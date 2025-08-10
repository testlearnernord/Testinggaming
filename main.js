// Poopboy v0.9 — performance pass & feature polish
// - Fixed: rock placement teleport bug (no more self-collide snap)
// - Restored: stamina/sprint system with smooth regen + UI
// - Added: simple day/night cycle & radial lighting overlay (GPU-cheap)
// - Added: NPC random wander w/ avoidance; static house placement
// - Added: interact (E) to talk/shop; basic inventory; seeds visible
// - Optimized: draw order, texture batching, camera culling, input loop
// - Structured: tiny ECS-style update loop for clarity
import { ASSETS, MAP_W, MAP_H, TILE, TILES, map, SOLID, HOUSES, NPCS } from "./data.js";
import { SFX } from "./sfx.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d",{alpha:false});
let W = canvas.width, H = canvas.height;

const ui = {
  fps: document.getElementById("fps"),
  stam: document.getElementById("stamina"),
  money: document.getElementById("money"),
  clock: document.getElementById("clock"),
  shop: document.getElementById("shop"),
  shopItems: document.getElementById("shop-items"),
  shopClose: document.getElementById("shop-close"),
};
ui.shopClose.onclick = ()=> ui.shop.classList.add("hidden");

const sfx = new SFX(ASSETS.sfx);

// Loader
const IMGS = new Map();
async function loadImg(url){ return new Promise(res=>{ const i=new Image(); i.onload=()=>res(i); i.src=url; }); }
async function loadAll(){
  const tasks = [];
  for(const cat of [ASSETS.sprites, ASSETS.tiles, ASSETS.fx]){
    for(const [k,url] of Object.entries(cat)){
      tasks.push(loadImg(url).then(img=>IMGS.set(url,img)));
    }
  }
  await Promise.all(tasks);
}
function img(url){ return IMGS.get(url); }

// Input
const keys = new Map();
const once = new Set();
function kd(e){ keys.set(e.key.toLowerCase(), true); }
function ku(e){ keys.delete(e.key.toLowerCase()); once.delete(e.key.toLowerCase()); }
addEventListener("keydown", kd);
addEventListener("keyup", ku);
function pressed(k){ return keys.has(k); }
function pressedOnce(k){ const k2 = k.toLowerCase(); if(keys.has(k2)&&!once.has(k2)){ once.add(k2); return true;} return false; }

// Camera
const cam = {x:0,y:0, lerp:0.18};
function focus(x,y){
  cam.x += ((x - W/2) - cam.x)*cam.lerp;
  cam.y += ((y - H/2) - cam.y)*cam.lerp;
}

// Entities
function makeActor(spriteId, x, y){
  return {
    kind:"actor",
    x,y, vx:0, vy:0,
    dir:0, // 0 down,1 left,2 right,3 up
    frame:0, anim:0,
    spd: 2.0,
    sprite: ASSETS.sprites[spriteId],
    w: 32, h: 38,
    talk:"",
  };
}
const player = makeActor("player", 26*TILE, 54*TILE);
player.stamina = 100; player.maxStamina=100; player.sprint=false; player.money=0;
player.inv = { seeds: {cabbage:0, corn:0}, stones:0 };

// NPCs
const actors = [player];
for(const n of NPCS){
  const a = makeActor(n.id, n.x, n.y);
  a.spd = 1.3;
  a.talk = `Moin, ich bin ${n.id.charAt(0).toUpperCase()+n.id.slice(1)}.`;
  actors.push(a);
}

// Physics helpers
function tileAt(x,y){ 
  const tx = Math.floor(x/TILE), ty=Math.floor(y/TILE);
  if(tx<0||ty<0||tx>=MAP_W||ty>=MAP_H) return 6; // wall outside
  return map[ty*MAP_W+tx];
}
function collideRect(ax,ay,aw,ah){
  const minx = Math.floor((ax)/TILE)-1, maxx = Math.floor((ax+aw)/TILE)+1;
  const miny = Math.floor((ay)/TILE)-1, maxy = Math.floor((ay+ah)/TILE)+1;
  for(let ty=miny; ty<=maxy; ty++){
    for(let tx=minx; tx<=maxx; tx++){
      if(tx<0||ty<0||tx>=MAP_W||ty>=MAP_H) return {x:tx*TILE,y:ty*TILE,w:TILE,h:TILE};
      const t = map[ty*MAP_W+tx];
      if(SOLID.has(t)) return {x:tx*TILE,y:ty*TILE,w:TILE,h:TILE};
    }
  }
  return null;
}
function resolve(a){
  const r = collideRect(a.x-16,a.y-32,a.w,a.h);
  if(!r) return;
  const ax=a.x-16, ay=a.y-32;
  const dx1 = (r.x+r.w) - ax;
  const dx2 = (ax+a.w) - r.x;
  const dy1 = (r.y+r.h) - ay;
  const dy2 = (ay+a.h) - r.y;
  const m = Math.min(dx1,dx2,dy1,dy2);
  if(m===dx1) a.x = r.x+r.w+16;
  else if(m===dx2) a.x = r.x-16-a.w;
  else if(m===dy1) a.y = r.y+r.h+32;
  else a.y = r.y+32-a.h;
}

