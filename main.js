// Poopboy v1.0 — Komplettüberarbeitung: Modular, performant, neue Features, bessere Steuerung, QoL, Bugfixes

import { ASSETS, MAP_W, MAP_H, TILE, TILES, map, SOLID, HOUSES, NPCS } from "./data.js";
import { SFX } from "./sfx.js";

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
  hint: document.getElementById("hint"),
};
ui.shopClose.onclick = () => ui.shop.classList.add("hidden");

// --- Audio ---
const sfx = new SFX(ASSETS.sfx);
const DEBUG_OVERLAY = false;

const HINT_CONTROLS = [
  ["WASD/←↑→↓", "Bewegen"],
  ["Shift", "Sprint"],
  ["E", "Interagieren"],
  ["1-3", "Pflanzen"],
  ["4", "Stein setzen"],
  ["Q/E", "Auswahl"],
  ["Esc", "Pause"],
];
const HINT_CONTROLS_HTML = HINT_CONTROLS
  .map(([key, desc]) => `<span class="hint-item"><span class="hint-key">${key}</span><span class="hint-desc">${desc}</span></span>`)
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
  keys.set(e.key.toLowerCase(), true);
  if (e.key === "Escape") paused = !paused;
}
function ku(e) { keys.delete(e.key.toLowerCase()); once.delete(e.key.toLowerCase()); }
addEventListener("keydown", kd);
addEventListener("keyup", ku);
function pressed(k) { return keys.has(k); }
function pressedOnce(k) {
  const k2 = k.toLowerCase();
  if (keys.has(k2) && !once.has(k2)) { once.add(k2); return true; }
  return false;
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
    ai: null,
    state: "",
    wt: 0,
  };
}
const player = makeActor("player", 26 * TILE, 54 * TILE);
player.stamina = 100; player.maxStamina = 100; player.sprint = false; player.money = 0;
player.inv = { seeds: { cabbage: 0, corn: 0, flower: 0 }, stones: 0, flowers: 0 };
player.selectedSeed = "cabbage";

// --- NPCs ---
const actors = [player];
for (const n of NPCS) {
  const a = makeActor(n.id, n.x, n.y);
  a.spd = 1.3;
  a.talk = `Hallo, ich bin ${n.id.charAt(0).toUpperCase() + n.id.slice(1)}.`;
  a.ai = "wander";
  actors.push(a);
}

// --- Pflanzen (neues System) ---
const plants = [];
const PLANT_TYPES = {
  cabbage: { growTime: 30, sprite: "assets/sprites/cabbage.png", yield: 1, name: "Kohl" },
  corn: { growTime: 40, sprite: "assets/sprites/corn.png", yield: 1, name: "Mais" },
  flower: { growTime: 20, sprite: "assets/sprites/flower.png", yield: 1, name: "Blume" },
};
const SEED_IDS = Object.keys(PLANT_TYPES);
const SEED_HOTKEYS = [
  ["1", "cabbage"],
  ["2", "corn"],
  ["3", "flower"],
];
for (const id of SEED_IDS) {
  if (!(id in player.inv.seeds)) player.inv.seeds[id] = 0;
}
function plantSeed(seedId, tx, ty) {
  plants.push({ id: seedId, x: tx, y: ty, t: 0, grown: false });
}
function updatePlants(dt) {
  for (const p of plants) {
    if (!p.grown) {
      p.t += dt;
      if (p.t >= PLANT_TYPES[p.id].growTime) p.grown = true;
    }
  }
}
function drawPlants() {
  for (const p of plants) {
    const spr = img(PLANT_TYPES[p.id].sprite);
    if (!spr) continue;
    const px = p.x * TILE - cam.x, py = p.y * TILE - cam.y;
    ctx.globalAlpha = p.grown ? 1 : 0.6;
    ctx.drawImage(spr, px, py - 16, 32, 32);
    ctx.globalAlpha = 1;
  }
}
function harvestPlantAt(tx, ty) {
  for (let i = 0; i < plants.length; ++i) {
    const p = plants[i];
    if (p.x === tx && p.y === ty && p.grown) {
      const amount = PLANT_TYPES[p.id].yield;
      if (p.id === "flower") {
        player.inv.flowers = (player.inv.flowers ?? 0) + amount;
      } else {
        player.inv.seeds[p.id] = (player.inv.seeds[p.id] ?? 0) + amount;
      }
      plants.splice(i, 1);
      sfx.play("pickup", { volume: 0.85, rateRange: [0.95, 1.05], detuneRange: 35 });
      return true;
    }
  }
  return false;
}

