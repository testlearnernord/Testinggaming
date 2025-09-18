const globalScope =
  (typeof window !== "undefined" && window) ||
  (typeof self !== "undefined" && self) ||
  (typeof globalThis !== "undefined" && globalThis) ||
  Function("return this")();

const dataExports = globalScope && globalScope.PoopboyData;

if (!dataExports || typeof dataExports !== "object") {
  throw new Error("Poopboy data module missing – ensure data.js is loaded before main.js");
}

const {
  APP_VERSION,
  SAVE_KEY,
  GAME_VERSION,
  DEBUG,
  WORLD,
  MAPDATA,
  NPCS,
  HOUSES,
  PLANTS,
  ECON,
  CAN_MAX,
  SPAWN,
  STONE,
  CONTROLS,
  FLAGS,
  isBlockingSymbol,
  clamp,
  resolveAsset,
} = dataExports;

const sfxExports = (globalScope && globalScope.PoopboySfx) || {};

const globalSfx = sfxExports.globalSfx || {
  unlock: () => Promise.resolve(false),
  play: () => {},
  startLoop: () => null,
  stopLoop: () => {},
};

const primeAudioUnlock =
  typeof sfxExports.primeAudioUnlock === "function"
    ? sfxExports.primeAudioUnlock
    : function primeAudioUnlockFallback() {};

const TAU = Math.PI * 2;
const TILE = WORLD.tileSize;
const SAVE_DEBOUNCE_MS = 800;
const STONE_RADIUS = TILE * 0.35;
const PLAYER_RADIUS = TILE * 0.32;

const coarseQuery = window.matchMedia ? window.matchMedia("(pointer: coarse)") : null;
const FULLSCREEN_KEYS = new Set([
  "w",
  "a",
  "s",
  "d",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "shift",
  " ",
]);

const PLAYER_COLORS = {
  skin: "#f6e0c8",
  hair: "#3b2e24",
  shirt: "#4f79b7",
  strap: "#f1b24c",
  pants: "#2f3e59",
  eyes: "#1b1a1a",
};

const PLANT_ORDER = ["corn", "cabbage", "moonflower"];
const SKY_TOP_DAY = "#1c3850";
const SKY_BOTTOM_DAY = "#09131b";
const SKY_TOP_NIGHT = "#04060d";
const SKY_BOTTOM_NIGHT = "#020307";
const SKY_TOP_DAWN = "#2c1f3a";
const SKY_BOTTOM_DAWN = "#120d19";

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean, 16);
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

function mixColor(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const r = Math.round(lerp(ca.r, cb.r, t));
  const g = Math.round(lerp(ca.g, cb.g, t));
  const bVal = Math.round(lerp(ca.b, cb.b, t));
  return `rgb(${r}, ${g}, ${bVal})`;
}

const AREA_MAPPINGS = [
  { key: "fieldArea", symbol: "f" },
  { key: "yardArea", symbol: "y" },
  { key: "pondArea", symbol: "w" },
  { key: "clearingArea", symbol: "c" },
  { key: "quarryArea", symbol: "q" },
];
const RESERVED_AREA_SYMBOLS = new Set(["f", "y", "w"]);

let canvas = null;
let ctx = null;

function safeClone(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch (err) {
      console.warn("structuredClone failed", err);
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    console.warn("JSON clone failed", err);
    if (Array.isArray(value)) {
      return value.map(item => safeClone(item));
    }
    const copy = {};
    for (const key of Object.keys(value)) {
      copy[key] = safeClone(value[key]);
    }
    return copy;
  }
}
const hudElements = {
  version: null,
  health: null,
  poop: null,
  corn: null,
  cabbage: null,
  seed: null,
  moonseed: null,
  moonflower: null,
  money: null,
  ammo: null,
  water: null,
  stamina: null,
  day: null,
  clock: null,
  selection: null,
};
let joystickEl = null;
let joystickHandle = null;
let contextButton = null;
let restartButton = null;
let sprintButton = null;
let plantButton = null;
let dialogEl = null;
let dialogBody = null;
let dialogTitle = null;
let dialogSubtitle = null;
let dialogClose = null;
let editorPanel = null;
let editorBody = null;
let editorDescription = null;
let editorSave = null;
let editorReset = null;
let editorExit = null;
let toastEl = null;

let bootStarted = false;
let bootScheduled = false;

const state = {
  dpr: window.devicePixelRatio || 1,
  time: 0,
  lastTick: performance.now(),
  fps: 60,
  ready: false,
  keys: new Map(),
  once: new Set(),
  prefersTouch: coarseQuery ? coarseQuery.matches : "ontouchstart" in window,
  touchSprint: false,
  sprintPointerId: null,
  fullscreenAttempted: false,
  joystick: {
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    dx: 0,
    dy: 0,
  },
  map: null,
  player: null,
  stones: [],
  dirt: [],
  plants: new Map(),
  npcs: [],
  yard: {
    delivered: 0,
    total: 0,
    upgradeReady: false,
    upgradeNotified: false,
  },
  spawnTimers: {
    boulder: 0,
    dirt: 0,
  },
  nextSpawnDelay: SPAWN.boulderIntervalMs[0],
  contextAction: null,
  preview: null,
  dialog: { open: false },
  editor: {
    open: false,
    layout: null,
    order: [],
    index: 0,
  },
  saveTimer: null,
  camera: {
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
  },
  debugOverlay: DEBUG,
  prngSeed: Date.now() % 2147483647,
  day: {
    time: 0,
    length: WORLD.dayLength,
    phase: 0,
    count: 1,
    clock: "06:00",
    segment: "Morgen",
  },
  lighting: {
    ambient: 1,
  },
  fireflies: [],
  fireflyTimer: 0,
  unlocks: {
    moonflower: false,
  },
};

function seededRandom() {
  state.prngSeed = (state.prngSeed * 48271) % 2147483647;
  return state.prngSeed / 2147483647;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function seededBetween(min, max) {
  return min + seededRandom() * (max - min);
}

function tileKey(tx, ty, cols) {
  return ty * cols + tx;
}

function tileCenter(tx, ty) {
  return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
}

function randomPointInArea(area, { jitter = 0.6 } = {}) {
  if (!area) {
    return { x: 0, y: 0 };
  }
  const tx = area.x + Math.random() * area.w;
  const ty = area.y + Math.random() * area.h;
  const baseX = tx * TILE + TILE * 0.5;
  const baseY = ty * TILE + TILE * 0.5;
  const j = TILE * jitter * 0.5;
  return {
    x: baseX + (Math.random() - 0.5) * j,
    y: baseY + (Math.random() - 0.5) * j,
  };
}

function rectContains(rect, tx, ty) {
  return tx >= rect.x && ty >= rect.y && tx < rect.x + rect.w && ty < rect.y + rect.h;
}

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function areaSymbolAt(tx, ty, mapLike = state.map) {
  if (!mapLike) {
    return null;
  }
  for (const mapping of AREA_MAPPINGS) {
    const area = mapLike[mapping.key];
    if (area && rectContains(area, tx, ty)) {
      return mapping.symbol;
    }
  }
  return null;
}

function isReservedTile(tx, ty, mapLike = state.map) {
  const symbol = areaSymbolAt(tx, ty, mapLike);
  return symbol !== null && RESERVED_AREA_SYMBOLS.has(symbol);
}

function computeViewBounds(width, height, marginTiles = 1.5) {
  if (!state.map) {
    return {
      pixel: { left: 0, top: 0, right: width, bottom: height },
      tiles: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    };
  }
  const marginPx = marginTiles * TILE;
  const halfW = width / 2;
  const halfH = height / 2;
  const left = state.camera.x - halfW - marginPx;
  const right = state.camera.x + halfW + marginPx;
  const top = state.camera.y - halfH - marginPx;
  const bottom = state.camera.y + halfH + marginPx;
  const minX = Math.max(0, Math.floor(left / TILE));
  const maxX = Math.min(state.map.cols - 1, Math.ceil(right / TILE) - 1);
  const minY = Math.max(0, Math.floor(top / TILE));
  const maxY = Math.min(state.map.rows - 1, Math.ceil(bottom / TILE) - 1);
  return {
    pixel: { left, right, top, bottom },
    tiles: { minX, maxX, minY, maxY },
  };
}

function rectIntersectsView(x, y, width, height, view) {
  const right = x + width;
  const bottom = y + height;
  return right >= view.pixel.left && x <= view.pixel.right && bottom >= view.pixel.top && y <= view.pixel.bottom;
}

function applyInputMode() {
  if (typeof document === "undefined") return;
  const isDesktop = !state.prefersTouch;
  document.body.classList.toggle("desktop", isDesktop);
  if (isDesktop) {
    state.joystick.dx = 0;
    state.joystick.dy = 0;
    state.touchSprint = false;
    if (sprintButton) {
      sprintButton.classList.remove("active");
    }
  }
  resizeCanvas();
}

function watchInputMode() {
  if (!coarseQuery) {
    applyInputMode();
    return;
  }
  const handler = (event) => {
    state.prefersTouch = event.matches;
    applyInputMode();
  };
  if (typeof coarseQuery.addEventListener === "function") {
    coarseQuery.addEventListener("change", handler);
  } else if (typeof coarseQuery.addListener === "function") {
    coarseQuery.addListener(handler);
  }
  applyInputMode();
}

function initDom() {
  canvas = document.getElementById("game");
  hudElements.version = document.getElementById("hud-version");
  hudElements.health = document.querySelector("#hud-health [data-value]");
  hudElements.poop = document.querySelector("#hud-poop [data-value]");
  hudElements.corn = document.querySelector("#hud-corn [data-value]");
  hudElements.cabbage = document.querySelector("#hud-cabbage [data-value]");
  hudElements.seed = document.querySelector("#hud-seed [data-value]");
  hudElements.moonseed = document.querySelector("#hud-moonseed [data-value]");
  hudElements.moonflower = document.querySelector("#hud-moonflower [data-value]");
  hudElements.day = document.querySelector("#hud-day [data-value]");
  hudElements.clock = document.querySelector("#hud-clock [data-value]");
  hudElements.selection = document.querySelector("#hud-selection [data-value]");
  hudElements.money = document.querySelector("#hud-money [data-value]");
  hudElements.ammo = document.querySelector("#hud-ammo [data-value]");
  hudElements.water = document.querySelector("#hud-water [data-value]");
  hudElements.stamina = document.querySelector("#hud-stamina [data-value]");
  joystickEl = document.getElementById("joystick");
  joystickHandle = document.getElementById("joystick-handle");
  contextButton = document.getElementById("context-button");
  restartButton = document.getElementById("restart-button");
  sprintButton = document.getElementById("sprint-button");
  plantButton = document.getElementById("plant-button");
  dialogEl = document.getElementById("dialog");
  dialogBody = document.getElementById("dialog-body");
  dialogTitle = document.getElementById("dialog-title");
  dialogSubtitle = document.getElementById("dialog-subtitle");
  dialogClose = document.getElementById("dialog-close");
  editorPanel = document.getElementById("editor-panel");
  editorBody = document.getElementById("editor-body");
  editorDescription = document.getElementById("editor-description");
  editorSave = document.getElementById("editor-save");
  editorReset = document.getElementById("editor-reset");
  editorExit = document.getElementById("editor-exit");
  toastEl = document.getElementById("toast");

  const iconNodes = document.querySelectorAll(".hud__icon[data-icon]");
  for (const icon of iconNodes) {
    const assetPath = icon.getAttribute("data-icon");
    if (assetPath) {
      icon.src = resolveAsset(assetPath);
    }
  }
}

function failBoot(err) {
  console.error("Poopboy boot failed", err);
  if (toastEl) {
    toastEl.textContent = `Fehler beim Start: ${err.message}`;
    toastEl.classList.add("show");
  }
  if (canvas) {
    const fallback = canvas.getContext("2d");
    fallback.fillStyle = "#0b0f14";
    fallback.fillRect(0, 0, canvas.width, canvas.height);
    fallback.fillStyle = "#f86f6f";
    fallback.font = "16px sans-serif";
    fallback.fillText("Bitte Hard-Reload (Ctrl/Cmd+Shift+R)", 24, 32);
  }
}

function createMap() {
  const rows = MAPDATA.layout.length;
  const cols = MAPDATA.layout[0].length;
  const tiles = new Array(rows * cols);
  const blocking = new Set();
  for (let ty = 0; ty < rows; ty++) {
    const row = MAPDATA.layout[ty];
    for (let tx = 0; tx < cols; tx++) {
      const sym = row[tx];
      tiles[tileKey(tx, ty, cols)] = sym;
      if (isBlockingSymbol(sym)) {
        blocking.add(tileKey(tx, ty, cols));
      }
    }
  }
  return {
    rows,
    cols,
    tiles,
    blocking,
    spawnable: rebuildSpawnable({
      fieldArea: { ...MAPDATA.fieldArea },
      yardArea: { ...MAPDATA.yardArea },
      pondArea: { ...MAPDATA.pondArea },
      clearingArea: { ...MAPDATA.clearingArea },
      quarryArea: { ...MAPDATA.quarryArea },
    }),
    fieldArea: { ...MAPDATA.fieldArea },
    yardArea: { ...MAPDATA.yardArea },
    pondArea: { ...MAPDATA.pondArea },
    clearingArea: { ...MAPDATA.clearingArea },
    quarryArea: { ...MAPDATA.quarryArea },
    editorTable: { ...MAPDATA.editorTable },
  };
}

function rebuildSpawnable(areas) {
  const rows = MAPDATA.layout.length;
  const cols = MAPDATA.layout[0].length;
  const spots = [];
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const sym = MAPDATA.layout[ty][tx];
      if (isStoneSpawnable(sym, tx, ty, areas)) {
        spots.push({ tx, ty });
      }
    }
  }
  return spots;
}

