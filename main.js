/* =========================================================================
   MAIN GAME LOGIC – Part 1 (Setup, Map, Player, Input, Placement)
   ========================================================================= */

// ==== CANVAS SETUP ====
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// ==== GLOBAL GAME STATE ====
let gameState = {
  player: {
    x: 800, y: 500,
    w: 32, h: 32,
    speed: 2,
    dir: "down",
    hp: 3,
    inventory: JSON.parse(JSON.stringify(START_INVENTORY)),
    selectedItem: null
  },
  stones: [],
  placedObjects: [],
  npcs: JSON.parse(JSON.stringify(NPCS)),
  tutorialSeen: false,
  dayTimer: 0,
  isDay: true,
  version: GAME_VERSION
};

// ==== CONSTANTS ====
const TILE = 32;
const DAY_LENGTH = 180; // 3 Min total
const DAY_PHASE = 120;  // 2 Min Day, 1 Min Night

// ==== INPUT STATE ====
let keys = {};
let mouse = { x:0, y:0, down:false };

// ==== HELPER FUNCTIONS ====
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

function drawRect(x,y,w,h,color) {
  ctx.fillStyle = color;
  ctx.fillRect(x,y,w,h);
}

function getSelectedItem() {
  if (gameState.player.selectedItem !== null) {
    return gameState.player.inventory[gameState.player.selectedItem];
  }
  return null;
}

// ==== INIT GAME ====
function initGame() {
  // Spawn player near clearing with epic sound
  gameState.player.x = 750;
  gameState.player.y = 520;
  SFX.play("spawn");

  // Spawn some stones randomly
  for (let i=0; i<20; i++) {
    gameState.stones.push({
      x: Math.random()*MAP_WIDTH,
      y: Math.random()*MAP_HEIGHT,
      type: "stone"
    });
  }

  // Blockade Berta beim ersten Start
  for (let i=0; i<5; i++) {
    gameState.placedObjects.push({
      x: 1380 + i*TILE,
      y: 480,
      type: "stone"
    });
  }

  loop();
}

// ==== INPUT EVENTS ====
window.addEventListener("keydown", e => { keys[e.key] = true; });
window.addEventListener("keyup", e => { keys[e.key] = false; });
canvas.addEventListener("mousemove", e => {
  const rect = canvas.getBoundingClientRect();
  mouse.x = e.clientX - rect.left;
  mouse.y = e.clientY - rect.top;
});
canvas.addEventListener("mousedown", () => { mouse.down = true; });
canvas.addEventListener("mouseup", () => { mouse.down = false; });

// ==== PLAYER MOVEMENT ====
function updatePlayer() {
  let dx = 0, dy = 0;
  if (keys["w"] || keys["ArrowUp"])    { dy = -1; gameState.player.dir = "up"; }
  if (keys["s"] || keys["ArrowDown"])  { dy =  1; gameState.player.dir = "down"; }
  if (keys["a"] || keys["ArrowLeft"])  { dx = -1; gameState.player.dir = "left"; }
  if (keys["d"] || keys["ArrowRight"]) { dx =  1; gameState.player.dir = "right"; }

  const speed = gameState.player.speed;
  const newX = gameState.player.x + dx * speed;
  const newY = gameState.player.y + dy * speed;

  const playerRect = { x:newX, y:newY, w:gameState.player.w, h:gameState.player.h };

  // Check collisions with placed objects + static collision rects
  let blocked = false;
  for (const obj of gameState.placedObjects) {
    if (rectsOverlap(playerRect, {x:obj.x, y:obj.y, w:TILE, h:TILE})) {
      blocked = true;
      break;
    }
  }
  for (const col of COLLISION_RECTS) {
    if (rectsOverlap(playerRect, col)) {
      blocked = true;
      break;
    }
  }

  if (!blocked) {
    gameState.player.x = newX;
    gameState.player.y = newY;
  }
}

// ==== DRAW PLAYER ====
function drawPlayer() {
  ctx.fillStyle = "#FFD966"; // Placeholder color for player
  ctx.fillRect(gameState.player.x, gameState.player.y, gameState.player.w, gameState.player.h);
}

// ==== DRAW STONES & OBJECTS ====
function drawObjects() {
  for (const s of gameState.stones) {
    drawRect(s.x, s.y, TILE, TILE, "#777");
  }
  for (const o of gameState.placedObjects) {
    drawRect(o.x, o.y, TILE, TILE, "#555");
  }
}