function tryInteract() {
  if (!ui.shop.classList.contains("hidden")) {
    ui.shop.classList.add("hidden");
    sfx.play("ui", { volume: 0.7, rateRange: [0.96, 1.05] });
    return true;
  }
  for (const a of actors) {
    if (a === player) continue;
    if (Math.hypot(a.x - player.x, a.y - player.y) < 40) {
      openShop();
      sfx.play("ui", { volume: 0.7, rateRange: [0.96, 1.05] });
      return true;
    }
  }
  const tx = Math.floor(player.x / TILE);
  const ty = Math.floor(player.y / TILE);
  if (harvestPlantAt(tx, ty)) return true;
  return false;
}

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
const SHOP_ITEMS = [
  { id: "cabbage", name: "Kohlsamen", price: 3 },
  { id: "corn", name: "Maissamen", price: 2 },
  { id: "flower", name: "Blumensamen", price: 4 },
  { id: "stone", name: "Schwerer Stein", price: 5 },
];
function openShop() {
  ui.shopItems.innerHTML = "";
  for (const it of SHOP_ITEMS) {
    const b = document.createElement("button");
    b.textContent = `${it.name} – ₽${it.price}`;
    b.onclick = () => {
      if (player.money >= it.price) {
        player.money -= it.price;
        if (it.id === "stone") player.inv.stones += 1;
        else if (it.id === "flower") player.inv.seeds.flower += 1;
        else player.inv.seeds[it.id] += 1;
        sfx.play("ui", { volume: 0.65, rateRange: [0.94, 1.04] });
        renderTopbar();
      }
    };
    ui.shopItems.appendChild(b);
  }
  ui.shop.classList.remove("hidden");
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
  const selected = PLANT_TYPES[player.selectedSeed];
  const seedsLeft = player.inv.seeds[player.selectedSeed] ?? 0;
  const flowers = player.inv.flowers ?? 0;
  const inventoryParts = [
    `<span class="hint-item emphasised">Saat: <span class="hint-badge">${selected ? selected.name : "?"}</span><span class="hint-count">${seedsLeft}</span></span>`,
    `<span class="hint-item emphasised">Blumen: <span class="hint-count">${flowers}</span></span>`,
    `<span class="hint-item emphasised">Steine: <span class="hint-count">${player.inv.stones}</span></span>`,
  ];
  ui.hint.innerHTML = `${HINT_CONTROLS_HTML}<span class="hint-sep hint-gap">|</span>${inventoryParts.join('<span class="hint-sep">•</span>')}`;
}

// --- Movement + Stamina ---
const STEP_INTERVAL_WALK = 230;
const STEP_INTERVAL_SPRINT = 170;
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
  if (pressed("w") || pressed("arrowup")) { dy -= 1; player.dir = 3; }
  if (pressed("s") || pressed("arrowdown")) { dy += 1; player.dir = 0; }
  if (pressed("a") || pressed("arrowleft")) { dx -= 1; player.dir = 1; }
  if (pressed("d") || pressed("arrowright")) { dx += 1; player.dir = 2; }
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
    player.anim = (player.anim + dt * 8) % 3;
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
      tryPlant(id);
    }
  }

  if (pressedOnce("4")) {
    tryPlaceStone();
  }

  if (pressedOnce("q")) {
    cycleSeed(-1);
  }

  if (pressedOnce("e")) {
    if (!tryInteract()) {
      cycleSeed(1);
    }
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
  if (player.inv.stones <= 0) return;
  const tx = Math.floor(player.x / TILE);
  const ty = Math.floor(player.y / TILE);
  const offsets = [[0, 1], [-1, 0], [1, 0], [0, -1]];
  const [ox, oy] = offsets[player.dir];
  const px = tx + ox, py = ty + oy;
  if (px < 0 || py < 0 || px >= MAP_W || py >= MAP_H) return;
  if (SOLID.has(map[py * MAP_W + px])) return;
  const wouldOverlap = Math.abs((px + 0.5) * TILE - player.x) < 20 && Math.abs((py + 0.5) * TILE - (player.y - 20)) < 28;
  if (wouldOverlap) return;
  map[py * MAP_W + px] = 3;
  player.inv.stones -= 1;
  sfx.play("pickup", { volume: 0.72, rateRange: [0.9, 1.04], detuneRange: 25 });
}

function tryPlant(seedId) {
  if (player.inv.seeds[seedId] <= 0) return;
  const tx = Math.floor(player.x / TILE), ty = Math.floor(player.y / TILE);
  if (map[ty * MAP_W + tx] === 0 || map[ty * MAP_W + tx] === 1) {
    // Check if already plant
    if (plants.some(p => p.x === tx && p.y === ty)) return;
    plantSeed(seedId, tx, ty);
    player.inv.seeds[seedId]--;
    sfx.play("pickup", { volume: 0.75, rateRange: [0.92, 1.05], detuneRange: 30 });
  }
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
  ctx.drawImage(spr, sx, sy, 48, 48, Math.floor(a.x - 24 - cam.x), Math.floor(a.y - 40 - cam.y), 48, 48);
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

  const lamp = img(ASSETS.fx.radial);
  if (lamp) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.3 + 0.4 * nightFactor;
    ctx.drawImage(lamp, Math.floor(player.x - 180 - cam.x), Math.floor(player.y - 220 - cam.y), 360, 360);
    ctx.restore();
  }

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
  const ids = SEED_IDS;
  if (!ids.length) return;
  let idx = ids.indexOf(player.selectedSeed);
  if (idx === -1) idx = 0;
  idx = (idx + dir + ids.length) % ids.length;
  player.selectedSeed = ids[idx];
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
  // Draw
  ctx.clearRect(0, 0, W, H);
  drawTiles();
  drawPlants();
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