function isStoneSpawnable(sym, tx, ty, areas) {
  const areaSource = areas || (state && state.map) || MAPDATA;
  const areaSymbol = areaSymbolAt(tx, ty, areaSource);
  const inField = areaSymbol === "f";
  const inYard = areaSymbol === "y";
  const inPond = areaSymbol === "w";
  const inClearing = areaSymbol === "c";
  const inQuarry = areaSymbol === "q";
  if (sym === "f" && !inField) sym = ".";
  if (sym === "y" && !inYard) sym = ".";
  if (sym === "w" && !inPond) sym = ".";
  if (sym === "c" && !inClearing) sym = ".";
  if (sym === "q" && !inQuarry) sym = ".";
  if (sym === "h" || sym === "y" || sym === "w" || sym === "c" || sym === "f" || sym === "d" || sym === "b" || sym === "s" || sym === "t" || sym === "x") {
    return false;
  }
  if (inField || inYard || inPond || inClearing) return false;
  return true;
}

function createPlayer() {
  const spawn = MAPDATA.playerSpawn;
  return {
    x: spawn.x * TILE,
    y: spawn.y * TILE,
    vx: 0,
    vy: 0,
    dir: { x: 0, y: 1 },
    speed: WORLD.walkSpeed,
    maxStamina: WORLD.staminaMax,
    stamina: WORLD.staminaMax,
    isSprinting: false,
    isMoving: false,
    stepTimer: 0,
    anim: {
      phase: 0,
      facing: "down",
      stride: 0,
      bob: 0,
      expression: "calm",
    },
    hearts: WORLD.maxHearts,
    money: 0,
    poop: 0,
    corn: 0,
    cabbage: 0,
    cabbageSeed: 0,
    moonflower: 0,
    moonflowerSeed: 0,
    ammo: 0,
    carrying: null,
    watering: {
      charges: WORLD.baseWater,
      max: WORLD.baseWater,
    },
    upgrades: {
      watering: false,
      shoes: false,
      crusher: false,
      cart: false,
    },
    yardDelivered: 0,
    yardTotal: 0,
    selectedPlant: "corn",
  };
}

function setupCanvas() {
  if (!canvas) throw new Error("Canvas not found");
  ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D Kontext nicht verfügbar");
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas, { passive: true });
}

function resizeCanvas() {
  if (!canvas || !ctx) return;
  const dpr = window.devicePixelRatio || 1;
  let width;
  let height;
  if (!state.prefersTouch) {
    width = window.innerWidth || canvas.clientWidth;
    height = window.innerHeight || canvas.clientHeight;
  } else {
    const parent = canvas.parentElement;
    width = parent ? parent.clientWidth : window.innerWidth;
    const aspect = 16 / 9;
    height = width / aspect;
    const maxHeight = window.innerHeight ? window.innerHeight * 0.92 : height;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * aspect;
    }
  }
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.dpr = dpr;
}

function buildNPCs() {
  return NPCS.map(npc => ({ ...npc, x: npc.pos.x * TILE, y: npc.pos.y * TILE }));
}

function worldToTile(x, y) {
  return { tx: Math.floor(x / TILE), ty: Math.floor(y / TILE) };
}

function tileAt(tx, ty) {
  if (!state.map) return "x";
  if (tx < 0 || ty < 0 || tx >= state.map.cols || ty >= state.map.rows) return "x";
  let sym = state.map.tiles[tileKey(tx, ty, state.map.cols)];
  const areaSymbol = areaSymbolAt(tx, ty);
  if (areaSymbol) return areaSymbol;
  if (sym === "f" || sym === "y" || sym === "w" || sym === "c" || sym === "q") return ".";
  return sym;
}

function tileWalkable(tx, ty) {
  const sym = tileAt(tx, ty);
  return sym === "." || sym === "p" || sym === "q" || sym === "c" || sym === "f" || sym === "y" || sym === "d" || sym === "b" || sym === "s" || sym === "t";
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    if (typeof data.version !== "number" || data.version > GAME_VERSION) return null;
    return data;
  } catch (err) {
    console.warn("save parse failed", err);
    return null;
  }
}

function sanitizeNumber(value, fallback, min = -Infinity, max = Infinity) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return clamp(num, min, max);
}
function applySave(data) {
  const player = state.player;
  const savedPlayer = data.player || {};
  player.x = sanitizeNumber(savedPlayer.x, player.x);
  player.y = sanitizeNumber(savedPlayer.y, player.y);
  player.money = clamp(sanitizeNumber(savedPlayer.money, player.money), 0, 9999);
  player.poop = clamp(sanitizeNumber(savedPlayer.poop, player.poop), 0, WORLD.inventoryLimit);
  player.corn = clamp(sanitizeNumber(savedPlayer.corn, player.corn), 0, WORLD.inventoryLimit);
  player.cabbage = clamp(sanitizeNumber(savedPlayer.cabbage, player.cabbage), 0, WORLD.inventoryLimit);
  player.cabbageSeed = clamp(sanitizeNumber(savedPlayer.cabbageSeed, player.cabbageSeed), 0, WORLD.inventoryLimit);
  player.moonflower = clamp(sanitizeNumber(savedPlayer.moonflower, player.moonflower), 0, WORLD.inventoryLimit);
  player.moonflowerSeed = clamp(sanitizeNumber(savedPlayer.moonflowerSeed, player.moonflowerSeed), 0, WORLD.inventoryLimit);
  player.ammo = clamp(sanitizeNumber(savedPlayer.ammo, player.ammo), 0, WORLD.inventoryLimit);
  player.stamina = clamp(sanitizeNumber(savedPlayer.stamina, player.stamina), 0, player.maxStamina);
  player.hearts = clamp(sanitizeNumber(savedPlayer.hearts, player.hearts), 1, WORLD.maxHearts);
  player.yardDelivered = clamp(sanitizeNumber(savedPlayer.yardDelivered, player.yardDelivered), 0, WORLD.yardBatch);
  player.yardTotal = clamp(sanitizeNumber(savedPlayer.yardTotal, player.yardTotal), 0, 9999);
  if (savedPlayer.selectedPlant && PLANTS[savedPlayer.selectedPlant]) {
    player.selectedPlant = savedPlayer.selectedPlant;
  }
  if (savedPlayer.watering) {
    const charges = clamp(sanitizeNumber(savedPlayer.watering.charges, player.watering.charges), 0, CAN_MAX);
    player.watering.charges = charges;
  }
  if (savedPlayer.upgrades) {
    player.upgrades.watering = Boolean(savedPlayer.upgrades.watering);
    player.upgrades.shoes = Boolean(savedPlayer.upgrades.shoes);
    player.upgrades.crusher = Boolean(savedPlayer.upgrades.crusher);
    player.upgrades.cart = Boolean(savedPlayer.upgrades.cart);
    if (player.upgrades.watering) {
      player.watering.max = CAN_MAX;
      player.watering.charges = clamp(player.watering.charges, 0, CAN_MAX);
    }
  }
  if (data.yard) {
    state.yard.delivered = clamp(sanitizeNumber(data.yard.delivered, state.yard.delivered), 0, WORLD.yardBatch);
    state.yard.total = clamp(sanitizeNumber(data.yard.total, state.yard.total), 0, 9999);
    state.yard.upgradeReady = Boolean(data.yard.upgradeReady);
    state.yard.upgradeNotified = Boolean(data.yard.upgradeNotified);
  }
  if (data.editorLayout) {
    state.editor.layout = safeClone(data.editorLayout);
    applyEditorLayout(data.editorLayout, false);
  }
  if (data.unlocks && typeof data.unlocks === "object") {
    state.unlocks.moonflower = Boolean(data.unlocks.moonflower);
  } else if (player.moonflowerSeed > 0 || player.moonflower > 0) {
    state.unlocks.moonflower = true;
  }
  if (data.day) {
    const len = WORLD.dayLength;
    const savedTime = sanitizeNumber(data.day.time, state.day.time, 0, len);
    state.day.time = savedTime;
    state.day.count = clamp(sanitizeNumber(data.day.count, state.day.count), 1, 9999);
    syncDayState();
  }
  loadActorsFromSave(data);
}

function loadActorsFromSave(data) {
  state.stones = [];
  state.dirt = [];
  state.plants.clear();
  const stones = Array.isArray(data.stones) ? data.stones : [];
  for (const stone of stones) {
    if (!stone || typeof stone !== "object") continue;
    const x = sanitizeNumber(stone.x, null);
    const y = sanitizeNumber(stone.y, null);
    if (x === null || y === null) continue;
    state.stones.push(makeStone(x, y));
  }
  const dirt = Array.isArray(data.dirt) ? data.dirt : [];
  for (const clod of dirt) {
    if (!clod || typeof clod !== "object") continue;
    const x = sanitizeNumber(clod.x, null);
    const y = sanitizeNumber(clod.y, null);
    if (x === null || y === null) continue;
    state.dirt.push(makeDirt(x, y));
  }
  const plants = Array.isArray(data.plants) ? data.plants : [];
  for (const savedPlant of plants) {
    if (!savedPlant || typeof savedPlant !== "object") continue;
    const kind = typeof savedPlant.kind === "string" ? savedPlant.kind : "";
    const spec = PLANTS[kind];
    if (!spec) continue;
    const tx = sanitizeNumber(savedPlant.tx, null);
    const ty = sanitizeNumber(savedPlant.ty, null);
    if (tx === null || ty === null) continue;
    const plantedAt = sanitizeNumber(savedPlant.plantedAt, state.time * 1000);
    const growMs = sanitizeNumber(savedPlant.growMs, spec.growMs);
    const growDuration = Number.isFinite(growMs) ? growMs : spec.growMs;
    const readyAt = sanitizeNumber(savedPlant.readyAt, plantedAt + growDuration);
    let stage = typeof savedPlant.stage === "string" ? savedPlant.stage : "growing";
    if (stage !== "ready" && stage !== "failed") stage = "growing";
    const watered = Boolean(savedPlant.watered);
    let maxWatered = 0;
    if (Number.isFinite(spec.wateredTotalMs)) {
      maxWatered = spec.wateredTotalMs;
    } else if (Number.isFinite(spec.growMs)) {
      maxWatered = spec.growMs;
    }
    const wateredMs = clamp(sanitizeNumber(savedPlant.wateredMs, 0), 0, maxWatered);
    const success = savedPlant.success !== false;
    state.plants.set(tileKey(tx, ty, state.map.cols), {
      id: `${kind}-${tx}-${ty}`,
      kind,
      tx,
      ty,
      plantedAt,
      readyAt,
      stage,
      watered,
      wateredMs,
      success,
    });
  }
}