// ==== MAIN LOOP ====
function loop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  updatePlayer();
  drawObjects();
  drawPlayer();

  // Version
  ctx.fillStyle = "#fff";
  ctx.font = "14px Arial";
  ctx.fillText(gameState.version, 10, canvas.height - 10);

  requestAnimationFrame(loop);
}

// Start game
initGame();
/* =========================================================================
   MAIN GAME LOGIC – Part 2 (UI, Joystick, Context, Tutorial, Day/Night)
   ========================================================================= */

/* ============ INVENTORY HELPERS ============ */
function invGet(id){
  const i = gameState.player.inventory.findIndex(e=>e.id===id);
  return i>=0 ? {idx:i, ...gameState.player.inventory[i]} : {idx:-1, id, qty:0};
}
function invAdd(id, n){
  const e = invGet(id);
  if (e.idx<0) gameState.player.inventory.push({id, qty:Math.max(0,n)});
  else gameState.player.inventory[e.idx].qty = Math.max(0, e.qty + n);
}
function invHas(id, n=1){ return invGet(id).qty >= n; }

/* ============ WORLD HELPERS ============ */
function ellipse(x,y,rx,ry,color){
  ctx.fillStyle=color;
  ctx.beginPath(); ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2); ctx.fill();
}
function drawStoneSprite(x,y){
  // schicker „Stein“: Ellipse + Highlight
  ellipse(x,y, TILE*0.36, TILE*0.28, "#9fa9b5");
  ellipse(x - TILE*0.12, y - TILE*0.08, TILE*0.12, TILE*0.09, "#7a8592");
}
function drawDirtSprite(x,y){
  ellipse(x,y, TILE*0.34, TILE*0.26, "#7a5a3a");
  ellipse(x - TILE*0.08, y - TILE*0.05, TILE*0.10, TILE*0.08, "#5c4128");
}

function snapToGrid(x,y){
  return {
    x: Math.round(x / TILE) * TILE,
    y: Math.round(y / TILE) * TILE
  };
}
function dist(ax,ay,bx,by){ return Math.hypot(ax-bx, ay-by); }

/* ============ JOYSTICK + CONTEXT BUTTON ============ */
const ui = {
  joy: { cx: 110, cy: canvas.height-110, rOuter: 68, rInner: 32, active:false, id:null, vx:0, vy:0 },
  ctxBtn: { x: canvas.width-84, y: canvas.height-84, r: 44, icon:"❓", enabled:false, action:null },
  tutorialOpen: false,
  dayTimer: 0
};
function resizeUI(){
  ui.joy.cy = canvas.height - 110;
  ui.ctxBtn.x = canvas.width - 84;
  ui.ctxBtn.y = canvas.height - 84;
}
window.addEventListener('resize', resizeUI);

/* ============ CONTEXT LOGIK ============ */
const PICK_RADIUS = 44;
function nearestLooseStoneIndex(){
  let best=-1, bd=1e9;
  for (let i=0;i<gameState.stones.length;i++){
    const s = gameState.stones[i];
    const d = dist(gameState.player.x+16, gameState.player.y+16, s.x+16, s.y+16);
    if (d < PICK_RADIUS && d < bd){ bd=d; best=i; }
  }
  return best;
}
function nearestPlacedStoneIndex(){
  let best=-1, bd=1e9;
  for (let i=0;i<gameState.placedObjects.length;i++){
    const s = gameState.placedObjects[i];
    if (s.type!=="stone") continue;
    const d = dist(gameState.player.x+16, gameState.player.y+16, s.x+16, s.y+16);
    if (d < PICK_RADIUS && d < bd){ bd=d; best=i; }
  }
  return best;
}
function canPlaceStoneAt(px,py){
  const me = {x:px, y:py, w:TILE, h:TILE};
  // nicht auf Spieler
  if (rectsOverlap(me, {x:gameState.player.x, y:gameState.player.y, w:gameState.player.w, h:gameState.player.h})) return false;
  // nicht auf bestehende placed
  for (const o of gameState.placedObjects) if (rectsOverlap(me,{x:o.x,y:o.y,w:TILE,h:TILE})) return false;
  // nicht auf loose stones (visuell vermeiden)
  for (const s of gameState.stones) if (rectsOverlap(me,{x:s.x,y:s.y,w:TILE,h:TILE})) return false;
  // nicht in statische Kollision (z.B. Teich)
  for (const c of COLLISION_RECTS) if (rectsOverlap(me,c)) return false;
  return true;
}

