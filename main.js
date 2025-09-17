import {
  APP_VERSION,
  SAVE_KEY,
  GAME_VERSION,
  DEBUG,
  WORLD,
  MAPDATA,
  NPCS,
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
};
const joystickEl = document.getElementById("joystick");
const joystickHandle = document.getElementById("joystick-handle");
const contextButton = document.getElementById("context-button");
const restartButton = document.getElementById("restart-button");
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
  contextButton.addEventListener("click", () => triggerContextAction());
  restartButton.addEventListener("click", () => resetGame());
  dialogClose.addEventListener("click", closeDialog);
  editorSave.addEventListener("click", () => saveEditorLayout());
  editorReset.addEventListener("click", () => resetEditorLayout());
  editorExit.addEventListener("click", () => exitEditor());
  setupJoystick();
}

function onKeyDown(ev) {
  const key = ev.key.toLowerCase();
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
}
function setupJoystick() {
  if (!joystickEl) return;
  joystickEl.addEventListener("pointerdown", onJoyPointerDown);
  window.addEventListener("pointermove", onJoyPointerMove);
  window.addEventListener("pointerup", onJoyPointerUp);
  window.addEventListener("pointercancel", onJoyPointerUp);
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