function makeStone(x, y) {
  return { id: `stone-${Math.random().toString(36).slice(2)}`, x, y, radius: STONE_RADIUS };
}

function makeDirt(x, y) {
  return { id: `dirt-${Math.random().toString(36).slice(2)}`, x, y, radius: TILE * 0.25 };
}

function initWorld() {
  state.map = createMap();
  state.player = createPlayer();
  state.npcs = buildNPCs();
  state.stones = [];
  state.dirt = [];
  state.plants.clear();
  state.fireflies = [];
  state.fireflyTimer = 0;
  state.day.length = WORLD.dayLength;
  state.day.time = state.day.length * 0.25;
  state.day.count = 1;
  state.unlocks = { moonflower: false };
  syncDayState();
  state.yard = { delivered: 0, total: 0, upgradeReady: false, upgradeNotified: false };
  state.spawnTimers.boulder = 0;
  state.spawnTimers.dirt = 0;
  state.nextSpawnDelay = randomBetween(SPAWN.boulderIntervalMs[0], SPAWN.boulderIntervalMs[1]);
  state.camera.x = state.player.x;
  state.camera.y = state.player.y;
  const save = loadSave();
  if (save) {
    applySave(save);
  } else {
    spawnInitialActors();
  }
  syncDayState();
  updateHud();
}

function spawnInitialActors() {
  for (let i = 0; i < SPAWN.boulderInit; i++) {
    spawnStone();
  }
  for (let i = 0; i < SPAWN.dirtInit; i++) {
    spawnDirt();
  }
}

function spawnStone() {
  if (!state.map || state.stones.length >= SPAWN.boulderCap) return;
  const choices = state.map.spawnable;
  if (!choices.length) return;
  for (let i = 0; i < 12; i++) {
    const spot = choices[Math.floor(seededRandom() * choices.length)];
    const { x, y } = tileCenter(spot.tx, spot.ty);
    if (!positionBlocked(x, y, STONE_RADIUS * 1.4)) {
      state.stones.push(makeStone(x, y));
      break;
    }
  }
}

function spawnDirt() {
  if (!state.map) return;
  const choices = state.map.spawnable;
  if (!choices.length) return;
  for (let i = 0; i < 12; i++) {
    const spot = choices[Math.floor(Math.random() * choices.length)];
    const { x, y } = tileCenter(spot.tx, spot.ty);
    if (!positionBlocked(x, y, TILE * 0.5)) {
      state.dirt.push(makeDirt(x, y));
      break;
    }
  }
}

function positionBlocked(x, y, radius) {
  const { tx, ty } = worldToTile(x, y);
  if (!tileWalkable(tx, ty)) return true;
  if (isReservedTile(tx, ty)) return true;
  for (const stone of state.stones) {
    if (distance(x, y, stone.x, stone.y) < radius + stone.radius) return true;
  }
  return false;
}

function setupInput() {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  if (contextButton) contextButton.addEventListener("click", () => triggerContextAction());
  if (restartButton) restartButton.addEventListener("click", () => resetGame());
  if (dialogClose) dialogClose.addEventListener("click", closeDialog);
  if (editorSave) editorSave.addEventListener("click", () => saveEditorLayout());
  if (editorReset) editorReset.addEventListener("click", () => resetEditorLayout());
  if (editorExit) editorExit.addEventListener("click", () => exitEditor());
  setupJoystick();
  setupSprintButton();
  if (plantButton) plantButton.addEventListener("click", () => cyclePlantSelection());
}

function onKeyDown(ev) {
  const key = ev.key.toLowerCase();
  maybeEnterFullscreen(key);
  if (key === " " || key === "spacebar" || key === "space") {
    ev.preventDefault();
    triggerContextAction();
  }
  if (key === "1") {
    setSelectedPlant("corn");
  } else if (key === "2") {
    setSelectedPlant("cabbage");
  } else if (key === "3") {
    setSelectedPlant("moonflower");
  }
  state.keys.set(key, true);
}

function onKeyUp(ev) {
  const key = ev.key.toLowerCase();
  state.keys.delete(key);
  state.once.delete(key);
}

function onBlur() {
  state.keys.clear();
  state.once.clear();
  state.touchSprint = false;
  if (sprintButton) {
    sprintButton.classList.remove("active");
  }
}
function setupJoystick() {
  if (!joystickEl || !joystickHandle) return;
  joystickEl.addEventListener("pointerdown", onJoyPointerDown);
  window.addEventListener("pointermove", onJoyPointerMove);
  window.addEventListener("pointerup", onJoyPointerUp);
  window.addEventListener("pointercancel", onJoyPointerUp);
}

function setupSprintButton() {
  if (!sprintButton) return;
  const release = () => {
    state.touchSprint = false;
    state.sprintPointerId = null;
    sprintButton.classList.remove("active");
  };
  sprintButton.addEventListener("pointerdown", ev => {
    ev.preventDefault();
    state.touchSprint = true;
    state.sprintPointerId = ev.pointerId;
    sprintButton.classList.add("active");
    if (typeof sprintButton.setPointerCapture === "function") {
      sprintButton.setPointerCapture(ev.pointerId);
    }
  });
  sprintButton.addEventListener("pointerup", release);
  sprintButton.addEventListener("pointercancel", release);
  sprintButton.addEventListener("pointerleave", release);
  window.addEventListener("pointerup", release);
}

function getSelectablePlants() {
  const options = [];
  for (const kind of PLANT_ORDER) {
    if (kind === "moonflower" && !state.unlocks.moonflower && state.player.moonflowerSeed <= 0 && state.player.moonflower <= 0) {
      continue;
    }
    if (!PLANTS[kind]) continue;
    options.push(kind);
  }
  return options;
}

function getPlantLabel(kind) {
  const def = PLANTS[kind];
  if (def && typeof def.label === "string") {
    return def.label;
  }
  return kind;
}

function setSelectedPlant(kind, { silent = false } = {}) {
  if (!PLANTS[kind]) return;
  if (kind === "moonflower" && !state.unlocks.moonflower && state.player.moonflowerSeed <= 0 && state.player.moonflower <= 0) {
    showToast("Mondbohnen noch nicht freigeschaltet");
    return;
  }
  if (state.player.selectedPlant === kind) return;
  state.player.selectedPlant = kind;
  if (!silent) {
    showToast(`Saat: ${getPlantLabel(kind)}`);
  }
  updateHud();
}

function cyclePlantSelection(direction = 1) {
  const options = getSelectablePlants();
  if (!options.length) return;
  let index = options.indexOf(state.player.selectedPlant);
  if (index === -1) index = 0;
  const next = (index + direction + options.length) % options.length;
  setSelectedPlant(options[next]);
}

function maybeEnterFullscreen(key) {
  if (state.prefersTouch || state.fullscreenAttempted) return;
  if (!FULLSCREEN_KEYS.has(key)) return;
  state.fullscreenAttempted = true;
  if (document.fullscreenElement) return;
  const root = document.documentElement;
  if (!root || !root.requestFullscreen) return;
  try {
    root.requestFullscreen();
  } catch (err) {
    console.warn("fullscreen request failed", err);
  }
}

function onJoyPointerDown(ev) {
  if (state.joystick.active) return;
  state.joystick.active = true;
  state.joystick.pointerId = ev.pointerId;
  const rect = joystickEl.getBoundingClientRect();
  state.joystick.startX = rect.left + rect.width / 2;
  state.joystick.startY = rect.top + rect.height / 2;
  state.joystick.dx = 0;
  state.joystick.dy = 0;
  joystickEl.setPointerCapture(ev.pointerId);
}

function onJoyPointerMove(ev) {
  if (!state.joystick.active || ev.pointerId !== state.joystick.pointerId) return;
  const dx = ev.clientX - state.joystick.startX;
  const dy = ev.clientY - state.joystick.startY;
  const radius = joystickEl.clientWidth / 2;
  let nx = dx / radius;
  let ny = dy / radius;
  const len = Math.hypot(nx, ny);
  if (len > 1) {
    nx /= len;
    ny /= len;
  }
  state.joystick.dx = nx;
  state.joystick.dy = ny;
  if (joystickHandle) {
    joystickHandle.style.transform = `translate(${nx * radius * 0.55}px, ${ny * radius * 0.55}px)`;
  }
}

function onJoyPointerUp(ev) {
  if (!state.joystick.active || ev.pointerId !== state.joystick.pointerId) return;
  state.joystick.active = false;
  state.joystick.pointerId = null;
  state.joystick.dx = 0;
  state.joystick.dy = 0;
  if (joystickHandle) {
    joystickHandle.style.transform = "translate(-50%, -50%)";
  }
}

function triggerContextAction() {
  if (state.dialog.open) {
    closeDialog();
    return;
  }
  if (state.editor.open) {
    exitEditor();
    return;
  }
  const action = state.contextAction;
  if (action && !action.disabled && typeof action.handler === "function") {
    action.handler();
  }
}

function resetGame() {
  localStorage.removeItem(SAVE_KEY);
  applyEditorLayout(loadEditorLayoutFromStorage() || buildCurrentEditorLayout(), false);
  initWorld();
  showToast("Neustart abgeschlossen");
}

function openDialog({ title, subtitle = "", actions = [] }) {
  if (!dialogEl || !dialogBody || !dialogTitle) {
    console.warn("dialog DOM missing");
    return;
  }
  state.dialog.open = true;
  dialogTitle.textContent = title;
  if (dialogSubtitle) {
    dialogSubtitle.textContent = subtitle;
  }
  dialogBody.innerHTML = "";
  actions.forEach(action => {
    const btn = document.createElement("button");
    btn.className = "action-btn";
    btn.type = "button";
    btn.disabled = Boolean(action.disabled);
    const titleEl = document.createElement("strong");
    titleEl.textContent = action.label;
    btn.appendChild(titleEl);
    if (action.description) {
      const descEl = document.createElement("span");
      descEl.textContent = action.description;
      btn.appendChild(descEl);
    }
    btn.addEventListener("click", () => {
      if (action.disabled) return;
      if (typeof action.onSelect === "function") {
        action.onSelect();
      }
      closeDialog();
    });
    dialogBody.appendChild(btn);
  });
  dialogEl.classList.add("open");
  if (contextButton) {
    contextButton.textContent = "Schließen";
  }
}

function closeDialog() {
  state.dialog.open = false;
  if (dialogEl) {
    dialogEl.classList.remove("open");
  }
  if (contextButton && !state.editor.open) {
    contextButton.textContent = "Aktion";
  }
}

function showToast(message, duration = 2800) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add("show");
  window.setTimeout(() => toastEl.classList.remove("show"), duration);
}