function updateContextButton(){
  let icon="❓", enabled=false, action=null;

  // Tutorial-Schild?
  const sign = TUTORIAL_SIGNS[0];
  if (sign && dist(gameState.player.x+16, gameState.player.y+16, sign.x, sign.y) < 80){
    icon = "📜"; enabled=true;
    action = ()=>{ ui.tutorialOpen = true; };
  } else {
    // 1) platzierten Stein aufheben?
    const pb = nearestPlacedStoneIndex();
    if (pb >= 0){
      icon="🪨"; enabled=true;
      action = ()=>{ gameState.placedObjects.splice(pb,1); invAdd("stone",1); SFX.play("pickup"); };
    } else {
      // 2) losen Stein aufheben?
      const idx = nearestLooseStoneIndex();
      if (idx >= 0){
        icon="🪨"; enabled=true;
        action = ()=>{ gameState.stones.splice(idx,1); invAdd("stone",1); SFX.play("pickup"); };
      } else {
        // 3) platzieren?
        if (invHas("stone",1)){
          const g = snapToGrid(gameState.player.x+16, gameState.player.y+16);
          const px = g.x - 16, py = g.y - 16; // zentrieren
          if (canPlaceStoneAt(px,py)){
            icon="📦"; enabled=true;
            action = ()=>{ invAdd("stone",-1); gameState.placedObjects.push({x:px,y:py,type:"stone"}); SFX.play("drop"); };
          } else {
            icon="🚫"; enabled=false;
          }
        }
      }
    }
  }

  ui.ctxBtn.icon = icon;
  ui.ctxBtn.enabled = enabled;
  ui.ctxBtn.action = action;
}

/* ============ POINTER INPUT (Joystick + Context) ============ */
canvas.addEventListener('pointerdown', e=>{
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  // Kontextbutton?
  const dCtx = dist(x,y, ui.ctxBtn.x, ui.ctxBtn.y);
  if (dCtx <= ui.ctxBtn.r){
    if (ui.ctxBtn.enabled && ui.ctxBtn.action) ui.ctxBtn.action();
    return;
  }
  // Joystick?
  const dJoy = dist(x,y, ui.joy.cx, ui.joy.cy);
  if (dJoy <= ui.joy.rOuter){
    ui.joy.active = true; ui.joy.id = e.pointerId;
    const dx = x - ui.joy.cx, dy = y - ui.joy.cy;
    const m = Math.hypot(dx,dy);
    const s = Math.min(1, m / (ui.joy.rOuter-8));
    ui.joy.vx = (m<8?0:dx/m) * s;
    ui.joy.vy = (m<8?0:dy/m) * s;
  }
});
canvas.addEventListener('pointermove', e=>{
  if (!ui.joy.active || e.pointerId !== ui.joy.id) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  const dx = x - ui.joy.cx, dy = y - ui.joy.cy;
  const m = Math.hypot(dx,dy);
  const s = Math.min(1, m / (ui.joy.rOuter-8));
  ui.joy.vx = (m<8?0:dx/m) * s;
  ui.joy.vy = (m<8?0:dy/m) * s;
});
window.addEventListener('pointerup', e=>{
  if (ui.joy.active && e.pointerId === ui.joy.id){
    ui.joy.active = false; ui.joy.id = null; ui.joy.vx = ui.joy.vy = 0;
  }
});

/* ============ OVERRIDE: updatePlayer (Joystick + Kollision) ============ */
const _origUpdatePlayer = updatePlayer;
updatePlayer = function(){
  // Tastatur + Joystick zusammenführen
  let dx = 0, dy = 0;
  if (keys["w"] || keys["ArrowUp"])    dy -= 1;
  if (keys["s"] || keys["ArrowDown"])  dy += 1;
  if (keys["a"] || keys["ArrowLeft"])  dx -= 1;
  if (keys["d"] || keys["ArrowRight"]) dx += 1;

  // Joystick dominiert bei Touch
  dx += ui.joy.vx*2.5;
  dy += ui.joy.vy*2.5;

  const len = Math.hypot(dx,dy);
  if (len>0){
    const dirx = dx/len, diry = dy/len;
    // Blickrichtung
    if (Math.abs(dirx) > Math.abs(diry)) gameState.player.dir = (dirx<0)?"left":"right";
    else gameState.player.dir = (diry<0)?"up":"down";

    const sp = gameState.player.speed * 1.25; // leicht schneller als vorher
    const nx = gameState.player.x + dirx * sp;
    const ny = gameState.player.y + diry * sp;

    const rectN = {x:nx, y:gameState.player.y, w:gameState.player.w, h:gameState.player.h};
    const rectM = {x:gameState.player.x, y:ny, w:gameState.player.w, h:gameState.player.h};

    let blockX=false, blockY=false;

    for (const o of gameState.placedObjects){
      const r = {x:o.x,y:o.y,w:TILE,h:TILE};
      if (rectsOverlap(rectN, r)) blockX=true;
      if (rectsOverlap(rectM, r)) blockY=true;
      if (blockX && blockY) break;
    }
    for (const c of COLLISION_RECTS){
      if (rectsOverlap(rectN, c)) blockX=true;
      if (rectsOverlap(rectM, c)) blockY=true;
      if (blockX && blockY) break;
    }

    if (!blockX) gameState.player.x = nx;
    if (!blockY) gameState.player.y = ny;
  }
};

