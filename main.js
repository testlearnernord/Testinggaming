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
const AREA_MAPPINGS = [
  { key: "fieldArea", symbol: "f" },
  { key: "yardArea", symbol: "y" },
  { key: "pondArea", symbol: "w" },
  { key: "clearingArea", symbol: "c" },
  { key: "quarryArea", symbol: "q" },
];
const RESERVED_AREA_SYMBOLS = new Set(["f", "y", "w"]);

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
let bootScheduled = false;
let bootStarted = false;

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

function isStoneSpawnable(sym, tx, ty, areas = state?.map ?? MAPDATA) {
  const areaSymbol = areaSymbolAt(tx, ty, areas);
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
    state.player.selectedPlant = "corn";
    showToast("Saat: Mais");
  }
  if (key === "2") {
    state.player.selectedPlant = "cabbage";
    showToast("Saat: Kohl");
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
  sprintButton?.classList.remove("active");
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
    sprintButton.setPointerCapture?.(ev.pointerId);
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
  return PLANTS[kind]?.label || kind;
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

function render() {
  if (!canvas || !ctx) return;
  
  const width = canvas.width;
  const height = canvas.height;
  
  // Clear canvas
  ctx.fillStyle = '#0c1116';
  ctx.fillRect(0, 0, width, height);
  
  // Draw game world with improved graphics
  const phase = state.dayNight ? state.dayNight.phase : 0.25;
  drawBackground(width, height, phase);
  drawWorld(width, height);
  
  // Draw player if exists
  if (state.player) {
    drawPlayer(state.player, width, height);
  }
  
  // Draw game objects
  if (state.stones && state.stones.length > 0) {
    drawStones(state.stones);
  }
  
  if (state.plants && state.plants.size > 0) {
    drawPlants(Array.from(state.plants.values()));
  }
  
  // Apply lighting effects for day/night
  applyLightingOverlay(width, height, phase);
  
  // Draw FPS counter in debug mode
  if (DEBUG) {
    drawHudOverlay(width, height);
  }
}

function drawWorld(width, height) {
  if (!state.map || !state.player) return;
  
  const tileSize = TILE;
  const centerX = width / 2;
  const centerY = height / 2;
  
  // Calculate viewport bounds
  const viewX = state.player.x - centerX;
  const viewY = state.player.y - centerY;
  
  const startTileX = Math.floor(viewX / tileSize) - 1;
  const endTileX = Math.ceil((viewX + width) / tileSize) + 1;
  const startTileY = Math.floor(viewY / tileSize) - 1;
  const endTileY = Math.ceil((viewY + height) / tileSize) + 1;
  
  // Draw tiles
  for (let ty = startTileY; ty <= endTileY; ty++) {
    for (let tx = startTileX; tx <= endTileX; tx++) {
      const worldX = tx * tileSize - viewX;
      const worldY = ty * tileSize - viewY;
      
      if (worldX + tileSize < 0 || worldX > width || worldY + tileSize < 0 || worldY > height) continue;
      
      const tileType = getTileType(tx, ty);
      drawTile(worldX, worldY, tileSize, tileType);
    }
  }
}

function getTileType(tx, ty) {
  if (!state.map) return 'grass';
  
  // Check bounds
  if (tx < 0 || ty < 0 || tx >= WORLD.width || ty >= WORLD.height) return 'woods';
  
  // Get base tile from map data
  const row = MAPDATA.layout[ty];
  if (!row) return 'grass';
  const symbol = row[tx];
  
  // Convert symbol to tile type
  const legend = MAPDATA.legend;
  return legend[symbol] || 'grass';
}

function drawTile(x, y, size, type) {
  ctx.save();
  
  switch (type) {
    case 'grass':
      ctx.fillStyle = '#4a7c59';
      ctx.fillRect(x, y, size, size);
      // Add some texture
      ctx.fillStyle = '#5d8f6b';
      ctx.fillRect(x + size * 0.2, y + size * 0.1, size * 0.6, size * 0.1);
      ctx.fillRect(x + size * 0.1, y + size * 0.7, size * 0.8, size * 0.1);
      break;
      
    case 'path':
      ctx.fillStyle = '#8b7355';
      ctx.fillRect(x, y, size, size);
      break;
      
    case 'woods':
      ctx.fillStyle = '#2d4a34';
      ctx.fillRect(x, y, size, size);
      // Add tree representation
      ctx.fillStyle = '#1a2e1f';
      ctx.fillRect(x + size * 0.2, y + size * 0.1, size * 0.6, size * 0.8);
      break;
      
    case 'water':
      ctx.fillStyle = '#4a7ba7';
      ctx.fillRect(x, y, size, size);
      // Add water shimmer effect
      const shimmer = Math.sin(state.time * 2) * 0.1 + 0.1;
      ctx.fillStyle = `rgba(135, 206, 235, ${shimmer})`;
      ctx.fillRect(x, y, size, size * 0.3);
      break;
      
    case 'field':
      ctx.fillStyle = '#8b4513';
      ctx.fillRect(x, y, size, size);
      // Add furrow lines
      ctx.strokeStyle = '#654321';
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        const lineY = y + (i + 1) * size / 4;
        ctx.beginPath();
        ctx.moveTo(x, lineY);
        ctx.lineTo(x + size, lineY);
        ctx.stroke();
      }
      break;
      
    case 'house':
      ctx.fillStyle = '#8b4513';
      ctx.fillRect(x, y, size, size);
      // Add roof
      ctx.fillStyle = '#654321';
      ctx.fillRect(x, y, size, size * 0.3);
      // Add door
      ctx.fillStyle = '#2f1b14';
      ctx.fillRect(x + size * 0.4, y + size * 0.5, size * 0.2, size * 0.5);
      break;
      
    default:
      ctx.fillStyle = '#4a7c59';
      ctx.fillRect(x, y, size, size);
  }
  
  ctx.restore();
}