function updateHud() {
  if (hudElements.version) {
    hudElements.version.textContent = APP_VERSION;
  }
  const player = state.player;
  if (hudElements.health) hudElements.health.textContent = `${player.hearts}`;
  if (hudElements.poop) hudElements.poop.textContent = `${player.poop}`;
  if (hudElements.corn) hudElements.corn.textContent = `${player.corn}`;
  if (hudElements.cabbage) hudElements.cabbage.textContent = `${player.cabbage}`;
  if (hudElements.seed) hudElements.seed.textContent = `${player.cabbageSeed}`;
  if (hudElements.moonseed) hudElements.moonseed.textContent = `${player.moonflowerSeed}`;
  if (hudElements.moonflower) hudElements.moonflower.textContent = `${player.moonflower}`;
  if (hudElements.money) hudElements.money.textContent = `${player.money}`;
  if (hudElements.ammo) hudElements.ammo.textContent = `${player.ammo}`;
  if (hudElements.water) hudElements.water.textContent = `${player.watering.charges}/${player.watering.max}`;
  if (hudElements.stamina) {
    const pct = Math.round((player.stamina / player.maxStamina) * 100);
    hudElements.stamina.textContent = `${pct}%`;
  }
  if (hudElements.day) {
    hudElements.day.textContent = `Tag ${state.day.count} – ${state.day.segment}`;
  }
  if (hudElements.clock) {
    hudElements.clock.textContent = state.day.clock;
  }
  if (hudElements.selection) {
    const label = getPlantLabel(player.selectedPlant);
    hudElements.selection.textContent = label;
  }
  if (plantButton) {
    const label = getPlantLabel(player.selectedPlant);
    plantButton.textContent = `Saat: ${label}`;
    plantButton.disabled = getSelectablePlants().length <= 1;
  }
  if (state.contextAction) {
    if (contextButton) {
      contextButton.textContent = state.contextAction.label;
      contextButton.disabled = Boolean(state.contextAction.disabled);
    }
  } else if (contextButton) {
    contextButton.textContent = "Aktion";
    contextButton.disabled = true;
  }
}

function mainLoop(now) {
  if (!state.ready) return;
  const dt = Math.min(0.1, Math.max(0.001, (now - state.lastTick) / 1000));
  state.lastTick = now;
  state.time += dt;
  state.fps = state.fps * 0.9 + (1 / dt) * 0.1;
  update(dt);
  render();
  requestAnimationFrame(mainLoop);
}

function update(dt) {
  if (state.dialog.open || state.editor.open) {
    state.contextAction = state.dialog.open
      ? { label: "Schließen", handler: closeDialog }
      : { label: "Editor schließen", handler: exitEditor };
    updateHud();
    return;
  }
  updateDayNight(dt);
  handleSpawns(dt);
  updatePlayer(dt);
  updatePlants(dt);
  updateFireflies(dt);
  state.contextAction = resolveContextAction();
  updateHud();
  maybeSave();
}

function handleSpawns(dt) {
  state.spawnTimers.boulder += dt * 1000;
  state.spawnTimers.dirt += dt * 1000;
  if (state.spawnTimers.boulder >= state.nextSpawnDelay) {
    spawnStone();
    state.spawnTimers.boulder = 0;
    const modifier = isNight() ? 0.8 : 1;
    state.nextSpawnDelay = randomBetween(SPAWN.boulderIntervalMs[0], SPAWN.boulderIntervalMs[1]) * modifier;
  }
  const dirtInterval = isNight() ? 12000 : 16000;
  if (state.spawnTimers.dirt >= dirtInterval) {
    spawnDirt();
    state.spawnTimers.dirt = 0;
  }
}

function formatClockFromPhase(phase) {
  const hoursFloat = (phase * 24) % 24;
  const hours = Math.floor(hoursFloat);
  const minutes = Math.floor((hoursFloat - hours) * 60);
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

function resolveDaySegment(phase) {
  if (phase < 0.2) return "Morgen";
  if (phase < 0.45) return "Tag";
  if (phase < 0.65) return "Abend";
  if (phase < 0.85) return "Nacht";
  return "Späte Nacht";
}

function computeAmbientLight(phase) {
  const wave = (Math.cos((phase - 0.5) * TAU) + 1) / 2;
  return clamp(0.22 + wave * 0.78, 0.18, 1);
}

function syncDayState() {
  const length = Math.max(60, WORLD.dayLength || 240);
  state.day.length = length;
  if (!Number.isFinite(state.day.time)) {
    state.day.time = 0;
  }
  while (state.day.time < 0) state.day.time += length;
  while (state.day.time >= length) state.day.time -= length;
  state.day.phase = state.day.time / length;
  state.day.clock = formatClockFromPhase(state.day.phase);
  state.day.segment = resolveDaySegment(state.day.phase);
  state.lighting.ambient = FLAGS.dayNightEnabled ? computeAmbientLight(state.day.phase) : 1;
}

function isNightPhase(phase) {
  return phase >= 0.7 || phase <= 0.22;
}

function isNight() {
  if (!FLAGS.dayNightEnabled) return false;
  return isNightPhase(state.day.phase);
}

function updateDayNight(dt) {
  if (!FLAGS.dayNightEnabled) return;
  state.day.time += dt;
  if (state.day.time >= state.day.length) {
    state.day.time -= state.day.length;
    state.day.count += 1;
  }
  syncDayState();
}

function updateFireflies(dt) {
  if (!FLAGS.dayNightEnabled) return;
  const active = isNight();
  const targetCount = active ? 18 : 0;
  if (active) {
    state.fireflyTimer += dt;
    const spawnInterval = 0.25;
    while (state.fireflies.length < targetCount && state.fireflyTimer >= spawnInterval) {
      state.fireflyTimer -= spawnInterval;
      spawnFirefly();
    }
  } else {
    state.fireflyTimer = 0;
  }
  for (let i = state.fireflies.length - 1; i >= 0; i--) {
    const fly = state.fireflies[i];
    fly.age += dt;
    fly.pulse += dt * fly.pulseSpeed;
    fly.angle += dt * fly.drift;
    fly.x = fly.baseX + Math.sin(fly.angle) * fly.swing;
    fly.y = fly.baseY + Math.cos(fly.angle * 0.8) * fly.swing * 0.6;
    const lifeDelta = active ? dt * 1.8 : -dt * 1.4;
    fly.life = clamp(fly.life + lifeDelta, 0, 1);
    if (!active && fly.life <= 0.02 && fly.age > 1.2) {
      state.fireflies.splice(i, 1);
    }
  }
  if (active && state.fireflies.length > targetCount) {
    state.fireflies.length = targetCount;
  }
}

function spawnFirefly() {
  const area = state.map && state.map.pondArea ? state.map.pondArea : MAPDATA.pondArea;
  if (!area) return;
  const point = randomPointInArea(area, { jitter: 1.1 });
  const baseY = point.y - TILE * 0.2 + Math.random() * TILE * 0.4;
  state.fireflies.push({
    baseX: point.x,
    baseY,
    x: point.x,
    y: baseY,
    swing: randomBetween(TILE * 0.18, TILE * 0.5),
    angle: Math.random() * TAU,
    drift: randomBetween(0.6, 1.3),
    pulse: Math.random() * TAU,
    pulseSpeed: randomBetween(1.6, 2.6),
    life: 0,
    age: 0,
  });
}

function updatePlayer(dt) {
  const player = state.player;
  const input = readMovementInput();
  let dx = input.x;
  let dy = input.y;
  const moving = input.magnitude > 0.01;
  if (moving) {
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    player.dir.x = dx;
    player.dir.y = dy;
    player.anim.facing = vectorToFacing(dx, dy, player.anim.facing);
  }
  let speed = player.speed;
  if (player.upgrades.shoes) {
    speed *= 1 + WORLD.shoesSpeedBonus;
  }
  let stamina = player.stamina;
  let sprinting = false;
  if (moving && input.sprint && stamina > 0.05) {
    sprinting = true;
    speed *= WORLD.sprintMultiplier;
    stamina = Math.max(0, stamina - WORLD.staminaDrain * dt);
  } else {
    const recovery = moving ? WORLD.staminaRecovery : WORLD.staminaIdleRecovery;
    stamina = Math.min(player.maxStamina, stamina + recovery * dt);
  }
  if (stamina <= 0.002) {
    sprinting = false;
  }
  player.stamina = clamp(stamina, 0, player.maxStamina);
  player.isSprinting = sprinting;
  player.isMoving = moving;
  if (player.carrying && player.carrying.kind === "stone") {
    speed *= STONE.carrySlow * (player.upgrades.cart ? STONE.cartBonus : 1);
  }
  const nextX = player.x + dx * speed * TILE * dt;
  const nextY = player.y + dy * speed * TILE * dt;
  const { x: resolvedX, y: resolvedY } = resolveCollisions(player.x, player.y, nextX, nextY, PLAYER_RADIUS);
  player.x = resolvedX;
  player.y = resolvedY;
  clampPlayerToBounds(player);
  updatePlayerAnimation(player, dt, moving, sprinting);
  handleFootsteps(player, dt, moving, sprinting);
  state.camera.targetX = player.x;
  state.camera.targetY = player.y;
  state.camera.x += (state.camera.targetX - state.camera.x) * 0.16;
  state.camera.y += (state.camera.targetY - state.camera.y) * 0.16;
}

function clampPlayerToBounds(player) {
  const minX = TILE * 1.5;
  const minY = TILE * 1.5;
  const maxX = (state.map.cols - 1.5) * TILE;
  const maxY = (state.map.rows - 1.5) * TILE;
  player.x = clamp(player.x, minX, maxX);
  player.y = clamp(player.y, minY, maxY);
}

function resolveCollisions(oldX, oldY, nextX, nextY, radius) {
  let x = nextX;
  let y = nextY;
  const sample = (sx, sy) => {
    const { tx, ty } = worldToTile(sx, sy);
    return tileWalkable(tx, ty);
  };
  if (!sample(x, oldY)) {
    x = oldX;
  }
  if (!sample(oldX, y)) {
    y = oldY;
  }
  for (const stone of state.stones) {
    if (state.player.carrying && state.player.carrying.id === stone.id) continue;
    const dist = distance(x, y, stone.x, stone.y);
    if (dist < radius + stone.radius) {
      const overlap = radius + stone.radius - dist;
      if (overlap > 0 && dist > 0.0001) {
        x += (x - stone.x) / dist * overlap;
        y += (y - stone.y) / dist * overlap;
      }
    }
  }
  return { x, y };
}

function readMovementInput() {
  let x = 0;
  let y = 0;
  const joyX = state.joystick.dx;
  const joyY = state.joystick.dy;
  const dead = CONTROLS.touchDeadZone;
  const joyMagnitude = Math.hypot(joyX, joyY);
  if (joyMagnitude > dead) {
    x += joyX;
    y += joyY;
  }
  if (isAnyPressed(CONTROLS.keyboard.left)) x -= 1;
  if (isAnyPressed(CONTROLS.keyboard.right)) x += 1;
  if (isAnyPressed(CONTROLS.keyboard.up)) y -= 1;
  if (isAnyPressed(CONTROLS.keyboard.down)) y += 1;
  let magnitude = Math.hypot(x, y);
  if (magnitude > 1) {
    x /= magnitude;
    y /= magnitude;
    magnitude = 1;
  }
  const sprintKey = !state.prefersTouch && isAnyPressed(CONTROLS.keyboard.sprint);
  const sprintTouch = state.prefersTouch && (state.touchSprint || joyMagnitude > 0.85);
  return { x, y, magnitude, sprint: sprintKey || sprintTouch };
}

function vectorToFacing(dx, dy, fallback = "down") {
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? "right" : "left";
  }
  if (Math.abs(dy) < 0.001) return fallback;
  return dy > 0 ? "down" : "up";
}

function updatePlayerAnimation(player, dt, moving, sprinting) {
  const anim = player.anim;
  if (!anim) return;
  const rate = sprinting ? WORLD.runAnimRate : WORLD.walkAnimRate;
  if (moving) {
    anim.phase = (anim.phase + dt * rate) % TAU;
    anim.stride = Math.sin(anim.phase);
    anim.bob = Math.abs(Math.sin(anim.phase * 0.5)) * (sprinting ? TILE * 0.22 : TILE * 0.16);
  } else {
    anim.phase = (anim.phase + dt * 3) % TAU;
    anim.stride *= Math.max(0, 1 - dt * 6);
    anim.bob *= Math.max(0, 1 - dt * 5);
  }
  if (player.carrying && player.carrying.kind === "stone") {
    anim.expression = "strain";
  } else if (sprinting) {
    anim.expression = "focus";
  } else if (moving) {
    anim.expression = "smile";
  } else {
    anim.expression = "calm";
  }
}