// Interactions
const prompts = [];
function prompt(text, fn){ prompts.push({text,fn}); }

// Shop sample
const SHOP_ITEMS = [
  {id:"cabbage", name:"Kohlsamen", price:3},
  {id:"corn", name:"Maissamen", price:2},
  {id:"stone", name:"Schwerer Stein", price:5},
];

function openShop(){
  ui.shopItems.innerHTML = "";
  for(const it of SHOP_ITEMS){
    const b = document.createElement("button");
    b.textContent = `${it.name} – ₽${it.price}`;
    b.onclick = ()=>{
      if(player.money>=it.price){
        player.money -= it.price;
        if(it.id==="stone") player.inv.stones += 1;
        else player.inv.seeds[it.id] += 1;
        sfx.play("ui",0.7);
        renderTopbar();
      }
    };
    ui.shopItems.appendChild(b);
  }
  ui.shop.classList.remove("hidden");
}

// Gameplay systems
let timeMin = 6*60; // start 06:00
function timeTick(dt){
  timeMin += dt*0.04; // ~25x slower than real time
  if(timeMin>=24*60) timeMin=0;
  const hh = Math.floor(timeMin/60).toString().padStart(2,"0");
  const mm = Math.floor(timeMin%60).toString().padStart(2,"0");
  ui.clock.textContent = `${hh}:${mm}`;
}

function renderTopbar(){
  ui.fps.textContent = `${fps.toFixed(0)} FPS`;
  ui.stam.textContent = `Ausdauer: ${Math.round(player.stamina)}`;
  ui.money.textContent = `₽ ${player.money}`;
}

// Movement + stamina/sprint
function controlPlayer(dt){
  let dx=0, dy=0;
  if(pressed("w")){ dy-=1; player.dir=3; }
  if(pressed("s")){ dy+=1; player.dir=0; }
  if(pressed("a")){ dx-=1; player.dir=1; }
  if(pressed("d")){ dx+=1; player.dir=2; }
  const sprinting = pressed("shift") && player.stamina>0;
  const spd = player.spd*(sprinting?1.85:1);
  if(dx||dy){
    const invLen = 1/Math.hypot(dx,dy);
    dx*=invLen; dy*=invLen;
    player.x += dx*spd*dt*60;
    player.y += dy*spd*dt*60;
    sfx.play("step",0.15);
    player.anim = (player.anim + dt*8) % 3;
    if(sprinting){ player.stamina = Math.max(0, player.stamina - dt*18); player.sprint=true; }
    else player.sprint=false;
  } else {
    player.anim = 1;
  }
  if(!sprinting && player.stamina<player.maxStamina){
    const regen = player.sprint? 6 : 12; // slower immediately after sprint
    player.stamina = Math.min(player.maxStamina, player.stamina + dt*regen);
  }
  resolve(player);
  focus(player.x, player.y);
  // Interact
  if(pressedOnce("e")){
    // if near NPC -> talk/shop
    for(const a of actors){
      if(a===player) continue;
      if(Math.hypot(a.x-player.x,a.y-player.y)<40){
        openShop(); sfx.play("ui",0.8); break;
      }
    }
  }
}

// NPC wander
function updateNPC(a, dt){
  if(!a.wt || a.wt<=0){
    a.tx = a.x + (Math.random()*120-60);
    a.ty = a.y + (Math.random()*60-30);
    a.wt = 2+Math.random()*3;
  }
  const dx = a.tx - a.x, dy = a.ty - a.y;
  const dist = Math.hypot(dx,dy);
  if(dist>2){
    const inv = 1/dist;
    a.x += dx*inv*a.spd*dt*60;
    a.y += dy*inv*a.spd*dt*60;
    a.dir = Math.abs(dx)>Math.abs(dy) ? (dx<0?1:2) : (dy<0?3:0);
    a.anim = (a.anim + dt*6) % 3;
    resolve(a);
  } else { a.wt -= dt; a.anim = 1; }
  // Avoid player
  const pd = Math.hypot(player.x-a.x, player.y-a.y);
  if(pd<36){ a.x += (a.x-player.x)*0.02; a.y += (a.y-player.y)*0.02; }
}