/* ============ DAY/NIGHT ============ */
function updateDayNight(dt){
  ui.dayTimer += dt;
  const sec = ui.dayTimer;
  const t = sec % DAY_LENGTH;
  gameState.isDay = (t < DAY_PHASE);
}
function drawNightOverlay(){
  if (!gameState.isDay){
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(0,0,canvas.width,canvas.height);
  }
}

/* ============ TUTORIAL OVERLAY ============ */
function drawTutorial(){
  if (!ui.tutorialOpen) return;
  const lines = TUTORIAL_SIGNS[0]?.text || [];
  const W = Math.min(560, canvas.width*0.9), H = Math.min(260, canvas.height*0.6);
  const x = (canvas.width - W)/2, y = (canvas.height - H)/2;

  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0,0,canvas.width,canvas.height);

  ctx.fillStyle = "#0f141a"; ctx.fillRect(x, y, W, H);
  ctx.strokeStyle = "#3a2a18"; ctx.lineWidth = 2; ctx.strokeRect(x, y, W, H);

  ctx.fillStyle = "#e7e5e4"; ctx.font = "bold 18px system-ui";
  ctx.fillText("Tutorial", x+16, y+28);
  ctx.font = "14px system-ui"; ctx.fillStyle = "#cbd5e1";

  let yy = y+56;
  for (const line of lines){
    ctx.fillText(line, x+16, yy);
    yy += 22;
  }
  ctx.font = "12px system-ui"; ctx.fillStyle = "#9aa6b2";
  ctx.fillText("Tippe außerhalb, um zu schließen", x+16, y+H-12);
}
canvas.addEventListener('pointerdown', e=>{
  if (!ui.tutorialOpen) return;
  // Klick außerhalb schließt:
  ui.tutorialOpen = false;
});

/* ============ DRAW WORLD (override drawObjects & drawPlayer additions) ============ */
const _origDrawObjects = drawObjects;
drawObjects = function(){
  // losen Steine
  for (const s of gameState.stones){
    drawStoneSprite(s.x+TILE/2, s.y+TILE/2);
  }
  // platzierte Steine (Blocker)
  for (const o of gameState.placedObjects){
    if (o.type==="stone") drawStoneSprite(o.x+TILE/2, o.y+TILE/2);
  }

  // Tutorial-Schild zeichnen (bei Fred)
  const sign = TUTORIAL_SIGNS[0];
  if (sign){
    // Holzpfahl + Schild
    ctx.fillStyle="#775836";
    ctx.fillRect(sign.x-6, sign.y-24, 12, 48);
    ctx.fillStyle="#e8e0c8";
    ctx.fillRect(sign.x-40, sign.y-46, 80, 30);
    ctx.fillStyle="#2b2b2b"; ctx.font="bold 12px system-ui"; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText("INFO", sign.x, sign.y-31);
    ctx.textAlign="left"; ctx.textBaseline="alphabetic";
  }
};
const _origDrawPlayer = drawPlayer;
drawPlayer = function(){
  // simple runder „Char“
  ctx.fillStyle="#e6b35a";
  ellipse(gameState.player.x+16, gameState.player.y+16, 16, 16, "#e6b35a");
  // Blickrichtung (Pupillen)
  const dir = gameState.player.dir;
  let fx=0, fy=0; if (dir==="left") fx=-1; else if (dir==="right") fx=1; else if (dir==="up") fy=-1; else fy=1;
  const Lx = gameState.player.x+16 + (-fy)*6 + fx*3;
  const Ly = gameState.player.y+16 + ( fx)*6 + fy*3;
  const Rx = gameState.player.x+16 - (-fy)*6 + fx*3;
  const Ry = gameState.player.y+16 - ( fx)*6 + fy*3;
  ellipse(Lx,Ly,3.5,3.5,"#fff"); ellipse(Rx,Ry,3.5,3.5,"#fff");
  ellipse(Lx+fx*2,Ly+fy*2,2.2,2.2,"#111"); ellipse(Rx+fx*2,Ry+fy*2,2.2,2.2,"#111");
};