function handleFootsteps(player, dt, moving, sprinting) {
  if (!moving) {
    player.stepTimer = 0;
    return;
  }
  player.stepTimer += dt;
  const interval = sprinting ? WORLD.runStepInterval : WORLD.walkStepInterval;
  if (player.stepTimer < interval) return;
  player.stepTimer -= interval;
  const { tx, ty } = worldToTile(player.x, player.y);
  const surface = resolveFootstepSurface(tx, ty);
  playFootstepSound(surface, sprinting);
}

function resolveFootstepSurface(tx, ty) {
  const symbol = tileAt(tx, ty);
  if (symbol === "p" || symbol === "q" || symbol === "t" || symbol === "h" || symbol === "y" || symbol === "d" || symbol === "b" || symbol === "s") {
    return "stone";
  }
  if (symbol === "w") {
    return "soft";
  }
  return "grass";
}

function playFootstepSound(surface, sprinting) {
  if (sprinting) {
    globalSfx.play("footstepSprint", { volume: 0.42, cooldown: 0 });
    return;
  }
  if (surface === "stone") {
    globalSfx.play("footstepSoft", { volume: 0.34, cooldown: 0 });
  } else {
    globalSfx.play("footstepGrass", { volume: 0.32, cooldown: 0 });
  }
}

function isAnyPressed(list) {
  if (!list) return false;
  for (const key of list) {
    if (state.keys.has(key)) return true;
  }
  return false;
}

function updatePlants(dt) {
  const now = state.time * 1000;
  for (const plant of state.plants.values()) {
    if (plant.stage !== "growing") continue;
    if (plant.kind === "moonflower" && isNight()) {
      const def = PLANTS.moonflower;
      if (def) {
        const minMs = Number.isFinite(def.minMs) ? def.minMs : 0;
        const minReady = plant.plantedAt + minMs;
        plant.readyAt = Math.max(minReady, plant.readyAt - dt * 1000 * def.nightSpeed);
      }
    }
    if (now >= plant.readyAt) {
      plant.stage = plant.success ? "ready" : "failed";
    }
  }
}
function resolveContextAction() {
  const player = state.player;
  const { tx: playerTx, ty: playerTy } = worldToTile(player.x, player.y);
  if (areaSymbolAt(playerTx, playerTy) === "y" && player.carrying && player.carrying.kind === "stone") {
    return {
      label: `Abliefern (${player.yardDelivered}/5)`,
      handler: deliverStone,
    };
  }
  if (player.carrying && player.carrying.kind === "stone") {
    const preview = placementPreview();
    state.preview = preview;
    return {
      label: preview.valid ? "Stein platzieren" : "Kein Platz",
      handler: () => preview.valid && placeStone(preview.tx, preview.ty),
      disabled: !preview.valid,
    };
  } else {
    state.preview = null;
  }
  const dirt = findNearby(state.dirt, player.x, player.y, TILE * 0.6);
  if (dirt) {
    return {
      label: "Erdbrocken einsammeln",
      handler: () => collectDirt(dirt),
    };
  }
  const stone = findNearby(state.stones, player.x, player.y, TILE * 0.75);
  if (stone) {
    return {
      label: "Stein aufnehmen",
      handler: () => pickupStone(stone),
    };
  }
  const npc = findNPCNearby(player.x, player.y, TILE * 0.9);
  if (npc) {
    if (npc.id === "fred") return { label: "Fecalfreds Stand", handler: openFredShop };
    if (npc.id === "berta") return { label: "Bertas Werkbank", handler: openBertaShop };
    if (npc.id === "stefan") return { label: "Mit Stefan planen", handler: openStefanDialog };
  }
  const tableCenter = tileCenter(state.map.editorTable.x, state.map.editorTable.y);
  if (distance(player.x, player.y, tableCenter.x, tableCenter.y) < TILE) {
    return { label: "Editor öffnen", handler: enterEditor };
  }
  const front = getFrontTile();
  const key = tileKey(front.tx, front.ty, state.map.cols);
  const plant = state.plants.get(key);
  if (plant) {
    if (plant.stage === "ready") {
      return { label: "Ernten", handler: () => harvestPlant(plant) };
    }
    if (plant.stage === "growing" && state.player.watering.charges > 0) {
      return { label: "Gießen", handler: () => waterPlant(plant) };
    }
    if (plant.stage === "failed") {
      return { label: "Entfernen", handler: () => { state.plants.delete(key); scheduleSave(); } };
    }
  } else if (areaSymbolAt(front.tx, front.ty) === "f") {
    if (state.player.selectedPlant === "corn" && state.player.poop > 0) {
      return { label: "Mais säen", handler: () => plantCrop(front.tx, front.ty, "corn") };
    }
    if (state.player.selectedPlant === "cabbage" && state.player.cabbageSeed > 0) {
      return { label: "Kohl pflanzen", handler: () => plantCrop(front.tx, front.ty, "cabbage") };
    }
    if (state.player.selectedPlant === "moonflower") {
      const hasSeed = state.player.moonflowerSeed > 0;
      return {
        label: hasSeed ? "Mondbohne pflanzen" : "Keine Mondbohnen-Saat",
        handler: () => hasSeed && plantCrop(front.tx, front.ty, "moonflower"),
        disabled: !hasSeed,
      };
    }
  }
  if (tileAt(front.tx, front.ty) === "w" && state.player.watering.charges < state.player.watering.max) {
    return { label: "Gießkanne füllen", handler: refillWater };
  }
  return null;
}

function findNearby(list, x, y, radius) {
  for (const item of list) {
    if (distance(x, y, item.x, item.y) <= radius) return item;
  }
  return null;
}

function findNPCNearby(x, y, radius) {
  for (const npc of state.npcs) {
    if (distance(x, y, npc.x, npc.y) <= radius) return npc;
  }
  return null;
}

function placementPreview() {
  const front = getFrontTile();
  if (!front) return { valid: false };
  const { tx, ty } = front;
  if (!tileWalkable(tx, ty)) return { valid: false, tx, ty };
  if (isReservedTile(tx, ty)) return { valid: false, tx, ty };
  for (const stone of state.stones) {
    const { tx: sx, ty: sy } = worldToTile(stone.x, stone.y);
    if (sx === tx && sy === ty) return { valid: false, tx, ty };
  }
  return { valid: true, tx, ty };
}

function getFrontTile() {
  const player = state.player;
  let dirX = player.dir.x;
  let dirY = player.dir.y;
  if (!dirX && !dirY) dirY = 1;
  const fx = player.x + Math.sign(dirX) * TILE * 0.75;
  const fy = player.y + Math.sign(dirY) * TILE * 0.75;
  const { tx, ty } = worldToTile(fx, fy);
  return { tx, ty };
}

function pickupStone(stone) {
  const idx = state.stones.indexOf(stone);
  if (idx === -1) return;
  state.stones.splice(idx, 1);
  state.player.carrying = { kind: "stone", id: stone.id, stored: stone };
  globalSfx.play("pickup");
  scheduleSave();
}

function placeStone(tx, ty) {
  const player = state.player;
  if (!player.carrying || player.carrying.kind !== "stone") return;
  const { x, y } = tileCenter(tx, ty);
  const stone = player.carrying.stored;
  stone.x = x;
  stone.y = y;
  state.stones.push(stone);
  player.carrying = null;
  globalSfx.play("plant");
  scheduleSave();
}

function deliverStone() {
  const player = state.player;
  if (!player.carrying || player.carrying.kind !== "stone") return;
  player.carrying = null;
  player.yardDelivered = (player.yardDelivered + 1) % WORLD.yardBatch;
  player.yardTotal += 1;
  state.yard.delivered = player.yardDelivered;
  state.yard.total = player.yardTotal;
  if (player.yardDelivered === 0) {
    player.poop = clamp(player.poop + 1, 0, WORLD.inventoryLimit);
    showToast("Dünger erhalten");
  }
  if (player.yardTotal >= WORLD.yardUpgradeStones) {
    player.yardTotal = 0;
    state.yard.upgradeReady = true;
    state.yard.upgradeNotified = false;
    showToast("Neues bei Fecalfred!");
  }
  globalSfx.play("sell");
  scheduleSave();
}

function collectDirt(dirt) {
  const idx = state.dirt.indexOf(dirt);
  if (idx !== -1) state.dirt.splice(idx, 1);
  const baseChance = 0.1 + Math.random() * 0.05;
  const bonus = isNight() ? 0.08 : 0;
  if (Math.random() < Math.min(0.95, baseChance + bonus)) {
    state.player.poop = clamp(state.player.poop + 1, 0, WORLD.inventoryLimit);
    showToast(isNight() ? "Mondschein-Bonus: 💩 gefunden" : "Ein bisschen 💩 gefunden");
  }
  globalSfx.play("pickup");
  scheduleSave();
}

function plantCrop(tx, ty, kind) {
  const key = tileKey(tx, ty, state.map.cols);
  if (state.plants.has(key)) return;
  const plantDef = PLANTS[kind];
  const now = state.time * 1000;
  const plant = {
    id: `${kind}-${tx}-${ty}-${now}`,
    kind,
    tx,
    ty,
    plantedAt: now,
    readyAt: now + plantDef.growMs,
    stage: "growing",
    watered: false,
    wateredMs: 0,
    success: true,
  };
  if (kind === "corn") {
    state.player.poop = clamp(state.player.poop - plantDef.poopCost, 0, WORLD.inventoryLimit);
    plant.success = Math.random() < plantDef.chance;
    if (!plant.success) {
      plant.readyAt = now + 10000;
    }
  } else if (kind === "cabbage") {
    state.player.cabbageSeed = clamp(state.player.cabbageSeed - 1, 0, WORLD.inventoryLimit);
  } else if (kind === "moonflower") {
    state.player.moonflowerSeed = clamp(state.player.moonflowerSeed - 1, 0, WORLD.inventoryLimit);
    plant.success = true;
    state.unlocks.moonflower = true;
    const def = PLANTS.moonflower;
    if (def && isNight()) {
      const minMs = Number.isFinite(def.minMs) ? def.minMs : 0;
      const minReady = plant.plantedAt + minMs;
      plant.readyAt = Math.max(minReady, plant.readyAt - def.nightSpeed * 1000 * 6);
    }
  }
  state.plants.set(key, plant);
  globalSfx.play("plant");
  scheduleSave();
}

function waterPlant(plant) {
  if (state.player.watering.charges <= 0) return;
  state.player.watering.charges -= 1;
  plant.watered = true;
  if (plant.kind === "corn") {
    const def = PLANTS.corn;
    const minReady = plant.plantedAt + def.minMs;
    plant.readyAt = Math.max(minReady, plant.readyAt - def.waterBonusMs);
  } else if (plant.kind === "cabbage") {
    const def = PLANTS.cabbage;
    plant.readyAt = Math.min(plant.readyAt, plant.plantedAt + def.wateredTotalMs);
  } else if (plant.kind === "moonflower") {
    const def = PLANTS.moonflower;
    if (def) {
      const minMs = Number.isFinite(def.minMs) ? def.minMs : 0;
      const bonusMs = Number.isFinite(def.waterBonusMs) ? def.waterBonusMs : 0;
      const minReady = plant.plantedAt + minMs;
      plant.readyAt = Math.max(minReady, plant.readyAt - bonusMs);
    }
  }
  globalSfx.play("water");
  scheduleSave();
}

function harvestPlant(plant) {
  const key = tileKey(plant.tx, plant.ty, state.map.cols);
  state.plants.delete(key);
  if (plant.kind === "corn") {
    if (plant.success) {
      state.player.corn = clamp(state.player.corn + 1, 0, WORLD.inventoryLimit);
    }
  } else if (plant.kind === "cabbage") {
    state.player.cabbage = clamp(state.player.cabbage + 1, 0, WORLD.inventoryLimit);
  } else if (plant.kind === "moonflower") {
    state.player.moonflower = clamp(state.player.moonflower + 1, 0, WORLD.inventoryLimit);
    state.unlocks.moonflower = true;
  }
  globalSfx.play("pickup");
  scheduleSave();
}