function drawPlants(plants) {
  if (!plants || !state.player) return;
  
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const viewX = state.player.x - centerX;
  const viewY = state.player.y - centerY;
  
  for (const plant of plants) {
    const screenX = plant.x - viewX;
    const screenY = plant.y - viewY;
    
    if (screenX < -TILE || screenX > canvas.width + TILE || 
        screenY < -TILE || screenY > canvas.height + TILE) continue;
    
    drawPlant(screenX, screenY, plant);
  }
}

function drawPlant(x, y, plant) {
  ctx.save();
  
  // Different colors for different plant types and stages
  let color = '#4a7c59'; // Default green
  let size = TILE * 0.6;
  
  switch (plant.kind) {
    case 'corn':
      color = plant.stage === 'mature' ? '#ffd700' : '#90ee90';
      size = plant.stage === 'mature' ? TILE * 0.8 : TILE * 0.4;
      break;
    case 'cabbage':
      color = plant.stage === 'mature' ? '#32cd32' : '#98fb98';
      size = plant.stage === 'mature' ? TILE * 0.7 : TILE * 0.3;
      break;
    case 'moonflower':
      color = plant.stage === 'mature' ? '#9370db' : '#dda0dd';
      size = plant.stage === 'mature' ? TILE * 0.6 : TILE * 0.3;
      if (plant.stage === 'mature' && isNight()) {
        // Add glow effect for moonflowers at night
        ctx.shadowColor = '#9370db';
        ctx.shadowBlur = 10;
      }
      break;
  }
  
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + TILE / 2, y + TILE / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.restore();
}

function applyLightingOverlay(width, height, phase) {
  // Apply day/night lighting effects
  if (!phase) return;
  
  const isNightTime = phase > 0.5 && phase < 0.9;
  if (isNightTime) {
    // Apply dark overlay for night
    const nightIntensity = Math.sin((phase - 0.5) * Math.PI * 2.5) * 0.3 + 0.3;
    ctx.fillStyle = `rgba(0, 10, 20, ${nightIntensity})`;
    ctx.fillRect(0, 0, width, height);
  }
}

