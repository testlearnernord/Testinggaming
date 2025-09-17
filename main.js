// Poopboy v1.0 — Komplettüberarbeitung: Modular, performant, neue Features, bessere Steuerung, QoL, Bugfixes

import {
  ASSETS,
  MAP_W,
  MAP_H,
  TILE,
  TILES,
  map,
  SOLID,
  HOUSES,
  NPCS,
  CONTROL_HINTS,
  SEEDS,
  SEED_MAP,
  SEED_ORDER,
  SEED_HOTKEYS,
  SHOP_GOOD_MAP,
} from "./data.js";
import { SFX } from "./sfx.js";

const hasOwn = Object.prototype.hasOwnProperty;

// --- Canvas & UI ---
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d", { alpha: false });
let W = canvas.width, H = canvas.height;

const ui = {
  fps: document.getElementById("fps"),
  stam: document.getElementById("stamina"),
  money: document.getElementById("money"),
  clock: document.getElementById("clock"),
  shop: document.getElementById("shop"),
  shopItems: document.getElementById("shop-items"),
  shopClose: document.getElementById("shop-close"),
  shopTitle: document.getElementById("shop-title"),
  shopSubtitle: document.getElementById("shop-subtitle"),
  shopPortrait: document.getElementById("shop-portrait"),
  hint: document.getElementById("hint"),
  seedWheel: document.getElementById("seed-wheel"),
  contextHint: document.getElementById("context-hint"),
};

// --- Audio ---
const sfx = new SFX(ASSETS.sfx);
const DEBUG_OVERLAY = false;
const DIR_OFFSETS = [
  [0, 1],
  [-1, 0],
  [1, 0],
  [0, -1],
];

const MOVEMENT_CONTROLS = [
  { dir: 3, keys: ["w", "arrowup"], vec: DIR_OFFSETS[3] },
  { dir: 0, keys: ["s", "arrowdown"], vec: DIR_OFFSETS[0] },
  { dir: 1, keys: ["a", "arrowleft"], vec: DIR_OFFSETS[1] },
  { dir: 2, keys: ["d", "arrowright"], vec: DIR_OFFSETS[2] },
];

function isShopOpen() {
  return !!(ui.shop && !ui.shop.classList.contains("hidden"));
}

function closeShop({ silent = false } = {}) {
  if (!isShopOpen()) return false;
  ui.shop.classList.add("hidden");
  if (!silent) {
    sfx.play("ui", { volume: 0.7, rateRange: [0.96, 1.05] });
  }
  detectContext();
  refreshContextHint();
  return true;
}

if (ui.shopClose) {
  ui.shopClose.onclick = () => closeShop();
}

const HINT_CONTROLS_HTML = CONTROL_HINTS
  .map(({ key, desc }) => `<span class="hint-item"><span class="hint-key">${key}</span><span class="hint-desc">${desc}</span></span>`)
  .join('<span class="hint-sep">•</span>');

const MINIMAP_TILE_COLORS = {
  0: "#2c7a55",
  1: "#c9864c",
  2: "#d2b994",
  3: "#6c7b91",
  4: "#3970c2",
  5: "#8e5a37",
  6: "#1f262e",
};

function tileAtWorld(x, y) {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return 0;
  return map[ty * MAP_W + tx];
}

// --- Loader ---
const IMGS = new Map();
async function loadImg(url) {
  return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = url; });
}
async function loadAll() {
  const tasks = [];
  for (const cat of [ASSETS.sprites, ASSETS.tiles, ASSETS.fx]) {
    for (const [k, url] of Object.entries(cat)) {
      tasks.push(loadImg(url).then(img => IMGS.set(url, img)));
    }
  }
  await Promise.all(tasks);
}
function img(url) { return IMGS.get(url); }

// --- Input ---
const keys = new Map();
const once = new Set();
let paused = false;
function kd(e) {
  if (e.repeat) return;
  if (e.key === " " || e.key === "Spacebar" || e.key === "Space") e.preventDefault();
  keys.set(e.key.toLowerCase(), true);
  if (e.key === "Escape") paused = !paused;
}
function ku(e) { keys.delete(e.key.toLowerCase()); once.delete(e.key.toLowerCase()); }
addEventListener("keydown", kd);
addEventListener("keyup", ku);
addEventListener("wheel", onWheel, { passive: false });
function pressed(k) { return keys.has(k); }
function pressedOnce(k) {
  const k2 = k.toLowerCase();
  if (keys.has(k2) && !once.has(k2)) { once.add(k2); return true; }
  return false;
}

function onWheel(e) {
  if (!ui.seedWheel) return;
  if (isShopOpen()) return;
  const dir = e.deltaY > 0 ? 1 : -1;
  if (!dir) return;
  cycleSeed(dir);
  e.preventDefault();
}