function refillWater() {
  state.player.watering.charges = state.player.watering.max;
  globalSfx.play("water");
  scheduleSave();
}
function openFredShop() {
  const player = state.player;
  const actions = [];
  if (player.corn > 0) {
    actions.push({
      label: `Mais verkaufen (+${player.corn * ECON.cornSell} €)`,
      description: `${player.corn}x Mais`,
      onSelect: () => {
        player.money += player.corn * ECON.cornSell;
        player.corn = 0;
        globalSfx.play("sell");
        scheduleSave();
      },
    });
  }
  if (player.cabbage > 0) {
    actions.push({
      label: `Kohl verkaufen (+${player.cabbage * ECON.cabbageSell} €)`,
      description: `${player.cabbage}x Kohl`,
      onSelect: () => {
        player.money += player.cabbage * ECON.cabbageSell;
        player.cabbage = 0;
        globalSfx.play("sell");
        scheduleSave();
      },
    });
  }
  if (player.moonflower > 0) {
    actions.push({
      label: `Mondbohnen verkaufen (+${player.moonflower * ECON.moonflowerSell} €)`,
      description: `${player.moonflower}x Mondbohne`,
      onSelect: () => {
        player.money += player.moonflower * ECON.moonflowerSell;
        player.moonflower = 0;
        state.unlocks.moonflower = true;
        globalSfx.play("sell");
        scheduleSave();
      },
    });
  }
  actions.push({
    label: "Kohlsamen kaufen (2 €)",
    description: "Eins pro Klick",
    disabled: player.money < 2,
    onSelect: () => {
      if (player.money < 2) return;
      player.money -= 2;
      player.cabbageSeed = clamp(player.cabbageSeed + 1, 0, WORLD.inventoryLimit);
      globalSfx.play("ui");
      scheduleSave();
    },
  });
  if (state.yard.upgradeReady || state.unlocks.moonflower) {
    actions.push({
      label: "Mondbohnen-Saat (3 €)",
      description: "Leuchtet bei Nacht",
      disabled: player.money < 3,
      onSelect: () => {
        if (player.money < 3) return;
        player.money -= 3;
        player.moonflowerSeed = clamp(player.moonflowerSeed + 1, 0, WORLD.inventoryLimit);
        state.unlocks.moonflower = true;
        globalSfx.play("ui");
        scheduleSave();
      },
    });
  }
  if (state.yard.upgradeReady) {
    actions.push({
      label: "Karren kaufen (6 €)",
      description: "+10 % Tragespeed",
      disabled: player.upgrades.cart || player.money < 6,
      onSelect: () => {
        if (player.money < 6 || player.upgrades.cart) return;
        player.money -= 6;
        player.upgrades.cart = true;
        state.yard.upgradeReady = false;
        state.yard.upgradeNotified = true;
        globalSfx.play("ui");
        showToast("Karren verfügbar");
        scheduleSave();
      },
    });
    actions.push({
      label: "💩 kaufen (4 €)",
      description: "Dünger auf Vorrat",
      disabled: player.money < 4,
      onSelect: () => {
        if (player.money < 4) return;
        player.money -= 4;
        player.poop = clamp(player.poop + 1, 0, WORLD.inventoryLimit);
        globalSfx.play("sell");
        scheduleSave();
      },
    });
  } else if (!state.yard.upgradeNotified && state.yard.total === 0) {
    showToast("Mehr Felsen für neue Waren!");
    state.yard.upgradeNotified = true;
  }
  openDialog({ title: "Fecalfred", subtitle: "Alles fürs Geschäft", actions });
}

function openBertaShop() {
  const player = state.player;
  const actions = [];
  if (player.upgrades.crusher && player.carrying && player.carrying.kind === "stone") {
    actions.push({
      label: "Stein zerkleinern",
      description: "+8 Munition",
      onSelect: () => {
        player.carrying = null;
        player.ammo = clamp(player.ammo + STONE.crusherYield, 0, WORLD.inventoryLimit);
        globalSfx.play("sell");
        scheduleSave();
      },
    });
  }
  actions.push({
    label: "Gießkanne aufrüsten (5 €)",
    description: "Kapazität 13 Füllungen",
    disabled: player.upgrades.watering || player.money < 5,
    onSelect: () => {
      if (player.money < 5 || player.upgrades.watering) return;
      player.money -= 5;
      player.upgrades.watering = true;
      player.watering.max = CAN_MAX;
      player.watering.charges = CAN_MAX;
      globalSfx.play("ui");
      scheduleSave();
    },
  });
  actions.push({
    label: "Schuhe kaufen (7 €)",
    description: "+35 % Geschwindigkeit",
    disabled: player.upgrades.shoes || player.money < 7,
    onSelect: () => {
      if (player.money < 7 || player.upgrades.shoes) return;
      player.money -= 7;
      player.upgrades.shoes = true;
      globalSfx.play("ui");
      scheduleSave();
    },
  });
  actions.push({
    label: "Steinzerkleinerer (6 €)",
    description: "Schaltet Munition frei",
    disabled: player.upgrades.crusher || player.money < 6,
    onSelect: () => {
      if (player.money < 6 || player.upgrades.crusher) return;
      player.money -= 6;
      player.upgrades.crusher = true;
      globalSfx.play("ui");
      scheduleSave();
    },
  });
  openDialog({ title: "Berta", subtitle: "Werkbank & Extras", actions });
}

function openStefanDialog() {
  const actions = [
    {
      label: "Editor öffnen",
      onSelect: enterEditor,
    },
    {
      label: "Layout speichern",
      onSelect: () => saveEditorLayout(),
    },
  ];
  openDialog({ title: "Stefan", subtitle: "Der Planer", actions });
}

function scheduleSave() {
  if (state.saveTimer) window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(saveGame, SAVE_DEBOUNCE_MS);
}

function maybeSave() {
  // intentional noop placeholder for future batching
}