function isNight() {
  if (!state.dayNight) return false;
  const phase = state.dayNight.phase;
  return phase > 0.7 || phase < 0.2; // Night time periods
}

function drawBackground(width, height, phase) {
  // Draw sky gradient based on time of day
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  
  // Day/night color interpolation
  const dayTop = '#1c3850';
  const dayBottom = '#09131b';
  const nightTop = '#04060d';
  const nightBottom = '#020307';
  
  // Simple day/night transition (phase 0-1, where 0.25 = day, 0.75 = night)
  const isNightTime = phase > 0.5 && phase < 0.9;
  const skyTop = isNightTime ? nightTop : dayTop;
  const skyBottom = isNightTime ? nightBottom : dayBottom;
  
  gradient.addColorStop(0, skyTop);
  gradient.addColorStop(1, skyBottom);
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  
  // Draw simple ground
  ctx.fillStyle = '#2d5a3d';
  ctx.fillRect(0, height * 0.7, width, height * 0.3);
}

function drawPlayer(player, width, height) {
  if (!player) return;
  
  // Center camera on player
  const centerX = width / 2;
  const centerY = height / 2;
  
  // Draw simple player representation
  ctx.fillStyle = '#f6e0c8'; // Skin color
  ctx.beginPath();
  ctx.arc(centerX, centerY, 16, 0, Math.PI * 2);
  ctx.fill();
  
  // Draw simple body
  ctx.fillStyle = '#4f79b7'; // Shirt color
  ctx.fillRect(centerX - 12, centerY + 5, 24, 30);
  
  // Draw simple legs
  ctx.fillStyle = '#2f3e59'; // Pants color
  ctx.fillRect(centerX - 10, centerY + 25, 8, 20);
  ctx.fillRect(centerX + 2, centerY + 25, 8, 20);
}

function drawStones(stones) {
  ctx.fillStyle = '#666';
  for (const stone of stones) {
    ctx.beginPath();
    ctx.arc(stone.x, stone.y, 8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHudOverlay(width, height) {
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '12px Inter, sans-serif';
  ctx.fillText(`FPS: ${state.fps.toFixed(0)}`, width - 80, height - 16);
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
  const area = state.map?.pondArea || MAPDATA.pondArea;
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
        const minReady = plant.plantedAt + (def.minMs ?? 0);
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
  return "grass";
}

function findNearby(list, x, y, radius) {
  if (!list || !Array.isArray(list)) return null;
  for (const item of list) {
    if (!item || typeof item.x !== 'number' || typeof item.y !== 'number') continue;
    const dx = item.x - x;
    const dy = item.y - y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance <= radius) {
      return item;
    }
  }
  return null;
}

function maybeSave() {
  // Simple auto-save placeholder - just store the current state periodically
  if (state.time % 30 < 0.1) { // Save every 30 seconds
    try {
      const saveData = {
        player: state.player,
        stones: state.stones || [],
        plants: state.plants || new Map(),
        time: state.time,
        dayNight: state.dayNight
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(saveData));
    } catch (err) {
      console.warn("Auto-save failed:", err);
    }
  }
}

function boot() {
  try {
    initDom();
    setupCanvas();
    watchInputMode();
    
    // Set up fullscreen change listener
    document.addEventListener("fullscreenchange", () => resizeCanvas());
    
    // Initialize game state
    state.map = createMap();
    state.player = createPlayer();
    state.npcs = buildNPCs();
    
    // Initialize audio (safely)
    if (typeof primeAudioUnlock === "function") {
      primeAudioUnlock();
    }
    
    setupInput();
    initWorld();
    
    // Mark as ready and start the game loop
    state.ready = true;
    state.lastTick = performance.now();
    requestAnimationFrame(mainLoop);
    
    console.log("Poopboy game initialized successfully");
  } catch (err) {
    failBoot(err);
  }
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
  setTimeout(() => {
    bootScheduled = false;
    requestBoot();
  }, 0);
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

// Start the game
initBoot();