// --- Camera ---
const cam = { x: 0, y: 0, lerp: 0.18 };
function focus(x, y) {
  cam.x += ((x - W / 2) - cam.x) * cam.lerp;
  cam.y += ((y - H / 2) - cam.y) * cam.lerp;
}

// --- Entities ---
function makeActor(spriteId, x, y) {
  return {
    kind: "actor",
    x, y, vx: 0, vy: 0,
    dir: 0, // 0 down,1 left,2 right,3 up
    frame: 0, anim: 0,
    spd: 2.0,
    sprite: ASSETS.sprites[spriteId],
    w: 32, h: 38,
    talk: "",
    displayName: null,
    accent: "#ffffff",
    role: "",
    portrait: ASSETS.sprites[spriteId],
    ai: null,
    state: "",
    wt: 0,
  };
}
const player = makeActor("player", 26 * TILE, 54 * TILE);
player.spd = 2.75;
player.stamina = 100; player.maxStamina = 100; player.sprint = false; player.money = 0;
const initialSeedInventory = Object.fromEntries(SEED_ORDER.map(id => [id, 0]));
player.inv = { seeds: initialSeedInventory, stones: 0, flowers: 0 };
player.selectedSeed = SEED_ORDER[0] ?? (SEEDS[0]?.id ?? "");

function ensureSeedSlot(id) {
  if (!hasOwn.call(player.inv.seeds, id)) {
    player.inv.seeds[id] = 0;
  }
}

function getSeedCount(id) {
  ensureSeedSlot(id);
  return player.inv.seeds[id];
}

function setSeedCount(id, value) {
  ensureSeedSlot(id);
  const clamped = Math.max(0, value);
  player.inv.seeds[id] = clamped;
  return clamped;
}

function addSeeds(id, amount = 1) {
  return setSeedCount(id, getSeedCount(id) + amount);
}

function consumeSeeds(id, amount = 1) {
  const current = getSeedCount(id);
  if (current < amount) return false;
  setSeedCount(id, current - amount);
  return true;
}

function hasSeeds(id, amount = 1) {
  return getSeedCount(id) >= amount;
}

// --- NPCs ---
const actors = [player];
for (const n of NPCS) {
  const a = makeActor(n.id, n.x, n.y);
  a.spd = 1.35;
  a.talk = n.greeting;
  a.displayName = `${n.name}`;
  a.role = n.title;
  a.accent = n.accent;
  a.meta = n;
  a.ai = "wander";
  actors.push(a);
}

// --- Pflanzen (neues System) ---
const plants = [];
const seedCards = [];

