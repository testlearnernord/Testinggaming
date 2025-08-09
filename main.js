/* =========================================================================
   Poopboy v0.6.1 – Mehrdateien-Build
   Fixes jetzt drin:
   - Stein-Platzieren priorisiert (Kontext) + saubere Vorschau (Tilesnap)
   - Standardauswahl HUD = "🪨" (Stein)
   - 4 Monster nachts mit Respawn, stärkerer Pushback + SFX
   - Zaun-/Haus-Kollisionen, Teich/Steine hinter Gebäuden
   - Tutorial-Schild sichtbar
   ========================================================================= */
(() => {
  // ----- Canvas & DPI -----
  const cv = document.getElementById("gameCanvas");
  const ctx = cv.getContext("2d", { alpha:false });

  // UI (Joystick, Kontext, Tutorial)
  const ui = {
    joy:{ cx:110, cy:110, r:68, knob:32, active:false, id:null, vx:0, vy:0 },
    ctxBtn:{ x:110, y:110, r:44, icon:"❓", enabled:false, action:null },
    tutorial:false
  };
  function resizeCanvas(){
    const dpr = Math.max(1, window.devicePixelRatio||1);
    const w = window.innerWidth, h = window.innerHeight;
    cv.style.width = w+"px"; cv.style.height = h+"px";
    cv.width = Math.floor(w*dpr); cv.height = Math.floor(h*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ui.joy.cy = cv.clientHeight - 110;
    ui.ctxBtn.x = cv.clientWidth - 84;
    ui.ctxBtn.y = cv.clientHeight - 84;
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // ----- Helpers -----
  const T = WORLD.TILE, MAP_W = WORLD.W, MAP_H = WORLD.H;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const dist=(ax,ay,bx,by)=>Math.hypot(ax-bx,ay-by);
  const toPx=(tx,ty)=>({x:tx*T,y:ty*T});
  const toRectPx=(r)=>({x:r.x*T,y:r.y*T,w:r.w*T,h:r.h*T});
  const rectsOverlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
  const ellipse=(x,y,rx,ry,color)=>{ ctx.fillStyle=color; ctx.beginPath(); ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2); ctx.fill(); };
  function clampToWorld(x,y){ const min=T/2, maxX=MAP_W*T-T/2, maxY=MAP_H*T-T/2; return {x:clamp(x,min,maxX), y:clamp(y,min,maxY)}; }
  // präzises Tile-Center (verhindert „zwischen Kacheln“)
  function tileCenterFromPx(x,y){ const tx=Math.floor(x/T), ty=Math.floor(y/T); return {x:tx*T+T/2, y:ty*T+T/2}; }
  const snapToTile = tileCenterFromPx;

  // ----- Areas (mutable) -----
  const BASE_FARM  = toRectPx(MAPDATA.farm);
  const BASE_CLEAR = toRectPx(MAPDATA.clearing);
  const POND       = toRectPx(MAPDATA.pondRect);
  const TUTORIAL   = toPx(MAPDATA.tutorial.x+0.5, MAPDATA.tutorial.y+0.5);

  // ----- State -----
  const state = {
    version: GAME_VERSION,
    player: { x: BASE_CLEAR.x + T*1.2, y: BASE_CLEAR.y + BASE_CLEAR.h/2, r: T*0.38, dir:"right" },
    inv: { stone:0, poop:0, corn:0, cabbage:0, euro:0, cabbageSeed:0, hasCan:false, can:0, canMax:CAN_MAX, hasShoes:false },
    hearts: 3,
    speedMult: 1.0,
    isDay: true, prevIsDay:true, dayBase: performance.now(), timeScale: 1.0,
    stones: [], dirts: [], blocks: [], plants: [],
    monsters: [], bullets: [],
    uiSeed: "stone", // << Standard: Stein ausgewählt
    farm: { ...BASE_FARM },
    clear:{ ...BASE_CLEAR },
    shackBuilt:false,
    bertaBlockadePlaced:false,
    rng:(Date.now() ^ 0x9e3779b9)>>>0,
    god:false,
    dmgCooldown: 0
  };
  function rnd(){ let x=state.rng; x^=x<<13; x^=x>>>17; x^=x<<5; state.rng=x>>>0; return (x>>>0)/4294967296; }

  // ----- Save/Load -----
  function save(){
    try{ localStorage.setItem("pb_save_v6", JSON.stringify({
      inv:state.inv, hearts:state.hearts, speedMult:state.speedMult, dayBase:state.dayBase, timeScale:state.timeScale,
      blocks:state.blocks, plants:state.plants, farm:state.farm, clear:state.clear,
      shackBuilt:state.shackBuilt, bertaBlockadePlaced:state.bertaBlockadePlaced, god:state.god
    })); }catch{}
  }
  (function load(){
    try{
      const d = JSON.parse(localStorage.getItem("pb_save_v6")||"null"); if(!d) return;
      Object.assign(state.inv, d.inv||{});
      state.hearts = d.hearts || 3;
      state.speedMult = d.speedMult||1.0;
      state.dayBase = d.dayBase||state.dayBase;
      state.timeScale = d.timeScale||1.0;
      if(Array.isArray(d.blocks)) state.blocks = d.blocks;
      if(Array.isArray(d.plants)) state.plants = d.plants;
      if(d.farm)  state.farm = d.farm;
      if(d.clear) state.clear = d.clear;
      state.shackBuilt = !!d.shackBuilt;
      state.bertaBlockadePlaced = !!d.bertaBlockadePlaced;
      state.god = !!d.god;
    }catch{}
  })();

  // ----- FX -----
  const FX=[];
  function spawnDust(x,y){ for(let i=0;i<14;i++){ const a=Math.random()*Math.PI*2,s=1.5+Math.random()*2.2; FX.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,r:2.5+Math.random()*3,a:0.9,t:36}); } }

  // ----- Spawn player -----
  function spawnPlayer(){
    let sx = state.clear.x + state.clear.w * 0.5 - T*0.6;
    let sy = state.clear.y + state.clear.h * 0.5;
    const p = clampToWorld(sx, sy);
    state.player.x = p.x; state.player.y = p.y; state.player.dir="right";
    spawnDust(state.player.x, state.player.y);
    if (window.SFX) SFX.play("spawn");
  }

  // ----- HUD Slots -----
  const HUD_SLOTS = [
    { key:"stone",        icon:"🪨", x:10 },
    { key:"poop",         icon:"💩", x:90 },
    { key:"cabbageSeed",  icon:"🥬", x:170 },
    { key:null,           icon:"🚫", x:250 },
  ];
  const HUD_H=48, HUD_Y=0, HUD_SLOT_Y=10, HUD_SLOT_H=28, HUD_SLOT_W=68;
  let hudSlotRects=[];

  // ----- Pickups: stones + dirts -----
  function canSpawnPickupAt(x,y){
    const r={x:x-T*0.5,y:y-T*0.5,w:T,h:T};
    if(rectsOverlap(r,POND)) return false;
    if(rectsOverlap(r,state.farm)) return false;
    if(rectsOverlap(r,state.clear)) return false;
    for(const b of state.blocks) if(rectsOverlap(r,{x:b.x-T*0.5,y:b.y-T*0.5,w:T,h:T})) return false;
    for(const p of state.plants) if(rectsOverlap(r,{x:p.x-T*0.5,y:p.y-T*0.5,w:T,h:T})) return false;
    return true;
  }
  function spawnRandomStone(){
    let tries=120;
    while(tries--){
      const tx=Math.floor(rnd()*MAP_W), ty=Math.floor(rnd()*MAP_H);
      const gx=tx*T+T/2, gy=ty*T+T/2;
      if (canSpawnPickupAt(gx,gy)){ state.stones.push({x:gx,y:gy}); return true; }
    } return false;
  }
  function spawnRandomDirt(){
    let tries=120;
    while(tries--){
      const tx=Math.floor(rnd()*MAP_W), ty=Math.floor(rnd()*MAP_H);
      const gx=tx*T+T/2, gy=ty*T+T/2;
      if (canSpawnPickupAt(gx,gy)){ state.dirts.push({x:gx,y:gy}); return true; }
    } return false;
  }
  // Initialdichte
  state.stones.length=0; state.dirts.length=0;
  for(let i=0;i<70;i++)  spawnRandomStone();
  for(let i=0;i<40;i++)  spawnRandomDirt();

  // Berta-Blockade (um das Haus herum)
  function placeBertaBlockade(){
    if (state.bertaBlockadePlaced) return;
    const b = NPCS.find(n=>n.id==="berta"); if(!b) return;
    const bp = toPx(b.x,b.y);
    const ring = [[-1,0],[1,0],[0,1],[0,-1],[-1,-1],[1,-1],[-1,1],[1,1]];
    for(const [ox,oy] of ring){
      const px = bp.x + ox*T, py = bp.y + oy*T;
      if (canSpawnPickupAt(px,py)) state.blocks.push({x:px,y:py});
    }
    state.bertaBlockadePlaced=true; save();
  }

  // ----- Day/Night -----
  function updateDay(){
    const dt=((performance.now()-state.dayBase)*state.timeScale)%DAY_TOTAL_MS;
    state.prevIsDay = state.isDay;
    state.isDay = dt < DAYLIGHT_MS;
    if (state.isDay !== state.prevIsDay){
      if (state.isDay){ if(SFX)SFX.play("day"); state.monsters.length = 0; }
      else { if(SFX)SFX.play("night"); }
    }
  }

  // ----- Plants -----
  function inFarm(x,y){ const f=state.farm; return x>=f.x&&x<=f.x+f.w&&y>=f.y&&y<=f.y+f.h; }
  function findNearbyPlant(){ let best=null,bd=1e9; for(const p of state.plants){ const d=dist(state.player.x,state.player.y,p.x,p.y); if(d<T*0.9 && d<bd){bd=d;best=p;} } return best; }
  function plant(type){
    if(!state.isDay) return say("Nacht: Kein Anbau.");
    if(!inFarm(state.player.x,state.player.y)) return say("Nur im Feld!");
    const {x,y}=snapToTile(state.player.x,state.player.y);
    if(state.plants.some(p=>p.x===x&&p.y===y)) return say("Hier wächst bereits etwas.");
    for(const b of state.blocks) if(Math.hypot(x-b.x,y-b.y)<T*0.5) return say("Blockiert.");
    if(type==="corn"){
      if(state.inv.poop<=0) return say("💩 fehlt.");
      state.inv.poop--; state.plants.push({x,y,type:"corn",plantedAt:performance.now(),readyAt:performance.now()+PLANTS.corn.growMs,watered:false,stage:0});
      say("🌱 Mais wächst…"); save();
    }else{
      if(state.inv.cabbageSeed<=0) return say("🥬-Saat fehlt.");
      state.inv.cabbageSeed--; state.plants.push({x,y,type:"cabbage",plantedAt:performance.now(),readyAt:performance.now()+PLANTS.cabbage.growMs,watered:false,stage:0});
      say("🌱 Kohl wächst…"); save();
    }
  }
  function water(){
    if(!state.inv.hasCan) return say("Keine Gießkanne.");
    if(state.inv.can<=0) return say("Gießkanne leer.");
    const p=findNearbyPlant(); if(!p) return say("Geh näher an die Pflanze.");
    if(p.stage>=3) return say("Schon reif."); if(p.watered) return say("Schon gegossen.");
    p.watered=true;
    if(p.type==="corn"){ p.readyAt=Math.max(performance.now()+10000, p.readyAt-30000); say("💧 Mais: -30s"); }
    else { p.readyAt=p.plantedAt+PLANTS.cabbage.wateredTotalMs; say("💧 Kohl: Gesamtzeit 40s"); }
    state.inv.can--; save();
  }
  function harvest(){
    const p=findNearbyPlant(); if(!p) return;
    if(p.stage<3) return say("Noch nicht reif.");
    if(p.type==="corn"){ if(rnd()<PLANTS.corn.chance){ state.inv.corn++; say("🌽 +1"); } else say("🌽 Ernte fehlgeschlagen."); }
    else state.inv.cabbage++, say("🥬 +1");
    state.plants.splice(state.plants.indexOf(p),1); save();
  }
  function updatePlants(){
    const now=performance.now();
    for(const p of state.plants){
      const total=(p.type==="corn")?PLANTS.corn.growMs:(p.watered?PLANTS.cabbage.wateredTotalMs:PLANTS.cabbage.growMs);
      const prog=clamp(1-((p.readyAt-now)/total),0,1);
      p.stage = prog<0.33?0 : prog<0.66?1 : prog<0.99?2 : 3;
    }
  }

  // ----- Stones/Dirts/Blocks -----
  const STONE_R=T*0.36;
  function drawStone(x,y){ ellipse(x,y,STONE_R,STONE_R*0.78,"#b9c2cc"); ellipse(x-T*0.12,y-T*0.08,T*0.12,T*0.09,"#88929e"); }
  function drawDirt(x,y){ ellipse(x,y,T*0.32,T*0.24,"#7a5a3a"); ellipse(x+T*0.10,y-T*0.06,T*0.10,T*0.07,"#5d452d"); }
  function nearestLooseStoneIndex(){ let i=-1,bd=1e9; for(let k=0;k<state.stones.length;k++){ const s=state.stones[k]; const d=dist(state.player.x,state.player.y,s.x,s.y); if(d<T*0.7&&d<bd){i=k;bd=d;} } return i; } // 0.7 statt 0.9
  function nearestDirtIndex(){ let i=-1,bd=1e9; for(let k=0;k<state.dirts.length;k++){ const s=state.dirts[k]; const d=dist(state.player.x,state.player.y,s.x,s.y); if(d<T*0.7&&d<bd){i=k;bd=d;} } return i; }   // 0.7
  function nearestBlockIndex(){ let i=-1,bd=1e9; for(let k=0;k<state.blocks.length;k++){ const b=state.blocks[k]; const d=dist(state.player.x,state.player.y,b.x,b.y); if(d<T*0.7&&d<bd){i=k;bd=d;} } return i; }   // 0.7
  function canPlaceStone(px,py){
    if(rectsOverlap({x:px-T*0.5,y:py-T*0.5,w:T,h:T},POND)) return false;
    if(Math.hypot(px-state.player.x,py-state.player.y)<state.player.r+STONE_R+6) return false;
    for(const b of state.blocks) if(Math.hypot(px-b.x,py-b.y)<STONE_R*2) return false;
    for(const s of state.stones) if(Math.hypot(px-s.x,py-s.y)<STONE_R*2) return false;
    for(const d of state.dirts)  if(Math.hypot(px-d.x,py-d.y)<STONE_R*2) return false;
    for(const p of state.plants) if(Math.hypot(px-p.x,py-p.y)<STONE_R*2) return false;
    return true;
  }

  // ----- Monsters + Slingshot -----
  function getSafeZoneRect(){
    if (!state.shackBuilt) return null;
    const c = state.clear;
    const w = T*1.8, h = T*1.2;
    return { x: c.x + c.w/2 - w/2, y: c.y + c.h/2 - h/2, w, h };
  }
  let monsterRespawnTimer = 0;
  function maintainMonsters(dt){
    if (!state.isDay){
      monsterRespawnTimer -= dt;
      const target = 4;
      if (state.monsters.length < target && monsterRespawnTimer <= 0){
        let tries=200;
        while(tries--){
          const tx=Math.floor(rnd()*MAP_W), ty=Math.floor(rnd()*MAP_H);
          const x=tx*T+T/2, y=ty*T+T/2;
          const r={x:x-T*0.5,y:y-T*0.5,w:T,h:T};
          if(rectsOverlap(r,POND)||rectsOverlap(r,state.farm)||rectsOverlap(r,state.clear)) { tries--; continue; }
          if(dist(x,y,state.player.x,state.player.y)<T*8) { tries--; continue; }
          state.monsters.push({x,y,hp:2});
          break;
        }
        monsterRespawnTimer = 2000; // alle 2s versuchen
      }
    } else {
      state.monsters.length = 0;
      monsterRespawnTimer = 0;
    }
  }
  function fireTowards(tx,ty){
    if(state.inv.stone<=0) return say("Keine Steine!");
    state.inv.stone--;
    const dx=tx-state.player.x, dy=ty-state.player.y, m=Math.hypot(dx,dy)||1;
    const speed = 8.0; // px/frame
    state.bullets.push({ x:state.player.x, y:state.player.y, vx:dx/m*speed, vy:dy/m*speed, life:90 });
    if(SFX)SFX.play("shoot"); save();
  }
  function fireAtNearestMonster(){
    let best=null,bd=1e9;
    for(const mo of state.monsters){ const d=dist(state.player.x,state.player.y,mo.x,mo.y); if(d<bd){bd=d;best=mo;} }
    if(!best) return say("Kein Ziel.");
    fireTowards(best.x,best.y);
  }

  // ----- Input -----
  const keys=new Set();
  window.addEventListener('keydown', e=>keys.add(e.key.toLowerCase()));
  window.addEventListener('keyup',   e=>keys.delete(e.key.toLowerCase()));
  cv.addEventListener('pointerdown', e=>{
    const r=cv.getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top;

    // Kontext
    if(dist(x,y,ui.ctxBtn.x,ui.ctxBtn.y)<=ui.ctxBtn.r){ if(ui.ctxBtn.enabled&&ui.ctxBtn.action) ui.ctxBtn.action(); return; }
    // Joystick
    if(dist(x,y,ui.joy.cx,ui.joy.cy)<=ui.joy.r){ ui.joy.active=true; ui.joy.id=e.pointerId; const dx=x-ui.joy.cx,dy=y-ui.joy.cy,m=Math.hypot(dx,dy),s=Math.min(1,m/(ui.joy.r-8)); ui.joy.vx=(m<8?0:dx/m)*s; ui.joy.vy=(m<8?0:dy/m)*s; return; }
    // HUD – Slot-Auswahl
    if (y >= HUD_Y && y <= HUD_Y + HUD_H){
      for(const rect of hudSlotRects){ if(x>=rect.x && x<=rect.x+rect.w && y>=rect.y && y<=rect.y+rect.h){ state.uiSeed = rect.key; if(SFX)SFX.play("ui"); return; } }
    }
    // Schießen: Tap auf Map (wenn Monster existiert und Steine da sind)
    if (state.monsters.length>0 && state.inv.stone>0){ fireTowards(x,y); return; }

    if(ui.tutorial) ui.tutorial=false;
  });
  cv.addEventListener('pointermove', e=>{
    if(!ui.joy.active||e.pointerId!==ui.joy.id) return;
    const r=cv.getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top;
    const dx=x-ui.joy.cx, dy=y-ui.joy.cy, m=Math.hypot(dx,dy), s=Math.min(1,m/(ui.joy.r-8));
    ui.joy.vx=(m<8?0:dx/m)*s; ui.joy.vy=(m<8?0:dy/m)*s;
  });
  window.addEventListener('pointerup', e=>{
    if(ui.joy.active && e.pointerId===ui.joy.id){ ui.joy.active=false; ui.joy.id=null; ui.joy.vx=ui.joy.vy=0; }
  });

  // ----- Kollisionen (Zaun/Häuser) -----
  const FRED_POS   = toPx(NPCS.find(n=>n.id==="fred").x,   NPCS.find(n=>n.id==="fred").y);
  const STEFAN_POS = toPx(NPCS.find(n=>n.id==="stefan").x, NPCS.find(n=>n.id==="stefan").y);
  const FRED_HOUSE   = { x: FRED_POS.x - T*1.0,   y: FRED_POS.y - T*0.6, w: T*2.0, h: T*1.2 };
  const STEFAN_HOUSE = { x: STEFAN_POS.x - T*0.9, y: STEFAN_POS.y - T*0.9, w: T*1.8, h: T*1.1 };

  function fenceBlocks(rect){
    const f = state.farm;
    const gateW = T*1.2, gateC = f.x + f.w/2, gateL = gateC - gateW/2, gateR = gateC + gateW/2;
    const overlapX = !(rect.x + rect.w < f.x || rect.x > f.x + f.w);
    const hitsTop   = rect.y < f.y && rect.y + rect.h > f.y && overlapX;
    const hitsLeft  = rect.x < f.x && rect.x + rect.w > f.x && rect.y < f.y + f.h && rect.y + rect.h > f.y;
    const hitsRight = rect.x < f.x + f.w && rect.x + rect.w > f.x + f.w && rect.y < f.y + f.h && rect.y + rect.h > f.y;
    let hitsBottom = false;
    const onBottomEdge = rect.y + rect.h > f.y + f.h - 3 && rect.y < f.y + f.h + 3;
    if (onBottomEdge && overlapX){
      const midL = Math.max(rect.x, f.x);
      const midR = Math.min(rect.x + rect.w, f.x + f.w);
      const throughGate = !(midR <= gateL || midL >= gateR);
      hitsBottom = !throughGate;
    }
    return hitsTop || hitsLeft || hitsRight || hitsBottom;
  }

  // ----- Player movement -----
  function updatePlayer(){
    let dx=0,dy=0;
    if(keys.has('w')||keys.has('arrowup'))dy-=1;
    if(keys.has('s')||keys.has('arrowdown'))dy+=1;
    if(keys.has('a')||keys.has('arrowleft'))dx-=1;
    if(keys.has('d')||keys.has('arrowright'))dx+=1;
    dx += ui.joy.vx*2.5; dy += ui.joy.vy*2.5;
    const len=Math.hypot(dx,dy);
    if(len>0){
      const vx=dx/len, vy=dy/len;
      state.player.dir = Math.abs(vx)>Math.abs(vy)?(vx<0?"left":"right"):(vy<0?"up":"down");
      const sp=3.6*state.speedMult;
      let nx=clamp(state.player.x+vx*sp, T/2, MAP_W*T-T/2);
      let ny=clamp(state.player.y+vy*sp, T/2, MAP_H*T-T/2);
      const RX={x:nx-T*0.5,y:state.player.y-T*0.5,w:T,h:T}, RY={x:state.player.x-T*0.5,y:ny-T*0.5,w:T,h:T};
      let bx=false,by=false;
      for(const b of state.blocks){ const r={x:b.x-T*0.5,y:b.y-T*0.5,w:T,h:T}; if(rectsOverlap(RX,r))bx=true; if(rectsOverlap(RY,r))by=true; if(bx&&by)break; }
      if(rectsOverlap(RX,POND))bx=true; if(rectsOverlap(RY,POND))by=true;
      if(rectsOverlap(RX,FRED_HOUSE) || rectsOverlap(RX,STEFAN_HOUSE)) bx=true;
      if(rectsOverlap(RY,FRED_HOUSE) || rectsOverlap(RY,STEFAN_HOUSE)) by=true;
      if(fenceBlocks(RX)) bx=true;
      if(fenceBlocks(RY)) by=true;
      if(!bx) state.player.x=nx; if(!by) state.player.y=ny;
    }
    if (state.dmgCooldown>0) state.dmgCooldown--;
  }

  // ----- Kontextbutton -----
  function toolboxPos(){ return { x: state.clear.x + state.clear.w + T*1.5, y: state.clear.y + state.clear.h / 2 }; }
  function updateContext(){
    let icon="❓", enabled=false, action=null;

    if(dist(state.player.x,state.player.y,TUTORIAL.x,TUTORIAL.y)<T*0.9){
      icon="📜"; enabled=true; action=()=>{ ui.tutorial=true; };
    } else {
      const fred = toPx(NPCS.find(n=>n.id==="fred").x,   NPCS.find(n=>n.id==="fred").y);
      const berta= toPx(NPCS.find(n=>n.id==="berta").x,  NPCS.find(n=>n.id==="berta").y);
      const stefan=toPx(NPCS.find(n=>n.id==="stefan").x, NPCS.find(n=>n.id==="stefan").y);
      if(dist(state.player.x,state.player.y,fred.x,fred.y)<T*1.2 && state.isDay){ icon="🛒"; enabled=true; action=()=>openShop('fred'); }
      else if(dist(state.player.x,state.player.y,berta.x,berta.y)<T*1.2 && state.isDay){ icon="🛒"; enabled=true; action=()=>openShop('berta'); }
      else if(dist(state.player.x,state.player.y,stefan.x,stefan.y)<T*1.2){ icon="🧙‍♂️"; enabled=true; action=()=>openShop('stefan'); }
      else if(dist(state.player.x,state.player.y,POND.x+POND.w/2,POND.y+POND.h/2)<T*2.0){
        icon="💧"; enabled=state.inv.hasCan; action=()=>{ if(!state.inv.hasCan) return say("Keine Gießkanne."); state.inv.can=state.inv.canMax; save(); say("💧 Gießkanne aufgefüllt!"); };
      } else if(dist(state.player.x,state.player.y,toolboxPos().x,toolboxPos().y)<T*0.9){
        icon="🧰"; enabled=true; action=()=>openUpgradeShop();
      } else {
        // ---- Platzieren priorisieren, wenn Stein gewählt ----
        const g = snapToTile(state.player.x, state.player.y);
        if (state.uiSeed === "stone" && state.inv.stone > 0 && canPlaceStone(g.x, g.y)) {
          icon = "📦"; enabled = true; action = () => {
            state.inv.stone--;
            state.blocks.push({ x: g.x, y: g.y });
            save();
            if (SFX) SFX.play("drop");
          };
        } else {
          // Pflanzen / Gießen / Ernten
          const p=findNearbyPlant();
          if(p && p.stage>=3){ icon="🌾"; enabled=true; action=harvest; }
          else if(p && p.stage<3 && state.inv.hasCan && state.inv.can>0 && !p.watered){ icon="💧"; enabled=true; action=water; }
          else {
            // Entfernen/Aufheben – geringere Priorität
            const bi=nearestBlockIndex();
            if(bi>=0){ icon="🪨"; enabled=true; action=()=>{ state.blocks.splice(bi,1); state.inv.stone++; save(); if(SFX)SFX.play("pickup"); }; }
            else {
              const si=nearestLooseStoneIndex();
              if(si>=0){ icon="🪨"; enabled=true; action=()=>{ state.stones.splice(si,1); state.inv.stone++; save(); if(SFX)SFX.play("pickup"); }; }
              else {
                const di=nearestDirtIndex();
                if(di>=0){ icon="🪵"; enabled=true; action=()=>{ state.dirts.splice(di,1); const chance=0.10+rnd()*0.05; if(rnd()<chance){ state.inv.poop++; say("💩 Glück gehabt!"); } else { say("🪵 Erdbrocken."); } save(); if(SFX)SFX.play("pickup"); }; }
                else {
                  // Pflanzen-Shortcuts, falls Tag und im Feld
                  if(state.isDay && inFarm(g.x,g.y)){
                    if(state.uiSeed==="poop" && state.inv.poop>0){ icon="💩"; enabled=true; action=()=>plant("corn"); }
                    else if(state.uiSeed==="cabbageSeed" && state.inv.cabbageSeed>0){ icon="🥬"; enabled=true; action=()=>plant("cabbage"); }
                    else { icon="🚫"; enabled=false; }
                  } else if(state.monsters.length>0 && state.inv.stone>0){
                    icon="🎯"; enabled=true; action=fireAtNearestMonster;
                  } else {
                    icon="🚫"; enabled=false;
                  }
                }
              }
            }
          }
        }
      }
    }
    ui.ctxBtn.icon=icon; ui.ctxBtn.enabled=enabled; ui.ctxBtn.action=action;
  }

  // ----- Shops/Cheat/Upgrades -----
  const backdrop=document.getElementById("backdrop");
  const modal=document.getElementById("modal");
  const mList=document.getElementById("m_list");
  const mTitle=document.getElementById("m_title");
  const mSub=document.getElementById("m_sub");
  const mPortrait=document.getElementById("m_portrait");
  const mClose=document.getElementById("m_close");
  function openModal(){ backdrop.classList.add("open"); modal.classList.add("open"); }
  function closeModal(){ modal.classList.remove("open"); backdrop.classList.remove("open"); }
  mClose.onclick=closeModal; backdrop.onclick=closeModal;

  function addRow({icon,name,desc,price,button,disabled,onClick}){
    const row=document.createElement('div'); row.className="item";
    row.innerHTML=`<div class="iic">${icon}</div>
      <div class="ibody"><div class="iname">${name}</div><div class="idesc">${desc||""}</div></div>
      <div class="iprice">${price||""}</div>`;
    const btn=document.createElement('button'); btn.className="ghost"; btn.textContent=button||"OK";
    if(disabled) btn.disabled=true; btn.onclick=onClick||(()=>{});
    const col=document.createElement('div'); col.style.display="flex"; col.style.alignItems="center"; col.style.gap="10px";
    col.appendChild(btn); row.appendChild(col); mList.appendChild(row);
  }

  function openShop(kind){
    mList.innerHTML="";
    if(kind==='fred'){
      mPortrait.textContent="🧑‍🌾"; mTitle.textContent="Fecalfred"; mSub.textContent="Tags: Handel & Saat";
      addRow({icon:"🔁", name:"10 🪨 → 1 💩", desc:"Steine zu Dünger.", price:"—", button:"Tauschen", disabled: state.inv.stone<ECON.stoneToPoop,
        onClick:()=>{ state.inv.stone-=ECON.stoneToPoop; state.inv.poop++; save(); openShop('fred'); }});
      addRow({icon:"🥬", name:"Kohl-Saat", desc:"Für dein Feld.", price:"4 €", button:"Kaufen", disabled: state.inv.euro<4,
        onClick:()=>{ state.inv.euro-=4; state.inv.cabbageSeed++; save(); openShop('fred'); }});
      addRow({icon:"🌽", name:"Mais verkaufen", desc:"+1 €", price:"+1 €", button:"Verkaufen", disabled: state.inv.corn<1,
        onClick:()=>{ state.inv.corn--; state.inv.euro+=ECON.cornSell; save(); openShop('fred'); }});
      addRow({icon:"🥬", name:"Kohl verkaufen", desc:"+7 €", price:"+7 €", button:"Verkaufen", disabled: state.inv.cabbage<1,
        onClick:()=>{ state.inv.cabbage--; state.inv.euro+=ECON.cabbageSell; save(); openShop('fred'); }});
    } else if(kind==='berta'){
      mPortrait.textContent="👩‍🎨"; mTitle.textContent="Berta Brown"; mSub.textContent="Upgrades (Tag)";
      addRow({icon:"💧", name:"Gießkanne", desc:"Permanent. 13 Nutzungen. Am Teich auffüllen.", price:"5 €", button: state.inv.hasCan?"Gekauft":"Kaufen",
        disabled: state.inv.hasCan || state.inv.euro<5, onClick:()=>{ state.inv.hasCan=true; state.inv.can=state.inv.canMax; state.inv.euro-=5; save(); openShop('berta'); }});
      addRow({icon:"👟", name:"Schnelle Schuhe", desc:"+35% Laufgeschwindigkeit", price:"7 €", button: state.inv.hasShoes?"Gekauft":"Kaufen",
        disabled: state.inv.hasShoes || state.inv.euro<7, onClick:()=>{ state.inv.hasShoes=true; state.speedMult=1.35; state.inv.euro-=7; save(); openShop('berta'); }});
    } else {
      mPortrait.textContent="🧙‍♂️"; mTitle.textContent="Stefan Spielverderber"; mSub.textContent="Tests & Cheats";
      addRow({icon:"💶", name:"+50 €", button:"+50", onClick:()=>{ state.inv.euro+=50; save(); openShop('stefan'); }});
      addRow({icon:"🪨", name:"+20 Steine", button:"+20", onClick:()=>{ state.inv.stone+=20; save(); openShop('stefan'); }});
      addRow({icon:"💩", name:"+10 Poop",  button:"+10", onClick:()=>{ state.inv.poop+=10; save(); openShop('stefan'); }});
      addRow({icon:"🥬", name:"+10 Kohlsaat", button:"+10", onClick:()=>{ state.inv.cabbageSeed+=10; save(); openShop('stefan'); }});
      addRow({icon: state.god?"🛡️":"🗡️", name:"Godmode", button: state.god?"AUS":"AN", onClick:()=>{ state.god=!state.god; save(); openShop('stefan'); }});
      addRow({icon:"⏱️", name:"Zeit x0.5", button:"x0.5", onClick:()=>{ state.timeScale=0.5; save(); }});
      addRow({icon:"⏱️", name:"Zeit x1.5", button:"x1.5", onClick:()=>{ state.timeScale=1.5; save(); }});
      addRow({icon:"⏱️", name:"Zeit x2",   button:"x2",   onClick:()=>{ state.timeScale=2; save(); }});
      addRow({icon:"⏱️", name:"Zeit x3",   button:"x3",   onClick:()=>{ state.timeScale=3; save(); }});
      addRow({icon:"🌞", name:"Zu Tag",    button:"Tag",  onClick:()=>{ state.dayBase = performance.now(); save(); }});
      addRow({icon:"🌙", name:"Zu Nacht",  button:"Nacht",onClick:()=>{ state.dayBase = performance.now() - (DAYLIGHT_MS-1); save(); }});
    }
    openModal();
  }

  function openUpgradeShop(){
    mList.innerHTML="";
    mPortrait.textContent="🧰"; mTitle.textContent="Werkzeugkasten"; mSub.textContent="Bau & Upgrades";

    addRow({
      icon:"🏚️", name:"Broken Shack", desc:"Hütte: Safe-Zone in der Nacht.",
      price:"50 €", button: state.shackBuilt?"Bereits gebaut":"Bauen",
      disabled: state.shackBuilt || state.inv.euro<50,
      onClick:()=>{ state.inv.euro-=50; state.shackBuilt=true; save(); openUpgradeShop(); }
    });
    addRow({
      icon:"🌾", name:"Feld erweitern", desc:"+2 Tiles Breite",
      price:"30 €", button:"Erweitern",
      disabled: state.inv.euro<30 || state.farm.x+state.farm.w+T*2 > MAP_W*T - T,
      onClick:()=>{ state.inv.euro-=30; state.farm.w += T*2; save(); openUpgradeShop(); }
    });
    addRow({
      icon:"🌳", name:"Lichtung erweitern", desc:"+2×1 Tiles",
      price:"30 €", button:"Erweitern",
      disabled: state.inv.euro<30 || state.clear.x+state.clear.w+T*2 > MAP_W*T - T || state.clear.y+state.clear.h+T > MAP_H*T - T,
      onClick:()=>{ state.inv.euro-=30; state.clear.w += T*2; state.clear.h += T*1; save(); openUpgradeShop(); }
    });

    openModal();
  }

  // ----- Tutorial Schild -----
  function drawTutorialSign(){
    const x=TUTORIAL.x, y=TUTORIAL.y;
    ctx.fillStyle="#8b5a2b";
    ctx.fillRect(x - T*0.06, y - T*0.5, T*0.12, T*0.9);
    const w=T*1.2,h=T*0.45;
    ctx.fillStyle="#f0e9d6";
    ctx.fillRect(x - w/2, y - T*0.65, w, h);
    ctx.strokeStyle="#856d45"; ctx.strokeRect(x - w/2+0.5, y - T*0.65+0.5, w-1, h-1);
    ctx.fillStyle="#333"; ctx.font=`bold ${Math.floor(T*0.28)}px system-ui`;
    ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText("INFO", x, y - T*0.43);
    ctx.textAlign="left"; ctx.textBaseline="alphabetic";
  }

  // ----- Toast -----
  const TOAST={t:0,text:""}; function say(s){ TOAST.text=s; TOAST.t=1.6; }

  // ----- Monsters Update -----
  function updateMonsters(){
    const speed = 3.6*state.speedMult*0.5;
    const safe = getSafeZoneRect();
    for (let i=state.monsters.length-1;i>=0;i--){
      const m = state.monsters[i];
      if (!state.isDay){
        const dx = state.player.x - m.x, dy = state.player.y - m.y, L = Math.hypot(dx,dy)||1;
        let nx = m.x + (dx/L)*speed, ny = m.y + (dy/L)*speed;

        const RX={x:nx-T*0.5,y:m.y-T*0.5,w:T,h:T}, RY={x:m.x-T*0.5,y:ny-T*0.5,w:T,h:T};
        let bx=false,by=false;
        for(const b of state.blocks){ const r={x:b.x-T*0.5,y:b.y-T*0.5,w:T,h:T}; if(rectsOverlap(RX,r))bx=true; if(rectsOverlap(RY,r))by=true; if(bx&&by)break; }
        if(rectsOverlap(RX,POND))bx=true; if(rectsOverlap(RY,POND))by=true;
        if(rectsOverlap(RX,FRED_HOUSE) || rectsOverlap(RX,STEFAN_HOUSE)) bx=true;
        if(rectsOverlap(RY,FRED_HOUSE) || rectsOverlap(RY,STEFAN_HOUSE)) by=true;
        if(fenceBlocks(RX)) bx=true; if(fenceBlocks(RY)) by=true;
        if(safe && rectsOverlap(RX,safe)) bx=true;
        if(safe && rectsOverlap(RY,safe)) by=true;
        if(!bx) m.x=nx; if(!by) m.y=ny;

        const d = dist(m.x,m.y,state.player.x,state.player.y);
        if (d < T*0.7){
          if(!state.god && state.dmgCooldown<=0){
            state.hearts = Math.max(0, state.hearts-1);
            state.dmgCooldown = 220;
            const kx = (state.player.x - m.x) / (d||1), ky=(state.player.y - m.y)/(d||1);
            state.player.x += kx * T*1.2; state.player.y += ky * T*1.2;
            if (SFX){ SFX.play("hit"); SFX.play("deny"); }
            say("💢 Aua! -1 ❤");
            if (state.hearts<=0){ state.hearts=3; spawnPlayer(); say("Neu gestartet."); }
          }
        }
      } else {
        state.monsters.splice(i,1);
      }
    }
  }

  // ----- Bullets -----
  function updateBullets(){
    for (let i=state.bullets.length-1;i>=0;i--){
      const b = state.bullets[i];
      b.x += b.vx; b.y += b.vy; b.life--;
      if (b.life<=0){ state.bullets.splice(i,1); continue; }
      if (b.x<0||b.y<0||b.x>MAP_W*T||b.y>MAP_H*T){ state.bullets.splice(i,1); continue; }
      for (let j=state.monsters.length-1;j>=0;j--){
        const m = state.monsters[j];
        if (dist(b.x,b.y,m.x,m.y) < T*0.4){
          if(SFX)SFX.play("hit");
          m.hp--; state.bullets.splice(i,1);
          if (m.hp<=0){ if(SFX)SFX.play("kill"); dropFromMonster(m.x,m.y); state.monsters.splice(j,1); }
          break;
        }
      }
    }
  }
  function dropFromMonster(x,y){
    const r=rnd();
    if (r<0.33) state.inv.poop++;
    else if (r<0.66) state.inv.cabbageSeed++;
    else state.inv.euro += 1 + Math.floor(rnd()*3);
    save();
  }

  // ----- Draw world -----
  function drawBG(){
    const a=state.isDay?"#13481e":"#0a2a14", b=state.isDay?"#0f3a18":"#092412";
    for(let y=0;y<MAP_H*T;y+=T) for(let x=0;x<MAP_W*T;x+=T){ ctx.fillStyle=(((x+y)/T)%2===0)?a:b; ctx.fillRect(x,y,T,T); }
  }
  function drawFence(){
    const f=state.farm;
    ctx.fillStyle="rgba(120,220,140,0.14)"; ctx.fillRect(f.x,f.y,f.w,f.h);
    ctx.strokeStyle="#916c3b"; ctx.lineWidth=4;
    const gw=T*1.2, gc=f.x+f.w/2, gl=gc-gw/2, gr=gc+gw/2;
    ctx.beginPath(); ctx.moveTo(f.x,f.y); ctx.lineTo(f.x+f.w,f.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(f.x,f.y+f.h); ctx.lineTo(gl,f.y+f.h); ctx.moveTo(gr,f.y+f.h); ctx.lineTo(f.x+f.w,f.y+f.h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(f.x,f.y); ctx.lineTo(f.x,f.y+f.h); ctx.moveTo(f.x+f.w,f.y); ctx.lineTo(f.x+f.w,f.y+f.h); ctx.stroke();
  }
  function drawClearing(){ const c=state.clear; ctx.fillStyle="#1a5a2d"; ctx.fillRect(c.x,c.y,c.w,c.h); ctx.strokeStyle="rgba(180,220,150,0.35)"; ctx.strokeRect(c.x,c.y,c.w,c.h); }
  function drawPond(){
    const cx=POND.x+POND.w/2, cy=POND.y+POND.h/2, rx=POND.w*0.48, ry=POND.h*0.46;
    ctx.fillStyle="#1b4d6b"; ctx.beginPath(); ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle="rgba(180,220,255,0.3)"; ctx.lineWidth=2;
    for(let i=1;i<=4;i++){ ctx.beginPath(); ctx.ellipse(cx,cy, rx*i/4, ry*i/4, 0, 0, Math.PI*2); ctx.stroke(); }
  }
  function drawFred(){
    const n=NPCS.find(n=>n.id==="fred"); const p=toPx(n.x,n.y); const hx=p.x-T, hy=p.y-T;
    ctx.fillStyle="#6b4630"; ctx.fillRect(hx-T*0.5,hy-T*0.5,T*2,T*1.6);
    ctx.fillStyle="#9b3b2e"; ctx.fillRect(hx-T*0.6,hy-T*1.0,T*2.4,T*0.45);
    ctx.fillStyle="#2b1c11"; ctx.fillRect(hx+T*0.2,hy+T*0.6,T*0.5,T*0.7);
    const w=T*2.6,h=T*0.7; ctx.fillStyle="#f8f5e7"; ctx.fillRect(p.x-w/2,hy+T*1.25,w,h);
    ctx.fillStyle="#2b2b2b"; ctx.font=`bold ${Math.floor(T*0.34)}px system-ui`; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText("FECALFRED", p.x, hy + T*1.25 + h/2); ctx.textAlign="left"; ctx.textBaseline="alphabetic";
  }
  function drawBerta(){
    const n=NPCS.find(n=>n.id==="berta"); const p=toPx(n.x,n.y);
    ctx.fillStyle="#8b5a2b"; ctx.fillRect(p.x-T*0.8,p.y-T*0.6,T*0.15,T*1.3); ctx.fillRect(p.x+T*0.65,p.y-T*0.6,T*0.15,T*1.3);
    ctx.fillStyle="#f0e0c0"; ctx.fillRect(p.x-T*0.5,p.y-T*0.9,T*1.1,T*0.8);
    ctx.fillStyle="#f8f5e7"; ctx.fillRect(p.x-T*1.2,p.y+T*0.8,T*2.4,T*0.45);
    ctx.fillStyle="#2b2b2b"; ctx.font=`bold ${Math.floor(T*0.32)}px system-ui`; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText("BERTA BROWN", p.x, p.y+T*1.02); ctx.textAlign="left"; ctx.textBaseline="alphabetic";
  }
  function drawStefan(){
    const n=NPCS.find(n=>n.id==="stefan"); const p=toPx(n.x,n.y);
    ctx.fillStyle="#9c7a00"; ctx.fillRect(p.x-T*0.9,p.y-T*0.9,T*1.8,T*1.1);
    ctx.fillStyle="#ffd54a"; ctx.fillRect(p.x-T*1.2,p.y-T*1.25,T*2.4,T*0.5);
    ctx.fillStyle="#2b1c11"; ctx.fillRect(p.x-T*0.2,p.y-T*0.1,T*0.4,T*0.6);
    ctx.fillStyle="#f8f5e7"; ctx.fillRect(p.x-T*1.4,p.y+T*0.8,T*2.8,T*0.45);
    ctx.fillStyle="#2b2b2b"; ctx.font=`bold ${Math.floor(T*0.32)}px system-ui`; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText("STEFAN SPIELVERDERBER", p.x, p.y+T*1.02); ctx.textAlign="left"; ctx.textBaseline="alphabetic";
  }
  function drawToolbox(){ const p=toolboxPos(); const x=p.x,y=p.y; ctx.fillStyle="#2f3b48"; ctx.beginPath(); ctx.arc(x,y, T*0.28, 0, Math.PI*2); ctx.fill(); ctx.fillStyle="#d1e3ff"; ctx.font="bold 14px system-ui"; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText("🧰", x, y+1); ctx.textAlign="left"; ctx.textBaseline="alphabetic"; }
  function drawShack(){ if(!state.shackBuilt) return; const c=state.clear; const sx=c.x+c.w/2 - T*0.8, sy=c.y+c.h/2 - T*0.8; ctx.fillStyle="#5a4636"; ctx.fillRect(sx,sy,T*1.6,T*1.0); ctx.fillStyle="#a44b3a"; ctx.fillRect(sx - T*0.2, sy - T*0.45, T*2.0, T*0.45); ctx.fillStyle="#26180e"; ctx.fillRect(sx + T*0.6, sy + T*0.3, T*0.4, T*0.5); }

  function drawPlayer(){
    const p=state.player;
    ellipse(p.x,p.y,p.r,p.r,"#e6b35a");
    let fx=0,fy=0; if(p.dir==="left")fx=-1; else if(p.dir==="right")fx=1; else if(p.dir==="up")fy=-1; else fy=1;
    const sx=-fy, sy=fx, eR=p.r*0.11, off=6, ex=p.x+fx*(p.r*0.25), ey=p.y+fy*(p.r*0.25);
    ellipse(ex+sx*off, ey+sy*off, eR, eR, "#fff"); ellipse(ex-sx*off, ey-sy*off, eR, eR, "#fff");
    ellipse(ex+sx*off+fx*eR*0.6, ey+sy*off+fy*eR*0.6, eR*0.55, eR*0.55, "#111");
    ellipse(ex-sx*off+fx*eR*0.6, ey-sy*off+fy*eR*0.6, eR*0.55, eR*0.55, "#111");
  }
  function drawMonster(m){
    ellipse(m.x,m.y,T*0.36,T*0.33,"#6b1f1f");
    ctx.fillStyle="#111"; ctx.beginPath(); ctx.arc(m.x-6,m.y-4,3,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(m.x+6,m.y-4,3,0,Math.PI*2); ctx.fill();
  }

  // ----- HUD & Preview -----
  function drawHUD(){
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, HUD_Y, cv.clientWidth, HUD_H);

    hudSlotRects = [];
    for (let i=0; i<HUD_SLOTS.length; i++){
      const s = HUD_SLOTS[i];
      const bx = (10 + i*(HUD_SLOT_W+8));
      const by = HUD_SLOT_Y, bw = HUD_SLOT_W, bh = HUD_SLOT_H;

      const selected = state.uiSeed===s.key || (s.key===null && state.uiSeed===null);
      ctx.fillStyle = selected ? "rgba(37,99,235,.38)" : "rgba(255,255,255,.08)";
      ctx.fillRect(bx,by,bw,bh);
      ctx.strokeStyle = selected ? "#2563eb" : "rgba(255,255,255,.25)";
      ctx.strokeRect(bx+.5,by+.5,bw-1,bh-1);

      ctx.fillStyle="#fff"; ctx.font="18px system-ui";
      ctx.textAlign="left"; ctx.textBaseline="middle";
      ctx.fillText(s.icon, bx+10, by+bh/2+1);

      const cnt = s.key==="stone" ? state.inv.stone :
                  s.key==="poop" ? state.inv.poop :
                  s.key==="cabbageSeed" ? state.inv.cabbageSeed : "";
      if (cnt!==""){ ctx.font="bold 12px system-ui"; ctx.fillText(String(cnt), bx+36, by+bh/2+1); }
      hudSlotRects.push({x:bx,y:by,w:bw,h:bh,key:s.key});
    }
    ctx.textAlign="left"; ctx.textBaseline="alphabetic";

    let x=330,y=22;
    ctx.fillStyle="#fff"; ctx.font="bold 14px system-ui";
    ctx.fillText(`❤ ${state.hearts}`, x,y); x+=70;
    ctx.fillText(`🌽 ${state.inv.corn}`, x,y); x+=80;
    ctx.fillText(`🥬 ${state.inv.cabbage}`, x,y); x+=90;
    ctx.fillText(`💶 ${state.inv.euro}`, x,y); x+=90;
    if(state.inv.hasCan) ctx.fillText(`💧 ${state.inv.can}/${state.inv.canMax}`, x,y);

    const el=((performance.now()-state.dayBase)*state.timeScale)%DAY_TOTAL_MS;
    const hh=Math.floor((el/DAY_TOTAL_MS)*24), mm=Math.floor(((el/DAY_TOTAL_MS)*24-hh)*60);
    ctx.textAlign="right"; ctx.fillText(`${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')} ${state.isDay?'🌞':'🌙'}`, cv.clientWidth-12, y); ctx.textAlign="left";

    ctx.fillStyle="#ddd"; ctx.font="12px system-ui"; ctx.fillText(state.version, 10, cv.clientHeight-10);

    // joystick
    ctx.globalAlpha=.9; ellipse(ui.joy.cx,ui.joy.cy,ui.joy.r,ui.joy.r,"rgba(24,34,44,.55)");
    ellipse(ui.joy.cx,ui.joy.cy,ui.joy.r-6,ui.joy.r-6,"rgba(60,80,96,.18)");
    ellipse(ui.joy.cx+ui.joy.vx*(ui.joy.r-12), ui.joy.cy+ui.joy.vy*(ui.joy.r-12), 32,32, "#1f2937");
    ctx.globalAlpha=1;

    // context
    ellipse(ui.ctxBtn.x,ui.ctxBtn.y,ui.ctxBtn.r,ui.ctxBtn.r,ui.ctxBtn.enabled?"#2563eb":"#3b4551");
    ctx.fillStyle="#fff"; ctx.font="32px system-ui"; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(ui.ctxBtn.icon, ui.ctxBtn.x, ui.ctxBtn.y+2); ctx.textAlign="left"; ctx.textBaseline="alphabetic";

    if(TOAST.t>0){ ctx.fillStyle="rgba(0,0,0,.8)"; const tw=ctx.measureText(TOAST.text).width+22;
      ctx.fillRect((cv.clientWidth-tw)/2, cv.clientHeight-120, tw, 30);
      ctx.fillStyle="#fff"; ctx.font="bold 14px system-ui";
      ctx.fillText(TOAST.text, (cv.clientWidth-tw)/2+11, cv.clientHeight-100);
    }
  }
  function drawPreview(){
    if (state.uiSeed !== "stone" || state.inv.stone <= 0) return;
    const g = tileCenterFromPx(state.player.x, state.player.y);
    const ok = canPlaceStone(g.x, g.y);
    ctx.globalAlpha = .6;
    ellipse(g.x, g.y, STONE_R, STONE_R*0.78, ok ? "rgba(56,189,248,.35)" : "rgba(239,68,68,.45)");
    ctx.globalAlpha = 1;
  }
  function drawTutorialOverlay(){
    if(!ui.tutorial) return;
    const lines=[
      "Steine: aufnehmen, platzieren, handeln, als Munition nutzen (Tippen).",
      "Platziertes blockiert Monster – und dich selbst.",
      "💩 → 🌽 (40s, 60%). 🥬-Saat → 🥬 (120s; Gießen → 40s).",
      "Gießkanne bei Berta, am Teich auffüllen."
    ];
    const W=Math.min(560,cv.clientWidth*0.9), H=Math.min(260,cv.clientHeight*0.6);
    const x=(cv.clientWidth-W)/2, y=(cv.clientHeight-H)/2;
    ctx.fillStyle="rgba(0,0,0,.6)"; ctx.fillRect(0,0,cv.clientWidth,cv.clientHeight);
    ctx.fillStyle="#0f141a"; ctx.fillRect(x,y,W,H);
    ctx.strokeStyle="#3a2a18"; ctx.lineWidth=2; ctx.strokeRect(x,y,W,H);
    ctx.fillStyle="#e7e5e4"; ctx.font="bold 18px system-ui"; ctx.fillText("Tutorial", x+16, y+28);
    ctx.font="14px system-ui"; ctx.fillStyle="#cbd5e1";
    let yy=y+56; for(const L of lines){ ctx.fillText(L, x+16, yy); yy+=22; }
    ctx.font="12px system-ui"; ctx.fillStyle="#9aa6b2"; ctx.fillText("Tippe außerhalb, um zu schließen", x+16, y+H-12);
  }

  // ----- Update/Draw Loop -----
  let lastT = performance.now();
  function update(){
    const now = performance.now();
    const dt = now - lastT; lastT = now;

    updateDay(); updatePlants(); updatePlayer(); updateContext();
    maintainMonsters(dt);
    updateMonsters(); updateBullets();
    if(TOAST.t>0){ TOAST.t-=dt/1000; if(TOAST.t<0) TOAST.t=0; }
  }
  function draw(){
    ctx.clearRect(0,0,cv.clientWidth,cv.clientHeight);
    drawBG();

    // Pickups GANZ hinten
    for(const s of state.stones) drawStone(s.x,s.y);
    for(const d of state.dirts)  drawDirt(d.x,d.y);

    drawClearing(); drawFence(); drawPond(); drawTutorialSign();
    drawFred(); drawBerta(); drawStefan(); drawToolbox(); drawShack();

    // Pflanzen
    for(const p of state.plants){
      if(p.type==="corn"){
        ctx.fillStyle="#382a1d"; ctx.beginPath(); ctx.arc(p.x,p.y,T*0.28,0,Math.PI*2); ctx.fill();
        if(p.stage===0){ ctx.fillStyle="#63d16e"; ctx.fillRect(p.x-T*0.08,p.y-T*0.10,T*0.16,T*0.10); }
        else if(p.stage===1){ ctx.fillStyle="#58b368"; ctx.fillRect(p.x-T*0.12,p.y-T*0.20,T*0.24,T*0.22); }
        else if(p.stage===2){ ctx.save(); ctx.translate(p.x,p.y); ctx.fillStyle="#f2d24b"; ctx.beginPath(); ctx.ellipse(0,-T*0.05,T*0.10,T*0.20,0,0,Math.PI*2); ctx.fill(); ctx.fillStyle="#5cbc6b"; ctx.beginPath(); ctx.moveTo(-T*0.18,0); ctx.quadraticCurveTo(0,-T*0.30,T*0.18,0); ctx.quadraticCurveTo(0,T*0.05,-T*0.18,0); ctx.fill(); ctx.restore(); }
        else { ctx.save(); ctx.translate(p.x,p.y); ctx.fillStyle="#f2d24b"; ctx.beginPath(); ctx.ellipse(0,-T*0.05,T*0.16,T*0.26,0,0,Math.PI*2); ctx.fill(); ctx.fillStyle="#5cbc6b"; ctx.beginPath(); ctx.moveTo(-T*0.22,0); ctx.quadraticCurveTo(0,-T*0.35,T*0.22,0); ctx.quadraticCurveTo(0,T*0.05,-T*0.22,0); ctx.fill(); ctx.restore(); }
      } else {
        ctx.fillStyle="#352519"; ctx.beginPath(); ctx.arc(p.x,p.y,T*0.28,0,Math.PI*2); ctx.fill();
        if(p.stage===0){ ctx.fillStyle="#4e8f4e"; ctx.beginPath(); ctx.arc(p.x,p.y,T*0.10,0,Math.PI*2); ctx.fill(); }
        else if(p.stage===1){ ctx.fillStyle="#4fa65b"; ctx.beginPath(); ctx.arc(p.x,p.y,T*0.16,0,Math.PI*2); ctx.fill(); ctx.fillStyle="#3d7f43"; ctx.beginPath(); ctx.arc(p.x-6,p.y-2,5,0,Math.PI*2); ctx.fill(); ctx.arc(p.x+6,p.y+3,4,0,Math.PI*2); ctx.fill(); }
        else if(p.stage===2){ ctx.fillStyle="#58bb68"; ctx.beginPath(); ctx.arc(p.x,p.y,T*0.22,0,Math.PI*2); ctx.fill(); ctx.fillStyle="#3d944a"; ctx.beginPath(); ctx.arc(p.x-8,p.y,6,0,Math.PI*2); ctx.fill(); ctx.arc(p.x+8,p.y,6,0,Math.PI*2); ctx.fill(); }
        else { ctx.fillStyle="#6bd17a"; ctx.beginPath(); ctx.arc(p.x,p.y,T*0.26,0,Math.PI*2); ctx.fill(); ctx.fillStyle="#44a457"; ctx.beginPath(); ctx.arc(p.x-9,p.y-2,7,0,Math.PI*2); ctx.fill(); ctx.arc(p.x+9,p.y+2,7,0,Math.PI*2); ctx.fill(); }
      }
    }

    for(const m of state.monsters) drawMonster(m);
    ctx.fillStyle="#cbd5e1";
    for(const b of state.bullets){ ctx.beginPath(); ctx.arc(b.x,b.y,4,0,Math.PI*2); ctx.fill(); }

    drawPlayer();

    ctx.globalCompositeOperation='lighter';
    for(let i=FX.length-1;i>=0;i--){ const p=FX[i]; p.x+=p.vx; p.y+=p.vy; p.vx*=0.92; p.vy*=0.92; p.a*=0.96; p.t--; ctx.fillStyle=`rgba(240,220,180,${p.a})`; ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill(); if(p.t<=0||p.a<0.05) FX.splice(i,1); }
    ctx.globalCompositeOperation='source-over';
    if(!state.isDay){ ctx.fillStyle="rgba(0,0,0,.35)"; ctx.fillRect(0,0,cv.clientWidth,cv.clientHeight); }

    drawPreview(); drawHUD(); drawTutorialOverlay();
  }

  // ----- Save-Sauberkeit -----
  function cullOutOfWorld(){
    const min=T/2, maxX=MAP_W*T - T/2, maxY=MAP_H*T - T/2;
    state.stones = state.stones.filter(s => s.x>=min && s.x<=maxX && s.y>=min && s.y<=maxY);
    state.dirts  = state.dirts.filter(s => s.x>=min && s.x<=maxX && s.y>=min && s.y<=maxY);
    state.blocks = state.blocks.filter(b => b.x>=min && b.x<=maxX && b.y>=min && b.y<=maxY);
    state.plants = state.plants.filter(p => p.x>=min && p.x<=maxX && p.y>=min && p.y<=maxY);
  }

  // ----- Boot -----
  placeBertaBlockade();
  cullOutOfWorld();
  spawnPlayer();
  (function loop(){ update(); draw(); requestAnimationFrame(loop); })();
})();