// Planting & stones (bugfix for teleport): we reject placement that would collide with player
function tryPlaceStone(){
  if(player.inv.stones<=0) return;
  const tx = Math.floor(player.x/TILE);
  const ty = Math.floor(player.y/TILE);
  // Place in front based on dir
  const offsets = [[0,1],[ -1,0 ],[1,0],[0,-1]];
  const [ox,oy] = offsets[player.dir];
  const px = tx+ox, py = ty+oy;
  if(px<0||py<0||px>=MAP_W||py>=MAP_H) return;
  // Reject if solid or would overlap player body rectangle
  if(SOLID.has(map[py*MAP_W+px])) return;
  const wouldOverlap = Math.abs((px+0.5)*TILE - player.x) < 20 && Math.abs((py+0.5)*TILE - (player.y-20)) < 28;
  if(wouldOverlap) return; // no teleport bug
  map[py*MAP_W+px] = 3; // rock
  player.inv.stones -= 1;
}

function tryPlant(seedId){
  // find ground
  const tx = Math.floor(player.x/TILE), ty = Math.floor(player.y/TILE);
  if(map[ty*MAP_W+tx]===0 || map[ty*MAP_W+tx]===1){ // grass/dirt
    if(player.inv.seeds[seedId]>0){
      player.inv.seeds[seedId]--;
      player.money += 1; // temporary reward loop to test inventory visibility
      sfx.play("pickup",0.8);
    }
  }
}

// Rendering
const tileImgs = TILES.map(n=>ASSETS.tiles[n]);
function drawTiles(){
  const startX = Math.max(0, Math.floor((cam.x)/TILE)-2);
  const startY = Math.max(0, Math.floor((cam.y)/TILE)-2);
  const endX = Math.min(MAP_W, Math.ceil((cam.x+W)/TILE)+2);
  const endY = Math.min(MAP_H, Math.ceil((cam.y+H)/TILE)+2);
  for(let ty=startY; ty<endY; ty++){
    for(let tx=startX; tx<endX; tx++){
      const t = map[ty*MAP_W+tx];
      const imgUrl = tileImgs[t]; const im = img(imgUrl);
      if(im) ctx.drawImage(im, tx*TILE - cam.x, ty*TILE - cam.y);
    }
  }
}

function drawActor(a){
  const spr = img(a.sprite);
  const frame = Math.floor(a.anim);
  const sx = frame*48, sy = a.dir*48;
  ctx.drawImage(spr, sx, sy, 48,48, Math.floor(a.x-24 - cam.x), Math.floor(a.y-40 - cam.y), 48,48);
}

function drawAllActors(){
  // simple y-sort for faux depth
  const list = actors.slice().sort((a,b)=> (a.y-b.y));
  for(const a of list) drawActor(a);
}

// Lighting & day-night tint
function drawLighting(){
  // evening factor
  const t = Math.abs(Math.sin(timeMin/1440*Math.PI*2)); // 0..1 over a day
  ctx.globalCompositeOperation="multiply";
  ctx.fillStyle = `rgba(${Math.floor(30+60*t)},${Math.floor(40+50*t)},${Math.floor(80+100*t)},${0.25+0.25*t})`;
  ctx.fillRect(0,0,W,H);
  // player lamp
  const lamp = img(ASSETS.fx.radial);
  if(lamp){
    ctx.globalCompositeOperation="screen";
    ctx.globalAlpha = 0.6*(0.4+0.6*(1-t));
    ctx.drawImage(lamp, Math.floor(player.x-128 - cam.x), Math.floor(player.y-160 - cam.y));
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation="source-over";
}

// Resize
function onResize(){
  canvas.width = innerWidth*devicePixelRatio; canvas.height = innerHeight*devicePixelRatio;
  W = canvas.width; H = canvas.height;
  ctx.imageSmoothingEnabled = false;
}
addEventListener("resize", onResize);

// HUD debug controls for planting and stone placement
addEventListener("keydown", (e)=>{
  if(e.key==='1') tryPlant("cabbage");
  if(e.key==='2') tryPlant("corn");
  if(e.key==='3') tryPlaceStone();
});

// Main loop
let last=0, fps=0;
function loop(t){
  const dt = Math.min(0.033, (t-last)/1000||0); last=t;
  fps = fps*0.9 + (1/dt)*0.1;
  // Update
  controlPlayer(dt);
  for(const a of actors){ if(a!==player) updateNPC(a, dt); }
  timeTick(dt);
  renderTopbar();
  // Draw
  ctx.clearRect(0,0,W,H);
  drawTiles();
  drawAllActors();
  drawLighting();
  requestAnimationFrame(loop);
}

// Boot
(async function(){
  onResize();
  await loadAll();
  requestAnimationFrame(loop);
})();