/* ============ UI DRAWING (HUD, Joystick, Context, Version) ============ */
function drawHUD(){
  // Top-Leiste: Steine
  const stones = invGet("stone").qty;
  ctx.fillStyle="rgba(0,0,0,0.35)";
  ctx.fillRect(0,0, Math.max(140, canvas.width), 34);
  ctx.fillStyle="#fff"; ctx.font="bold 14px system-ui";
  ctx.fillText("🪨 Steine: " + stones, 10, 22);

  // Uhr & Tag/Nacht
  const t = (ui.dayTimer % DAY_LENGTH);
  const hours = Math.floor((t / DAY_LENGTH) * 24);
  const mins  = Math.floor(((t / DAY_LENGTH) * 24 - hours) * 60);
  const clock = `${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}`;
  ctx.textAlign="right";
  ctx.fillText(`${clock} ${gameState.isDay?'🌞':'🌙'}`, canvas.width-12, 22);
  ctx.textAlign="left";

  // Version unten links
  ctx.fillStyle="#ddd"; ctx.font="12px system-ui";
  ctx.fillText(gameState.version, 10, canvas.height-10);

  // Joystick
  ctx.globalAlpha=0.9;
  ellipse(ui.joy.cx, ui.joy.cy, ui.joy.rOuter, ui.joy.rOuter, "rgba(24,34,44,.55)");
  ellipse(ui.joy.cx, ui.joy.cy, ui.joy.rOuter-6, ui.joy.rOuter-6, "rgba(60,80,96,.18)");
  const kx = ui.joy.cx + ui.joy.vx * (ui.joy.rOuter-12);
  const ky = ui.joy.cy + ui.joy.vy * (ui.joy.rOuter-12);
  ellipse(kx, ky, ui.joy.rInner, ui.joy.rInner, "#1f2937");
  ctx.globalAlpha=1;

  // Kontextbutton
  const cb = ui.ctxBtn;
  ellipse(cb.x, cb.y, cb.r, cb.r, cb.enabled ? "#2563eb" : "#3b4551");
  ctx.fillStyle="#fff"; ctx.font="32px system-ui"; ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.fillText(cb.icon, cb.x, cb.y+2);
  ctx.textAlign="left"; ctx.textBaseline="alphabetic";
}

/* ============ PLACEMENT PREVIEW ============ */
function drawPlacementPreview(){
  // nur wenn wir Steine haben und nichts anderes in Reichweite
  if (!invHas("stone",1)) return;
  if (nearestLooseStoneIndex()>=0 || nearestPlacedStoneIndex()>=0) return;
  const g = snapToGrid(gameState.player.x+16, gameState.player.y+16);
  const px = g.x - 16, py = g.y - 16;
  const ok = canPlaceStoneAt(px,py);
  ctx.globalAlpha = 0.6;
  ellipse(px+TILE/2, py+TILE/2, TILE*0.36, TILE*0.28, ok ? "rgba(56, 189, 248, 0.35)" : "rgba(239, 68, 68, 0.45)");
  ctx.globalAlpha = 1;
}

/* ============ GAME LOOP OVERRIDE ============ */
const _origLoop = loop;
let _last = performance.now();
loop = function(){
  const now = performance.now();
  const dt = (now - _last)/1000; _last = now;

  ctx.clearRect(0,0,canvas.width,canvas.height);

  // Update
  updateDayNight(dt);
  updatePlayer();
  updateContextButton();

  // Draw
  // Hintergrund (einfaches Schachbrett für Kontrast)
  const bgA = gameState.isDay ? "#13481e" : "#0a2a14";
  const bgB = gameState.isDay ? "#0f3a18" : "#092412";
  for (let y=0;y<canvas.height;y+=TILE){
    for (let x=0;x<canvas.width;x+=TILE){
      ctx.fillStyle = (((x+y)/TILE)%2===0)?bgA:bgB;
      ctx.fillRect(x,y,TILE,TILE);
    }
  }

  // Weltobjekte
  drawObjects();
  drawPlayer();
  drawPlacementPreview();
  drawNightOverlay();
  drawHUD();
  drawTutorial();

  requestAnimationFrame(loop);
};

/* ============ BOOT TWEAKS ============ */
resizeUI();
SFX && SFX.play && SFX.play("spawn"); // extra Sicherheit