function buildSeedWheel() {
  if (!ui.seedWheel) return;
  ui.seedWheel.innerHTML = "";
  seedCards.length = 0;
  SEEDS.forEach((seed, idx) => {
    const { id } = seed;
    ensureSeedSlot(id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "seed-card";
    button.dataset.seed = id;

    const iconWrap = document.createElement("span");
    iconWrap.className = "seed-card__icon";
    const icon = document.createElement("img");
    icon.src = seed.icon || seed.sprite;
    icon.alt = seed.name;
    icon.width = 28;
    icon.height = 28;
    iconWrap.appendChild(icon);

    const label = document.createElement("span");
    label.className = "seed-card__label";
    label.textContent = seed.name;

    const count = document.createElement("span");
    count.className = "seed-card__count";
    count.textContent = "x0";

    const hotkey = document.createElement("span");
    hotkey.className = "seed-card__hotkey";
    hotkey.textContent = seed.hotkey || idx + 1;

    button.append(iconWrap, label, count, hotkey);
    button.addEventListener("click", () => {
      player.selectedSeed = id;
      onSeedChanged(true);
    });

    ui.seedWheel.appendChild(button);
    seedCards.push({ id, button, countEl: count, labelEl: label });
  });
}

function updateSeedWheel() {
  for (const entry of seedCards) {
    const amount = getSeedCount(entry.id);
    entry.countEl.textContent = `x${amount}`;
    entry.button.classList.toggle("active", player.selectedSeed === entry.id);
    entry.button.classList.toggle("seed-card--empty", amount <= 0);
  }
}

buildSeedWheel();
updateSeedWheel();
function plantSeed(seedId, tx, ty) {
  plants.push({ id: seedId, x: tx, y: ty, t: 0, grown: false });
}
function updatePlants(dt) {
  for (const p of plants) {
    if (!p.grown) {
      p.t += dt;
      const info = SEED_MAP[p.id];
      if (info && p.t >= info.growTime) p.grown = true;
    }
  }
}
function drawPlants() {
  for (const p of plants) {
    const info = SEED_MAP[p.id];
    if (!info) continue;
    const spr = img(info.sprite);
    if (!spr) continue;
    const px = p.x * TILE - cam.x, py = p.y * TILE - cam.y;
    ctx.globalAlpha = p.grown ? 1 : 0.6;
    ctx.drawImage(spr, px, py - 16, 32, 32);
    ctx.globalAlpha = 1;
  }
}

function drawInteractionHighlight() {
  if (!contextTarget || contextTarget.type === "shop-open") return;

  if (contextTarget.tile) {
    const { x, y } = contextTarget.tile;
    if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) {
      const px = x * TILE - cam.x;
      const py = y * TILE - cam.y;
      let fill = "rgba(114,239,221,0.25)";
      let stroke = "rgba(114,239,221,0.9)";
      if (contextTarget.type === "harvest") {
        fill = "rgba(255,214,99,0.3)";
        stroke = "rgba(255,214,99,0.95)";
      } else if (contextTarget.type === "no-seed") {
        fill = "rgba(255,118,118,0.22)";
        stroke = "rgba(255,118,118,0.9)";
      }
      ctx.save();
      ctx.translate(px, py);
      ctx.fillStyle = fill;
      ctx.globalAlpha = 0.65;
      ctx.fillRect(3, 3, TILE - 6, TILE - 6);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.strokeRect(3, 3, TILE - 6, TILE - 6);
      ctx.restore();
    }
  }

  if (contextTarget.type === "shop" && contextTarget.npc) {
    const npc = contextTarget.npc;
    ctx.save();
    ctx.translate(npc.x - cam.x, npc.y - cam.y);
    ctx.fillStyle = npc.accent || "#56cfe1";
    ctx.globalAlpha = 0.28;
    ctx.beginPath();
    ctx.ellipse(0, 6, 28, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = npc.accent || "#56cfe1";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 6, 30, 16, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
function harvestPlantAt(tx, ty) {
  for (let i = 0; i < plants.length; ++i) {
    const p = plants[i];
    if (p.x === tx && p.y === ty && p.grown) {
      const info = SEED_MAP[p.id];
      const amount = info?.yield ?? 1;
      const harvest = info?.harvest || { inventory: "seeds", id: p.id };
      if (harvest.inventory === "seeds") {
        const targetId = harvest.id ?? p.id;
        addSeeds(targetId, amount);
      } else {
        const key = harvest.inventory;
        player.inv[key] = (player.inv[key] ?? 0) + amount;
      }
      plants.splice(i, 1);
      sfx.play("pickup", { volume: 0.85, rateRange: [0.95, 1.05], detuneRange: 35 });
      return true;
    }
  }
  return false;
}

const INTERACTION_DISTANCE = 60;
let contextTarget = null;
let contextHintKey = null;

function tileInBounds(tile) {
  return tile.x >= 0 && tile.y >= 0 && tile.x < MAP_W && tile.y < MAP_H;
}

function getPlayerTile() {
  return {
    x: Math.floor(player.x / TILE),
    y: Math.floor(player.y / TILE),
  };
}

function getFacingTile(base = getPlayerTile()) {
  const [ox, oy] = DIR_OFFSETS[player.dir] ?? DIR_OFFSETS[0];
  return { x: base.x + ox, y: base.y + oy };
}

function findNearbyNPC() {
  let best = null;
  let bestDist = Infinity;
  for (const a of actors) {
    if (a === player) continue;
    const d = Math.hypot(a.x - player.x, a.y - player.y);
    if (d < INTERACTION_DISTANCE && d < bestDist) {
      best = a;
      bestDist = d;
    }
  }
  return best;
}

function detectContext() {
  if (isShopOpen()) {
    contextTarget = { type: "shop-open" };
    return;
  }

  const origin = getPlayerTile();
  const facing = getFacingTile(origin);
  const tiles = [facing, origin];

  for (const tile of tiles) {
    if (!tileInBounds(tile)) continue;
    const plant = plants.find(p => p.x === tile.x && p.y === tile.y);
    if (plant && plant.grown) {
      contextTarget = { type: "harvest", tile, plant };
      return;
    }
  }

  for (const tile of tiles) {
    if (!tileInBounds(tile)) continue;
    if (plants.some(p => p.x === tile.x && p.y === tile.y)) continue;
    if (!isPlantableTile(map[tile.y * MAP_W + tile.x])) continue;
    if (hasSeeds(player.selectedSeed)) {
      contextTarget = { type: "plant", tile, seed: player.selectedSeed };
    } else {
      contextTarget = { type: "no-seed", tile, seed: player.selectedSeed };
    }
    return;
  }

  const npc = findNearbyNPC();
  if (npc) {
    contextTarget = { type: "shop", npc };
    return;
  }

  contextTarget = null;
}

function refreshContextHint() {
  if (!ui.contextHint) return;
  let key = "none";
  let text = "";
  let icon = "";

  if (!contextTarget || contextTarget.type === "shop-open") {
    if (contextHintKey !== key) {
      ui.contextHint.classList.add("hidden");
      ui.contextHint.innerHTML = "";
      contextHintKey = key;
    }
    return;
  }

  switch (contextTarget.type) {
    case "plant": {
      const info = SEED_MAP[contextTarget.seed] || SEED_MAP[player.selectedSeed];
      key = `plant:${contextTarget.seed}`;
      text = `E • ${info ? info.name : "Saat"} pflanzen`;
      icon = info?.icon || info?.sprite || "";
      break;
    }
    case "no-seed": {
      const info = SEED_MAP[contextTarget.seed] || SEED_MAP[player.selectedSeed];
      key = `no-seed:${contextTarget.seed}`;
      text = info ? `Keine ${info.name}-Samen übrig` : "Keine Samen übrig";
      icon = info?.icon || info?.sprite || "";
      break;
    }
    case "harvest": {
      const info = SEED_MAP[contextTarget.plant.id];
      key = `harvest:${contextTarget.plant.id}`;
      text = `E • ${info ? info.name : "Ernte"} einsammeln`;
      icon = info?.icon || info?.sprite || "";
      break;
    }
    case "shop": {
      const npc = contextTarget.npc;
      key = `shop:${npc.displayName}`;
      text = `E • mit ${npc.displayName} handeln`;
      icon = npc.meta ? ASSETS.sprites[npc.meta.id] : npc.sprite;
      break;
    }
    default:
      key = "none";
      break;
  }

  if (contextHintKey === key) return;
  contextHintKey = key;

  ui.contextHint.innerHTML = "";
  if (icon) {
    const imgEl = document.createElement("img");
    imgEl.src = icon;
    imgEl.alt = "";
    imgEl.width = 28;
    imgEl.height = 28;
    imgEl.className = "context-hint__icon";
    ui.contextHint.appendChild(imgEl);
  }
  const label = document.createElement("span");
  label.className = "context-hint__label";
  label.textContent = text;
  ui.contextHint.appendChild(label);
  ui.contextHint.classList.toggle("context-hint--warning", contextTarget.type === "no-seed");
  ui.contextHint.classList.remove("hidden");
}

function onSeedChanged(playSound = false) {
  onInventoryChanged();
  if (playSound) sfx.play("ui", { volume: 0.55, rateRange: [0.9, 1.08], detuneRange: 12 });
}

function onInventoryChanged() {
  updateSeedWheel();
  renderTopbar();
  detectContext();
  refreshContextHint();
}

function performPrimaryAction() {
  if (closeShop()) {
    return true;
  }
  if (!contextTarget) return false;
  switch (contextTarget.type) {
    case "plant":
      if (tryPlant(player.selectedSeed, contextTarget.tile.x, contextTarget.tile.y)) {
        onInventoryChanged();
        return true;
      }
      break;
    case "no-seed":
      sfx.play("ui", { volume: 0.4, rateRange: [0.82, 0.9], detuneRange: 20 });
      return false;
    case "harvest":
      if (harvestPlantAt(contextTarget.tile.x, contextTarget.tile.y)) {
        onInventoryChanged();
        return true;
      }
      break;
    case "shop":
      openShop(contextTarget.npc);
      contextTarget = { type: "shop-open" };
      refreshContextHint();
      return true;
    default:
      break;
  }
  detectContext();
  refreshContextHint();
  return false;
}

onInventoryChanged();

// --- Physics ---
function collideRect(ax, ay, aw, ah) {
  const minx = Math.floor(ax / TILE);
  const maxx = Math.floor((ax + aw - 1) / TILE);
  const miny = Math.floor(ay / TILE);
  const maxy = Math.floor((ay + ah - 1) / TILE);
  for (let ty = miny; ty <= maxy; ty++) {
    for (let tx = minx; tx <= maxx; tx++) {
      if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) {
        return { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE };
      }
      const tile = map[ty * MAP_W + tx];
      if (SOLID.has(tile)) {
        return { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE };
      }
    }
  }
  return null;
}

// Robuste Kollision: Separat X und Y, damit man an Wänden entlanggleiten kann
function resolve(a) {
  const maxIter = 4;
  for (let i = 0; i < maxIter; i++) {
    const r = collideRect(a.x - 16, a.y - 32, a.w, a.h);
    if (!r) break;
    if (a === player) {
      const ax = a.x - 16;
      const ay = a.y - 32;
      const overlapX = Math.min(ax + a.w, r.x + r.w) - Math.max(ax, r.x);
      const overlapY = Math.min(ay + a.h, r.y + r.h) - Math.max(ay, r.y);
      if (overlapX <= 0 || overlapY <= 0) break;
      if (overlapX < overlapY) {
        const push = overlapX + 0.1;
        if (ax < r.x) a.x -= push;
        else a.x += push;
      } else {
        const push = overlapY + 0.1;
        if (ay < r.y) a.y -= push;
        else a.y += push;
      }
    } else {
      a.x += (Math.random() - 0.5) * 2;
      a.y += (Math.random() - 0.5) * 2;
      break;
    }
  }
}

// --- Shop ---
function applyPurchase(good) {
  if (!good) return;
  if (good.type === "seed") {
    const seedId = good.seed;
    addSeeds(seedId, good.amount ?? 1);
  } else if (good.type === "bundle") {
    const contents = good.contents || {};
    for (const [seedId, amount] of Object.entries(contents)) {
      addSeeds(seedId, amount ?? 0);
    }
  } else if (good.type === "stone") {
    player.inv.stones += good.amount ?? 1;
  } else if (good.type === "flowers") {
    player.inv.flowers = (player.inv.flowers ?? 0) + (good.amount ?? 1);
  }
  sfx.play("pickup", { volume: 0.68, rateRange: [0.96, 1.06], detuneRange: 22 });
}

function openShop(npc) {
  if (!npc || !npc.meta) return;
  const meta = npc.meta;
  ui.shopItems.innerHTML = "";
  ui.shopItems.scrollTop = 0;
  if (ui.shopTitle) ui.shopTitle.textContent = `${meta.name} · ${meta.title}`;
  if (ui.shopSubtitle) ui.shopSubtitle.textContent = meta.bio || "";
  if (ui.shopPortrait) {
    ui.shopPortrait.src = ASSETS.sprites[meta.id];
    ui.shopPortrait.alt = meta.name;
  }
  if (ui.shop) ui.shop.style.setProperty("--shop-accent", meta.accent || "#56cfe1");

  for (const entry of meta.shop) {
    const good = SHOP_GOOD_MAP[entry.good];
    if (!good) continue;
    const priceValue = entry.price ?? good.cost ?? 0;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "shop-item";

    const iconWrap = document.createElement("span");
    iconWrap.className = "shop-item__icon";
    const icon = document.createElement("img");
    icon.src = good.icon;
    icon.alt = good.name;
    icon.width = 40;
    icon.height = 40;
    iconWrap.appendChild(icon);

    const info = document.createElement("span");
    info.className = "shop-item__info";
    const title = document.createElement("strong");
    title.className = "shop-item__title";
    title.textContent = good.name;
    const desc = document.createElement("span");
    desc.className = "shop-item__desc";
    desc.textContent = good.description;
    info.append(title, desc);

    const price = document.createElement("span");
    price.className = "shop-item__price";
    price.textContent = `₽ ${priceValue}`;

    button.append(iconWrap, info, price);
    button.addEventListener("click", () => {
      if (player.money < priceValue) {
        sfx.play("ui", { volume: 0.45, rateRange: [0.72, 0.85], detuneRange: 30 });
        return;
      }
      player.money -= priceValue;
      applyPurchase(good);
      onInventoryChanged();
    });

    ui.shopItems.appendChild(button);
  }

  ui.shop.classList.remove("hidden");
  sfx.play("ui", { volume: 0.7, rateRange: [0.96, 1.05] });
}

// --- Zeit & UI ---
let timeMin = 6 * 60;
function timeTick(dt) {
  timeMin += dt * 0.04;
  if (timeMin >= 24 * 60) timeMin = 0;
  const hh = Math.floor(timeMin / 60).toString().padStart(2, "0");
  const mm = Math.floor(timeMin % 60).toString().padStart(2, "0");
  ui.clock.textContent = `${hh}:${mm}`;
}
function renderTopbar() {
  ui.fps.textContent = `${Math.round(fps)} FPS`;
  ui.stam.textContent = `Ausdauer ${Math.round(player.stamina)}/${player.maxStamina}`;
  ui.stam.style.setProperty("--fill", Math.max(0, Math.min(1, player.stamina / player.maxStamina)).toFixed(3));
  ui.money.textContent = `₽ ${player.money.toLocaleString("de-DE")}`;
  const selected = SEED_MAP[player.selectedSeed];
  const flowers = player.inv.flowers ?? 0;
  const inventoryParts = [
    `<span class="hint-item emphasised">Aktive Saat: <span class="hint-badge">${selected ? selected.name : "?"}</span></span>`,
    `<span class="hint-item emphasised">Blumen: <span class="hint-count">${flowers}</span></span>`,
    `<span class="hint-item emphasised">Steine: <span class="hint-count">${player.inv.stones}</span></span>`,
  ];
  ui.hint.innerHTML = `${HINT_CONTROLS_HTML}<span class="hint-sep hint-gap">|</span>${inventoryParts.join('<span class="hint-sep">•</span>')}`;
}

// --- Movement + Stamina ---
const STEP_INTERVAL_WALK = 180;
const STEP_INTERVAL_SPRINT = 130;
let lastStep = 0;
let lastMoveDir = { x: 0, y: 1 }; // Start: unten

function footstepKey() {
  const tile = tileAtWorld(player.x, player.y + 12);
  if (tile === 1) return "step_dirt";
  if (tile === 2 || tile === 3 || tile === 5) return "step_stone";
  return "step_grass";
}

function triggerFootstep(sprinting) {
  const key = footstepKey();
  const base = sprinting ? 0.74 : 0.6;
  const volume = key === "step_stone" ? base + 0.06 : key === "step_dirt" ? base + 0.03 : base;
  sfx.play(key, {
    volume,
    rateRange: [0.92, 1.08],
    detuneRange: 45,
    offsetRange: 0.01,
  });
}

function controlPlayer(dt) {
  let dx = 0, dy = 0;
  let facingDir = null;
  for (const control of MOVEMENT_CONTROLS) {
    if (control.keys.some(key => pressed(key))) {
      const [vx, vy] = control.vec;
      dx += vx;
      dy += vy;
      facingDir = control.dir;
    }
  }
  if (facingDir !== null) {
    player.dir = facingDir;
  }
  const sprinting = pressed("shift") && player.stamina > 0;
  const spd = player.spd * (sprinting ? 1.85 : 1);
  const now = performance.now();
  if (dx || dy) {
    lastMoveDir.x = dx;
    lastMoveDir.y = dy;
    const invLen = 1 / Math.hypot(dx || 1, dy || 1);
    dx *= invLen; dy *= invLen;
    player.x += dx * spd * dt * 60;
    player.y += dy * spd * dt * 60;
    const interval = sprinting ? STEP_INTERVAL_SPRINT : STEP_INTERVAL_WALK;
    if (now - lastStep > interval) {
      triggerFootstep(sprinting);
      lastStep = now;
    }
    player.anim = (player.anim + dt * (sprinting ? 14 : 10)) % 3;
    if (sprinting) { player.stamina = Math.max(0, player.stamina - dt * 18); player.sprint = true; }
    else player.sprint = false;
  } else {
    player.anim = 1;
  }
  if (!sprinting && player.stamina < player.maxStamina) {
    const regen = player.sprint ? 6 : 12;
    player.stamina = Math.min(player.maxStamina, player.stamina + dt * regen);
  }
  resolve(player);
  focus(player.x, player.y);

  for (const [key, id] of SEED_HOTKEYS) {
    if (pressedOnce(key)) {
      player.selectedSeed = id;
      onSeedChanged(true);
    }
  }

  if (pressedOnce("4")) {
    tryPlaceStone();
  }

  if (pressedOnce("q")) {
    cycleSeed(-1);
  }

  if (pressedOnce("e")) {
    const acted = performPrimaryAction();
    if (!acted) {
      cycleSeed(1);
    }
  }

  if (pressedOnce(" ") || pressedOnce("space")) {
    performPrimaryAction();
  }
}

// --- NPC AI ---
function updateNPC(a, dt) {
  if (a.ai === "wander") {
    if (!a.wt || a.wt <= 0) {
      a.tx = a.x + (Math.random() * 120 - 60);
      a.ty = a.y + (Math.random() * 60 - 30);
      a.wt = 2 + Math.random() * 3;
    }
    const dx = a.tx - a.x, dy = a.ty - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 2) {
      const inv = 1 / dist;
      a.x += dx * inv * a.spd * dt * 60;
      a.y += dy * inv * a.spd * dt * 60;
      a.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : (dy < 0 ? 3 : 0);
      a.anim = (a.anim + dt * 6) % 3;
      resolve(a);
    } else { a.wt -= dt; a.anim = 1; }
    // Avoid player
    const pd = Math.hypot(player.x - a.x, player.y - a.y);
    if (pd < 36) { a.x += (a.x - player.x) * 0.02; a.y += (a.y - player.y) * 0.02; }
  }
}

// --- Planting & Stones ---
function tryPlaceStone() {
  if (player.inv.stones <= 0) return false;
  const tx = Math.floor(player.x / TILE);
  const ty = Math.floor(player.y / TILE);
  const [ox, oy] = DIR_OFFSETS[player.dir] ?? DIR_OFFSETS[0];
  const px = tx + ox, py = ty + oy;
  if (px < 0 || py < 0 || px >= MAP_W || py >= MAP_H) return false;
  if (SOLID.has(map[py * MAP_W + px])) return false;
  const wouldOverlap = Math.abs((px + 0.5) * TILE - player.x) < 20 && Math.abs((py + 0.5) * TILE - (player.y - 20)) < 28;
  if (wouldOverlap) return false;
  map[py * MAP_W + px] = 3;
  player.inv.stones -= 1;
  sfx.play("pickup", { volume: 0.72, rateRange: [0.9, 1.04], detuneRange: 25 });
  onInventoryChanged();
  return true;
}

function isPlantableTile(tile) {
  return tile === 0 || tile === 1 || tile === 5;
}

function tryPlant(seedId, tx = Math.floor(player.x / TILE), ty = Math.floor(player.y / TILE)) {
  if (!hasSeeds(seedId)) return false;
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return false;
  const tile = map[ty * MAP_W + tx];
  if (!isPlantableTile(tile)) return false;
  if (plants.some(p => p.x === tx && p.y === ty)) return false;
  if (!consumeSeeds(seedId)) return false;
  plantSeed(seedId, tx, ty);
  sfx.play("pickup", { volume: 0.75, rateRange: [0.92, 1.05], detuneRange: 30 });
  return true;
}

// --- Rendering ---
const tileImgs = TILES.map(n => ASSETS.tiles[n]);
function drawTiles() {
  const startX = Math.max(0, Math.floor((cam.x) / TILE) - 2);
  const startY = Math.max(0, Math.floor((cam.y) / TILE) - 2);
  const endX = Math.min(MAP_W, Math.ceil((cam.x + W) / TILE) + 2);
  const endY = Math.min(MAP_H, Math.ceil((cam.y + H) / TILE) + 2);
  for (let ty = startY; ty < endY; ty++) {
    for (let tx = startX; tx < endX; tx++) {
      const t = map[ty * MAP_W + tx];
      const imgUrl = tileImgs[t]; const im = img(imgUrl);
      if (im) ctx.drawImage(im, tx * TILE - cam.x, ty * TILE - cam.y);
    }
  }
}
// Haus-Overlay für Debug/Sichtbarkeit
function drawHouseOverlay() {
  ctx.save();
  ctx.strokeStyle = "#fff8";
  ctx.lineWidth = 2;
  for (const h of HOUSES) {
    const [sx, sy, w, hh] = h.rect;
    ctx.strokeRect(sx * TILE - cam.x, sy * TILE - cam.y, w * TILE, hh * TILE);
  }
  ctx.restore();
}
function drawActor(a) {
  const spr = img(a.sprite);
  const frame = Math.floor(a.anim);
  const sx = frame * 48, sy = a.dir * 48;
  const dx = Math.floor(a.x - 24 - cam.x);
  const dy = Math.floor(a.y - 40 - cam.y);
  if (a !== player) {
    ctx.save();
    ctx.translate(Math.floor(a.x - cam.x), Math.floor(a.y - cam.y));
    ctx.fillStyle = a.accent || "#56cfe1";
    ctx.globalAlpha = 0.24;
    ctx.beginPath();
    ctx.ellipse(0, 8, 22, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  if (spr) ctx.drawImage(spr, sx, sy, 48, 48, dx, dy, 48, 48);
  if (a !== player && a.displayName) {
    ctx.save();
    const tx = Math.floor(a.x - cam.x);
    const ty = Math.floor(a.y - 48 - cam.y);
    ctx.font = "600 16px 'Inter',Arial,sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillText(a.displayName, tx, ty + 1);
    ctx.fillStyle = a.accent || "#f5fbff";
    ctx.fillText(a.displayName, tx, ty);
    if (a.role) {
      ctx.font = "500 12px 'Inter',Arial,sans-serif";
      ctx.fillStyle = "rgba(240, 250, 255, 0.85)";
      ctx.fillText(a.role, tx, ty + 14);
    }
    ctx.restore();
  }
}
function drawAllActors() {
  const list = actors.slice().sort((a, b) => (a.y - b.y));
  for (const a of list) drawActor(a);
}

// --- Minimap ---
function drawMinimap() {
  const size = 200;
  const radius = size / 2;
  const cx = W - radius - 40;
  const cy = radius + 48;
  const scale = size / Math.max(MAP_W, MAP_H);
  const offsetX = -MAP_W * scale / 2;
  const offsetY = -MAP_H * scale / 2;

  ctx.save();
  ctx.translate(cx, cy);

  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = "rgba(26, 51, 83, 0.45)";
  ctx.beginPath();
  ctx.arc(0, 0, radius + 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "rgba(8, 13, 20, 0.92)";
  ctx.beginPath();
  ctx.arc(0, 0, radius + 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(16, 22, 30, 0.96)";
  ctx.fill();
  ctx.clip();

  ctx.save();
  ctx.translate(offsetX, offsetY);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const t = map[y * MAP_W + x];
      ctx.fillStyle = MINIMAP_TILE_COLORS[t] || MINIMAP_TILE_COLORS[0];
      ctx.fillRect(x * scale, y * scale, Math.ceil(scale) + 0.5, Math.ceil(scale) + 0.5);
    }
  }

  ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
  ctx.lineWidth = 1.2;
  for (const h of HOUSES) {
    const [sx, sy, w, hh] = h.rect;
    ctx.strokeRect(sx * scale, sy * scale, w * scale, hh * scale);
  }

  for (const a of actors) {
    if (a === player) continue;
    ctx.fillStyle = "rgba(255, 220, 120, 0.9)";
    ctx.beginPath();
    ctx.arc((a.x / TILE) * scale, (a.y / TILE) * scale, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.translate((player.x / TILE) * scale, (player.y / TILE) * scale);
  let angle = 0;
  if (lastMoveDir.x !== 0 || lastMoveDir.y !== 0) {
    angle = Math.atan2(lastMoveDir.y, lastMoveDir.x);
  } else {
    angle = [Math.PI / 2, Math.PI, 0, -Math.PI / 2][player.dir] || 0;
  }
  ctx.rotate(angle + Math.PI / 2);
  ctx.fillStyle = "#56cfe1";
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5, 6);
  ctx.lineTo(-5, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.restore(); // map translation
  ctx.restore(); // clip circle

  ctx.strokeStyle = "rgba(86, 207, 225, 0.65)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, radius + 10, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.font = "600 12px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("KARTE", 0, radius + 18);

  ctx.restore();
}

// --- Lighting & Day-Night ---
function drawLighting() {
  const cycle = (timeMin % (24 * 60)) / (24 * 60);
  const dayStrength = (Math.cos((cycle - 0.5) * Math.PI * 2) + 1) / 2;
  const nightFactor = 1 - dayStrength;

  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  const r = Math.floor(36 + 120 * nightFactor);
  const g = Math.floor(48 + 95 * nightFactor);
  const b = Math.floor(88 + 110 * nightFactor);
  const alpha = 0.18 + 0.4 * nightFactor;
  ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  const gradient = ctx.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(0, `rgba(255, 240, 214, ${0.08 * dayStrength})`);
  gradient.addColorStop(1, `rgba(18, 30, 54, ${0.25 * nightFactor})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  const ambient = img(ASSETS.fx.ambient);
  if (ambient) {
    ctx.save();
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = 0.15 + 0.2 * nightFactor;
    ctx.drawImage(ambient, 0, 0, W, H);
    ctx.restore();
  }
}

function drawVignette() {
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  const radius = Math.sqrt(W * W + H * H) * 0.55;
  const vignette = ctx.createRadialGradient(W / 2, H / 2, radius * 0.3, W / 2, H / 2, radius);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = "rgba(90, 170, 255, 0.07)";
  ctx.fillRect(0, 0, W, H * 0.12);
  ctx.restore();
}

// --- Resize ---
function onResize() {
  canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio;
  W = canvas.width; H = canvas.height;
  ctx.imageSmoothingEnabled = false;
}
addEventListener("resize", onResize);

// --- Hotkeys & Plant Selection ---
function cycleSeed(dir) {
  const ids = SEED_ORDER;
  if (!ids.length) return;
  let idx = ids.indexOf(player.selectedSeed);
  if (idx === -1) idx = 0;
  idx = (idx + dir + ids.length) % ids.length;
  player.selectedSeed = ids[idx];
  onSeedChanged(true);
}

// --- Main Loop ---
let last = 0, fps = 0;
function loop(t) {
  const dt = Math.min(0.033, (t - last) / 1000 || 0); last = t;
  fps = fps * 0.9 + (1 / dt) * 0.1;
  if (!paused) {
    controlPlayer(dt);
    for (const a of actors) { if (a !== player) updateNPC(a, dt); }
    updatePlants(dt);
    timeTick(dt);
    renderTopbar();
  }
  detectContext();
  refreshContextHint();
  // Draw
  ctx.clearRect(0, 0, W, H);
  drawTiles();
  drawPlants();
    drawInteractionHighlight();
    drawAllActors();
    if (DEBUG_OVERLAY) drawHouseOverlay();
    drawLighting();
    drawVignette();
    drawMinimap(); // Minimap zeichnen (immer!)
  if (paused) {
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = "#222";
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 48px Inter,Arial,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("PAUSE", W / 2, H / 2);
    ctx.restore();
  }
  requestAnimationFrame(loop);
}

// --- Boot ---
(async function () {
  onResize();
  await Promise.all([loadAll(), sfx.ready]);
  requestAnimationFrame(loop);
})();

