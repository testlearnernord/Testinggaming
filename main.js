import {
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
  isBlockingSymbol,
  clamp,

} from "./data.js";
import { globalSfx, primeAudioUnlock } from "./sfx.js";

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
  money: null,
  ammo: null,
  water: null,
  stamina: null,
};
let joystickEl = null;
let joystickHandle = null;
let contextButton = null;
let restartButton = null;
let sprintButton = null;
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

function rectContains(rect, tx, ty) {
  return tx >= rect.x && ty >= rect.y && tx < rect.x + rect.w && ty < rect.y + rect.h;
}

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function applyInputMode() {
  if (typeof document === "undefined") return;
  const isDesktop = !state.prefersTouch;
  document.body.classList.toggle("desktop", isDesktop);
  if (isDesktop) {
    state.joystick.dx = 0;
    state.joystick.dy = 0;
    state.touchSprint = false;
    sprintButton?.classList.remove("active");
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
  hudElements.money = document.querySelector("#hud-money [data-value]");
  hudElements.ammo = document.querySelector("#hud-ammo [data-value]");
  hudElements.water = document.querySelector("#hud-water [data-value]");
  hudElements.stamina = document.querySelector("#hud-stamina [data-value]");
  joystickEl = document.getElementById("joystick");
  joystickHandle = document.getElementById("joystick-handle");
  contextButton = document.getElementById("context-button");
  restartButton = document.getElementById("restart-button");
  sprintButton = document.getElementById("sprint-button");
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
  const inField = rectContains(areas.fieldArea, tx, ty);
  const inYard = rectContains(areas.yardArea, tx, ty);
  const inPond = rectContains(areas.pondArea, tx, ty);
  const inClearing = rectContains(areas.clearingArea, tx, ty);
  const inQuarry = rectContains(areas.quarryArea, tx, ty);
  if (sym === "f" && !inField) sym = ".";
  if (sym === "y" && !inYard) sym = ".";
  if (sym === "w" && !inPond) sym = ".";
  if (sym === "c" && !inClearing) sym = ".";
  if (sym === "q" && !inQuarry) sym = ".";
  if (sym === "h" || sym === "y" || sym === "w" || sym === "c" || sym === "f" || sym === "d" || sym === "b" || sym === "s" || sym === "t" || sym === "x") {
    return false;
  }
  if (inYard || inField || inPond || inClearing) return false;
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
  if (rectContains(state.map.fieldArea, tx, ty)) return "f";
  if (rectContains(state.map.yardArea, tx, ty)) return "y";
  if (rectContains(state.map.pondArea, tx, ty)) return "w";
  if (rectContains(state.map.clearingArea, tx, ty)) return "c";
  if (rectContains(state.map.quarryArea, tx, ty)) return "q";
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
  player.ammo = clamp(sanitizeNumber(savedPlayer.ammo, player.ammo), 0, WORLD.inventoryLimit);
  player.stamina = clamp(sanitizeNumber(savedPlayer.stamina, player.stamina), 0, player.maxStamina);
  player.hearts = clamp(sanitizeNumber(savedPlayer.hearts, player.hearts), 1, WORLD.maxHearts);
  player.yardDelivered = clamp(sanitizeNumber(savedPlayer.yardDelivered, player.yardDelivered), 0, WORLD.yardBatch);
  player.yardTotal = clamp(sanitizeNumber(savedPlayer.yardTotal, player.yardTotal), 0, 9999);
  if (savedPlayer.selectedPlant === "cabbage" || savedPlayer.selectedPlant === "corn") {
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
=======

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
  money: null,
  ammo: null,
  water: null,
  stamina: null,
};
let joystickEl = null;
let joystickHandle = null;
let contextButton = null;
let restartButton = null;
let sprintButton = null;
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
=======

};


const canvas = document.getElementById("game");
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


const canvas = document.getElementById("game");
let ctx = null;
const hudElements = {
  version: document.getElementById("hud-version"),
  health: document.querySelector("#hud-health [data-value]"),
  poop: document.querySelector("#hud-poop [data-value]"),
  corn: document.querySelector("#hud-corn [data-value]"),
  cabbage: document.querySelector("#hud-cabbage [data-value]"),
  seed: document.querySelector("#hud-seed [data-value]"),
  money: document.querySelector("#hud-money [data-value]"),
  ammo: document.querySelector("#hud-ammo [data-value]"),
  water: document.querySelector("#hud-water [data-value]"),
  stamina: document.querySelector("#hud-stamina [data-value]"),


};
const joystickEl = document.getElementById("joystick");
const joystickHandle = document.getElementById("joystick-handle");
const contextButton = document.getElementById("context-button");
const restartButton = document.getElementById("restart-button");
const sprintButton = document.getElementById("sprint-button");

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

function rectContains(rect, tx, ty) {
  return tx >= rect.x && ty >= rect.y && tx < rect.x + rect.w && ty < rect.y + rect.h;
}

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function applyInputMode() {
  if (typeof document === "undefined") return;
  const isDesktop = !state.prefersTouch;
  document.body.classList.toggle("desktop", isDesktop);
  if (isDesktop) {
    state.joystick.dx = 0;
    state.joystick.dy = 0;
    state.touchSprint = false;
    sprintButton?.classList.remove("active");
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
  hudElements.money = document.querySelector("#hud-money [data-value]");
  hudElements.ammo = document.querySelector("#hud-ammo [data-value]");
  hudElements.water = document.querySelector("#hud-water [data-value]");
  hudElements.stamina = document.querySelector("#hud-stamina [data-value]");
  joystickEl = document.getElementById("joystick");
  joystickHandle = document.getElementById("joystick-handle");
  contextButton = document.getElementById("context-button");
  restartButton = document.getElementById("restart-button");
  sprintButton = document.getElementById("sprint-button");
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
=======

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
  if (data.yard) {
    state.yard.delivered = clamp(sanitizeNumber(data.yard.delivered, state.yard.delivered), 0, WORLD.yardBatch);
    state.yard.total = clamp(sanitizeNumber(data.yard.total, state.yard.total), 0, 9999);
    state.yard.upgradeReady = Boolean(data.yard.upgradeReady);
    state.yard.upgradeNotified = Boolean(data.yard.upgradeNotified);
  }
  if (data.editorLayout) {
    state.editor.layout = safeClone(data.editorLayout);
    applyEditorLayout(data.editorLayout, false);
=======
}
const hudElements = {
  version: null,
  health: null,
  poop: null,
  corn: null,
  cabbage: null,
  seed: null,
  money: null,
  ammo: null,
  water: null,
  stamina: null,
};
let joystickEl = null;
let joystickHandle = null;
let contextButton = null;
let restartButton = null;
let sprintButton = null;
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

const dialogEl = document.getElementById("dialog");
const dialogBody = document.getElementById("dialog-body");
const dialogTitle = document.getElementById("dialog-title");
const dialogSubtitle = document.getElementById("dialog-subtitle");
const dialogClose = document.getElementById("dialog-close");
const editorPanel = document.getElementById("editor-panel");
const editorBody = document.getElementById("editor-body");
const editorDescription = document.getElementById("editor-description");
const editorSave = document.getElementById("editor-save");
const editorReset = document.getElementById("editor-reset");
const editorExit = document.getElementById("editor-exit");
const toastEl = document.getElementById("toast");

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
};

function seededRandom() {
  state.prngSeed = (state.prngSeed * 48271) % 2147483647;
  return state.prngSeed / 2147483647;

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
    const maxWatered = spec.wateredTotalMs ?? spec.growMs ?? 0;
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
=======
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
  const inField = rectContains(areas.fieldArea, tx, ty);
  const inYard = rectContains(areas.yardArea, tx, ty);
  const inPond = rectContains(areas.pondArea, tx, ty);
  const inClearing = rectContains(areas.clearingArea, tx, ty);
  const inQuarry = rectContains(areas.quarryArea, tx, ty);
  if (sym === "f" && !inField) sym = ".";
  if (sym === "y" && !inYard) sym = ".";
  if (sym === "w" && !inPond) sym = ".";
  if (sym === "c" && !inClearing) sym = ".";
  if (sym === "q" && !inQuarry) sym = ".";
  if (sym === "h" || sym === "y" || sym === "w" || sym === "c" || sym === "f" || sym === "d" || sym === "b" || sym === "s" || sym === "t" || sym === "x") {
    return false;
  }
  if (inYard || inField || inPond || inClearing) return false;
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
  if (rectContains(state.map.fieldArea, tx, ty)) return true;
  if (rectContains(state.map.yardArea, tx, ty)) return true;
  if (rectContains(state.map.pondArea, tx, ty)) return true;
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
}

function onKeyDown(ev) {
  const key = ev.key.toLowerCase();
  maybeEnterFullscreen(key);
  if (key === " " || key === "spacebar" || key === "space") {
    ev.preventDefault();
    triggerContextAction();
  }
  if (key === "1") {
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
    sprintButton.setPointerCapture?.(ev.pointerId);
  });
  sprintButton.addEventListener("pointerup", release);
  sprintButton.addEventListener("pointercancel", release);
  sprintButton.addEventListener("pointerleave", release);
  window.addEventListener("pointerup", release);
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
=======
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
  if (rectContains(state.map.fieldArea, tx, ty)) return "f";
  if (rectContains(state.map.yardArea, tx, ty)) return "y";
  if (rectContains(state.map.pondArea, tx, ty)) return "w";
  if (rectContains(state.map.clearingArea, tx, ty)) return "c";
  if (rectContains(state.map.quarryArea, tx, ty)) return "q";
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
=======
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

function rectContains(rect, tx, ty) {
  return tx >= rect.x && ty >= rect.y && tx < rect.x + rect.w && ty < rect.y + rect.h;
}

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function applyInputMode() {
  if (typeof document === "undefined") return;
  const isDesktop = !state.prefersTouch;
  document.body.classList.toggle("desktop", isDesktop);
  if (isDesktop) {
    state.joystick.dx = 0;
    state.joystick.dy = 0;
    state.touchSprint = false;
    sprintButton?.classList.remove("active");
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
  hudElements.money = document.querySelector("#hud-money [data-value]");
  hudElements.ammo = document.querySelector("#hud-ammo [data-value]");
  hudElements.water = document.querySelector("#hud-water [data-value]");
  hudElements.stamina = document.querySelector("#hud-stamina [data-value]");
  joystickEl = document.getElementById("joystick");
  joystickHandle = document.getElementById("joystick-handle");
  contextButton = document.getElementById("context-button");
  restartButton = document.getElementById("restart-button");
  sprintButton = document.getElementById("sprint-button");
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
    btn.addEventListener("click", () => {
      if (action.disabled) return;
      action.onSelect?.();
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
  if (hudElements.money) hudElements.money.textContent = `${player.money}`;
  if (hudElements.ammo) hudElements.ammo.textContent = `${player.ammo}`;
  if (hudElements.water) hudElements.water.textContent = `${player.watering.charges}/${player.watering.max}`;
  if (hudElements.stamina) {
    const pct = Math.round((player.stamina / player.maxStamina) * 100);
    hudElements.stamina.textContent = `${pct}%`;
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
  handleSpawns(dt);
  updatePlayer(dt);
  updatePlants(dt);
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
    state.nextSpawnDelay = randomBetween(SPAWN.boulderIntervalMs[0], SPAWN.boulderIntervalMs[1]);
  }
  if (state.spawnTimers.dirt >= 16000) {
    spawnDirt();
    state.spawnTimers.dirt = 0;
  }
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
=======
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
  player.ammo = clamp(sanitizeNumber(savedPlayer.ammo, player.ammo), 0, WORLD.inventoryLimit);
  player.stamina = clamp(sanitizeNumber(savedPlayer.stamina, player.stamina), 0, player.maxStamina);
  player.hearts = clamp(sanitizeNumber(savedPlayer.hearts, player.hearts), 1, WORLD.maxHearts);
  player.yardDelivered = clamp(sanitizeNumber(savedPlayer.yardDelivered, player.yardDelivered), 0, WORLD.yardBatch);
  player.yardTotal = clamp(sanitizeNumber(savedPlayer.yardTotal, player.yardTotal), 0, 9999);
  if (savedPlayer.selectedPlant === "cabbage" || savedPlayer.selectedPlant === "corn") {
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
    const maxWatered = spec.wateredTotalMs ?? spec.growMs ?? 0;
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
  if (rectContains(state.map.fieldArea, tx, ty)) return true;
  if (rectContains(state.map.yardArea, tx, ty)) return true;
  if (rectContains(state.map.pondArea, tx, ty)) return true;
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
}

function onKeyDown(ev) {
  const key = ev.key.toLowerCase();
  maybeEnterFullscreen(key);
  if (key === " " || key === "spacebar" || key === "space") {
    ev.preventDefault();
    triggerContextAction();
  }
  if (key === "1") {
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
    sprintButton.setPointerCapture?.(ev.pointerId);
  });
  sprintButton.addEventListener("pointerup", release);
  sprintButton.addEventListener("pointercancel", release);
  sprintButton.addEventListener("pointerleave", release);
  window.addEventListener("pointerup", release);
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
  return false;
}

function updatePlants(dt) {
  const now = state.time * 1000;
  for (const plant of state.plants.values()) {
    if (plant.stage === "growing" && now >= plant.readyAt) {
      plant.stage = plant.success ? "ready" : "failed";
    }
  }
}
function resolveContextAction() {
  const player = state.player;
  const { tx: playerTx, ty: playerTy } = worldToTile(player.x, player.y);
  if (rectContains(state.map.yardArea, playerTx, playerTy) && player.carrying && player.carrying.kind === "stone") {
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
  } else if (rectContains(state.map.fieldArea, front.tx, front.ty)) {
    if (state.player.selectedPlant === "corn" && state.player.poop > 0) {
      return { label: "Mais säen", handler: () => plantCrop(front.tx, front.ty, "corn") };
    }
    if (state.player.selectedPlant === "cabbage" && state.player.cabbageSeed > 0) {
      return { label: "Kohl pflanzen", handler: () => plantCrop(front.tx, front.ty, "cabbage") };
    }
  }
  if (tileAt(front.tx, front.ty) === "w" && state.player.watering.charges < state.player.watering.max) {
    return { label: "Gießkanne füllen", handler: refillWater };
=======
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
      action.onSelect?.();
      closeDialog();
    });
    dialogBody.appendChild(btn);
  });
  dialogEl.classList.add("open");
  if (contextButton) {
    contextButton.textContent = "Schließen";
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
  if (rectContains(state.map.fieldArea, tx, ty)) return { valid: false, tx, ty };
  if (rectContains(state.map.yardArea, tx, ty)) return { valid: false, tx, ty };
  if (rectContains(state.map.pondArea, tx, ty)) return { valid: false, tx, ty };
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
  const chance = 0.1 + Math.random() * 0.05;
  if (Math.random() < chance) {
    state.player.poop = clamp(state.player.poop + 1, 0, WORLD.inventoryLimit);
    showToast("Ein bisschen 💩 gefunden");
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
    const nx = sanitizeNumber(match?.x, fallbackX, 1, state.map.cols - 2);
    const ny = sanitizeNumber(match?.y, fallbackY, 1, state.map.rows - 2);
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
  if (!ctx) return;
  const width = canvas.width / state.dpr;
  const height = canvas.height / state.dpr;
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  drawBackground(width, height);
  const offsetX = width / 2 - state.camera.x;
  const offsetY = height / 2 - state.camera.y;
  ctx.translate(offsetX, offsetY);
  drawTiles();
  drawHouses();
  drawPlants();
  drawDirt();
  drawStones();
  drawNPCs();
  drawPlayer();
  drawPreview();
  ctx.restore();
  drawHudOverlay(width, height);
}

function drawBackground(width, height) {
  const grd = ctx.createLinearGradient(0, 0, 0, height);
  grd.addColorStop(0, "#0b1418");
  grd.addColorStop(1, "#04070a");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, width, height);
}

function drawTiles() {
  for (let ty = 0; ty < state.map.rows; ty++) {
    for (let tx = 0; tx < state.map.cols; tx++) {
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

function drawHouses() {
  for (const house of HOUSES) {
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

function drawPlants() {
  for (const plant of state.plants.values()) {
    const x = plant.tx * TILE + TILE / 2;
    const y = plant.ty * TILE + TILE / 2;
    ctx.save();
    ctx.translate(x, y);
    if (plant.kind === "corn") {
      ctx.fillStyle = plant.stage === "ready" ? "#ffd95a" : plant.stage === "failed" ? "#665540" : "#c1a842";
      ctx.beginPath();
      ctx.ellipse(0, 0, TILE * 0.22, TILE * 0.34, 0, 0, TAU);
      ctx.fill();
    } else {
      ctx.fillStyle = plant.stage === "ready" ? "#7ae38f" : plant.stage === "failed" ? "#4f5f4f" : "#4ecb6d";
      ctx.beginPath();
      ctx.arc(0, 0, TILE * 0.28, 0, TAU);
      ctx.fill();
=======
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
  if (hudElements.money) hudElements.money.textContent = `${player.money}`;
  if (hudElements.ammo) hudElements.ammo.textContent = `${player.ammo}`;
  if (hudElements.water) hudElements.water.textContent = `${player.watering.charges}/${player.watering.max}`;
  if (hudElements.stamina) {
    const pct = Math.round((player.stamina / player.maxStamina) * 100);
    hudElements.stamina.textContent = `${pct}%`;
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
  handleSpawns(dt);
  updatePlayer(dt);
  updatePlants(dt);
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
    state.nextSpawnDelay = randomBetween(SPAWN.boulderIntervalMs[0], SPAWN.boulderIntervalMs[1]);
  }
  if (state.spawnTimers.dirt >= 16000) {
    spawnDirt();
    state.spawnTimers.dirt = 0;
  }
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
    ctx.restore();
  }
}

function drawDirt() {
  ctx.fillStyle = "#5a4228";
  for (const clod of state.dirt) {
    ctx.beginPath();
    ctx.arc(clod.x, clod.y, clod.radius, 0, TAU);
    ctx.fill();
  }
}

function drawStones() {
  ctx.fillStyle = "#8793a1";
  for (const stone of state.stones) {
    ctx.beginPath();
    ctx.arc(stone.x, stone.y, stone.radius, 0, TAU);
    ctx.fill();
  }
}

function drawNPCs() {
  let index = 0;
  for (const npc of state.npcs) {
    const facing = vectorToFacing(state.player.x - npc.x, state.player.y - npc.y, "down");
    drawNpcSprite(npc, facing, index);
    index += 1;
  }
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
  ctx.ellipse(0, Math.sin((player.anim?.phase || 0) * 2) * TILE * 0.04, TILE * 0.26, TILE * 0.18, 0, 0, TAU);
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

function drawPreview() {
  const preview = state.preview;
  if (!preview) return;
  ctx.save();
  ctx.fillStyle = preview.valid ? "rgba(120,220,140,0.35)" : "rgba(220,80,80,0.35)";
  ctx.fillRect(preview.tx * TILE, preview.ty * TILE, TILE, TILE);
  ctx.restore();
}

function drawHudOverlay(width, height) {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "12px Inter, sans-serif";
  ctx.fillText(`FPS: ${state.fps.toFixed(0)}`, width - 80, height - 16);
  ctx.restore();
}

=======
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
=======
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
  const inField = rectContains(areas.fieldArea, tx, ty);
  const inYard = rectContains(areas.yardArea, tx, ty);
  const inPond = rectContains(areas.pondArea, tx, ty);
  const inClearing = rectContains(areas.clearingArea, tx, ty);
  const inQuarry = rectContains(areas.quarryArea, tx, ty);
  if (sym === "f" && !inField) sym = ".";
  if (sym === "y" && !inYard) sym = ".";
  if (sym === "w" && !inPond) sym = ".";
  if (sym === "c" && !inClearing) sym = ".";
  if (sym === "q" && !inQuarry) sym = ".";
  if (sym === "h" || sym === "y" || sym === "w" || sym === "c" || sym === "f" || sym === "d" || sym === "b" || sym === "s" || sym === "t" || sym === "x") {
    return false;
  }
  if (inYard || inField || inPond || inClearing) return false;
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
  if (rectContains(state.map.fieldArea, tx, ty)) return "f";
  if (rectContains(state.map.yardArea, tx, ty)) return "y";
  if (rectContains(state.map.pondArea, tx, ty)) return "w";
  if (rectContains(state.map.clearingArea, tx, ty)) return "c";
  if (rectContains(state.map.quarryArea, tx, ty)) return "q";
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

function rectContains(rect, tx, ty) {
  return tx >= rect.x && ty >= rect.y && tx < rect.x + rect.w && ty < rect.y + rect.h;
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

function rectContains(rect, tx, ty) {
  return tx >= rect.x && ty >= rect.y && tx < rect.x + rect.w && ty < rect.y + rect.h;
}

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function applyInputMode() {
  if (typeof document === "undefined") return;
  const isDesktop = !state.prefersTouch;
  document.body.classList.toggle("desktop", isDesktop);
  if (isDesktop) {
    state.joystick.dx = 0;
    state.joystick.dy = 0;
    state.touchSprint = false;
    sprintButton?.classList.remove("active");

  }
  resizeCanvas();
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
  player.ammo = clamp(sanitizeNumber(savedPlayer.ammo, player.ammo), 0, WORLD.inventoryLimit);
  player.stamina = clamp(sanitizeNumber(savedPlayer.stamina, player.stamina), 0, player.maxStamina);
  player.hearts = clamp(sanitizeNumber(savedPlayer.hearts, player.hearts), 1, WORLD.maxHearts);
  player.yardDelivered = clamp(sanitizeNumber(savedPlayer.yardDelivered, player.yardDelivered), 0, WORLD.yardBatch);
  player.yardTotal = clamp(sanitizeNumber(savedPlayer.yardTotal, player.yardTotal), 0, 9999);
  if (savedPlayer.selectedPlant === "cabbage" || savedPlayer.selectedPlant === "corn") {
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
  loadActorsFromSave(data);
}

function loadActorsFromSave(data) {
  state.stones = [];
  state.dirt = [];
  state.plants.clear();
  const stones = Array.isArray(data.stones) ? data.stones : [];
  for (const stone of stones) {
    const x = sanitizeNumber(stone.x, null);
    const y = sanitizeNumber(stone.y, null);
    if (x === null || y === null) continue;
    state.stones.push(makeStone(x, y));
  }
  const dirt = Array.isArray(data.dirt) ? data.dirt : [];
  for (const clod of dirt) {
    const x = sanitizeNumber(clod.x, null);
    const y = sanitizeNumber(clod.y, null);
    if (x === null || y === null) continue;
    state.dirt.push(makeDirt(x, y));
  }
  const plants = Array.isArray(data.plants) ? data.plants : [];
  for (const savedPlant of plants) {
    const tx = sanitizeNumber(savedPlant.tx, null);
    const ty = sanitizeNumber(savedPlant.ty, null);
    const kind = savedPlant.kind;
    if (tx === null || ty === null) continue;
    if (kind !== "corn" && kind !== "cabbage") continue;
    const plantedAt = sanitizeNumber(savedPlant.plantedAt, state.time * 1000);
    const readyAt = sanitizeNumber(savedPlant.readyAt, plantedAt + PLANTS[kind].growMs);
    const stage = savedPlant.stage === "ready" || savedPlant.stage === "failed" ? savedPlant.stage : "growing";
    const watered = Boolean(savedPlant.watered);
    const wateredMs = clamp(sanitizeNumber(savedPlant.wateredMs, 0), 0, PLANTS.cabbage.wateredTotalMs || 0);
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

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
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
    if (plant.stage === "growing" && now >= plant.readyAt) {
      plant.stage = plant.success ? "ready" : "failed";
    }
  }
}
function resolveContextAction() {
  const player = state.player;
  const { tx: playerTx, ty: playerTy } = worldToTile(player.x, player.y);
  if (rectContains(state.map.yardArea, playerTx, playerTy) && player.carrying && player.carrying.kind === "stone") {
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
  } else if (rectContains(state.map.fieldArea, front.tx, front.ty)) {
    if (state.player.selectedPlant === "corn" && state.player.poop > 0) {
      return { label: "Mais säen", handler: () => plantCrop(front.tx, front.ty, "corn") };
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
    if (state.player.selectedPlant === "cabbage" && state.player.cabbageSeed > 0) {
      return { label: "Kohl pflanzen", handler: () => plantCrop(front.tx, front.ty, "cabbage") };
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
  if (rectContains(state.map.fieldArea, tx, ty)) return { valid: false, tx, ty };
  if (rectContains(state.map.yardArea, tx, ty)) return { valid: false, tx, ty };
  if (rectContains(state.map.pondArea, tx, ty)) return { valid: false, tx, ty };
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
  const chance = 0.1 + Math.random() * 0.05;
  if (Math.random() < chance) {
    state.player.poop = clamp(state.player.poop + 1, 0, WORLD.inventoryLimit);
    showToast("Ein bisschen 💩 gefunden");
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
=======
function positionBlocked(x, y, radius) {
  const { tx, ty } = worldToTile(x, y);
  if (!tileWalkable(tx, ty)) return true;
  if (rectContains(state.map.fieldArea, tx, ty)) return true;
  if (rectContains(state.map.yardArea, tx, ty)) return true;
  if (rectContains(state.map.pondArea, tx, ty)) return true;
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
}

function onKeyDown(ev) {
  const key = ev.key.toLowerCase();
  maybeEnterFullscreen(key);
  if (key === " " || key === "spacebar" || key === "space") {
    ev.preventDefault();
    triggerContextAction();
  }
  if (key === "1") {
    state.player.selectedPlant = "corn";
    showToast("Saat: Mais");
  }
  if (key === "2") {
    state.player.selectedPlant = "cabbage";
    showToast("Saat: Kohl");
  }
  state.keys.set(key, true);
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
    const nx = sanitizeNumber(match?.x, fallbackX, 1, state.map.cols - 2);
    const ny = sanitizeNumber(match?.y, fallbackY, 1, state.map.rows - 2);
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
  if (!ctx) return;
  const width = canvas.width / state.dpr;
  const height = canvas.height / state.dpr;
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  drawBackground(width, height);
  const offsetX = width / 2 - state.camera.x;
  const offsetY = height / 2 - state.camera.y;
  ctx.translate(offsetX, offsetY);
  drawTiles();
  drawHouses();
  drawPlants();
  drawDirt();
  drawStones();
  drawNPCs();
  drawPlayer();
  drawPreview();
  ctx.restore();
  drawHudOverlay(width, height);
}

function drawBackground(width, height) {
  const grd = ctx.createLinearGradient(0, 0, 0, height);
  grd.addColorStop(0, "#0b1418");
  grd.addColorStop(1, "#04070a");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, width, height);
}

function drawTiles() {
  for (let ty = 0; ty < state.map.rows; ty++) {
    for (let tx = 0; tx < state.map.cols; tx++) {
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

function drawHouses() {
  for (const house of HOUSES) {
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

function drawPlants() {
  for (const plant of state.plants.values()) {
    const x = plant.tx * TILE + TILE / 2;
    const y = plant.ty * TILE + TILE / 2;
    ctx.save();
    ctx.translate(x, y);
    if (plant.kind === "corn") {
      ctx.fillStyle = plant.stage === "ready" ? "#ffd95a" : plant.stage === "failed" ? "#665540" : "#c1a842";
      ctx.beginPath();
      ctx.ellipse(0, 0, TILE * 0.22, TILE * 0.34, 0, 0, TAU);
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

function drawDirt() {
  ctx.fillStyle = "#5a4228";
  for (const clod of state.dirt) {
    ctx.beginPath();
    ctx.arc(clod.x, clod.y, clod.radius, 0, TAU);
    ctx.fill();
  }
}

function drawStones() {
  ctx.fillStyle = "#8793a1";
  for (const stone of state.stones) {
    ctx.beginPath();
    ctx.arc(stone.x, stone.y, stone.radius, 0, TAU);
    ctx.fill();
  }
}

function drawNPCs() {
  let index = 0;
  for (const npc of state.npcs) {
    const facing = vectorToFacing(state.player.x - npc.x, state.player.y - npc.y, "down");
    drawNpcSprite(npc, facing, index);
    index += 1;
  }
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
  ctx.ellipse(0, Math.sin((player.anim?.phase || 0) * 2) * TILE * 0.04, TILE * 0.26, TILE * 0.18, 0, 0, TAU);
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
=======
function onKeyUp(ev) {
  const key = ev.key.toLowerCase();
  state.keys.delete(key);
  state.once.delete(key);
}

function onBlur() {
  state.keys.clear();
  state.once.clear();
  state.touchSprint = false;
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
    sprintButton.setPointerCapture?.(ev.pointerId);
  });
  sprintButton.addEventListener("pointerup", release);
  sprintButton.addEventListener("pointercancel", release);
  sprintButton.addEventListener("pointerleave", release);
  window.addEventListener("pointerup", release);
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
      action.onSelect?.();
      closeDialog();
    });
    dialogBody.appendChild(btn);
  });
  dialogEl.classList.add("open");
  if (contextButton) {
    contextButton.textContent = "Schließen";
  }
=======
function isStoneSpawnable(sym, tx, ty, areas = state?.map ?? MAPDATA) {
  const inField = rectContains(areas.fieldArea, tx, ty);
  const inYard = rectContains(areas.yardArea, tx, ty);
  const inPond = rectContains(areas.pondArea, tx, ty);
  const inClearing = rectContains(areas.clearingArea, tx, ty);
  const inQuarry = rectContains(areas.quarryArea, tx, ty);
  if (sym === "f" && !inField) sym = ".";
  if (sym === "y" && !inYard) sym = ".";
  if (sym === "w" && !inPond) sym = ".";
  if (sym === "c" && !inClearing) sym = ".";
  if (sym === "q" && !inQuarry) sym = ".";
  if (sym === "h" || sym === "y" || sym === "w" || sym === "c" || sym === "f" || sym === "d" || sym === "b" || sym === "s" || sym === "t" || sym === "x") {
    return false;
  }
  if (inYard || inField || inPond || inClearing) return false;
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

  if (!canvas) return;
  const parent = canvas.parentElement;
  const width = parent ? parent.clientWidth : window.innerWidth;
  const height = width * (9 / 16);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);

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
  if (rectContains(state.map.fieldArea, tx, ty)) return "f";
  if (rectContains(state.map.yardArea, tx, ty)) return "y";
  if (rectContains(state.map.pondArea, tx, ty)) return "w";
  if (rectContains(state.map.clearingArea, tx, ty)) return "c";
  if (rectContains(state.map.quarryArea, tx, ty)) return "q";
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
  player.ammo = clamp(sanitizeNumber(savedPlayer.ammo, player.ammo), 0, WORLD.inventoryLimit);
  player.stamina = clamp(sanitizeNumber(savedPlayer.stamina, player.stamina), 0, player.maxStamina);

function drawPreview() {
  const preview = state.preview;
  if (!preview) return;
  ctx.save();
  ctx.fillStyle = preview.valid ? "rgba(120,220,140,0.35)" : "rgba(220,80,80,0.35)";
  ctx.fillRect(preview.tx * TILE, preview.ty * TILE, TILE, TILE);
  ctx.restore();
}

function drawHudOverlay(width, height) {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "12px Inter, sans-serif";
  ctx.fillText(`FPS: ${state.fps.toFixed(0)}`, width - 80, height - 16);
  ctx.restore();
}

=======

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
  if (hudElements.money) hudElements.money.textContent = `${player.money}`;
  if (hudElements.ammo) hudElements.ammo.textContent = `${player.ammo}`;
  if (hudElements.water) hudElements.water.textContent = `${player.watering.charges}/${player.watering.max}`;
  if (hudElements.stamina) {
    const pct = Math.round((player.stamina / player.maxStamina) * 100);
    hudElements.stamina.textContent = `${pct}%`;
  }
  if (state.contextAction) {
    if (contextButton) {
      contextButton.textContent = state.contextAction.label;
      contextButton.disabled = Boolean(state.contextAction.disabled);

  player.hearts = clamp(sanitizeNumber(savedPlayer.hearts, player.hearts), 1, WORLD.maxHearts);
  player.yardDelivered = clamp(sanitizeNumber(savedPlayer.yardDelivered, player.yardDelivered), 0, WORLD.yardBatch);
  player.yardTotal = clamp(sanitizeNumber(savedPlayer.yardTotal, player.yardTotal), 0, 9999);
  if (savedPlayer.selectedPlant === "cabbage" || savedPlayer.selectedPlant === "corn") {
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
  handleSpawns(dt);
  updatePlayer(dt);
  updatePlants(dt);
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
    state.nextSpawnDelay = randomBetween(SPAWN.boulderIntervalMs[0], SPAWN.boulderIntervalMs[1]);
  }
  if (state.spawnTimers.dirt >= 16000) {
    spawnDirt();
    state.spawnTimers.dirt = 0;
  }
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
    if (plant.stage === "growing" && now >= plant.readyAt) {
      plant.stage = plant.success ? "ready" : "failed";
    }
  }
}
function resolveContextAction() {
  const player = state.player;
  const { tx: playerTx, ty: playerTy } = worldToTile(player.x, player.y);
  if (rectContains(state.map.yardArea, playerTx, playerTy) && player.carrying && player.carrying.kind === "stone") {
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
  } else if (rectContains(state.map.fieldArea, front.tx, front.ty)) {
    if (state.player.selectedPlant === "corn" && state.player.poop > 0) {
      return { label: "Mais säen", handler: () => plantCrop(front.tx, front.ty, "corn") };
    }
    if (state.player.selectedPlant === "cabbage" && state.player.cabbageSeed > 0) {
      return { label: "Kohl pflanzen", handler: () => plantCrop(front.tx, front.ty, "cabbage") };
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
  if (rectContains(state.map.fieldArea, tx, ty)) return { valid: false, tx, ty };
  if (rectContains(state.map.yardArea, tx, ty)) return { valid: false, tx, ty };
  if (rectContains(state.map.pondArea, tx, ty)) return { valid: false, tx, ty };
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
  const chance = 0.1 + Math.random() * 0.05;
  if (Math.random() < chance) {
    state.player.poop = clamp(state.player.poop + 1, 0, WORLD.inventoryLimit);
    showToast("Ein bisschen 💩 gefunden");
=======
  if (data.yard) {
    state.yard.delivered = clamp(sanitizeNumber(data.yard.delivered, state.yard.delivered), 0, WORLD.yardBatch);
    state.yard.total = clamp(sanitizeNumber(data.yard.total, state.yard.total), 0, 9999);
    state.yard.upgradeReady = Boolean(data.yard.upgradeReady);
    state.yard.upgradeNotified = Boolean(data.yard.upgradeNotified);

  }
  if (data.editorLayout) {
    state.editor.layout = structuredClone(data.editorLayout);
    applyEditorLayout(data.editorLayout, false);
  }
  loadActorsFromSave(data);
}

function loadActorsFromSave(data) {
  state.stones = [];
  state.dirt = [];
  state.plants.clear();
  const stones = Array.isArray(data.stones) ? data.stones : [];
  for (const stone of stones) {
    const x = sanitizeNumber(stone.x, null);
    const y = sanitizeNumber(stone.y, null);
    if (x === null || y === null) continue;
    state.stones.push(makeStone(x, y));
  }
  const dirt = Array.isArray(data.dirt) ? data.dirt : [];
  for (const clod of dirt) {
    const x = sanitizeNumber(clod.x, null);
    const y = sanitizeNumber(clod.y, null);
    if (x === null || y === null) continue;
    state.dirt.push(makeDirt(x, y));
  }
  const plants = Array.isArray(data.plants) ? data.plants : [];
  for (const savedPlant of plants) {
    const tx = sanitizeNumber(savedPlant.tx, null);
    const ty = sanitizeNumber(savedPlant.ty, null);
    const kind = savedPlant.kind;
    if (tx === null || ty === null) continue;
    if (kind !== "corn" && kind !== "cabbage") continue;
    const plantedAt = sanitizeNumber(savedPlant.plantedAt, state.time * 1000);
    const readyAt = sanitizeNumber(savedPlant.readyAt, plantedAt + PLANTS[kind].growMs);
    const stage = savedPlant.stage === "ready" || savedPlant.stage === "failed" ? savedPlant.stage : "growing";
    const watered = Boolean(savedPlant.watered);
    const wateredMs = clamp(sanitizeNumber(savedPlant.wateredMs, 0), 0, PLANTS.cabbage.wateredTotalMs || 0);
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
  if (data.editorLayout) {
    state.editor.layout = safeClone(data.editorLayout);
    applyEditorLayout(data.editorLayout, false);
  }
  loadActorsFromSave(data);
}


function loadActorsFromSave(data) {
  state.stones = [];
  state.dirt = [];
  state.plants.clear();
  const stones = Array.isArray(data.stones) ? data.stones : [];
  for (const stone of stones) {
    const x = sanitizeNumber(stone.x, null);
    const y = sanitizeNumber(stone.y, null);
    if (x === null || y === null) continue;
    state.stones.push(makeStone(x, y));
  }
  const dirt = Array.isArray(data.dirt) ? data.dirt : [];
  for (const clod of dirt) {
    const x = sanitizeNumber(clod.x, null);
    const y = sanitizeNumber(clod.y, null);
    if (x === null || y === null) continue;
    state.dirt.push(makeDirt(x, y));
  }
  const plants = Array.isArray(data.plants) ? data.plants : [];
  for (const savedPlant of plants) {
    const tx = sanitizeNumber(savedPlant.tx, null);
    const ty = sanitizeNumber(savedPlant.ty, null);
    const kind = savedPlant.kind;
    if (tx === null || ty === null) continue;
    if (kind !== "corn" && kind !== "cabbage") continue;
    const plantedAt = sanitizeNumber(savedPlant.plantedAt, state.time * 1000);
    const readyAt = sanitizeNumber(savedPlant.readyAt, plantedAt + PLANTS[kind].growMs);
    const stage = savedPlant.stage === "ready" || savedPlant.stage === "failed" ? savedPlant.stage : "growing";
    const watered = Boolean(savedPlant.watered);
    const wateredMs = clamp(sanitizeNumber(savedPlant.wateredMs, 0), 0, PLANTS.cabbage.wateredTotalMs || 0);
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
  updateHud();
}

function spawnInitialActors() {
  for (let i = 0; i < SPAWN.boulderInit; i++) {
    spawnStone();
  }
  for (let i = 0; i < SPAWN.dirtInit; i++) {
    spawnDirt();

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
  } else if (plant.kind === "cabbage") {
    state.player.cabbage = clamp(state.player.cabbage + 1, 0, WORLD.inventoryLimit);
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
    return JSON.parse(raw);
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
  if (!layout) return;
  state.map.fieldArea = layout.fieldArea ? { ...layout.fieldArea } : { ...MAPDATA.fieldArea };
  state.map.yardArea = layout.yardArea ? { ...layout.yardArea } : { ...MAPDATA.yardArea };
  state.map.pondArea = layout.pondArea ? { ...layout.pondArea } : { ...MAPDATA.pondArea };
  state.map.clearingArea = layout.clearingArea ? { ...layout.clearingArea } : { ...MAPDATA.clearingArea };
  state.map.quarryArea = layout.quarryArea ? { ...layout.quarryArea } : { ...MAPDATA.quarryArea };
  if (Array.isArray(layout.npcs)) {
    for (const info of layout.npcs) {
      const npc = state.npcs.find(n => n.id === info.id);
      if (!npc) continue;
      npc.x = clamp(info.x, 1, state.map.cols - 2) * TILE;
      npc.y = clamp(info.y, 1, state.map.rows - 2) * TILE;
    }
  }
  state.map.spawnable = rebuildSpawnable(state.map);
  if (updatePanel) {
    state.editor.layout = safeClone(layout);
    renderEditorPanel();
function positionBlocked(x, y, radius) {
  const { tx, ty } = worldToTile(x, y);
  if (!tileWalkable(tx, ty)) return true;
  if (rectContains(state.map.fieldArea, tx, ty)) return true;
  if (rectContains(state.map.yardArea, tx, ty)) return true;
  if (rectContains(state.map.pondArea, tx, ty)) return true;
  for (const stone of state.stones) {
    if (distance(x, y, stone.x, stone.y) < radius + stone.radius) return true;
  }
  return false;
}

function setupInput() {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  contextButton.addEventListener("click", () => triggerContextAction());
  restartButton.addEventListener("click", () => resetGame());
  dialogClose.addEventListener("click", closeDialog);
  editorSave.addEventListener("click", () => saveEditorLayout());
  editorReset.addEventListener("click", () => resetEditorLayout());
  editorExit.addEventListener("click", () => exitEditor());
  setupJoystick();
  setupSprintButton();
}

function onKeyDown(ev) {
  const key = ev.key.toLowerCase();
  maybeEnterFullscreen(key);
  if (key === " " || key === "spacebar" || key === "space") {
    ev.preventDefault();
    triggerContextAction();
  }
  if (key === "1") {
    state.player.selectedPlant = "corn";
    showToast("Saat: Mais");
  }
  if (key === "2") {
    state.player.selectedPlant = "cabbage";
    showToast("Saat: Kohl");
  }
  state.keys.set(key, true);
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
  if (!ctx) return;
  const width = canvas.width / state.dpr;
  const height = canvas.height / state.dpr;
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  drawBackground(width, height);
  const offsetX = width / 2 - state.camera.x;
  const offsetY = height / 2 - state.camera.y;
  ctx.translate(offsetX, offsetY);
  drawTiles();
  drawHouses();
  drawPlants();
  drawDirt();
  drawStones();
  drawNPCs();
  drawPlayer();
  drawPreview();
  ctx.restore();
  drawHudOverlay(width, height);
}

function drawBackground(width, height) {
  const grd = ctx.createLinearGradient(0, 0, 0, height);
  grd.addColorStop(0, "#0b1418");
  grd.addColorStop(1, "#04070a");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, width, height);
}

function drawTiles() {
  for (let ty = 0; ty < state.map.rows; ty++) {
    for (let tx = 0; tx < state.map.cols; tx++) {
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

function drawHouses() {
  for (const house of HOUSES) {
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

function drawPlants() {
  for (const plant of state.plants.values()) {
    const x = plant.tx * TILE + TILE / 2;
    const y = plant.ty * TILE + TILE / 2;
    ctx.save();
    ctx.translate(x, y);
    if (plant.kind === "corn") {
      ctx.fillStyle = plant.stage === "ready" ? "#ffd95a" : plant.stage === "failed" ? "#665540" : "#c1a842";
      ctx.beginPath();
      ctx.ellipse(0, 0, TILE * 0.22, TILE * 0.34, 0, 0, TAU);
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

function drawDirt() {
  ctx.fillStyle = "#5a4228";
  for (const clod of state.dirt) {
    ctx.beginPath();
    ctx.arc(clod.x, clod.y, clod.radius, 0, TAU);
    ctx.fill();
  }
}

function drawStones() {
  ctx.fillStyle = "#8793a1";
  for (const stone of state.stones) {
    ctx.beginPath();
    ctx.arc(stone.x, stone.y, stone.radius, 0, TAU);
    ctx.fill();
  }
}

function drawNPCs() {
  let index = 0;
  for (const npc of state.npcs) {
    const facing = vectorToFacing(state.player.x - npc.x, state.player.y - npc.y, "down");
    drawNpcSprite(npc, facing, index);
    index += 1;
  }
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
  ctx.ellipse(0, Math.sin((player.anim?.phase || 0) * 2) * TILE * 0.04, TILE * 0.26, TILE * 0.18, 0, 0, TAU);
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

function drawPreview() {
  const preview = state.preview;
  if (!preview) return;
  ctx.save();
  ctx.fillStyle = preview.valid ? "rgba(120,220,140,0.35)" : "rgba(220,80,80,0.35)";
  ctx.fillRect(preview.tx * TILE, preview.ty * TILE, TILE, TILE);
  ctx.restore();
}

function drawHudOverlay(width, height) {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "12px Inter, sans-serif";
  ctx.fillText(`FPS: ${state.fps.toFixed(0)}`, width - 80, height - 16);
  ctx.restore();
}

function boot() {
  try {
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
  } catch (err) {
    failBoot(err);
  }
}

=======
  }
}

=======
  }
}

=======
function onKeyUp(ev) {
  const key = ev.key.toLowerCase();
  state.keys.delete(key);
  state.once.delete(key);
}

function onBlur() {
  state.keys.clear();
  state.once.clear();
  state.touchSprint = false;
  sprintButton?.classList.remove("active");
}
function setupJoystick() {
  if (!joystickEl) return;
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
    sprintButton.setPointerCapture?.(ev.pointerId);
  });
  sprintButton.addEventListener("pointerup", release);
  sprintButton.addEventListener("pointercancel", release);
  sprintButton.addEventListener("pointerleave", release);
  window.addEventListener("pointerup", release);
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


function positionBlocked(x, y, radius) {
  const { tx, ty } = worldToTile(x, y);
  if (!tileWalkable(tx, ty)) return true;
  if (rectContains(state.map.fieldArea, tx, ty)) return true;
  if (rectContains(state.map.yardArea, tx, ty)) return true;
  if (rectContains(state.map.pondArea, tx, ty)) return true;
  for (const stone of state.stones) {
    if (distance(x, y, stone.x, stone.y) < radius + stone.radius) return true;
  }
  return false;
}

function setupInput() {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  contextButton.addEventListener("click", () => triggerContextAction());
  restartButton.addEventListener("click", () => resetGame());
  dialogClose.addEventListener("click", closeDialog);
  editorSave.addEventListener("click", () => saveEditorLayout());
  editorReset.addEventListener("click", () => resetEditorLayout());
  editorExit.addEventListener("click", () => exitEditor());
  setupJoystick();
  setupSprintButton();
=======
}

function onKeyDown(ev) {
  const key = ev.key.toLowerCase();
  maybeEnterFullscreen(key);
  if (key === " " || key === "spacebar" || key === "space") {
    ev.preventDefault();
    triggerContextAction();
  }
  if (key === "1") {
    state.player.selectedPlant = "corn";
    showToast("Saat: Mais");
  }
=======
  if (key === " " || key === "spacebar" || key === "space") {
    ev.preventDefault();
    triggerContextAction();
  }
  if (key === "1") {
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
  sprintButton?.classList.remove("active");

}
function setupJoystick() {
  if (!joystickEl) return;
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
    sprintButton.setPointerCapture?.(ev.pointerId);
  });
  sprintButton.addEventListener("pointerup", release);
  sprintButton.addEventListener("pointercancel", release);
  sprintButton.addEventListener("pointerleave", release);
  window.addEventListener("pointerup", release);
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
  joystickHandle.style.transform = `translate(${nx * radius * 0.55}px, ${ny * radius * 0.55}px)`;
}

function onJoyPointerUp(ev) {
  if (!state.joystick.active || ev.pointerId !== state.joystick.pointerId) return;
  state.joystick.active = false;
  state.joystick.pointerId = null;
  state.joystick.dx = 0;
  state.joystick.dy = 0;
  joystickHandle.style.transform = "translate(-50%, -50%)";
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
  joystickHandle.style.transform = `translate(${nx * radius * 0.55}px, ${ny * radius * 0.55}px)`;
}

function onJoyPointerUp(ev) {
  if (!state.joystick.active || ev.pointerId !== state.joystick.pointerId) return;
  state.joystick.active = false;
  state.joystick.pointerId = null;
  state.joystick.dx = 0;
  state.joystick.dy = 0;
  joystickHandle.style.transform = "translate(-50%, -50%)";
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
  state.dialog.open = true;
  dialogTitle.textContent = title;
  dialogSubtitle.textContent = subtitle;
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
      action.onSelect?.();
      closeDialog();
    });
    dialogBody.appendChild(btn);
  });
  dialogEl.classList.add("open");
  contextButton.textContent = "Schließen";
}

function closeDialog() {
  state.dialog.open = false;
  dialogEl.classList.remove("open");
}

function showToast(message, duration = 2800) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  window.setTimeout(() => toastEl.classList.remove("show"), duration);
}

function updateHud() {
  hudElements.version.textContent = APP_VERSION;
  const player = state.player;
  hudElements.health.textContent = `${player.hearts}`;
  hudElements.poop.textContent = `${player.poop}`;
  hudElements.corn.textContent = `${player.corn}`;
  hudElements.cabbage.textContent = `${player.cabbage}`;
  hudElements.seed.textContent = `${player.cabbageSeed}`;
  hudElements.money.textContent = `${player.money}`;
  hudElements.ammo.textContent = `${player.ammo}`;
  hudElements.water.textContent = `${player.watering.charges}/${player.watering.max}`;
  if (hudElements.stamina) {
    const pct = Math.round((player.stamina / player.maxStamina) * 100);
    hudElements.stamina.textContent = `${pct}%`;
  }
  if (state.contextAction) {
    contextButton.textContent = state.contextAction.label;
    contextButton.disabled = Boolean(state.contextAction.disabled);
  } else {
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
  handleSpawns(dt);
  updatePlayer(dt);
  updatePlants(dt);
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
    state.nextSpawnDelay = randomBetween(SPAWN.boulderIntervalMs[0], SPAWN.boulderIntervalMs[1]);
  }
  if (state.spawnTimers.dirt >= 16000) {
    spawnDirt();
    state.spawnTimers.dirt = 0;
  }
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
    if (plant.stage === "growing" && now >= plant.readyAt) {
      plant.stage = plant.success ? "ready" : "failed";
    }
  }
}
function resolveContextAction() {
  const player = state.player;
  const { tx: playerTx, ty: playerTy } = worldToTile(player.x, player.y);
  if (rectContains(state.map.yardArea, playerTx, playerTy) && player.carrying && player.carrying.kind === "stone") {
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
  } else if (rectContains(state.map.fieldArea, front.tx, front.ty)) {
    if (state.player.selectedPlant === "corn" && state.player.poop > 0) {
      return { label: "Mais säen", handler: () => plantCrop(front.tx, front.ty, "corn") };
    }
    if (state.player.selectedPlant === "cabbage" && state.player.cabbageSeed > 0) {
      return { label: "Kohl pflanzen", handler: () => plantCrop(front.tx, front.ty, "cabbage") };
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
  if (rectContains(state.map.fieldArea, tx, ty)) return { valid: false, tx, ty };
  if (rectContains(state.map.yardArea, tx, ty)) return { valid: false, tx, ty };
  if (rectContains(state.map.pondArea, tx, ty)) return { valid: false, tx, ty };
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
  const chance = 0.1 + Math.random() * 0.05;
  if (Math.random() < chance) {
    state.player.poop = clamp(state.player.poop + 1, 0, WORLD.inventoryLimit);
    showToast("Ein bisschen 💩 gefunden");
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
  editorPanel.classList.add("open");
}

function exitEditor() {
  state.editor.open = false;
  editorPanel.classList.remove("open");
}

function loadEditorLayoutFromStorage() {
  try {
    const raw = localStorage.getItem(WORLD.editorLayoutKey);
    if (!raw) return null;
    return JSON.parse(raw);
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
  if (!layout) return;
  state.map.fieldArea = layout.fieldArea ? { ...layout.fieldArea } : { ...MAPDATA.fieldArea };
  state.map.yardArea = layout.yardArea ? { ...layout.yardArea } : { ...MAPDATA.yardArea };
  state.map.pondArea = layout.pondArea ? { ...layout.pondArea } : { ...MAPDATA.pondArea };
  state.map.clearingArea = layout.clearingArea ? { ...layout.clearingArea } : { ...MAPDATA.clearingArea };
  state.map.quarryArea = layout.quarryArea ? { ...layout.quarryArea } : { ...MAPDATA.quarryArea };
  if (Array.isArray(layout.npcs)) {
    for (const info of layout.npcs) {
      const npc = state.npcs.find(n => n.id === info.id);
      if (!npc) continue;
      npc.x = clamp(info.x, 1, state.map.cols - 2) * TILE;
      npc.y = clamp(info.y, 1, state.map.rows - 2) * TILE;
    }
  }
  state.map.spawnable = rebuildSpawnable(state.map);
  if (updatePanel) {
    state.editor.layout = safeClone(layout);
    renderEditorPanel();
  }
}

function renderEditorPanel() {
  if (!state.editor.open) return;
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
  if (!ctx) return;
  const width = canvas.width / state.dpr;
  const height = canvas.height / state.dpr;
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  drawBackground(width, height);
  const offsetX = width / 2 - state.camera.x;
  const offsetY = height / 2 - state.camera.y;
  ctx.translate(offsetX, offsetY);
  drawTiles();
  drawHouses();
  drawPlants();
  drawDirt();
  drawStones();
  drawNPCs();
  drawPlayer();
  drawPreview();
  ctx.restore();
  drawHudOverlay(width, height);
}

function drawBackground(width, height) {
  const grd = ctx.createLinearGradient(0, 0, 0, height);
  grd.addColorStop(0, "#0b1418");
  grd.addColorStop(1, "#04070a");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, width, height);
}

function drawTiles() {
  for (let ty = 0; ty < state.map.rows; ty++) {
    for (let tx = 0; tx < state.map.cols; tx++) {
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

function drawHouses() {
  for (const house of HOUSES) {
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

function drawPlants() {
  for (const plant of state.plants.values()) {
    const x = plant.tx * TILE + TILE / 2;
    const y = plant.ty * TILE + TILE / 2;
    ctx.save();
    ctx.translate(x, y);
    if (plant.kind === "corn") {
      ctx.fillStyle = plant.stage === "ready" ? "#ffd95a" : plant.stage === "failed" ? "#665540" : "#c1a842";
      ctx.beginPath();
      ctx.ellipse(0, 0, TILE * 0.22, TILE * 0.34, 0, 0, TAU);
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

function drawDirt() {
  ctx.fillStyle = "#5a4228";
  for (const clod of state.dirt) {
    ctx.beginPath();
    ctx.arc(clod.x, clod.y, clod.radius, 0, TAU);
    ctx.fill();
  }
}

function drawStones() {
  ctx.fillStyle = "#8793a1";
  for (const stone of state.stones) {
    ctx.beginPath();
    ctx.arc(stone.x, stone.y, stone.radius, 0, TAU);
    ctx.fill();
  }
}

function drawNPCs() {
  let index = 0;
  for (const npc of state.npcs) {
    const facing = vectorToFacing(state.player.x - npc.x, state.player.y - npc.y, "down");
    drawNpcSprite(npc, facing, index);
    index += 1;
  }
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
  ctx.ellipse(0, Math.sin((player.anim?.phase || 0) * 2) * TILE * 0.04, TILE * 0.26, TILE * 0.18, 0, 0, TAU);
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

function drawPreview() {
  const preview = state.preview;
  if (!preview) return;
  ctx.save();
  ctx.fillStyle = preview.valid ? "rgba(120,220,140,0.35)" : "rgba(220,80,80,0.35)";
  ctx.fillRect(preview.tx * TILE, preview.ty * TILE, TILE, TILE);
  ctx.restore();
}

function drawHudOverlay(width, height) {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "12px Inter, sans-serif";
  ctx.fillText(`FPS: ${state.fps.toFixed(0)}`, width - 80, height - 16);
  ctx.restore();
}

function boot() {
  try {
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
  } catch (err) {
    failBoot(err);
  }
}

=======
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
  state.dialog.open = true;
  dialogTitle.textContent = title;
  dialogSubtitle.textContent = subtitle;
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
      action.onSelect?.();
      closeDialog();
    });
    dialogBody.appendChild(btn);
  });
  dialogEl.classList.add("open");
  contextButton.textContent = "Schließen";
}

function closeDialog() {
  state.dialog.open = false;
  dialogEl.classList.remove("open");
}

function showToast(message, duration = 2800) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  window.setTimeout(() => toastEl.classList.remove("show"), duration);
}

function updateHud() {
  hudElements.version.textContent = APP_VERSION;
  const player = state.player;
  hudElements.health.textContent = `${player.hearts}`;
  hudElements.poop.textContent = `${player.poop}`;
  hudElements.corn.textContent = `${player.corn}`;
  hudElements.cabbage.textContent = `${player.cabbage}`;
  hudElements.seed.textContent = `${player.cabbageSeed}`;
  hudElements.money.textContent = `${player.money}`;
  hudElements.ammo.textContent = `${player.ammo}`;
  hudElements.water.textContent = `${player.watering.charges}/${player.watering.max}`;
  if (hudElements.stamina) {
    const pct = Math.round((player.stamina / player.maxStamina) * 100);
    hudElements.stamina.textContent = `${pct}%`;
  }

  if (state.contextAction) {
    contextButton.textContent = state.contextAction.label;
    contextButton.disabled = Boolean(state.contextAction.disabled);
  } else {
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
  handleSpawns(dt);
  updatePlayer(dt);
  updatePlants(dt);
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
    state.nextSpawnDelay = randomBetween(SPAWN.boulderIntervalMs[0], SPAWN.boulderIntervalMs[1]);
  }
  if (state.spawnTimers.dirt >= 16000) {
    spawnDirt();
    state.spawnTimers.dirt = 0;
  }
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

=======
  if (dx || dy) {
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    player.dir.x = dx;
    player.dir.y = dy;
  }
  let speed = player.speed;
  if (player.upgrades.shoes) {
    speed *= 1 + WORLD.sprintBonus;
  }
  if (player.carrying && player.carrying.kind === "stone") {
    speed *= STONE.carrySlow * (player.upgrades.cart ? STONE.cartBonus : 1);
  }
  const nextX = player.x + dx * speed * TILE * dt;
  const nextY = player.y + dy * speed * TILE * dt;
  const { x: resolvedX, y: resolvedY } = resolveCollisions(player.x, player.y, nextX, nextY, PLAYER_RADIUS);
  player.x = resolvedX;
  player.y = resolvedY;
  clampPlayerToBounds(player);
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
  if (Math.hypot(joyX, joyY) > dead) {
    x = joyX;
    y = joyY;
  }
  if (isAnyPressed(CONTROLS.keyboard.left)) x -= 1;
  if (isAnyPressed(CONTROLS.keyboard.right)) x += 1;
  if (isAnyPressed(CONTROLS.keyboard.up)) y -= 1;
  if (isAnyPressed(CONTROLS.keyboard.down)) y += 1;
  return { x, y };
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
    if (plant.stage === "growing" && now >= plant.readyAt) {
      plant.stage = plant.success ? "ready" : "failed";
    }
  }
}
function resolveContextAction() {
  const player = state.player;
  const { tx: playerTx, ty: playerTy } = worldToTile(player.x, player.y);
  if (rectContains(state.map.yardArea, playerTx, playerTy) && player.carrying && player.carrying.kind === "stone") {
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
=======
    }
  } else if (rectContains(state.map.fieldArea, front.tx, front.ty)) {
    if (state.player.selectedPlant === "corn" && state.player.poop > 0) {
      return { label: "Mais säen", handler: () => plantCrop(front.tx, front.ty, "corn") };
    }
    if (state.player.selectedPlant === "cabbage" && state.player.cabbageSeed > 0) {
      return { label: "Kohl pflanzen", handler: () => plantCrop(front.tx, front.ty, "cabbage") };
    }
  }
  if (tileAt(front.tx, front.ty) === "w" && state.player.watering.charges < state.player.watering.max) {
    return { label: "Gießkanne füllen", handler: refillWater };
  }
=======
}
function resolveContextAction() {
  const player = state.player;
  const { tx: playerTx, ty: playerTy } = worldToTile(player.x, player.y);
  if (rectContains(state.map.yardArea, playerTx, playerTy) && player.carrying && player.carrying.kind === "stone") {
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
  } else if (rectContains(state.map.fieldArea, front.tx, front.ty)) {
    if (state.player.selectedPlant === "corn" && state.player.poop > 0) {
      return { label: "Mais säen", handler: () => plantCrop(front.tx, front.ty, "corn") };
    }
    if (state.player.selectedPlant === "cabbage" && state.player.cabbageSeed > 0) {
      return { label: "Kohl pflanzen", handler: () => plantCrop(front.tx, front.ty, "cabbage") };
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
  if (rectContains(state.map.fieldArea, tx, ty)) return { valid: false, tx, ty };
  if (rectContains(state.map.yardArea, tx, ty)) return { valid: false, tx, ty };
  if (rectContains(state.map.pondArea, tx, ty)) return { valid: false, tx, ty };
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

=======

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
  const chance = 0.1 + Math.random() * 0.05;
  if (Math.random() < chance) {
    state.player.poop = clamp(state.player.poop + 1, 0, WORLD.inventoryLimit);
    showToast("Ein bisschen 💩 gefunden");
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
      ammo: player.ammo,
      stamina: player.stamina,
=======
      hearts: player.hearts,
      yardDelivered: player.yardDelivered,
      yardTotal: player.yardTotal,
      selectedPlant: player.selectedPlant,
      watering: { charges: player.watering.charges },
      upgrades: { ...player.upgrades },
    },
    yard: { ...state.yard },
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
  editorPanel.classList.add("open");
}

function exitEditor() {
  state.editor.open = false;
  editorPanel.classList.remove("open");
}

function loadEditorLayoutFromStorage() {
  try {
    const raw = localStorage.getItem(WORLD.editorLayoutKey);
    if (!raw) return null;
    return JSON.parse(raw);
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
  if (!layout) return;
  state.map.fieldArea = layout.fieldArea ? { ...layout.fieldArea } : { ...MAPDATA.fieldArea };
  state.map.yardArea = layout.yardArea ? { ...layout.yardArea } : { ...MAPDATA.yardArea };
  state.map.pondArea = layout.pondArea ? { ...layout.pondArea } : { ...MAPDATA.pondArea };
  state.map.clearingArea = layout.clearingArea ? { ...layout.clearingArea } : { ...MAPDATA.clearingArea };
  state.map.quarryArea = layout.quarryArea ? { ...layout.quarryArea } : { ...MAPDATA.quarryArea };
  if (Array.isArray(layout.npcs)) {
    for (const info of layout.npcs) {
      const npc = state.npcs.find(n => n.id === info.id);
      if (!npc) continue;
      npc.x = clamp(info.x, 1, state.map.cols - 2) * TILE;
      npc.y = clamp(info.y, 1, state.map.rows - 2) * TILE;
    }
  }
  state.map.spawnable = rebuildSpawnable(state.map);
  if (updatePanel) {
    state.editor.layout = structuredClone(layout);
    renderEditorPanel();
  }
}

function renderEditorPanel() {
  if (!state.editor.open) return;
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
  if (!ctx) return;
  const width = canvas.width / state.dpr;
  const height = canvas.height / state.dpr;
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  drawBackground(width, height);
  const offsetX = width / 2 - state.camera.x;
  const offsetY = height / 2 - state.camera.y;
  ctx.translate(offsetX, offsetY);
  drawTiles();
  drawHouses();
  drawPlants();
  drawDirt();
  drawStones();
  drawNPCs();
  drawPlayer();
  drawPreview();
  ctx.restore();
  drawHudOverlay(width, height);
}

function drawBackground(width, height) {
  const grd = ctx.createLinearGradient(0, 0, 0, height);
  grd.addColorStop(0, "#0b1418");
  grd.addColorStop(1, "#04070a");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, width, height);
}

function drawTiles() {
  for (let ty = 0; ty < state.map.rows; ty++) {
    for (let tx = 0; tx < state.map.cols; tx++) {
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

function drawHouses() {
  for (const house of HOUSES) {
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

function drawPlants() {
  for (const plant of state.plants.values()) {
    const x = plant.tx * TILE + TILE / 2;
    const y = plant.ty * TILE + TILE / 2;
    ctx.save();
    ctx.translate(x, y);
    if (plant.kind === "corn") {
      ctx.fillStyle = plant.stage === "ready" ? "#ffd95a" : plant.stage === "failed" ? "#665540" : "#c1a842";
      ctx.beginPath();
      ctx.ellipse(0, 0, TILE * 0.22, TILE * 0.34, 0, 0, TAU);
      ctx.fill();
    } else {
      ctx.fillStyle = plant.stage === "ready" ? "#7ae38f" : plant.stage === "failed" ? "#4f5f4f" : "#4ecb6d";
      ctx.beginPath();
      ctx.arc(0, 0, TILE * 0.28, 0, TAU);
      ctx.fill();

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
  editorPanel.classList.add("open");
}

function exitEditor() {
  state.editor.open = false;
  editorPanel.classList.remove("open");
}

function loadEditorLayoutFromStorage() {
  try {
    const raw = localStorage.getItem(WORLD.editorLayoutKey);
    if (!raw) return null;
    return JSON.parse(raw);
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
  if (!layout) return;
  state.map.fieldArea = layout.fieldArea ? { ...layout.fieldArea } : { ...MAPDATA.fieldArea };
  state.map.yardArea = layout.yardArea ? { ...layout.yardArea } : { ...MAPDATA.yardArea };
  state.map.pondArea = layout.pondArea ? { ...layout.pondArea } : { ...MAPDATA.pondArea };
  state.map.clearingArea = layout.clearingArea ? { ...layout.clearingArea } : { ...MAPDATA.clearingArea };
  state.map.quarryArea = layout.quarryArea ? { ...layout.quarryArea } : { ...MAPDATA.quarryArea };
  if (Array.isArray(layout.npcs)) {
    for (const info of layout.npcs) {
      const npc = state.npcs.find(n => n.id === info.id);
      if (!npc) continue;
      npc.x = clamp(info.x, 1, state.map.cols - 2) * TILE;
      npc.y = clamp(info.y, 1, state.map.rows - 2) * TILE;
    }
    ctx.restore();
  }
}

function drawDirt() {
  ctx.fillStyle = "#5a4228";
  for (const clod of state.dirt) {
    ctx.beginPath();
    ctx.arc(clod.x, clod.y, clod.radius, 0, TAU);
    ctx.fill();
  }
}

function drawStones() {
  ctx.fillStyle = "#8793a1";
  for (const stone of state.stones) {
    ctx.beginPath();
    ctx.arc(stone.x, stone.y, stone.radius, 0, TAU);
    ctx.fill();
  }
}

function drawNPCs() {
  let index = 0;
  for (const npc of state.npcs) {
    const facing = vectorToFacing(state.player.x - npc.x, state.player.y - npc.y, "down");
    drawNpcSprite(npc, facing, index);
    index += 1;
  }
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
  ctx.ellipse(0, Math.sin((player.anim?.phase || 0) * 2) * TILE * 0.04, TILE * 0.26, TILE * 0.18, 0, 0, TAU);
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

  state.map.spawnable = rebuildSpawnable(state.map);
  if (updatePanel) {
    state.editor.layout = structuredClone(layout);
    renderEditorPanel();
  }
}

function renderEditorPanel() {
  if (!state.editor.open) return;
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
  if (!ctx) return;
  const width = canvas.width / state.dpr;
  const height = canvas.height / state.dpr;
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  drawBackground(width, height);
  const offsetX = width / 2 - state.camera.x;
  const offsetY = height / 2 - state.camera.y;
  ctx.translate(offsetX, offsetY);
  drawTiles();
  drawPlants();
  drawDirt();
  drawStones();
  drawNPCs();
  drawPlayer();
  drawPreview();
  ctx.restore();
  drawHudOverlay(width, height);
}

function drawBackground(width, height) {
  const grd = ctx.createLinearGradient(0, 0, 0, height);
  grd.addColorStop(0, "#0b1418");
  grd.addColorStop(1, "#04070a");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, width, height);
}

function drawTiles() {
  for (let ty = 0; ty < state.map.rows; ty++) {
    for (let tx = 0; tx < state.map.cols; tx++) {
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

function drawPlants() {
  for (const plant of state.plants.values()) {
    const x = plant.tx * TILE + TILE / 2;
    const y = plant.ty * TILE + TILE / 2;
    ctx.save();
    ctx.translate(x, y);
    if (plant.kind === "corn") {
      ctx.fillStyle = plant.stage === "ready" ? "#ffd95a" : plant.stage === "failed" ? "#665540" : "#c1a842";
      ctx.beginPath();
      ctx.ellipse(0, 0, TILE * 0.22, TILE * 0.34, 0, 0, TAU);
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

function drawDirt() {
  ctx.fillStyle = "#5a4228";
  for (const clod of state.dirt) {
    ctx.beginPath();
    ctx.arc(clod.x, clod.y, clod.radius, 0, TAU);
    ctx.fill();
  }
}

function drawStones() {
  ctx.fillStyle = "#8793a1";
  for (const stone of state.stones) {
    ctx.beginPath();
    ctx.arc(stone.x, stone.y, stone.radius, 0, TAU);
    ctx.fill();
  }
}

function drawNPCs() {
  for (const npc of state.npcs) {
    ctx.fillStyle = npc.id === "fred" ? "#e9a86e" : npc.id === "berta" ? "#c772b0" : "#7ab2d8";
    ctx.beginPath();
    ctx.arc(npc.x, npc.y, TILE * 0.35, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(npc.x - TILE * 0.3, npc.y - TILE * 0.6, TILE * 0.6, TILE * 0.2);
  }
}

function drawPlayer() {
  const player = state.player;
  ctx.fillStyle = "#f6f1d3";
  ctx.beginPath();
  ctx.arc(player.x, player.y, TILE * 0.35, 0, TAU);
  ctx.fill();
  if (player.carrying && player.carrying.kind === "stone") {
    ctx.fillStyle = "#b2bcc7";
    ctx.beginPath();
    ctx.arc(player.x, player.y - TILE * 0.4, TILE * 0.22, 0, TAU);
    ctx.fill();
  }
}

function drawPreview() {
  const preview = state.preview;
  if (!preview) return;
  ctx.save();
  ctx.fillStyle = preview.valid ? "rgba(120,220,140,0.35)" : "rgba(220,80,80,0.35)";
  ctx.fillRect(preview.tx * TILE, preview.ty * TILE, TILE, TILE);
  ctx.restore();
}

function drawHudOverlay(width, height) {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "12px Inter, sans-serif";
  ctx.fillText(`FPS: ${state.fps.toFixed(0)}`, width - 80, height - 16);
  ctx.restore();
}

function boot() {
  try {
    setupCanvas();
    watchInputMode();
    document.addEventListener("fullscreenchange", () => resizeCanvas());
=======
    state.map = createMap();
    state.player = createPlayer();
    state.npcs = buildNPCs();
    primeAudioUnlock();
    setupInput();
    initWorld();
    state.ready = true;
    state.lastTick = performance.now();
    requestAnimationFrame(mainLoop);
  } catch (err) {
    failBoot(err);
  }
}


window.addEventListener("load", boot);