function saveGame() {
  state.saveTimer = null;
  const player = state.player;
  const save = {
    version: GAME_VERSION,
    player: {
      x: player.x,
      y: player.y,
      money: player.money,
      poop: player.poop,
      corn: player.corn,
      cabbage: player.cabbage,
      cabbageSeed: player.cabbageSeed,
      moonflower: player.moonflower,
      moonflowerSeed: player.moonflowerSeed,
      ammo: player.ammo,
      stamina: player.stamina,
      hearts: player.hearts,
      yardDelivered: player.yardDelivered,
      yardTotal: player.yardTotal,
      selectedPlant: player.selectedPlant,
      watering: { charges: player.watering.charges },
      upgrades: { ...player.upgrades },
    },
    yard: { ...state.yard },
    unlocks: { ...state.unlocks },
    day: { time: state.day.time, count: state.day.count },
    stones: state.stones.map(stone => ({ x: stone.x, y: stone.y })),
    dirt: state.dirt.map(clod => ({ x: clod.x, y: clod.y })),
    plants: Array.from(state.plants.values()).map(p => ({
      tx: p.tx,
      ty: p.ty,
      kind: p.kind,
      plantedAt: p.plantedAt,
      readyAt: p.readyAt,
      stage: p.stage,
      watered: p.watered,
      wateredMs: p.wateredMs,
      success: p.success,
    })),
    editorLayout: state.editor.layout || buildCurrentEditorLayout(),
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch (err) {
    console.warn("save failed", err);
  }
}
function buildCurrentEditorLayout() {
  return {
    fieldArea: { ...state.map.fieldArea },
    yardArea: { ...state.map.yardArea },
    pondArea: { ...state.map.pondArea },
    clearingArea: { ...state.map.clearingArea },
    quarryArea: { ...state.map.quarryArea },
    npcs: state.npcs.map(npc => ({ id: npc.id, x: npc.x / TILE, y: npc.y / TILE })),
  };
}

function enterEditor() {
  state.editor.open = true;
  if (!state.editor.layout) {
    state.editor.layout = loadEditorLayoutFromStorage() || buildCurrentEditorLayout();
  }
  state.editor.order = ["fred", "berta", "stefan", "fieldArea", "clearingArea", "pondArea", "quarryArea"];
  state.editor.index = 0;
  renderEditorPanel();
  if (editorPanel) {
    editorPanel.classList.add("open");
  }
}

function exitEditor() {
  state.editor.open = false;
  if (editorPanel) {
    editorPanel.classList.remove("open");
  }
}

function loadEditorLayoutFromStorage() {
  try {
    const raw = localStorage.getItem(WORLD.editorLayoutKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (err) {
    console.warn("layout parse failed", err);
    return null;
  }
}

function saveEditorLayout() {
  const layout = state.editor.layout || buildCurrentEditorLayout();
  try {
    localStorage.setItem(WORLD.editorLayoutKey, JSON.stringify(layout));
    applyEditorLayout(layout, false);
    showToast("Layout gespeichert");
  } catch (err) {
    console.warn("layout save failed", err);
  }
}

function resetEditorLayout() {
  localStorage.removeItem(WORLD.editorLayoutKey);
  state.editor.layout = buildCurrentEditorLayout();
  applyEditorLayout(state.editor.layout, false);
  renderEditorPanel();
  showToast("Layout zurückgesetzt");
}

function applyEditorLayout(layout, updatePanel = true) {
  if (!layout || typeof layout !== "object") return;

  const normalizeRect = (source, fallback) => {
    const base = { ...fallback };
    if (!source || typeof source !== "object") return base;
    const width = sanitizeNumber(source.w, fallback.w, 1, fallback.w);
    const height = sanitizeNumber(source.h, fallback.h, 1, fallback.h);
    const minX = 1;
    const minY = 1;
    const maxX = state.map ? Math.max(minX, state.map.cols - width - 1) : fallback.x;
    const maxY = state.map ? Math.max(minY, state.map.rows - height - 1) : fallback.y;
    return {
      x: sanitizeNumber(source.x, fallback.x, minX, maxX),
      y: sanitizeNumber(source.y, fallback.y, minY, maxY),
      w: width,
      h: height,
    };
  };

  const normalized = {
    fieldArea: normalizeRect(layout.fieldArea, MAPDATA.fieldArea),
    yardArea: normalizeRect(layout.yardArea, MAPDATA.yardArea),
    pondArea: normalizeRect(layout.pondArea, MAPDATA.pondArea),
    clearingArea: normalizeRect(layout.clearingArea, MAPDATA.clearingArea),
    quarryArea: normalizeRect(layout.quarryArea, MAPDATA.quarryArea),
    npcs: [],
  };

  for (const npc of state.npcs) {
    const match = Array.isArray(layout.npcs) ? layout.npcs.find(entry => entry && entry.id === npc.id) : null;
    const fallbackX = npc.x / TILE;
    const fallbackY = npc.y / TILE;
    const matchX = match ? match.x : undefined;
    const matchY = match ? match.y : undefined;
    const nx = sanitizeNumber(matchX, fallbackX, 1, state.map.cols - 2);
    const ny = sanitizeNumber(matchY, fallbackY, 1, state.map.rows - 2);
    npc.x = nx * TILE;
    npc.y = ny * TILE;
    normalized.npcs.push({ id: npc.id, x: nx, y: ny });
  }

  state.map.fieldArea = { ...normalized.fieldArea };
  state.map.yardArea = { ...normalized.yardArea };
  state.map.pondArea = { ...normalized.pondArea };
  state.map.clearingArea = { ...normalized.clearingArea };
  state.map.quarryArea = { ...normalized.quarryArea };
  state.map.spawnable = rebuildSpawnable(state.map);

  state.editor.layout = safeClone(normalized);
  if (updatePanel) {
    renderEditorPanel();
  }
}

function renderEditorPanel() {
  if (!state.editor.open || !editorBody) return;
  const layout = state.editor.layout || buildCurrentEditorLayout();
  editorBody.innerHTML = "";
  const container = document.createElement("div");
  container.className = "editor-controls";
  const currentId = state.editor.order[state.editor.index];
  const header = document.createElement("p");
  header.textContent = `Aktiv: ${editorLabel(currentId)}`;
  container.appendChild(header);
  const grid = document.createElement("div");
  grid.className = "editor-grid";
  const makeButton = (text, dx, dy) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = text;
    btn.addEventListener("click", () => moveEditorItem(currentId, dx, dy));
    return btn;
  };
  grid.appendChild(makeButton("↑", 0, -1));
  grid.appendChild(document.createElement("span"));
  grid.appendChild(makeButton("→", 1, 0));
  grid.appendChild(makeButton("←", -1, 0));
  grid.appendChild(document.createElement("span"));
  grid.appendChild(makeButton("↓", 0, 1));
  container.appendChild(grid);
  const nav = document.createElement("div");
  nav.className = "editor-nav";
  const prev = document.createElement("button");
  prev.type = "button";
  prev.textContent = "Vorheriges";
  prev.addEventListener("click", () => {
    state.editor.index = (state.editor.index - 1 + state.editor.order.length) % state.editor.order.length;
    renderEditorPanel();
  });
  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "Nächstes";
  next.addEventListener("click", () => {
    state.editor.index = (state.editor.index + 1) % state.editor.order.length;
    renderEditorPanel();
  });
  nav.appendChild(prev);
  nav.appendChild(next);
  container.appendChild(nav);
  editorBody.appendChild(container);
}

function editorLabel(id) {
  switch (id) {
    case "fred": return "Fecalfred";
    case "berta": return "Berta";
    case "stefan": return "Stefan";
    case "fieldArea": return "Feld";
    case "clearingArea": return "Lichtung";
    case "pondArea": return "Teich";
    case "quarryArea": return "Felsenhof";
    default: return id;
  }
}

function moveEditorItem(id, dx, dy) {
  const layout = state.editor.layout || buildCurrentEditorLayout();
  if (id === "fred" || id === "berta" || id === "stefan") {
    const npc = layout.npcs.find(n => n.id === id);
    if (!npc) return;
    npc.x = clamp(npc.x + dx, 2, state.map.cols - 3);
    npc.y = clamp(npc.y + dy, 2, state.map.rows - 3);
  } else if (layout[id]) {
    const rect = layout[id];
    rect.x = clamp(rect.x + dx, 1, state.map.cols - rect.w - 1);
    rect.y = clamp(rect.y + dy, 1, state.map.rows - rect.h - 1);
  }
  state.editor.layout = layout;
  applyEditorLayout(layout, false);
  renderEditorPanel();
  scheduleSave();
}

function render() {
  if (!ctx || !canvas) return;
  const width = canvas.width / state.dpr;
  const height = canvas.height / state.dpr;
  ctx.save();
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  drawBackground(width, height);
  const offsetX = width / 2 - state.camera.x;
  const offsetY = height / 2 - state.camera.y;
  ctx.translate(offsetX, offsetY);
  const view = computeViewBounds(width, height);
  drawTiles(view);
  drawHouses(view);
  drawPlants(view);
  drawDirt(view);
  drawStones(view);
  drawNPCs(view);
  drawFireflies(view);
  drawPlayer();
  drawPreview(view);
  ctx.restore();
  applyLightingOverlay(width, height);
  drawHudOverlay(width, height);
}

function drawBackground(width, height) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  if (FLAGS.dayNightEnabled) {
    const ambient = state.lighting.ambient;
    let top = mixColor(SKY_TOP_NIGHT, SKY_TOP_DAY, ambient);
    let bottom = mixColor(SKY_BOTTOM_NIGHT, SKY_BOTTOM_DAY, ambient);
    const phase = state.day.phase;
    const dawnSpan = typeof WORLD.dawnDuration === "number" ? WORLD.dawnDuration : 0.12;
    const duskSpan = typeof WORLD.duskDuration === "number" ? WORLD.duskDuration : 0.12;
    const dawnDistance = Math.min(Math.abs(phase - 0), Math.abs(phase - 1));
    const dawnWeight = clamp(1 - dawnDistance / Math.max(0.001, dawnSpan), 0, 1);
    const duskWeight = clamp(1 - Math.abs(phase - 0.5) / Math.max(0.001, duskSpan), 0, 1);
    const warm = Math.max(dawnWeight, duskWeight);
    if (warm > 0) {
      top = mixColor(top, SKY_TOP_DAWN, warm * 0.8);
      bottom = mixColor(bottom, SKY_BOTTOM_DAWN, warm * 0.8);
    }
    gradient.addColorStop(0, top);
    gradient.addColorStop(1, bottom);
  } else {
    gradient.addColorStop(0, SKY_TOP_DAY);
    gradient.addColorStop(1, SKY_BOTTOM_DAY);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function drawTiles(view) {
  if (!state.map) return;
  const { minX, maxX, minY, maxY } = view.tiles;
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      const sym = tileAt(tx, ty);
      ctx.fillStyle = tileColor(sym);
      ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      if (sym === "f") {
        ctx.strokeStyle = "rgba(255,255,255,0.1)";
        ctx.strokeRect(tx * TILE + 0.5, ty * TILE + 0.5, TILE - 1, TILE - 1);
      }
    }
  }
}

function drawHouses(view) {
  for (const house of HOUSES) {
    const { area } = house;
    const x = area.x * TILE;
    const y = area.y * TILE;
    const width = area.w * TILE;
    const height = area.h * TILE;
    if (!rectIntersectsView(x, y, width, height, view)) continue;
    drawHouse(house);
  }
}

function drawHouse(house) {
  const { area, palette, emblem } = house;
  const x = area.x * TILE;
  const y = area.y * TILE;
  const width = area.w * TILE;
  const height = area.h * TILE;
  const roofHeight = Math.min(height * 0.45, TILE * 1.6);
  const wallHeight = height - roofHeight;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.ellipse(width / 2, height + TILE * 0.25, width * 0.52, TILE * 0.4, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = palette.roof;
  ctx.beginPath();
  ctx.moveTo(0, roofHeight);
  ctx.lineTo(width / 2, Math.max(roofHeight - TILE, 0));
  ctx.lineTo(width, roofHeight);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(0, roofHeight - TILE * 0.12, width, TILE * 0.12);
  ctx.fillStyle = palette.wall;
  ctx.fillRect(0, roofHeight, width, Math.max(wallHeight, TILE));
  ctx.fillStyle = palette.trim;
  ctx.fillRect(0, roofHeight, width, TILE * 0.12);
  ctx.fillRect(0, roofHeight + wallHeight - TILE * 0.18, width, TILE * 0.18);
  const windowSize = TILE * 0.72;
  const windowY = roofHeight + TILE * 0.48;
  ctx.fillStyle = palette.trim;
  ctx.fillRect(TILE * 0.6, windowY, windowSize, windowSize);
  ctx.fillRect(width - TILE * 0.6 - windowSize, windowY, windowSize, windowSize);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(TILE * 0.6, windowY, windowSize, windowSize);
  ctx.fillRect(width - TILE * 0.6 - windowSize, windowY, windowSize, windowSize);
  const doorWidth = TILE * 1.1;
  const doorHeight = TILE * 1.7;
  ctx.fillStyle = palette.door;
  ctx.fillRect(width / 2 - doorWidth / 2, roofHeight + wallHeight - doorHeight, doorWidth, doorHeight);
  const bannerWidth = TILE * 1.5;
  const bannerHeight = TILE * 0.42;
  ctx.fillStyle = palette.banner;
  ctx.fillRect(width / 2 - bannerWidth / 2, roofHeight - bannerHeight * 0.4, bannerWidth, bannerHeight);
  ctx.fillStyle = "#120d0d";
  ctx.font = `${TILE * 0.55}px "Inter", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emblem, width / 2, roofHeight - bannerHeight * 0.1);
  ctx.restore();
}

function tileColor(sym) {
  switch (sym) {
    case "p": return "#6b5537";
    case "h": return "#2c2f3b";
    case "x": return "#0c1612";
    case "w": return "#1b3f6e";
    case "f": return "#3b6f36";
    case "y": return "#6b4026";
    case "c": return "#2d4b2a";
    case "q": return "#4f4d49";
    case "d": return "#5b3c2d";
    case "b": return "#4a3a5b";
    case "s": return "#37535c";
    case "t": return "#2d604b";
    default: return "#1e3a2b";
  }
}

function drawPlants(view) {
  const { minX, maxX, minY, maxY } = view.tiles;
  for (const plant of state.plants.values()) {
    if (plant.tx < minX || plant.tx > maxX || plant.ty < minY || plant.ty > maxY) continue;
    const x = plant.tx * TILE + TILE / 2;
    const y = plant.ty * TILE + TILE / 2;
    ctx.save();
    ctx.translate(x, y);
    if (plant.kind === "corn") {
      ctx.fillStyle = plant.stage === "ready" ? "#ffd95a" : plant.stage === "failed" ? "#665540" : "#c1a842";
      ctx.beginPath();
      ctx.ellipse(0, 0, TILE * 0.22, TILE * 0.34, 0, 0, TAU);
      ctx.fill();
    } else if (plant.kind === "moonflower") {
      const baseColor = plant.stage === "failed" ? "#3f4652" : plant.stage === "ready" ? "#b8f3ff" : "#79d3ff";
      if (plant.stage !== "failed") {
        const pulse = (Math.sin(state.time * 4.2 + plant.tx + plant.ty) + 1) * 0.5;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = `rgba(140, 210, 255, ${0.28 + pulse * 0.32})`;
        ctx.beginPath();
        ctx.arc(0, 0, TILE * (0.42 + pulse * 0.12), 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = baseColor;
      ctx.beginPath();
      ctx.ellipse(0, 0, TILE * 0.24, TILE * 0.32, 0, 0, TAU);
      ctx.fill();
    } else {
      ctx.fillStyle = plant.stage === "ready" ? "#7ae38f" : plant.stage === "failed" ? "#4f5f4f" : "#4ecb6d";
      ctx.beginPath();
      ctx.arc(0, 0, TILE * 0.28, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawDirt(view) {
  ctx.fillStyle = "#5a4228";
  for (const clod of state.dirt) {
    if (clod.x + clod.radius < view.pixel.left || clod.x - clod.radius > view.pixel.right) continue;
    if (clod.y + clod.radius < view.pixel.top || clod.y - clod.radius > view.pixel.bottom) continue;
    ctx.beginPath();
    ctx.arc(clod.x, clod.y, clod.radius, 0, TAU);
    ctx.fill();
  }
}

function drawStones(view) {
  ctx.fillStyle = "#8793a1";
  for (const stone of state.stones) {
    if (stone.x + stone.radius < view.pixel.left || stone.x - stone.radius > view.pixel.right) continue;
    if (stone.y + stone.radius < view.pixel.top || stone.y - stone.radius > view.pixel.bottom) continue;
    ctx.beginPath();
    ctx.arc(stone.x, stone.y, stone.radius, 0, TAU);
    ctx.fill();
  }
}

function drawNPCs(view) {
  let index = 0;
  for (const npc of state.npcs) {
    if (npc.x < view.pixel.left - TILE || npc.x > view.pixel.right + TILE) { index += 1; continue; }
    if (npc.y < view.pixel.top - TILE || npc.y > view.pixel.bottom + TILE) { index += 1; continue; }
    const facing = vectorToFacing(state.player.x - npc.x, state.player.y - npc.y, "down");
    drawNpcSprite(npc, facing, index);
    index += 1;
  }
}

function drawFireflies(view) {
  if (!FLAGS.dayNightEnabled || !state.fireflies.length) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const fly of state.fireflies) {
    if (fly.x < view.pixel.left - TILE || fly.x > view.pixel.right + TILE) continue;
    if (fly.y < view.pixel.top - TILE || fly.y > view.pixel.bottom + TILE) continue;
    const pulse = (Math.sin(fly.pulse) + 1) * 0.5;
    const alpha = clamp(fly.life * (0.45 + pulse * 0.5), 0, 1);
    if (alpha <= 0.01) continue;
    const radius = TILE * (0.1 + pulse * 0.12);
    ctx.fillStyle = `rgba(150, 220, 255, ${alpha})`;
    ctx.beginPath();
    ctx.arc(fly.x, fly.y, radius, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawNpcSprite(npc, facing, index) {
  const palette = npc.style || {
    skin: "#f0d4b8",
    hair: "#3a2a1f",
    outfit: "#b8745a",
    accent: "#f5c16c",
    eyes: "#211d19",
  };
  const bob = Math.sin(state.time * 1.8 + index) * TILE * 0.08;
  ctx.save();
  ctx.translate(npc.x, npc.y - bob);
  ctx.fillStyle = "rgba(0,0,0,0.26)";
  ctx.beginPath();
  ctx.ellipse(0, TILE * 0.34, TILE * 0.3, TILE * 0.17, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = palette.outfit || "#b8745a";
  ctx.beginPath();
  ctx.ellipse(0, 0, TILE * 0.28, TILE * 0.4, 0, 0, TAU);
  ctx.fill();
  if (palette.accent) {
    ctx.fillStyle = palette.accent;
    ctx.fillRect(-TILE * 0.24, TILE * 0.08, TILE * 0.48, TILE * 0.14);
  }
  ctx.fillStyle = palette.skin || "#f0d4b8";
  ctx.beginPath();
  ctx.ellipse(-TILE * 0.28, -TILE * 0.06, TILE * 0.1, TILE * 0.26, 0, 0, TAU);
  ctx.ellipse(TILE * 0.28, -TILE * 0.06, TILE * 0.1, TILE * 0.26, 0, 0, TAU);
  ctx.fill();
  if (npc.id === "fred") {
    ctx.fillStyle = "#f3d17c";
    ctx.beginPath();
    ctx.ellipse(0, TILE * 0.05, TILE * 0.15, TILE * 0.12, 0, 0, TAU);
    ctx.fill();
  } else if (npc.id === "berta") {
    ctx.strokeStyle = palette.accent || "#68d4f5";
    ctx.lineWidth = TILE * 0.08;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, TILE * 0.06, TILE * 0.14, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -TILE * 0.1);
    ctx.lineTo(0, TILE * 0.2);
    ctx.stroke();
  } else if (npc.id === "stefan") {
    ctx.fillStyle = "#e6f7ff";
    ctx.fillRect(-TILE * 0.12, -TILE * 0.05, TILE * 0.24, TILE * 0.26);
    ctx.strokeStyle = palette.accent || "#9fe3c6";
    ctx.lineWidth = TILE * 0.04;
    ctx.strokeRect(-TILE * 0.12, -TILE * 0.05, TILE * 0.24, TILE * 0.26);
  }
  drawFaceSprite(facing, "calm", palette, { scale: 0.92 });
  ctx.restore();
}

function drawPlayer() {
  const player = state.player;
  const anim = player.anim || { facing: "down", stride: 0, bob: 0, expression: "calm" };
  const facing = anim.facing || "down";
  const stride = anim.stride || 0;
  const bob = anim.bob || 0;
  const expression = anim.expression || "calm";
  const carrying = player.carrying && player.carrying.kind === "stone";
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(0, TILE * 0.34, TILE * 0.34, TILE * 0.18, 0, 0, TAU);
  ctx.fill();
  ctx.translate(0, -bob);
  drawPlayerLegs(stride, carrying);
  drawPlayerTorso();
  drawPlayerArms(stride, carrying);
  drawFaceSprite(facing, expression, PLAYER_COLORS, { carrying });
  ctx.restore();
  if (carrying) {
    drawCarriedStone(player, bob);
  }
}

function drawPlayerLegs(stride, carrying) {
  const swing = stride * (carrying ? TILE * 0.08 : TILE * 0.14);
  ctx.fillStyle = PLAYER_COLORS.pants;
  ctx.beginPath();
  ctx.ellipse(-TILE * 0.14 + swing, TILE * 0.22, TILE * 0.13, TILE * 0.26, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(TILE * 0.14 - swing, TILE * 0.22, TILE * 0.13, TILE * 0.26, 0, 0, TAU);
  ctx.fill();
}

function drawPlayerTorso() {
  ctx.fillStyle = PLAYER_COLORS.shirt;
  ctx.beginPath();
  ctx.ellipse(0, -TILE * 0.06, TILE * 0.28, TILE * 0.38, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = PLAYER_COLORS.strap;
  ctx.lineWidth = TILE * 0.12;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-TILE * 0.2, -TILE * 0.34);
  ctx.lineTo(TILE * 0.24, TILE * 0.3);
  ctx.stroke();
}

function drawPlayerArms(stride, carrying) {
  ctx.fillStyle = PLAYER_COLORS.skin;
  if (carrying) {
    ctx.beginPath();
    ctx.ellipse(-TILE * 0.28, -TILE * 0.32, TILE * 0.11, TILE * 0.36, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(TILE * 0.28, -TILE * 0.32, TILE * 0.11, TILE * 0.36, 0, 0, TAU);
    ctx.fill();
  } else {
    const swing = stride * TILE * 0.18;
    ctx.beginPath();
    ctx.ellipse(-TILE * 0.32, -TILE * 0.08 + swing, TILE * 0.1, TILE * 0.28, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(TILE * 0.32, -TILE * 0.08 - swing, TILE * 0.1, TILE * 0.28, 0, 0, TAU);
    ctx.fill();
  }
}

function drawCarriedStone(player, bob) {
  ctx.save();
  ctx.translate(player.x, player.y - TILE * 0.72 - bob);
  ctx.fillStyle = "#b9c3cf";
  ctx.beginPath();
  const animPhase = player.anim && typeof player.anim.phase === "number" ? player.anim.phase : 0;
  ctx.ellipse(0, Math.sin(animPhase * 2) * TILE * 0.04, TILE * 0.26, TILE * 0.18, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawFaceSprite(facing, expression, palette, { scale = 1 } = {}) {
  const skin = palette.skin || "#f4dcca";
  const hair = palette.hair || "#2f2f2f";
  const eyes = palette.eyes || "#1c1919";
  const headY = -TILE * 0.36 * scale;
  const headW = TILE * 0.24 * scale;
  const headH = TILE * 0.28 * scale;
  ctx.save();
  ctx.translate(0, -TILE * 0.02 * scale);
  ctx.fillStyle = hair;
  if (facing === "up") {
    ctx.beginPath();
    ctx.arc(0, headY - headH * 0.1, headW + TILE * 0.07 * scale, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(-headW - TILE * 0.02, headY - headH * 0.1, (headW + TILE * 0.02) * 2, headH * 0.35);
  } else {
    ctx.beginPath();
    ctx.ellipse(0, headY - headH * 0.55, headW + TILE * 0.05 * scale, headH * 0.72, 0, 0, TAU);
    ctx.fill();
    ctx.fillRect(-headW - TILE * 0.04, headY - headH * 0.18, (headW + TILE * 0.04) * 2, headH * 0.32);
  }
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(0, headY, headW, headH, 0, 0, TAU);
  ctx.fill();
  if (facing !== "up") {
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.ellipse(0, headY + headH * 0.05, headW * 0.96, headH * 0.9, 0, 0, TAU);
    ctx.fill();
  }
  const eyeY = headY - headH * 0.12;
  ctx.fillStyle = eyes;
  ctx.strokeStyle = eyes;
  ctx.lineWidth = TILE * 0.05 * scale;
  ctx.lineCap = "round";
  if (facing === "left") {
    ctx.beginPath();
    ctx.ellipse(-headW * 0.22, eyeY, TILE * 0.04 * scale, TILE * 0.055 * scale, 0, 0, TAU);
    ctx.fill();
  } else if (facing === "right") {
    ctx.beginPath();
    ctx.ellipse(headW * 0.22, eyeY, TILE * 0.04 * scale, TILE * 0.055 * scale, 0, 0, TAU);
    ctx.fill();
  } else if (facing === "up") {
    ctx.beginPath();
    ctx.moveTo(-headW * 0.32, eyeY);
    ctx.lineTo(-headW * 0.08, eyeY);
    ctx.moveTo(headW * 0.32, eyeY);
    ctx.lineTo(headW * 0.08, eyeY);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.ellipse(-headW * 0.22, eyeY, TILE * 0.045 * scale, TILE * 0.06 * scale, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(headW * 0.22, eyeY, TILE * 0.045 * scale, TILE * 0.06 * scale, 0, 0, TAU);
    ctx.fill();
  }
  if (expression === "strain" || expression === "focus") {
    ctx.strokeStyle = hair;
    ctx.lineWidth = TILE * 0.045 * scale;
    const browY = eyeY - headH * 0.22;
    ctx.beginPath();
    ctx.moveTo(-headW * 0.32, browY);
    ctx.lineTo(-headW * 0.08, browY - TILE * 0.04 * scale);
    ctx.moveTo(headW * 0.32, browY);
    ctx.lineTo(headW * 0.08, browY - TILE * 0.04 * scale);
    ctx.stroke();
  }
  const mouthY = headY + headH * 0.48;
  ctx.strokeStyle = expression === "strain" ? "#8f3a3a" : eyes;
  ctx.lineWidth = TILE * 0.07 * scale;
  ctx.beginPath();
  if (expression === "strain") {
    ctx.moveTo(-headW * 0.22, mouthY);
    ctx.lineTo(headW * 0.22, mouthY);
  } else if (expression === "focus") {
    ctx.moveTo(-headW * 0.18, mouthY);
    ctx.lineTo(headW * 0.18, mouthY);
  } else if (expression === "smile") {
    ctx.arc(0, mouthY, headW * 0.3, 0, Math.PI);
  } else {
    ctx.arc(0, mouthY, headW * 0.24, 0, Math.PI);
  }
  ctx.stroke();
  ctx.restore();
}

function drawPreview(view) {
  const preview = state.preview;
  if (!preview || !view) return;
  if (preview.tx < view.tiles.minX || preview.tx > view.tiles.maxX) return;
  if (preview.ty < view.tiles.minY || preview.ty > view.tiles.maxY) return;
  ctx.save();
  ctx.fillStyle = preview.valid ? "rgba(120,220,140,0.35)" : "rgba(220,80,80,0.35)";
  ctx.fillRect(preview.tx * TILE, preview.ty * TILE, TILE, TILE);
  ctx.restore();
}

function applyLightingOverlay(width, height) {
  if (!FLAGS.dayNightEnabled) return;
  const ambient = state.lighting.ambient;
  if (ambient >= 0.995) return;
  const darkness = clamp(1 - ambient, 0, 1);
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = `rgba(12, 16, 24, ${0.35 + darkness * 0.4})`;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
  if (ambient < 0.6) {
    ctx.save();
    ctx.globalAlpha = clamp((0.6 - ambient) * 0.85, 0, 0.5);
    ctx.fillStyle = "rgba(70, 110, 180, 0.65)";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
}

function drawHudOverlay(width, height) {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "12px Inter, sans-serif";
  ctx.fillText(`FPS: ${state.fps.toFixed(0)}`, width - 80, height - 16);
  ctx.restore();
}

function boot() {
  initDom();
  setupCanvas();
  watchInputMode();
  document.addEventListener("fullscreenchange", () => resizeCanvas());
  state.map = createMap();
  state.player = createPlayer();
  state.npcs = buildNPCs();
  primeAudioUnlock();
  setupInput();
  initWorld();
  state.ready = true;
  state.lastTick = performance.now();
  requestAnimationFrame(mainLoop);
}

function requestBoot() {
  if (bootStarted) return;
  bootStarted = true;
  try {
    boot();
  } catch (err) {
    failBoot(err);
  }
}

function scheduleBoot() {
  if (bootStarted || bootScheduled) return;
  bootScheduled = true;
  requestAnimationFrame(() => {
    bootScheduled = false;
    requestBoot();
  });
}

function initBoot() {
  if (typeof document === "undefined") {
    requestBoot();
    return;
  }
  const ready = document.readyState;
  if (ready === "complete" || ready === "interactive") {
    scheduleBoot();
    return;
  }
  document.addEventListener("DOMContentLoaded", scheduleBoot, { once: true });
  window.addEventListener("load", scheduleBoot, { once: true });
}

initBoot();
