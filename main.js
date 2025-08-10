/* =========================================================================
   Poopboy v0.8.1
   - HUD zeigt 🌱🥬 (Kohlsamen)
   - Cheat "+10 Kohlsaat" -> inv.cabbageSeed
   - Map-Editor-Tisch (🗺️) nahe Stefan: Fred/Berta/Stefan, Feld, Lichtung,
     Teich, Felsenhof verschiebbar, Snap-to-Player, Speichern/Reset
   - Felsenhof größer/versetzt und frei platzierbar
   - Bertas Blockade-Felsen mit 2 Tiles Abstand; passt sich an, wenn Berta
     versetzt wird
   - Steinzerkleinerer sichtbar (Hackklotz + Axt) auf der Lichtung
   - Nacht/Monster weiterhin deaktiviert
   - BUGFIX: fehlende placementTargetCenter() + ellipse-Argumente
   ========================================================================= */
(() => {
  // ===== Canvas & UI =====
  const cv = document.getElementById("gameCanvas");
  const ctx = cv.getContext("2d", { alpha:false });

  const ui = {
    joy:{ cx:110, cy:110, r:68, knob:32, active:false, id:null, vx:0, vy:0 },
    ctxBtn:{ x:110, y:110, r:44, icon:"❓", enabled:false, action:null },
    restart:{ x:0, y:0, r:20 },
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
    ui.restart.x = cv.clientWidth - 28;
    ui.restart.y = 26;
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // ===== Helpers & Const =====
  const T= WORLD.TILE, MAP_W=WORLD.W, MAP_H=WORLD.H;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const dist=(ax,ay,bx,by)=>Math.hypot(ax-bx,ay-by);
  const toPx=(tx,ty)=>({x:tx*T,y:ty*T});
  const toRectPx=(r)=>({x:r.x*T,y:r.y*T,w:r.w*T,h:r.h*T});
  const rectsOverlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
  const ellipse=(x,y,rx,ry,color)=>{ ctx.fillStyle=color; ctx.beginPath(); ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2); ctx.fill(); };
  function tileCenterFromPx(x,y){ const tx=Math.floor(x/T), ty=Math.floor(y/T); return {x:tx*T+T/2, y:ty*T+T/2}; }

  // >>> NEW: Ziel-Kachel 1 Tile vor dem Spieler (für Platzierungs-Vorschau)
  function placementTargetCenter(){
    const c = tileCenterFromPx(state.player.x, state.player.y);
    let dx=0,dy=0;
    if(state.player.dir==="left") dx=-1;
    else if(state.player.dir==="right") dx=1;
    else if(state.player.dir==="up") dy=-1;
    else dy=1;
    return {
      x: clamp(c.x + dx*T, T/2, MAP_W*T - T/2),
      y: clamp(c.y + dy*T, T/2, MAP_H*T - T/2)
    };
  }

  // ===== Areas & NPCs (dynamisch im State) =====
  const baseFarm  = toRectPx(MAPDATA.farm);
  const baseClear = toRectPx(MAPDATA.clearing);
  const basePond  = toRectPx(MAPDATA.pondRect);

  const FRED_TILE   = NPCS.find(n=>n.id==="fred");
  const BERTA_TILE  = NPCS.find(n=>n.id==="berta");
  const STEFAN_TILE = NPCS.find(n=>n.id==="stefan");

  // ===== State =====
  const state={
    version: GAME_VERSION,
    player:{ x: baseClear.x + T*1.2, y: baseClear.y + baseClear.h/2, r:T*0.38, dir:"right" },
    inv:{
      poop:0, corn:0, cabbage:0, euro:0, cabbageSeed:0,
      hasCan:false, can:0, canMax:CAN_MAX, hasShoes:false,
      cart:false, hasCrusher:false, ammo:0
    },
    hearts:3, speedMult:1.0,
    isDay:true, prevIsDay:true, dayBase:performance.now(), timeScale:1.0, // Nacht off
    boulders:[], dirts:[], plants:[],
    monsters:[], bullets:[],
    carry:{ has:false },
    farm:{ ...baseFarm },
    clear:{ ...baseClear },
    pond:{ ...basePond },
    npcs:{
      fred:   toPx(FRED_TILE.x, FRED_TILE.y),
      berta:  toPx(BERTA_TILE.x, BERTA_TILE.y),
      stefan: toPx(STEFAN_TILE.x, STEFAN_TILE.y),
    },
    shackBuilt:false,
    rng:(Date.now() ^ 0x9e3779b9)>>>0,
    god:false,
    dmgCooldown:0,
    yard:{ count:0, upgraded:false },
    yardRect:null,
    editor:{ open:false, target:"fred", step:1 }
  };
  function rnd(){ let x=state.rng; x^=x<<13; x^=x>>>17; x^=x<<5; state.rng=x>>>0; return (x>>>0)/4294967296; }

  function recalcYard(){
    const p = state.npcs.fred;
    state.yardRect = { x: p.x + T*3.2, y: p.y - T*2.2, w: T*4, h: T*4 };
  }
  recalcYard();

  // ===== Save/Load + Sanitize =====
  function sanitizeInv() {
    const num = v => Number.isFinite(v) ? v : 0;
    state.inv.poop        = num(state.inv.poop);
    state.inv.corn        = num(state.inv.corn);
    state.inv.cabbage     = num(state.inv.cabbage);
    state.inv.cabbageSeed = num(state.inv.cabbageSeed);
    state.inv.euro        = num(state.inv.euro);
    state.inv.can         = num(state.inv.can);
    state.inv.canMax      = num(state.inv.canMax) || CAN_MAX;
    state.inv.ammo        = num(state.inv.ammo);
    state.yard.count      = num(state.yard.count);
  }

  function save(){
    try{
      localStorage.setItem("pb_save_v7", JSON.stringify({
        inv:state.inv, hearts:state.hearts, speedMult:state.speedMult, dayBase:state.dayBase, timeScale:state.timeScale,
        plants:state.plants, boulders:state.boulders, dirts:state.dirts,
        farm:state.farm, clear:state.clear, pond:state.pond,
        npcs:state.npcs, shackBuilt:state.shackBuilt,god:state.god, yard:state.yard, stamina:state.stamina, hasBed:state.hasBed, bed:state.bed}));
    }catch{}
  }
  (function load(){
    try{
      const d=JSON.parse(localStorage.getItem("pb_save_v7")||"null"); if(!d) return;
      if (d.inv) Object.assign(state.inv, d.inv);
      if (d.farm)  state.farm = d.farm;
      if (d.clear) state.clear = d.clear;
      if (d.pond)  state.pond = d.pond;
      if (d.npcs)  state.npcs = d.npcs;
      state.shackBuilt = !!d.shackBuilt;if (d.boulders) state.boulders = d.boulders;
      if (d.dirts)    state.dirts = d.dirts;
      if (d.plants)   state.plants = d.plants;
      if (d.yard)     state.yard = d.yard;
      if (d.stamina)  state.stamina = d.stamina;
      if (typeof d.hasBed!=="undefined") state.hasBed = d.hasBed;
      if (d.bed)      state.bed = d.bed;
      state.hearts = d.hearts ?? 3;
      state.speedMult = d.speedMult ?? 1.0;
      state.dayBase = d.dayBase ?? state.dayBase;
      state.timeScale = d.timeScale ?? 1.0;
      state.god = !!d.god;
    }catch{}
  })();
  sanitizeInv();
  recalcYard();

  // ===== FX & Spawn =====
  const FX=[]; function dust(x,y){ for(let i=0;i<10;i++){ const a=Math.random()*Math.PI*2,s=1+Math.random()*2; FX.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,r:2+Math.random()*2,a:.9,t:28}); } }
  function spawnPlayer(){ state.player.x = state.clear.x + state.clear.w*0.5 - T*0.6; state.player.y = state.clear.y + state.clear.h*0.5; state.player.dir="right"; dust(state.player.x,state.player.y); if(window.SFX)SFX.play("spawn"); }

  // ===== Felsen & Erdbrocken =====
  const BOULDER_R = T*0.40;
  function drawBoulder(x,y){ ctx.fillStyle="rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(x, y+T*0.12, T*0.36, T*0.22, 0, 0, Math.PI*2); ctx.fill(); ctx.fillStyle="#aeb8c2"; ctx.beginPath(); ctx.ellipse(x,y,BOULDER_R,BOULDER_R*0.85,0,0,Math.PI*2); ctx.fill(); ctx.fillStyle="#8b97a4"; ctx.beginPath(); ctx.ellipse(x-BOULDER_R*0.35,y-BOULDER_R*0.25,BOULDER_R*0.35,BOULDER_R*0.28,0,0,Math.PI*2); ctx.fill(); ctx.fillStyle="#dfe5ea"; ctx.beginPath(); ctx.ellipse(x+BOULDER_R*0.22,y-BOULDER_R*0.18,BOULDER_R*0.18,BOULDER_R*0.14,0,0,Math.PI*2); ctx.fill(); }
  function drawDirt(x,y){ ellipse(x,y,T*0.32,T*0.24,"#7a5a3a"); ellipse(x+T*0.10,y-T*0.06,T*0.10,T*0.07,"#5d452d"); }

  function canSpawnPickupAt(x,y){
    const r={x:x-T*0.5,y:y-T*0.5,w:T,h:T};
    if(rectsOverlap(r,state.pond)) return false;
    if(rectsOverlap(r,state.farm)) return false;
    if(rectsOverlap(r,state.clear)) return false;
    if(state.yardRect && rectsOverlap(r,state.yardRect)) return false;
    for(const b of state.boulders) if(rectsOverlap(r,{x:b.x-T*0.5,y:b.y-T*0.5,w:T,h:T})) return false;
    for(const p of state.plants)   if(rectsOverlap(r,{x:p.x-T*0.5,y:p.y-T*0.5,w:T,h:T})) return false;
    return true;
  }
  function spawnRandomBoulder(){ let tries=180; while(tries--){ const tx=Math.floor(rnd()*MAP_W), ty=Math.floor(rnd()*MAP_H); const gx=tx*T+T/2, gy=ty*T+T/2; if(canSpawnPickupAt(gx,gy)){ state.boulders.push({x:gx,y:gy}); return true; } } return false; }
  function spawnRandomDirt(){ let tries=120; while(tries--){ const tx=Math.floor(rnd()*MAP_W), ty=Math.floor(rnd()*MAP_H); const gx=tx*T+T/2, gy=ty*T+T/2; if(canSpawnPickupAt(gx,gy)){ state.dirts.push({x:gx,y:gy}); return true; } } return false; }
  // initial
  state.boulders.length=0; state.dirts.length=0;
  for(let i=0;i<24;i++) spawnRandomBoulder();
  for(let i=0;i<40;i++) spawnRandomDirt();
  let boulderTimer=6000;
  function maintainBoulderSpawn(dt){ boulderTimer-=dt; if(boulderTimer<=0 && state.boulders.length<60){ spawnRandomBoulder(); boulderTimer=12000+Math.floor(rnd()*8000); } }

  // Berta-Blockade (2 Tiles Abstand)
  function placeBertaBlockade(){
    if (state.bertaBlockadePlaced) return;
    const bp = state.npcs.berta;
    const ring = [[-2,0],[2,0],[0,2],[0,-2],[-2,-2],[2,-2],[-2,2],[2,2]];
    for(const [ox,oy] of ring){
      const px = bp.x + ox*T, py = bp.y + oy*T;
      if (canSpawnPickupAt(px,py)) state.boulders.push({x:px,y:py});
    }
    state.bertaBlockadePlaced=true; save();
  }

  // ===== Day/Night (deaktiviert) =====
  function updateDay(){ state.prevIsDay = state.isDay; state.isDay = true; }

  // ===== Pflanzen =====
  function inFarm(x,y){ const f=state.farm; return x>=f.x&&x<=f.x+f.w&&y>=f.y&&y<=f.y+f.h; }
  function inClear(x,y){ const c=state.clear; return x>=c.x&&x<=c.x+c.w&&y>=c.y&&y<=c.y+c.h; }
  function findNearbyPlant(){ let best=null,bd=1e9; for(const p of state.plants){ const d=dist(state.player.x,state.player.y,p.x,p.y); if(d<T*0.9 && d<bd){bd=d;best=p;} } return best; }
  function tileFreeForPlantAtPlayer(){
    const {x,y}=tileCenterFromPx(state.player.x,state.player.y);
    if(!inFarm(x,y)) return false;
    if(state.plants.some(p=>p.x===x&&p.y===y)) return false;
    for(const b of state.boulders) if(Math.hypot(x-b.x,y-b.y)<T*0.5) return false;
    return true;
  }
  function plant(type){
    if(!inFarm(state.player.x,state.player.y)) return say("Nur im Feld!");
    const {x,y}=tileCenterFromPx(state.player.x,state.player.y);
    if(state.plants.some(p=>p.x===x&&p.y===y)) return say("Hier wächst bereits etwas.");
    for(const b of state.boulders) if(Math.hypot(x-b.x,y-b.y)<T*0.5) return say("Blockiert durch Felsen.");
    if(type==="corn"){
      if (!(state.inv.poop > 0)) return say("💩 fehlt.");
      state.inv.poop = (state.inv.poop|0) - 1;
      state.plants.push({x,y,type:"corn",plantedAt:performance.now(),readyAt:performance.now()+PLANTS.corn.growMs,watered:false,stage:0});
      say("🌱 Mais wächst…");
    }else{
      if (!(state.inv.cabbageSeed > 0)) return say("🥬-Saat fehlt.");
      state.inv.cabbageSeed = (state.inv.cabbageSeed|0) - 1;
      state.plants.push({x,y,type:"cabbage",plantedAt:performance.now(),readyAt:performance.now()+PLANTS.cabbage.growMs,watered:false,stage:0});
      say("🌱 Kohl wächst…");
    }
    save();
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
    else { state.inv.cabbage++; say("🥬 +1"); }
    state.plants.splice(state.plants.indexOf(p),1); save();
  }
  function updatePlants(){
    const now=performance.now();
    for(const p of state.plants){
      const total=(p.type==="corn")?PLANTS.corn.growMs:(p.watered?PLANTS.cabbage.wateredTotalMs:PLANTS.cabbage.growMs);
      const prog= Math.max(0, Math.min(1, 1-((p.readyAt-now)/total)));
      p.stage = prog<0.33?0 : prog<0.66?1 : prog<0.99?2 : 3;
    }
  }

  // ===== Fred Yard (Logik) =====
  function inStoneYard(x,y){ const f=state.yardRect; return x>=f.x && x<=f.x+f.w && y>=f.y && y<=f.y+f.h; }
  function depositBoulderAtFred(){
    state.yard.count++;
    if (SFX) SFX.play("drop");
    if (state.yard.count % 5 === 0){ state.inv.poop++; say("💩 +1 (5 Felsen abgegeben)"); }
    if (!state.yard.upgraded && state.yard.count >= 20){
      state.yard.count = 0;
      state.yard.upgraded = true;
      say("🛠️ Fecalfreds Shop hat ein Upgrade erhalten!");
    }
    save();
  }

  // ===== Monster & Slingshot (deaktiviert) =====
  function maintainMonsters(){ state.monsters.length = 0; }
  function updateMonsters(){ /* noop */ }
  function fireTowards(tx,ty){
    if(state.carry.has) return say("Zu schwer: Felsen erst ablegen!");
    if(state.inv.ammo<=0) return say("Keine Munition (🔹)!");
    state.inv.ammo--; save();
    const dx=tx-state.player.x, dy=ty-state.player.y, m=Math.hypot(dx,dy)||1;
    const speed=8.0;
    state.bullets.push({x:state.player.x,y:state.player.y,vx:dx/m*speed,vy:dy/m*speed,life:90});
    if(SFX)SFX.play("shoot");
  }

  // ===== Kollisionen (Zaun/Häuser/Yard/Teich) =====
  function fenceBlocks(rect){
    const f=state.farm;
    const gateW=T*1.2, gc=f.x+f.w/2, gl=gc-gateW/2, gr=gc+gateW/2;
    const overlapX = !(rect.x + rect.w < f.x || rect.x > f.x + f.w);
    const hitsTop   = rect.y < f.y && rect.y + rect.h > f.y && overlapX;
    const hitsLeft  = rect.x < f.x && rect.x + rect.w > f.x && rect.y < f.y + f.h && rect.y + rect.h > f.y;
    const hitsRight = rect.x < f.x + f.w && rect.x + rect.w > f.x + f.w && rect.y < f.y + f.h && rect.y + rect.h > f.y;
    let hitsBottom = false;
    const onBottomEdge = rect.y + rect.h > f.y + f.h - 3 && rect.y < f.y + f.h + 3;
    if (onBottomEdge && overlapX){
      const midL = Math.max(rect.x, f.x);
      const midR = Math.min(rect.x + rect.w, f.x + f.w);
      const throughGate = !(midR <= gl || midL >= gr);
      hitsBottom = !throughGate;
    }
    return hitsTop||hitsLeft||hitsRight||hitsBottom;
  }
  function yardFenceBlocks(rect){
    const f=state.yardRect;
    const gateC = f.x + f.w / 2, gl = gateC - (T * 1.6)/2, gr = gateC + (T * 1.6)/2;
    const overlapX = !(rect.x + rect.w < f.x || rect.x > f.x + f.w);
    const overlapY = !(rect.y + rect.h < f.y || rect.y > f.y + f.h);
    const hitsTop    = rect.y < f.y && rect.y + rect.h > f.y && overlapX;
    const hitsLeft   = rect.x < f.x && rect.x + rect.w > f.x && overlapY;
    const hitsRight  = rect.x < f.x + f.w && rect.x + rect.w > f.x + f.w && overlapY;
    let hitsBottom = false;
    const onBottomEdge = rect.y + rect.h > f.y + f.h - 3 && rect.y < f.y + f.h + 3;
    if (onBottomEdge && overlapX){
      const midL = Math.max(rect.x, f.x);
      const midR = Math.min(rect.x + rect.w, f.x + f.w);
      const throughGate = !(midR <= gl || midL >= gr);
      hitsBottom = !throughGate;
    }
    return hitsTop||hitsLeft||hitsRight||hitsBottom;
  }

  // ===== Bewegung =====
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
      const base=3.6*state.speedMult*(state.inv.cart?1.1:1);
      const sprinting = (keys.has('shift') || keys.has('shiftleft')) && state.stamina.value > 0 && !state.sleeping;
      const spBase = state.carry.has ? base*0.72 : base;
      const sp = sprinting ? spBase*1.6 : spBase;
      let nx=clamp(state.player.x+vx*sp, T/2, MAP_W*T-T/2);
      let ny=clamp(state.player.y+vy*sp, T/2, MAP_H*T-T/2);
      const RX={x:nx-T*0.5,y:state.player.y-T*0.5,w:T,h:T}, RY={x:state.player.x-T*0.5,y:ny-T*0.5,w:T,h:T};
      let bx=false,by=false;
      for(const b of state.boulders){ const r={x:b.x-T*0.5,y:b.y-T*0.5,w:T,h:T}; if(rectsOverlap(RX,r))bx=true; if(rectsOverlap(RY,r))by=true; if(bx&&by)break; }
      if(rectsOverlap(RX,state.pond))bx=true; if(rectsOverlap(RY,state.pond))by=true;

      const FRED_HOUSE={ x:state.npcs.fred.x-T*1.0, y:state.npcs.fred.y-T*0.6, w:T*2.0, h:T*1.2 };
      const STEFAN_HOUSE={ x:state.npcs.stefan.x-T*0.9, y:state.npcs.stefan.y-T*0.9, w:T*1.8, h:T*1.1 };
      if(rectsOverlap(RX,FRED_HOUSE)||rectsOverlap(RX,STEFAN_HOUSE))bx=true;
      if(rectsOverlap(RY,FRED_HOUSE)||rectsOverlap(RY,STEFAN_HOUSE))by=true;
      if(fenceBlocks(RX)||yardFenceBlocks(RX))bx=true;
      if(fenceBlocks(RY)||yardFenceBlocks(RY))by=true;
      if(!bx) state.player.x=nx; if(!by) state.player.y=ny;

      const nowT = performance.now();
      const dtSec = Math.max(0.001, (nowT - state._lastMoveT)/1000);
      state._lastMoveT = nowT;
      if (sprinting){
        const drain = (state.carry.has ? state.stamina.drainCarry : state.stamina.drainRun) * dtSec;
        state.stamina.value = Math.max(0, state.stamina.value - drain);
        if (SFX) SFX.setRate(1.1);
      } else if (!state.sleeping){
        state.stamina.value = Math.min(state.stamina.max, state.stamina.value + state.stamina.regen*dtSec);
        if (SFX) SFX.setRate(1);
      }
      if (state.stamina.value<=0 && state.carry.has){
        const g = placementTargetCenter();
        let placed = false;
        const opts = [[0,0],[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
        for (const [ox,oy] of opts){
          const px = g.x + ox*T, py = g.y + oy*T;
          if (canPlaceBoulder(px,py)){ state.carry.has=false; state.boulders.push({x:px,y:py}); if(SFX)SFX.play('drop'); placed=true; break; }
        }
        if (!placed){ state.carry.has=false; if(SFX)SFX.play('drop'); }
        const dir = state.player.dir;
        if (dir==='left') state.player.x = Math.max(T/2, state.player.x - T);
        else if (dir==='right') state.player.x = Math.min(MAP_W*T-T/2, state.player.x + T);
        else if (dir==='up') state.player.y = Math.max(T/2, state.player.y - T);
        else state.player.y = Math.min(MAP_H*T-T/2, state.player.y + T);
        say('😵 Erschöpft! Felsen abgelegt.');
      }
      state._stepTimer += len>0 ? dtSec : 0;
      const stepEvery = sprinting ? 0.16 : 0.28;
      if (len>0 && state._stepTimer >= stepEvery){ state._stepTimer = 0; if (SFX) (sprinting ? SFX.play('step_fast') : SFX.play('step')); }
    }
    if (state.dmgCooldown>0) state.dmgCooldown--;
  }

  // ===== Input =====
  const keys=new Set();
  window.addEventListener('keydown', e=>{
    const k=e.key.toLowerCase(); keys.add(k);
    if ((e.code==="Space"||e.key===" ") && ui.ctxBtn.enabled && typeof ui.ctxBtn.action==="function"){ e.preventDefault(); ui.ctxBtn.action(); }
  });
  window.addEventListener('keyup', e=>keys.delete(e.key.toLowerCase()));

  cv.addEventListener('pointerdown', e=>{
    const r=cv.getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top;
    if (dist(x,y,ui.restart.x,ui.restart.y) <= ui.restart.r){
      if (confirm("Spiel neu starten? Dein Fortschritt wird gelöscht.")){
        try{ localStorage.removeItem("pb_save_v7"); }catch{} location.reload();
      }
      return;
    }
    if(dist(x,y,ui.ctxBtn.x,ui.ctxBtn.y)<=ui.ctxBtn.r){ if(ui.ctxBtn.enabled&&ui.ctxBtn.action) ui.ctxBtn.action(); return; }
    if(dist(x,y,ui.joy.cx,ui.joy.cy)<=ui.joy.r){ ui.joy.active=true; ui.joy.id=e.pointerId; const dx=x-ui.joy.cx,dy=y-ui.joy.cy,m=Math.hypot(dx,dy),s=Math.min(1,m/(ui.joy.r-8)); ui.joy.vx=(m<8?0:dx/m)*s; ui.joy.vy=(m<8?0:dy/m)*s; return; }
    fireTowards(x,y); if(ui.tutorial) ui.tutorial=false;
  });
  cv.addEventListener('pointermove', e=>{
    if(!ui.joy.active||e.pointerId!==ui.joy.id) return;
    const r=cv.getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top;
    const dx=x-ui.joy.cx, dy=y-ui.joy.cy, m=Math.hypot(dx,dy), s=Math.min(1,m/(ui.joy.r-8));
    ui.joy.vx=(m<8?0:dx/m)*s; ui.joy.vy=(m<8?0:dy/m)*s;
  });
  window.addEventListener('pointerup', e=>{ if(ui.joy.active&&e.pointerId===ui.joy.id){ ui.joy.active=false; ui.joy.id=null; ui.joy.vx=ui.joy.vy=0; } });

  // ===== Modal (Shop/Editor) =====
  const backdrop=document.getElementById("backdrop");
  const modal=document.getElementById("modal");
  const mList=document.getElementById("m_list");
  const mTitle=document.getElementById("m_title");
  const mSub=document.getElementById("m_sub");
  const mPortrait=document.getElementById("m_portrait");
  const mClose=document.getElementById("m_close");
  function openModal(){ backdrop.classList.add("open"); modal.classList.add("open"); }
  function closeModal(){ modal.classList.remove("open"); backdrop.classList.remove("open"); state.editor.open=false; }
  mClose.onclick=closeModal; backdrop.onclick=closeModal;
  function addRow({icon,name,desc,price,button,disabled,onClick}){
    const row=document.createElement('div'); row.className="item";
    row.innerHTML=`<div class="iic">${icon}</div><div class="ibody"><div class="iname">${name}</div><div class="idesc">${desc||""}</div></div><div class="iprice">${price||""}</div>`;
    const btn=document.createElement('button'); btn.className="ghost"; btn.textContent=button||"OK"; if(disabled) btn.disabled=true; btn.onclick=onClick||(()=>{});
    const col=document.createElement('div'); col.style.display="flex"; col.style.alignItems="center"; col.style.gap="10px"; col.appendChild(btn); row.appendChild(col); mList.appendChild(row);
  }

  // ===== Shops (inkl. Cheats) =====
  function openShop(kind){
    mList.innerHTML="";
    if(kind==='fred'){
      mPortrait.textContent="🧑‍🌾";
      mTitle.textContent = state.yard.upgraded ? "Fecalfred (Upgrade)" : "Fecalfred";
      mSub.textContent   = state.yard.upgraded ? "Neues Angebot dank Felsen-Verkauf" : "Tauscht Felsen gegen 💩";
      addRow({icon:"🧱", name:"Felsen abgeben", desc:"Lege Felsen in den eingezäunten Bereich.", price:`Yard: ${state.yard.count}/20`, button:"OK"});
      addRow({icon:"🔁", name:"5 Felsen → 1 💩", desc:"Automatisch beim Abgeben.", price:"—", button:"OK"});
      addRow({icon:"🌽", name:"Mais verkaufen", desc:"+1 €", price:"+1 €", button:"Verkaufen", disabled: state.inv.corn<1, onClick:()=>{ state.inv.corn--; state.inv.euro+=ECON.cornSell; save(); openShop('fred'); }});
      addRow({icon:"🥬", name:"Kohl verkaufen", desc:"+7 €", price:"+7 €", button:"Verkaufen", disabled: state.inv.cabbage<1, onClick:()=>{ state.inv.cabbage--; state.inv.euro+=ECON.cabbageSell; save(); openShop('fred'); }});
      if(state.yard.upgraded){
        addRow({icon:"💩", name:"💩 kaufen", desc:"1x Dünger", price:"6 €", button:"Kaufen", disabled: state.inv.euro<6, onClick:()=>{ state.inv.euro-=6; state.inv.poop++; save(); openShop('fred'); }});
        addRow({icon:"🛒", name:"Werkel-Karren", desc:"+10% Speed beim Tragen", price:"10 €", button: state.inv.cart?"Gekauft":"Kaufen", disabled: state.inv.cart || state.inv.euro<10, onClick:()=>{ state.inv.cart=true; save(); openShop('fred'); }});
      }
    } else if(kind==='berta'){
      mPortrait.textContent="👩‍🎨"; mTitle.textContent="Berta Brown"; mSub.textContent="Upgrades (Tag)";
      addRow({icon:"💧", name:"Gießkanne", desc:"Permanent. 13 Nutzungen. Am Teich auffüllen.", price:"5 €", button: state.inv.hasCan?"Gekauft":"Kaufen", disabled: state.inv.hasCan || state.inv.euro<5, onClick:()=>{ state.inv.hasCan=true; state.inv.can=state.inv.canMax; state.inv.euro-=5; save(); openShop('berta'); }});
      addRow({icon:"👟", name:"Schnelle Schuhe", desc:"+35% Laufgeschwindigkeit", price:"7 €", button: state.inv.hasShoes?"Gekauft":"Kaufen", disabled: state.inv.hasShoes || state.inv.euro<7, onClick:()=>{ state.inv.hasShoes=true; state.speedMult=1.35; state.inv.euro-=7; save(); openShop('berta'); }});
      addRow({icon:"🪓", name:"Steinzerkleinerer", desc:"Auf der Lichtung: getragener Felsen → 🔹×8 Munition.", price:"6 €",
        button: state.inv.hasCrusher?"Gekauft":"Kaufen",
        disabled: state.inv.hasCrusher || state.inv.euro<6,
        onClick:()=>{ state.inv.hasCrusher=true; state.inv.euro-=6; save(); openShop('berta'); }
      });
      addRow({icon:"🛏️", name:"Bett", desc:"Schlafen füllt Ausdauer schnell auf.", price:"15 €",
        button: state.hasBed?"Gekauft":"Kaufen",
        disabled: state.hasBed || state.inv.euro<15,
        onClick:()=>{ state.inv.euro-=15; state.hasBed=true; if(!state.bed.placed){ const c=state.clear; state.bed.x=c.x+c.w*0.15; state.bed.y=c.y+c.h*0.65; state.bed.placed=true; } save(); openShop('berta'); }
      });
    } else {
      mPortrait.textContent="🧙‍♂️"; mTitle.textContent="Stefan Spielverderber"; mSub.textContent="Tests & Cheats";
      addRow({icon:"💶", name:"+50 €", button:"+50", onClick:()=>{ state.inv.euro+=50; save(); openShop('stefan'); }});
      addRow({icon:"💩", name:"+10 Poop",  button:"+10", onClick:()=>{ state.inv.poop+=10; save(); openShop('stefan'); }});
      addRow({icon:"🥬", name:"+10 Kohlsaat", button:"+10", onClick:()=>{ state.inv.cabbageSeed = (state.inv.cabbageSeed|0)+10; sanitizeInv(); save(); openShop('stefan'); }});
      addRow({icon:"🔹", name:"+20 Munition", button:"+20", onClick:()=>{ state.inv.ammo+=20; save(); openShop('stefan'); }});
      addRow({icon:"🧱", name:"Yard +19 Felsen", desc:"Schnelltest fürs Upgrade", button:"+19", onClick:()=>{ state.yard.count = Math.min(19, (state.yard.count|0)+19); sanitizeInv(); save(); openShop('stefan'); }});
      addRow({icon: state.god?"🛡️":"🗡️", name:"Godmode", button: state.god?"AUS":"AN", onClick:()=>{ state.god=!state.god; save(); openShop('stefan'); }});
      addRow({icon:"🌞", name:"Tag halten", desc:"Nacht/Monster sind aus.", price:"—", button:"OK"});
    }
    openModal();
  }

  // ===== Map-Editor =====
  const editorTable = { get x(){ return state.npcs.stefan.x + T*2.2; }, get y(){ return state.npcs.stefan.y - T*0.6; } };

  function openEditor(){
    state.editor.open=true;
    mList.innerHTML="";
    mPortrait.textContent="🗺️";
    mTitle.textContent="Map-Editor";
    mSub.textContent="Bewege Objekte per Buttons (Tiles) oder setze sie auf deine aktuelle Position.";

    const wrap=document.createElement('div'); wrap.style.display="grid"; wrap.style.gap="10px";
    const sel=document.createElement('select');
    ["fred","berta","stefan","feld","lichtung","teich","felsenhof"].forEach(k=>{
      const o=document.createElement('option'); o.value=k; o.textContent=k.toUpperCase(); sel.appendChild(o);
    });
    sel.value=state.editor.target;
    sel.onchange=()=>{ state.editor.target=sel.value; refreshInfo(); };

    const stepRow=document.createElement('div'); stepRow.style.display="flex"; stepRow.style.gap="8px"; stepRow.style.alignItems="center";
    const stepLbl=document.createElement('span'); stepLbl.textContent="Schrittweite (Tiles):";
    const stepIn=document.createElement('input'); stepIn.type="number"; stepIn.min="1"; stepIn.max="10"; stepIn.value=state.editor.step;
    stepIn.oninput=()=>{ state.editor.step = Math.max(1, Math.min(10, parseInt(stepIn.value||"1"))); stepIn.value=state.editor.step; };
    stepRow.append(stepLbl,stepIn);

    const btnRow=document.createElement('div'); btnRow.style.display="grid"; btnRow.style.gridTemplateColumns="repeat(3, 1fr)"; btnRow.style.gap="6px";
    function mk(text, cb){ const b=document.createElement('button'); b.className="ghost"; b.textContent=text; b.onclick=cb; return b; }
    btnRow.append(
      document.createElement('span'),
      mk("↑",()=>moveTarget(0,-1)),
      document.createElement('span'),
      mk("←",()=>moveTarget(-1,0)),
      mk("SNAP",()=>snapTargetToPlayer()),
      mk("→",()=>moveTarget(1,0)),
      document.createElement('span'),
      mk("↓",()=>moveTarget(0,1)),
      document.createElement('span'),
    );

    const info=document.createElement('div'); info.style.fontSize="12px"; info.style.opacity=".9";
    function refreshInfo(){
      let s="";
      if(state.editor.target==="fred"||state.editor.target==="berta"||state.editor.target==="stefan"){
        const p=state.npcs[state.editor.target]; s=`Pos: (${Math.round(p.x)}, ${Math.round(p.y)})`;
      }else if(state.editor.target==="feld"){ const f=state.farm; s=`Rect Feld: ${f.w/T|0}x${f.h/T|0} @ (${f.x/T|0},${f.y/T|0})`; }
      else if(state.editor.target==="lichtung"){ const c=state.clear; s=`Rect Lichtung: ${c.w/T|0}x${c.h/T|0} @ (${c.x/T|0},${c.y/T|0})`; }
      else if(state.editor.target==="teich"){ const p=state.pond; s=`Rect Teich: ${p.w/T|0}x${p.h/T|0} @ (${p.x/T|0},${p.y/T|0})`; }
      else { const y=state.yardRect; s=`Felsenhof @ (${(y.x/T|0)},${(y.y/T|0)}) size ${y.w/T|0}x${y.h/T|0}`; }
      info.textContent=s;
    }
    refreshInfo();

    const actionRow=document.createElement('div'); actionRow.style.display="flex"; actionRow.style.gap="8px";
    const saveBtn=mk("Speichern",()=>{ save(); say("🗺️ Map gespeichert."); });
    const resetBtn=mk("Reset",()=>{ if(confirm("Map auf Standard zurücksetzen?")){ resetMap(); say("🗺️ Map zurückgesetzt."); closeModal(); }});
    const closeBtn=mk("Schließen",()=>closeModal());
    actionRow.append(saveBtn, resetBtn, closeBtn);

    wrap.append(sel, stepRow, btnRow, info, actionRow);
    mList.appendChild(wrap);
    openModal();
  }

  function moveTarget(dxTiles, dyTiles){
    const dx=dxTiles*state.editor.step*T, dy=dyTiles*state.editor.step*T;
    switch(state.editor.target){
      case "fred":   state.npcs.fred.x+=dx; state.npcs.fred.y+=dy; recalcYard(); break;
      case "berta":  state.npcs.berta.x+=dx; state.npcs.berta.y+=dy;break;
      case "stefan": state.npcs.stefan.x+=dx; state.npcs.stefan.y+=dy; break;
      case "feld":   state.farm.x+=dx; state.farm.y+=dy; break;
      case "lichtung": state.clear.x+=dx; state.clear.y+=dy; break;
      case "teich":  state.pond.x+=dx; state.pond.y+=dy; break;
      case "felsenhof": state.yardRect.x+=dx; state.yardRect.y+=dy; break;
    }
  }
  function snapTargetToPlayer(){
    const c=tileCenterFromPx(state.player.x,state.player.y);
    switch(state.editor.target){
      case "fred":   state.npcs.fred.x=c.x; state.npcs.fred.y=c.y; recalcYard(); break;
      case "berta":  state.npcs.berta.x=c.x; state.npcs.berta.y=c.y;break;
      case "stefan": state.npcs.stefan.x=c.x; state.npcs.stefan.y=c.y; break;
      case "feld":   state.farm.x=c.x-state.farm.w/2; state.farm.y=c.y-state.farm.h/2; break;
      case "lichtung": state.clear.x=c.x-state.clear.w/2; state.clear.y=c.y-state.clear.h/2; break;
      case "teich":  state.pond.x=c.x-state.pond.w/2; state.pond.y=c.y-state.pond.h/2; break;
      case "felsenhof": state.yardRect.x=c.x-state.yardRect.w/2; state.yardRect.y=c.y-state.yardRect.h/2; break;
    }
  }
  function resetMap(){
    state.farm = { ...baseFarm };
    state.clear= { ...baseClear };
    state.pond = { ...basePond };
    state.npcs = {
      fred:   toPx(FRED_TILE.x, FRED_TILE.y),
      berta:  toPx(BERTA_TILE.x, BERTA_TILE.y),
      stefan: toPx(STEFAN_TILE.x, STEFAN_TILE.y),
    };recalcYard();
    save();
  }

  // ===== Kontextbutton =====
  function nearestBoulderIndex(){
    let best = -1, bestD = 1e9;
    const reach = T * 1.3;
    for (let i=0;i<state.boulders.length;i++){
      const b = state.boulders[i];
      const d = dist(state.player.x, state.player.y, b.x, b.y);
      if (d < reach && d < bestD){ best = i; bestD = d; }
    }
    return best;
  }
  function canPlaceBoulder(px,py){
    if(rectsOverlap({x:px-T*0.5,y:py-T*0.5,w:T,h:T},state.pond)) return false;
    if(inStoneYard(px,py)) return false;
    if(Math.hypot(px-state.player.x,py-state.player.y) < state.player.r + BOULDER_R + 8) return false;
    for(const b of state.boulders) if(Math.hypot(px-b.x,py-b.y)<BOULDER_R*2-6) return false;
    for(const p of state.plants)   if(Math.hypot(px-p.x,py-p.y)<T*0.5) return false;
    return true;
  }

  function updateContext(){
    let icon="❓", enabled=false, action=null;
    const fred=state.npcs.fred, berta=state.npcs.berta, stefan=state.npcs.stefan;
    const near=(px,py,qx,qy,r)=>dist(px,py,qx,qy)<r;

    // Editor-Tisch
    const editorNear = near(state.player.x,state.player.y, editorTable.x, editorTable.y, T*1.2);
    if(editorNear){ icon="🗺️"; enabled=true; action=()=>openEditor(); }
    else if(near(state.player.x,state.player.y,fred.x,fred.y,T*1.2)){ icon="🛒"; enabled=true; action=()=>openShop('fred'); }
    else if(near(state.player.x,state.player.y,berta.x,berta.y,T*1.2)){ icon="🛒"; enabled=true; action=()=>openShop('berta'); }
    else if(near(state.player.x,state.player.y,stefan.x,stefan.y,T*1.2)){ icon="🧙‍♂️"; enabled=true; action=()=>openShop('stefan'); }
    else if(near(state.player.x,state.player.y,state.pond.x+state.pond.w/2,state.pond.y+state.pond.h/2,T*2.0)){ icon="💧"; enabled=state.inv.hasCan; action=()=>{ if(!state.inv.hasCan) return say("Keine Gießkanne."); state.inv.can=state.inv.canMax; save(); say("💧 Gießkanne aufgefüllt!"); }; }
    else {
      if(state.hasBed && state.bed.placed && dist(state.player.x,state.player.y,state.bed.x,state.bed.y) < T*1.2){
        icon = state.sleeping ? "😴" : "🛌"; enabled = !state.sleeping; action = ()=>{ state.sleeping = true; say("Schlafen…"); if(SFX) SFX.play('sleep'); };
      } else {
      const g = placementTargetCenter();
      if(state.carry.has){
        if (inStoneYard(state.player.x, state.player.y)){ icon="⬇️"; enabled=true; action=()=>{ state.carry.has=false; depositBoulderAtFred(); save(); }; }
        else if (state.inv.hasCrusher && inClear(state.player.x, state.player.y)){
          icon="🪓"; enabled=true; action=()=>{ state.carry.has=false; state.inv.ammo += 8; say("🪓 Felsen → 🔹×8"); if(SFX)SFX.play("drop"); save(); };
        }
        else {
          const ok=canPlaceBoulder(g.x,g.y); icon = ok ? "📦" : "🚫"; enabled=ok; action=()=>{ state.carry.has=false; state.boulders.push({x:g.x,y:g.y}); if(SFX)SFX.play("drop"); const dir=state.player.dir; if(dir==='left') state.player.x=Math.max(T/2, state.player.x-T); else if(dir==='right') state.player.x=Math.min(MAP_W*T-T/2, state.player.x+T); else if(dir==='up') state.player.y=Math.max(T/2, state.player.y-T); else state.player.y=Math.min(MAP_H*T-T/2, state.player.y+T); save(); };
        }
      }else{
        const bi=nearestBoulderIndex();
        if (bi>=0){ icon="🪨"; enabled=true; action=()=>{ const b=state.boulders[bi]; state.boulders.splice(bi,1); state.carry.has=true; if(SFX)SFX.play("pickup"); }; }
        else {
          if (tileFreeForPlantAtPlayer()){
            if (state.inv.poop>0){ icon="💩"; enabled=true; action=()=>plant("corn"); }
            else if (state.inv.cabbageSeed>0){ icon="🥬"; enabled=true; action=()=>plant("cabbage"); }
          }
          const p=findNearbyPlant();
          if(!enabled && p && p.stage>=3){ icon="🌾"; enabled=true; action=harvest; }
          else if(!enabled && p && p.stage<3 && state.inv.hasCan && state.inv.can>0 && !p.watered){ icon="💧"; enabled=true; action=water; }
          else if(!enabled){
            const di=(function(){ let i=-1,bd=1e9; for(let k=0;k<state.dirts.length;k++){ const d=state.dirts[k]; const dd=dist(state.player.x,state.player.y,d.x,d.y); if(dd<T*0.7&&dd<bd){i=k;bd=dd;} } return i; })();
            if(di>=0){ icon="🪵"; enabled=true; action=()=>{ state.dirts.splice(di,1); const chance=0.10+rnd()*0.05; if(rnd()<chance){ state.inv.poop++; say("💩 Glück gehabt!"); } else say("🪵 Erdbrocken."); save(); if(SFX)SFX.play("pickup"); }; }
            else { icon="🚫"; enabled=false; }
          }
          }
        }
      }
    }
    ui.ctxBtn.icon=icon; ui.ctxBtn.enabled=enabled; ui.ctxBtn.action=action;
  }

  // ===== Render =====
  function drawBG(){
    const grad = ctx.createLinearGradient(0,0,0,MAP_H*T);
    grad.addColorStop(0,"#0f2f18"); grad.addColorStop(1,"#0b2614");
    ctx.fillStyle = grad; ctx.fillRect(0,0,MAP_W*T,MAP_H*T);
    const a="#174f28", b="#123d20";
    for(let y=0;y<MAP_H*T;y+=T){ for(let x=0;x<MAP_W*T;x+=T){ ctx.fillStyle=(((x/T + y/T)&1)===0)?a:b; ctx.globalAlpha=0.25; ctx.fillRect(x,y,T,T);} }
    ctx.globalAlpha=1;
  }
  function drawFence(){
    const f=state.farm; ctx.fillStyle="rgba(120,220,140,0.14)"; ctx.fillRect(f.x,f.y,f.w,f.h);
    ctx.strokeStyle="#916c3b"; ctx.lineWidth=4;
    const gw=T*1.2, gc=f.x+f.w/2, gl=gc-gw/2, gr=gc+gw/2;
    ctx.beginPath(); ctx.moveTo(f.x,f.y); ctx.lineTo(f.x+f.w,f.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(f.x,f.y+f.h); ctx.lineTo(gl,f.y+f.h); ctx.moveTo(gr,f.y+f.h); ctx.lineTo(f.x+f.w,f.y+f.h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(f.x,f.y); ctx.lineTo(f.x,f.y+f.h); ctx.moveTo(f.x+f.w,f.y); ctx.lineTo(f.x+f.w,f.y+f.h); ctx.stroke();
  }
  function drawStoneYard(){
    const f=state.yardRect; ctx.fillStyle="rgba(180,180,180,0.10)"; ctx.fillRect(f.x,f.y,f.w,f.h);
    ctx.strokeStyle="#8a6a3a"; ctx.lineWidth=3;
    ctx.beginPath(); ctx.moveTo(f.x,f.y); ctx.lineTo(f.x+f.w,f.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(f.x,f.y); ctx.lineTo(f.x,f.y+f.h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(f.x+f.w,f.y); ctx.lineTo(f.x+f.w,f.y+f.h); ctx.stroke();
    const gateC=f.x+f.w/2, gl=gateC-(T*1.6)/2, gr=gateC+(T*1.6)/2;
    ctx.beginPath(); ctx.moveTo(f.x, f.y+f.h); ctx.lineTo(gl, f.y+f.h); ctx.moveTo(gr, f.y+f.h); ctx.lineTo(f.x+f.w, f.y+f.h); ctx.stroke();
    ctx.fillStyle="#f8f5e7"; const w=T*3.2,h=T*0.6, sx=f.x+f.w/2-w/2, sy=f.y-h-T*0.3;
    ctx.fillRect(sx,sy,w,h); ctx.strokeStyle="#7b5b2b"; ctx.strokeRect(sx+.5,sy+.5,w-1,h-1);
    ctx.fillStyle="#333"; ctx.font=`bold ${Math.floor(T*0.30)}px system-ui`; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(`FELSEN-YARD (${state.yard.count}/20)`, sx+w/2, sy+h/2); ctx.textAlign="left"; ctx.textBaseline="alphabetic";
  }
  function drawPond(){ const p=state.pond; const cx=p.x+p.w/2, cy=p.y+p.h/2, rx=p.w*0.48, ry=p.h*0.46;
    const g=ctx.createRadialGradient(cx,cy,1, cx,cy, Math.max(rx,ry));
    g.addColorStop(0,"#1a6a8d"); g.addColorStop(1,"#0c3b52");
    ctx.fillStyle=g; ctx.beginPath(); ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle="rgba(180,220,255,0.25)"; ctx.lineWidth=2; for(let i=1;i<=4;i++){ ctx.beginPath(); ctx.ellipse(cx,cy, rx*i/4, ry*i/4, 0, 0, Math.PI*2); ctx.stroke(); }
  }
  function drawFred(){
    const p=state.npcs.fred, hx=p.x-T, hy=p.y-T;
    ctx.fillStyle="#6b4630"; ctx.fillRect(hx-T*0.5,hy-T*0.5,T*2,T*1.6);
    ctx.fillStyle= state.yard.upgraded ? "#b24f2f" : "#9b3b2e"; ctx.fillRect(hx-T*0.6,hy-T*1.0,T*2.4,T*0.45);
    ctx.fillStyle="#2b1c11"; ctx.fillRect(hx+T*0.2,hy+T*0.6,T*0.5,T*0.7);
    const w=T*2.8,h=T*0.7; ctx.fillStyle="#f8f5e7"; ctx.fillRect(p.x-w/2,hy+T*1.25,w,h);
    ctx.fillStyle="#2b2b2b"; ctx.font=`bold ${Math.floor(T*0.34)}px system-ui`; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(state.yard.upgraded?"FECALFRED ++":"FECALFRED", p.x, hy + T*1.25 + h/2); ctx.textAlign="left"; ctx.textBaseline="alphabetic";
  }
  function drawBerta(){ const p=state.npcs.berta; ctx.fillStyle="#8b5a2b"; ctx.fillRect(p.x-T*0.8,p.y-T*0.6,T*0.15,T*1.3); ctx.fillRect(p.x+T*0.65,p.y-T*0.6,T*0.15,T*1.3); ctx.fillStyle="#f0e0c0"; ctx.fillRect(p.x-T*0.5,p.y-T*0.9,T*1.1,T*0.8); ctx.fillStyle="#f8f5e7"; ctx.fillRect(p.x-T*1.2,p.y+T*0.8,T*2.4,T*0.45); ctx.fillStyle="#2b2b2b"; ctx.font=`bold ${Math.floor(T*0.32)}px system-ui`; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText("BERTA BROWN", p.x, p.y+T*1.02); ctx.textAlign="left"; ctx.textBaseline="alphabetic"; }
  function drawStefan(){ const p=state.npcs.stefan; ctx.fillStyle="#9c7a00"; ctx.fillRect(p.x-T*0.9,p.y-T*0.9,T*1.8,T*1.1); ctx.fillStyle="#ffd54a"; ctx.fillRect(p.x-T*1.2,p.y-T*1.25,T*2.4,T*0.5); ctx.fillStyle="#2b1c11"; ctx.fillRect(p.x-T*0.2,p.y-T*0.1,T*0.4,T*0.6); ctx.fillStyle="#f8f5e7"; ctx.fillRect(p.x-T*1.4,p.y+T*0.8,T*2.8,T*0.45); ctx.fillStyle="#2b2b2b"; ctx.font=`bold ${Math.floor(T*0.32)}px system-ui`; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText("STEFAN SPIELVERDERBER", p.x, p.y+T*1.02); ctx.textAlign="left"; ctx.textBaseline="alphabetic"; }
  function drawClearing(){ const c=state.clear; ctx.fillStyle="#1a5a2d"; ctx.fillRect(c.x,c.y,c.w,c.h); ctx.strokeStyle="rgba(180,220,150,0.35)"; ctx.strokeRect(c.x,c.y,c.w,c.h);
    if(state.inv.hasCrusher){
      const cx=c.x+c.w*0.72, cy=c.y+c.h*0.52;
      ctx.fillStyle="#5b4634"; ctx.fillRect(cx-T*0.25, cy-T*0.10, T*0.5, T*0.20);
      ctx.fillStyle="#354354"; ctx.fillRect(cx-T*0.05, cy-T*0.42, T*0.10, T*0.34);
      ctx.fillStyle="#b8c4d2"; ctx.beginPath(); ctx.moveTo(cx, cy-T*0.46); ctx.lineTo(cx+T*0.35, cy-T*0.32); ctx.lineTo(cx+T*0.04, cy-T*0.22); ctx.closePath(); ctx.fill();
    }
  }
  function drawShack(){ if(!state.shackBuilt) return; const c=state.clear; const sx=c.x+c.w/2 - T*0.8, sy=c.y+c.h/2 - T*0.8; ctx.fillStyle="#5a4636"; ctx.fillRect(sx,sy,T*1.6,T*1.0); ctx.fillStyle="#a44b3a"; ctx.fillRect(sx - T*0.2, sy - T*0.45, T*2.0, T*0.45); ctx.fillStyle="#26180e"; ctx.fillRect(sx + T*0.6, sy + T*0.3, T*0.4, T*0.5); }

  function drawBed(){
    if(!state.hasBed || !state.bed.placed) return;
    const x=state.bed.x, y=state.bed.y;
    ctx.save();
    ctx.fillStyle="#3b2a1d"; ctx.fillRect(x - T*0.6, y - T*0.2, T*1.2, T*0.4);
    ctx.fillStyle="#7e4b3a"; ctx.fillRect(x - T*0.62, y - T*0.52, T*1.24, T*0.36);
    ctx.fillStyle="#eae2d0"; ctx.fillRect(x - T*0.54, y - T*0.48, T*1.08, T*0.28);
    ctx.strokeStyle="rgba(0,0,0,0.35)"; ctx.strokeRect(x - T*0.62+0.5, y - T*0.52+0.5, T*1.24-1, T*0.68-1);
    ctx.restore();
  }
  function drawEditorTable(){
    const x=editorTable.x, y=editorTable.y;
    ctx.fillStyle="#6b543a"; ctx.fillRect(x - T*0.6, y - T*0.3, T*1.2, T*0.3);
    ctx.fillStyle="#3e2f20"; ctx.fillRect(x - T*0.5, y - T*0.36, T*1.0, T*0.08);
    ctx.fillStyle="#f0e9d6"; ctx.fillRect(x - T*0.7, y + T*0.1, T*1.4, T*0.45);
    ctx.fillStyle="#333"; ctx.font=`bold ${Math.floor(T*0.26)}px system-ui`; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText("MAP-EDITOR", x, y + T*0.32);
    ctx.textAlign="left"; ctx.textBaseline="alphabetic";
  }

  function drawPlayer(){
    const p=state.player; ellipse(p.x, p.y + T*0.14, p.r*0.9, p.r*0.55, "rgba(0,0,0,0.25)"); ellipse(p.x,p.y,p.r,p.r,"#e6b35a");

    // Augenrichtung
    let fx=0,fy=0;
    if (state.carry.has) { fx=0; fy=1; }
    else { if(p.dir==="left")fx=-1; else if(p.dir==="right")fx=1; else if(p.dir==="up")fy=-1; else fy=1; }

    const sx=-fy, sy=fx, eR=p.r*0.11, off=6, ex=p.x+fx*(p.r*0.25), ey=p.y+fy*(p.r*0.25);
    ellipse(ex+sx*off, ey+sy*off, eR, eR, "#fff"); ellipse(ex-sx*off, ey-sy*off, eR, eR, "#fff");
    ellipse(ex+sx*off+fx*eR*0.6, ey+sy*off+fy*eR*0.6, eR*0.55, eR*0.55, "#111");
    ellipse(ex-sx*off+fx*eR*0.6, ey-sy*off+fy*eR*0.6, eR*0.55, eR*0.55, "#111");

    // Mund
    ctx.strokeStyle = "#3b2a18"; ctx.lineWidth = 2;
    if (state.carry.has) {
      ctx.beginPath(); ctx.moveTo(p.x - 6, p.y + 10); ctx.quadraticCurveTo(p.x, p.y + 4, p.x + 6, p.y + 10); ctx.stroke();
      ctx.fillStyle = "rgba(180,220,255,0.85)"; ctx.beginPath(); ctx.ellipse(p.x + 10, p.y - 2, 2, 3, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      const d = state.player.dir;
      ctx.beginPath();
      if (d==="left"){
        ctx.moveTo(p.x, p.y-6); ctx.quadraticCurveTo(p.x+6, p.y, p.x, p.y+6);   // ')'
      } else if (d==="right"){
        ctx.moveTo(p.x, p.y-6); ctx.quadraticCurveTo(p.x-6, p.y, p.x, p.y+6);   // '('
      } else if (d==="up"){
        ctx.moveTo(p.x - 6, p.y + 10); ctx.quadraticCurveTo(p.x, p.y + 16, p.x + 6, p.y + 10); // U
      } else { // down
        ctx.moveTo(p.x - 6, p.y + 10); ctx.quadraticCurveTo(p.x, p.y + 16, p.x + 6, p.y + 10);  // U
      }
      ctx.stroke();
    }

    if(state.carry.has){ drawBoulder(p.x, p.y - T*0.9); }
  }

  function drawPlants(){
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
  }

  const TOAST={t:0,text:""}; function say(s){ TOAST.text=s; TOAST.t=1.6; }

  function drawSleepOverlay(){
    if(!state.sleeping) return;
    ctx.fillStyle="rgba(0,0,0,0.45)"; ctx.fillRect(0,0,cv.clientWidth,cv.clientHeight);
    ctx.fillStyle="#fff"; ctx.font="bold 18px system-ui"; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText("Schlafen…", cv.clientWidth/2, cv.clientHeight/2 - 30);
    const p = state.stamina.value/state.stamina.max;
    const w = Math.min(300, cv.clientWidth*0.6), h = 14, x = (cv.clientWidth-w)/2, y = cv.clientHeight/2 + 6;
    ctx.fillStyle="rgba(255,255,255,0.25)"; ctx.fillRect(x, y, w, h);
    ctx.fillStyle="#34d399"; ctx.fillRect(x, y, w*p, h);
    ctx.strokeStyle="rgba(255,255,255,0.5)"; ctx.strokeRect(x+0.5, y+0.5, w-1, h-1);
    ctx.textAlign="left"; ctx.textBaseline="alphabetic";
  }
  function drawHUD(){
    const HUD_H=48, HUD_Y=0; ctx.fillStyle="rgba(0,0,0,0.55)"; ctx.fillRect(0, HUD_Y, cv.clientWidth, HUD_H);
    let x=12,y=22; ctx.fillStyle="#fff"; ctx.font="bold 14px system-ui";
    ctx.fillText(`❤ ${state.hearts}`, x,y); x+=60;
    ctx.fillText(`💩 ${state.inv.poop|0}`, x,y); x+=60;
    ctx.fillText(`🌽 ${state.inv.corn|0}`, x,y); x+=60;
    ctx.fillText(`🥬 ${state.inv.cabbage|0}`, x,y); x+=70;
    ctx.fillText(`🌱🥬 ${state.inv.cabbageSeed|0}`, x,y); x+=88;
    ctx.fillText(`💶 ${state.inv.euro|0}`, x,y); x+=70;
    ctx.fillText(`🔹 ${state.inv.ammo|0}`, x,y); x+=70;
    const barW = 110, barH = 10; const sx = x, sy = y-10;
    ctx.fillStyle="rgba(255,255,255,0.18)"; ctx.fillRect(sx, sy, barW, barH);
    const p = state.stamina.value/state.stamina.max;
    ctx.fillStyle = p>0.5? "#34d399" : (p>0.2? "#f59e0b" : "#ef4444");
    ctx.fillRect(sx, sy, barW*p, barH);
    ctx.strokeStyle="rgba(255,255,255,0.5)"; ctx.strokeRect(sx+0.5, sy+0.5, barW-1, barH-1);
    ctx.fillStyle="#fff"; ctx.font="12px system-ui"; ctx.fillText(`⚡ ${Math.round(state.stamina.value)}`, sx+barW+10, y);
    x += barW + 80;
    if(state.inv.hasCan) ctx.fillText(`💧 ${state.inv.can|0}/${state.inv.canMax|0}`, x,y), x+=120;
    if(state.carry.has){ ctx.fillStyle="#cbd5e1"; ctx.fillText("🚚 Trägt FELSEN", x,y); }

    ctx.textAlign="right"; ctx.fillText(`🌞`, cv.clientWidth-16, y); ctx.textAlign="left";
    ctx.fillStyle="#ddd"; ctx.font="12px system-ui"; ctx.fillText(state.version, 10, cv.clientHeight-10);

    ellipse(ui.joy.cx,ui.joy.cy,ui.joy.r,ui.joy.r,"rgba(24,34,44,.55)");
    ellipse(ui.joy.cx,ui.joy.cy,ui.joy.r-6,ui.joy.r-6,"rgba(60,80,96,.18)");
    ellipse(ui.joy.cx+ui.joy.vx*(ui.joy.r-12), ui.joy.cy+ui.joy.vy*(ui.joy.r-12), 32,32, "#1f2937");
    ellipse(ui.ctxBtn.x,ui.ctxBtn.y,ui.ctxBtn.r,ui.ctxBtn.r, ui.ctxBtn.enabled?"#2563eb":"#3b4551");
    ctx.fillStyle="#fff"; ctx.font="28px system-ui"; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText(ui.ctxBtn.icon, ui.ctxBtn.x, ui.ctxBtn.y+2);
    ctx.textAlign="left"; ctx.textBaseline="alphabetic";
    ellipse(ui.restart.x, ui.restart.y, ui.restart.r, ui.restart.r, "#3b4551");
    ctx.fillStyle="#fff"; ctx.font="18px system-ui"; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText("🔄", ui.restart.x, ui.restart.y+1);
    ctx.textAlign="left"; ctx.textBaseline="alphabetic";
    if(TOAST.t>0){ ctx.fillStyle="rgba(0,0,0,.8)"; const tw=ctx.measureText(TOAST.text).width+22; ctx.fillRect((cv.clientWidth-tw)/2, cv.clientHeight-120, tw, 30); ctx.fillStyle="#fff"; ctx.font="bold 14px system-ui"; ctx.fillText(TOAST.text, (cv.clientWidth-tw)/2+11, cv.clientHeight-100); }
  }

  function drawPreview(){
    if(!state.carry.has) return;
    const g=placementTargetCenter(), ok=canPlaceBoulder(g.x,g.y);
    ctx.globalAlpha=.6; drawBoulder(g.x,g.y); ctx.globalAlpha=1;
    ctx.strokeStyle = ok ? "rgba(56,189,248,.85)" : "rgba(239,68,68,.9)"; ctx.lineWidth=2; ctx.strokeRect(g.x-T/2+1, g.y-T/2+1, T-2, T-2);
  }

  function drawTutorialSign(){
    const tPos = toPx(MAPDATA.tutorial.x+0.5, MAPDATA.tutorial.y+0.5);
    const x=tPos.x, y=tPos.y; ctx.fillStyle="#8b5a2b"; ctx.fillRect(x - T*0.06, y - T*0.5, T*0.12, T*0.9);
    const w=T*1.6,h=T*0.8; ctx.fillStyle="#f0e9d6"; ctx.fillRect(x - w/2, y - T*0.80, w, h); ctx.strokeStyle="#856d45"; ctx.strokeRect(x - w/2+0.5, y - T*0.80+0.5, w-1, h-1);
    ctx.fillStyle="#333"; ctx.font=`bold ${Math.floor(T*0.26)}px system-ui`; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText("TUTORIAL", x, y - T*0.64);
    ctx.font=`${Math.floor(T*0.20)}px system-ui`; ctx.textAlign="left";
    const lines=[ "FELSEN: Space = aufnehmen / abstellen.",
      "Auf LICHTUNG: 🪓 Felsen → 🔹×8 (mit Upgrade).",
      "Bei FRED: 5 Felsen = 1💩  •  20 ⇒ Shop-Upgrade.",
      "💩 → 🌽 säen  •  🥬-Saat bei FRED  •  Nacht aus." ];
    let yy=y - T*0.30; for(const L of lines){ ctx.fillText(L, x - w/2 + 8, yy); yy += T*0.22; }
    ctx.textAlign="left"; ctx.textBaseline="alphabetic";
  }

  // ===== Bullets =====
  function updateBullets(){
    for (let i=state.bullets.length-1;i>=0;i--){
      const b=state.bullets[i]; b.x+=b.vx; b.y+=b.vy; b.life--;
      if (b.life<=0 || b.x<0||b.y<0||b.x>MAP_W*T||b.y>MAP_H*T){ state.bullets.splice(i,1); continue; }
    }
  }

  // ===== Loop =====
  let lastT = performance.now();
  function update(){ const now=performance.now(); const dt=now-lastT; lastT=now;
    updateDay(); updatePlants();
    if (state.sleeping){
      state.stamina.value = Math.min(state.stamina.max, state.stamina.value + 60*(dt/1000));
      if (state.stamina.value >= state.stamina.max - 0.01) { state.sleeping=false; say('Ausgeschlafen.'); }
      if(keys.size>0){ state.sleeping=false; }
    } else {
      updatePlayer();
    }
    updateContext(); maintainBoulderSpawn(dt); maintainMonsters(); updateMonsters(); updateBullets();if(TOAST.t>0){ TOAST.t-=dt/1000; if(TOAST.t<0) TOAST.t=0; }
  }
  function draw(){
    ctx.clearRect(0,0,cv.clientWidth,cv.clientHeight);
    drawBG();
    for(const b of state.boulders) drawBoulder(b.x,b.y);
    for(const d of state.dirts)    drawDirt(d.x,d.y);
    drawClearing(); drawFence(); drawStoneYard(); drawPond(); drawTutorialSign(); drawFred(); drawBerta(); drawStefan(); drawShack(); drawBed(); drawEditorTable();
    drawPlants();
    ctx.fillStyle="#cbd5e1"; for(const b of state.bullets){ ctx.beginPath(); ctx.arc(b.x,b.y,4,0,Math.PI*2); ctx.fill(); }
    drawPlayer();
    ctx.globalCompositeOperation='lighter'; for(let i=FX.length-1;i>=0;i--){ const p=FX[i]; p.x+=p.vx; p.y+=p.vy; p.vx*=0.92; p.vy*=0.92; p.a*=0.96; p.t--; ctx.fillStyle=`rgba(240,220,180,${p.a})`; ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill(); if(p.t<=0||p.a<0.05) FX.splice(i,1); } ctx.globalCompositeOperation='source-over';
    drawPreview(); drawSleepOverlay(); drawHUD();
  }

  function cullOutOfWorld(){ const min=T/2, maxX=MAP_W*T - T/2, maxY=MAP_H*T - T/2;
    state.boulders = state.boulders.filter(s => s.x>=min && s.x<=maxX && s.y>=min && s.y<=maxY);
    state.dirts    = state.dirts.filter(s => s.x>=min && s.y>=min && s.x<=maxX && s.y<=maxY);
    state.plants   = state.plants.filter(p => p.x>=min && p.x<=maxX && p.y>=min && p.y<=maxY);
  }

  // ===== Boot =====
  cullOutOfWorld();
  placeBertaBlockade();
  spawnPlayer();
  (function loop(){ update(); draw(); requestAnimationFrame(loop); })();
})();
