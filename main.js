/* =========================================================================
   Poopboy v0.7.0 – Rework Steinsystem (Felsen tragen)
   - Felsen (Boulders) nicht im Inventar; tragen/abstellen per Space/Kontext
   - Tragen verlangsamt + anderes Gesicht; Felsen sichtbar über Kopf
   - Alle Felsen blocken (natürliche & platzierte)
   - Freds Steinbereich (eingezäunt): 5 Felsen => 1 💩, bei 20 => Shop-Upgrade
   - Seltener/langsamer Felsen-Spawn; Erdbrocken unverändert
   - Fix: Highlighter = Tile vor dem Spieler; unsichtbare Steine behoben
   - Neustart-Button mit Bestätigung; Kontextbutton via Leertaste
   ========================================================================= */
(() => {
  // ----- Canvas -----
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

  // ----- Helpers -----
  const T= WORLD.TILE, MAP_W=WORLD.W, MAP_H=WORLD.H;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const dist=(ax,ay,bx,by)=>Math.hypot(ax-bx,ay-by);
  const toPx=(tx,ty)=>({x:tx*T,y:ty*T});
  const toRectPx=(r)=>({x:r.x*T,y:r.y*T,w:r.w*T,h:r.h*T});
  const rectsOverlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
  const ellipse=(x,y,rx,ry,color)=>{ ctx.fillStyle=color; ctx.beginPath(); ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2); ctx.fill(); };
  function tileCenterFromPx(x,y){ const tx=Math.floor(x/T), ty=Math.floor(y/T); return {x:tx*T+T/2, y:ty*T+T/2}; }
  function placementTargetCenter(){
    const c = tileCenterFromPx(state.player.x,state.player.y);
    let dx=0,dy=0; if(state.player.dir==="left")dx=-1; else if(state.player.dir==="right")dx=1; else if(state.player.dir==="up")dy=-1; else dy=1;
    return { x: clamp(c.x+dx*T, T/2, MAP_W*T-T/2), y: clamp(c.y+dy*T, T/2, MAP_H*T-T/2) };
  }

  // ----- Areas -----
  const BASE_FARM  = toRectPx(MAPDATA.farm);
  const BASE_CLEAR = toRectPx(MAPDATA.clearing);
  const POND       = toRectPx(MAPDATA.pondRect);
  const TUTORIAL   = toPx(MAPDATA.tutorial.x+0.5, MAPDATA.tutorial.y+0.5);

  // ----- NPC-Positions & Freds Steinbereich (prozedural neben Fred) -----
  const FRED_TILE   = NPCS.find(n=>n.id==="fred");
  const FRED_POS    = toPx(FRED_TILE.x, FRED_TILE.y);
  const STEFAN_TILE = NPCS.find(n=>n.id==="stefan");
  const STEFAN_POS  = toPx(STEFAN_TILE.x, STEFAN_TILE.y);

  // Steinbereich: rechts neben Fred, 3x3 Tiles, eingezäunt
  const STONEYARD = {
    x: FRED_POS.x + T*2.4,
    y: FRED_POS.y - T*1.5,
    w: T*3, h: T*3
  };

  // ----- State -----
  const state={
    version: GAME_VERSION,
    player:{ x: BASE_CLEAR.x + T*1.2, y: BASE_CLEAR.y + BASE_CLEAR.h/2, r:T*0.38, dir:"right" },
    inv:{ poop:0, corn:0, cabbage:0, euro:0, cabbageSeed:0, hasCan:false, can:0, canMax:CAN_MAX, hasShoes:false, /* ammo optional */ pebble:0 },
    hearts:3,
    speedMult:1.0,
    isDay:true, prevIsDay:true, dayBase:performance.now(), timeScale:1.0,
    // Neue Sammlungen
    boulders:[],        // schwere Felsen (tragen/platzieren/handeln)
    dirts:[],           // Erdbrocken (unverändert)
    plants:[],
    monsters:[], bullets:[],
    // Tragen
    carry:{ has:false },
    // Bauflächen
    farm:{ ...BASE_FARM },
    clear:{ ...BASE_CLEAR },
    // Sonstiges
    shackBuilt:false,
    bertaBlockadePlaced:false,
    rng:(Date.now() ^ 0x9e3779b9)>>>0,
    god:false,
    dmgCooldown:0,
    // Freds Yard
    yard:{ count:0, upgraded:false }
  };
  function rnd(){ let x=state.rng; x^=x<<13; x^=x>>>17; x^=x<<5; state.rng=x>>>0; return (x>>>0)/4294967296; }

  // ----- Save/Load -----
  function save(){
    try{
      localStorage.setItem("pb_save_v7", JSON.stringify({
        inv:state.inv, hearts:state.hearts, speedMult:state.speedMult, dayBase:state.dayBase, timeScale:state.timeScale,
        plants:state.plants, boulders:state.boulders, dirts:state.dirts,
        farm:state.farm, clear:state.clear, shackBuilt:state.shackBuilt,
        bertaBlockadePlaced:state.bertaBlockadePlaced, god:state.god,
        yard:state.yard
      }));
    }catch{}
  }
  (function load(){
    try{
      const d=JSON.parse(localStorage.getItem("pb_save_v7")||"null"); if(!d) return;
      Object.assign(state.inv, d.inv||{});
      state.hearts = d.hearts ?? 3;
      state.speedMult = d.speedMult ?? 1.0;
      state.dayBase = d.dayBase ?? state.dayBase;
      state.timeScale = d.timeScale ?? 1.0;
      if (Array.isArray(d.boulders)) state.boulders = d.boulders;
      if (Array.isArray(d.dirts))    state.dirts = d.dirts;
      if (Array.isArray(d.plants))   state.plants = d.plants;
      if (d.farm)  state.farm = d.farm;
      if (d.clear) state.clear = d.clear;
      state.shackBuilt = !!d.shackBuilt;
      state.bertaBlockadePlaced = !!d.bertaBlockadePlaced;
      state.god = !!d.god;
      if (d.yard) state.yard = d.yard;
    }catch{}
  })();

  // ----- FX & Spawn -----
  const FX=[]; function dust(x,y){ for(let i=0;i<10;i++){ const a=Math.random()*Math.PI*2,s=1+Math.random()*2; FX.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,r:2+Math.random()*2,a:.9,t:28}); } }

  function spawnPlayer(){
    state.player.x = state.clear.x + state.clear.w * 0.5 - T*0.6;
    state.player.y = state.clear.y + state.clear.h * 0.5;
    state.player.dir="right"; dust(state.player.x,state.player.y); if (window.SFX) SFX.play("spawn");
  }

  // ---- Felsen & Erdbrocken
  const BOULDER_R = T*0.40;
  function drawBoulder(x,y){ // deutlich sichtbar
    ctx.fillStyle="#aeb8c2"; ctx.beginPath(); ctx.ellipse(x,y,BOULDER_R,BOULDER_R*0.85,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle="#8b97a4"; ctx.beginPath(); ctx.ellipse(x-BOULDER_R*0.35, y-BOULDER_R*0.25, BOULDER_R*0.35, BOULDER_R*0.28, 0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle="#dfe5ea"; ctx.beginPath(); ctx.ellipse(x+BOULDER_R*0.22, y-BOULDER_R*0.18, BOULDER_R*0.18, BOULDER_R*0.14, 0,0,Math.PI*2); ctx.fill();
  }
  function drawDirt(x,y){ ellipse(x,y,T*0.32,T*0.24,"#7a5a3a"); ellipse(x+T*0.10,y-T*0.06,T*0.10,T*0.07,"#5d452d"); }

  function canSpawnPickupAt(x,y){
    const r={x:x-T*0.5,y:y-T*0.5,w:T,h:T};
    if(rectsOverlap(r,POND)) return false;
    if(rectsOverlap(r,state.farm)) return false;
    if(rectsOverlap(r,state.clear)) return false;
    // nicht im Stein-Yard
    if(rectsOverlap(r,STONEYARD)) return false;
    // nicht auf Pflanzen oder Felsen
    for(const b of state.boulders) if(rectsOverlap(r,{x:b.x-T*0.5,y:b.y-T*0.5,w:T,h:T})) return false;
    for(const p of state.plants)   if(rectsOverlap(r,{x:p.x-T*0.5,y:p.y-T*0.5,w:T,h:T})) return false;
    return true;
  }
  function spawnRandomBoulder(){
    let tries=180;
    while(tries--){
      const tx=Math.floor(rnd()*MAP_W), ty=Math.floor(rnd()*MAP_H);
      const gx=tx*T+T/2, gy=ty*T+T/2;
      if(canSpawnPickupAt(gx,gy)){ state.boulders.push({x:gx,y:gy}); return true; }
    } return false;
  }
  function spawnRandomDirt(){
    let tries=120;
    while(tries--){
      const tx=Math.floor(rnd()*MAP_W), ty=Math.floor(rnd()*MAP_H);
      const gx=tx*T+T/2, gy=ty*T+T/2;
      if(canSpawnPickupAt(gx,gy)){ state.dirts.push({x:gx,y:gy}); return true; }
    } return false;
  }
  // initial seltener
  state.boulders.length=0; state.dirts.length=0;
  for(let i=0;i<24;i++) spawnRandomBoulder(); // vorher ~70
  for(let i=0;i<40;i++) spawnRandomDirt();
  // langsamer Nachspawn
  let boulderTimer=6000;
  function maintainBoulderSpawn(dt){
    boulderTimer-=dt* (state.isDay?1:0.6);
    if(boulderTimer<=0 && state.boulders.length<60){
      spawnRandomBoulder();
      boulderTimer= 12000 + Math.floor(rnd()*8000);
    }
  }

  // Berta-Blockade mit Felsen
  function placeBertaBlockade(){
    if (state.bertaBlockadePlaced) return;
    const b = NPCS.find(n=>n.id==="berta"); if(!b) return;
    const bp = toPx(b.x,b.y);
    const ring = [[-1,0],[1,0],[0,1],[0,-1],[-1,-1],[1,-1],[-1,1],[1,1]];
    for(const [ox,oy] of ring){
      const px = bp.x + ox*T, py = bp.y + oy*T;
      if (canSpawnPickupAt(px,py)) state.boulders.push({x:px,y:py});
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

  // ----- Pflanzen (unverändert) -----
  function inFarm(x,y){ const f=state.farm; return x>=f.x&&x<=f.x+f.w&&y>=f.y&&y<=f.y+f.h; }
  function findNearbyPlant(){ let best=null,bd=1e9; for(const p of state.plants){ const d=dist(state.player.x,state.player.y,p.x,p.y); if(d<T*0.9 && d<bd){bd=d;best=p;} } return best; }
  function plant(type){
    if(!state.isDay) return say("Nacht: Kein Anbau.");
    if(!inFarm(state.player.x,state.player.y)) return say("Nur im Feld!");
    const {x,y}=tileCenterFromPx(state.player.x,state.player.y);
    if(state.plants.some(p=>p.x===x&&p.y===y)) return say("Hier wächst bereits etwas.");
    // nicht auf Felsen
    for(const b of state.boulders) if(Math.hypot(x-b.x,y-b.y)<T*0.5) return say("Blockiert durch Felsen.");
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
      const prog= Math.max(0, Math.min(1, 1-((p.readyAt-now)/total)));
      p.stage = prog<0.33?0 : prog<0.66?1 : prog<0.99?2 : 3;
    }
  }

  // ----- Fred Yard Logik -----
  function inStoneYard(x,y){ return x>=STONEYARD.x && x<=STONEYARD.x+STONEYARD.w && y>=STONEYARD.y && y<=STONEYARD.y+STONEYARD.h; }
  function depositBoulderAtFred(){
    // Ablegen zählt NICHT als platzieren im Feld, sondern in den Yard
    state.yard.count++;
    if (SFX) SFX.play("drop");
    // alle 5: 1 💩
    if (state.yard.count % 5 === 0){ state.inv.poop++; say("💩 +1 (5 Felsen abgegeben)"); }
    // bei 20: Upgrade
    if (!state.yard.upgraded && state.yard.count >= 20){
      state.yard.count = 0; // verkauft, Bereich leert sich
      state.yard.upgraded = true;
      say("🛠️ Fecalfreds Shop hat ein Upgrade erhalten!");
    }
    save();
  }

  // ----- Monster & Schleuder (unverändert, aber Schießen gesperrt beim Tragen) -----
  let monsterRespawnTimer=0;
  function maintainMonsters(dt){
    if (!state.isDay){
      monsterRespawnTimer -= dt;
      const target=4;
      if(state.monsters.length<target && monsterRespawnTimer<=0){
        let tries=200;
        while(tries--){
          const tx=Math.floor(rnd()*MAP_W), ty=Math.floor(rnd()*MAP_H);
          const x=tx*T+T/2, y=ty*T+T/2;
          const r={x:x-T*0.5,y:y-T*0.5,w:T,h:T};
          if(rectsOverlap(r,POND)||rectsOverlap(r,state.farm)||rectsOverlap(r,state.clear)||rectsOverlap(r,STONEYARD)) { tries--; continue; }
          if(dist(x,y,state.player.x,state.player.y)<T*8) { tries--; continue; }
          state.monsters.push({x,y,hp:2}); break;
        }
        monsterRespawnTimer=2000;
      }
    } else { state.monsters.length=0; monsterRespawnTimer=0; }
  }
  function fireTowards(tx,ty){
    if(state.carry.has) return say("Zu schwer: Felsen erst ablegen!");
    // Hinweis: bisherige Steine-Ammo entfällt – vorläufig kein Verbrauch
    const dx=tx-state.player.x, dy=ty-state.player.y, m=Math.hypot(dx,dy)||1;
    const speed=8.0;
    state.bullets.push({x:state.player.x,y:state.player.y,vx:dx/m*speed,vy:dy/m*speed,life:90});
    if(SFX)SFX.play("shoot");
  }
  function fireAtNearestMonster(){
    let best=null,bd=1e9;
    for(const mo of state.monsters){ const d=dist(state.player.x,state.player.y,mo.x,mo.y); if(d<bd){bd=d;best=mo;} }
    if(!best) return say("Kein Ziel.");
    fireTowards(best.x,best.y);
  }

  function getSafeZoneRect(){
    if (!state.shackBuilt) return null;
    const c=state.clear, w=T*1.8, h=T*1.2;
    return { x:c.x+c.w/2-w/2, y:c.y+c.h/2-h/2, w, h };
  }

  function updateMonsters(){
    const speed=3.6*state.speedMult*0.5;
    const safe=getSafeZoneRect();
    for(let i=state.monsters.length-1;i>=0;i--){
      const m=state.monsters[i];
      if(!state.isDay){
        const dx=state.player.x-m.x, dy=state.player.y-m.y, L=Math.hypot(dx,dy)||1;
        let nx=m.x+(dx/L)*speed, ny=m.y+(dy/L)*speed;
        const RX={x:nx-T*0.5,y:m.y-T*0.5,w:T,h:T}, RY={x:m.x-T*0.5,y:ny-T*0.5,w:T,h:T};
        let bx=false,by=false;
        // Kollision mit Felsen
        for(const b of state.boulders){ const r={x:b.x-T*0.5,y:b.y-T*0.5,w:T,h:T}; if(rectsOverlap(RX,r))bx=true; if(rectsOverlap(RY,r))by=true; if(bx&&by)break; }
        if(rectsOverlap(RX,POND))bx=true; if(rectsOverlap(RY,POND))by=true;
        // Häuser/Feld/Zäune/Yard
        const FRED_HOUSE={ x:FRED_POS.x-T*1.0, y:FRED_POS.y-T*0.6, w:T*2.0, h:T*1.2 };
        const STEFAN_HOUSE={ x:STEFAN_POS.x-T*0.9, y:STEFAN_POS.y-T*0.9, w:T*1.8, h:T*1.1 };
        if(rectsOverlap(RX,FRED_HOUSE)||rectsOverlap(RX,STEFAN_HOUSE))bx=true;
        if(rectsOverlap(RY,FRED_HOUSE)||rectsOverlap(RY,STEFAN_HOUSE))by=true;
        if(fenceBlocks(RX)||yardFenceBlocks(RX))bx=true;
        if(fenceBlocks(RY)||yardFenceBlocks(RY))by=true;
        if(safe && (rectsOverlap(RX,safe)||rectsOverlap(RY,safe))){ bx=true; by=true; }
        if(!bx) m.x=nx; if(!by) m.y=ny;

        const d=dist(m.x,m.y,state.player.x,state.player.y);
        if(d<T*0.7){
          if(!state.god && state.dmgCooldown<=0){
            state.hearts=Math.max(0,state.hearts-1);
            state.dmgCooldown=220;
            const kx=(state.player.x-m.x)/(d||1), ky=(state.player.y-m.y)/(d||1);
            state.player.x+=kx*T*1.2; state.player.y+=ky*T*1.2;
            if(SFX){ SFX.play("hit"); SFX.play("deny"); } say("💢 Aua! -1 ❤");
            if(state.hearts<=0){ state.hearts=3; spawnPlayer(); say("Neu gestartet."); }
          }
        }
      } else { state.monsters.splice(i,1); }
    }
  }

  // ----- Bewegung & Kollision (Spieler) -----
  function fenceBlocks(rect){
    const f=state.farm;
    const gateW=T*1.2, gc=f.x+f.w/2, gl=gc-gateW/2, gr=gc+gateW/2;
    const overlapX = !(rect.x + rect.w < f.x || rect.x > f.x + f.w);
    const hitsTop   = rect.y < f.y && rect.y + rect.h > f.y && overlapX;
    const hitsLeft  = rect.x < f.x && rect.x + rect.w > f.x && rect.y < f.y + f.h && rect.y + rect.h > f.y;
    const hitsRight = rect.x < f.x + f.w && rect.x + rect.w > f.x + f.w && rect.y < f.y + f.h && rect.y + rect.h > f.y;
    let hitsBottom = false;
    const onBottom = rect.y + rect.h > f.y + f.h - 3 && rect.y < f.y + f.h + 3;
    if (onBottom && overlapX){
      const midL = Math.max(rect.x, f.x);
      const midR = Math.min(rect.x + rect.w, f.x + f.w);
      const throughGate = !(midR <= gl || midL >= gr);
      hitsBottom = !throughGate;
    }
    return hitsTop||hitsLeft||hitsRight||hitsBottom;
  }
  function yardFenceBlocks(rect){
    // Einfach geschlossener Zaun um STONEYARD (kein Tor)
    const f=STONEYARD;
    const overlapX = !(rect.x + rect.w < f.x || rect.x > f.x + f.w);
    const overlapY = !(rect.y + rect.h < f.y || rect.y > f.y + f.h);
    const hitsTop   = rect.y < f.y && rect.y + rect.h > f.y && overlapX;
    const hitsBottom= rect.y < f.y + f.h && rect.y + rect.h > f.y + f.h && overlapX;
    const hitsLeft  = rect.x < f.x && rect.x + rect.w > f.x && overlapY;
    const hitsRight = rect.x < f.x + f.w && rect.x + rect.w > f.x + f.w && overlapY;
    return hitsTop||hitsBottom||hitsLeft||hitsRight;
  }

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
      const base=3.6*state.speedMult;
      const sp = state.carry.has ? base*0.72 : base; // langsamer beim Tragen
      let nx=clamp(state.player.x+vx*sp, T/2, MAP_W*T-T/2);
      let ny=clamp(state.player.y+vy*sp, T/2, MAP_H*T-T/2);
      const RX={x:nx-T*0.5,y:state.player.y-T*0.5,w:T,h:T}, RY={x:state.player.x-T*0.5,y:ny-T*0.5,w:T,h:T};
      let bx=false,by=false;
      // Felsen kollidieren
      for(const b of state.boulders){ const r={x:b.x-T*0.5,y:b.y-T*0.5,w:T,h:T}; if(rectsOverlap(RX,r))bx=true; if(rectsOverlap(RY,r))by=true; if(bx&&by)break; }
      if(rectsOverlap(RX,POND))bx=true; if(rectsOverlap(RY,POND))by=true;
      const FRED_HOUSE={ x:FRED_POS.x-T*1.0, y:FRED_POS.y-T*0.6, w:T*2.0, h:T*1.2 };
      const STEFAN_HOUSE={ x:STEFAN_POS.x-T*0.9, y:STEFAN_POS.y-T*0.9, w:T*1.8, h:T*1.1 };
      if(rectsOverlap(RX,FRED_HOUSE)||rectsOverlap(RX,STEFAN_HOUSE))bx=true;
      if(rectsOverlap(RY,FRED_HOUSE)||rectsOverlap(RY,STEFAN_HOUSE))by=true;
      if(fenceBlocks(RX)||yardFenceBlocks(RX))bx=true;
      if(fenceBlocks(RY)||yardFenceBlocks(RY))by=true;
      if(!bx) state.player.x=nx; if(!by) state.player.y=ny;
    }
    if (state.dmgCooldown>0) state.dmgCooldown--;
  }

  // ----- Input -----
  const keys=new Set();
  window.addEventListener('keydown', e=>{
    const k=e.key.toLowerCase(); keys.add(k);
    if ((e.code==="Space"||e.key===" ") && ui.ctxBtn.enabled && typeof ui.ctxBtn.action==="function"){ e.preventDefault(); ui.ctxBtn.action(); }
  });
  window.addEventListener('keyup', e=>keys.delete(e.key.toLowerCase()));

  cv.addEventListener('pointerdown', e=>{
    const r=cv.getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top;
    // Restart
    if (dist(x,y,ui.restart.x,ui.restart.y) <= ui.restart.r){
      if (confirm("Spiel neu starten? Dein Fortschritt wird gelöscht.")){
        try{ localStorage.removeItem("pb_save_v7"); }catch{}
        location.reload();
      }
      return;
    }
    // Kontext
    if(dist(x,y,ui.ctxBtn.x,ui.ctxBtn.y)<=ui.ctxBtn.r){ if(ui.ctxBtn.enabled&&ui.ctxBtn.action) ui.ctxBtn.action(); return; }
    // Joystick
    if(dist(x,y,ui.joy.cx,ui.joy.cy)<=ui.joy.r){ ui.joy.active=true; ui.joy.id=e.pointerId; const dx=x-ui.joy.cx,dy=y-ui.joy.cy,m=Math.hypot(dx,dy),s=Math.min(1,m/(ui.joy.r-8)); ui.joy.vx=(m<8?0:dx/m)*s; ui.joy.vy=(m<8?0:dy/m)*s; return; }
    // Map-Schuss
    if (state.monsters.length>0){ fireTowards(x,y); return; }
    if(ui.tutorial) ui.tutorial=false;
  });
  cv.addEventListener('pointermove', e=>{
    if(!ui.joy.active||e.pointerId!==ui.joy.id) return;
    const r=cv.getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top;
    const dx=x-ui.joy.cx, dy=y-ui.joy.cy, m=Math.hypot(dx,dy), s=Math.min(1,m/(ui.joy.r-8));
    ui.joy.vx=(m<8?0:dx/m)*s; ui.joy.vy=(m<8?0:dy/m)*s;
  });
  window.addEventListener('pointerup', e=>{ if(ui.joy.active&&e.pointerId===ui.joy.id){ ui.joy.active=false; ui.joy.id=null; ui.joy.vx=ui.joy.vy=0; } });

  // ----- Kontextlogik (Pickup / Deposit / Place / Pflanzen / Shops) -----
  function nearestBoulderIndex(){ let i=-1,bd=1e9; for(let k=0;k<state.boulders.length;k++){ const b=state.boulders[k]; const d=dist(state.player.x,state.player.y,b.x,b.y); if(d<T*0.8 && d<bd){i=k;bd=d;} } return i; }
  function canPlaceBoulder(px,py){
    // nicht in Teich, nicht auf Spieler, nicht auf Pflanze/Felsen, nicht im Fred-Zaun (innen)
    if(rectsOverlap({x:px-T*0.5,y:py-T*0.5,w:T,h:T},POND)) return false;
    if(inStoneYard(px,py)) return false; // Yard ist nur zum Abgeben
    if(Math.hypot(px-state.player.x,py-state.player.y) < state.player.r + BOULDER_R + 4) return false;
    for(const b of state.boulders) if(Math.hypot(px-b.x,py-b.y)<BOULDER_R*2-6) return false;
    for(const p of state.plants)   if(Math.hypot(px-p.x,py-p.y)<T*0.5) return false;
    return true;
  }

  function openModal(){ backdrop.classList.add("open"); modal.classList.add("open"); }
  function closeModal(){ modal.classList.remove("open"); backdrop.classList.remove("open"); }
  const backdrop=document.getElementById("backdrop");
  const modal=document.getElementById("modal");
  const mList=document.getElementById("m_list");
  const mTitle=document.getElementById("m_title");
  const mSub=document.getElementById("m_sub");
  const mPortrait=document.getElementById("m_portrait");
  const mClose=document.getElementById("m_close");
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
      mPortrait.textContent="🧑‍🌾";
      mTitle.textContent = state.yard.upgraded ? "Fecalfred (Upgrade)" : "Fecalfred";
      mSub.textContent   = state.yard.upgraded ? "Neues Angebot dank Felsen-Verkauf" : "Tauscht Felsen gegen 💩";
      addRow({icon:"🧱", name:"Felsen abgeben", desc:"Lege Felsen in den eingezäunten Bereich.", price:`Yard: ${state.yard.count}/20`, button:"OK"});
      addRow({icon:"🔁", name:"5 Felsen → 1 💩", desc:"Automatisch beim Abgeben.", price:"—", button:"OK"});
      // Standard-Verkauf
      addRow({icon:"🌽", name:"Mais verkaufen", desc:"+1 €", price:"+1 €", button:"Verkaufen", disabled: state.inv.corn<1,
        onClick:()=>{ state.inv.corn--; state.inv.euro+=ECON.cornSell; save(); openShop('fred'); }});
      addRow({icon:"🥬", name:"Kohl verkaufen", desc:"+7 €", price:"+7 €", button:"Verkaufen", disabled: state.inv.cabbage<1,
        onClick:()=>{ state.inv.cabbage--; state.inv.euro+=ECON.cabbageSell; save(); openShop('fred'); }});
      // Upgrade-Angebote
      if(state.yard.upgraded){
        addRow({icon:"💩", name:"💩 kaufen", desc:"1x Dünger", price:"6 €", button:"Kaufen", disabled: state.inv.euro<6,
          onClick:()=>{ state.inv.euro-=6; state.inv.poop++; save(); openShop('fred'); }});
        addRow({icon:"🛒", name:"Werkel-Karren", desc:"+10% Speed beim Tragen", price:"10 €", button: state.inv.cart?"Gekauft":"Kaufen",
          disabled: state.inv.cart || state.inv.euro<10, onClick:()=>{ state.inv.cart=true; save(); openShop('fred'); }});
      }
    } else if(kind==='berta'){
      mPortrait.textContent="👩‍🎨"; mTitle.textContent="Berta Brown"; mSub.textContent="Upgrades (Tag)";
      addRow({icon:"💧", name:"Gießkanne", desc:"Permanent. 13 Nutzungen. Am Teich auffüllen.", price:"5 €", button: state.inv.hasCan?"Gekauft":"Kaufen",
        disabled: state.inv.hasCan || state.inv.euro<5, onClick:()=>{ state.inv.hasCan=true; state.inv.can=state.inv.canMax; state.inv.euro-=5; save(); openShop('berta'); }});
      addRow({icon:"👟", name:"Schnelle Schuhe", desc:"+35% Laufgeschwindigkeit", price:"7 €", button: state.inv.hasShoes?"Gekauft":"Kaufen",
        disabled: state.inv.hasShoes || state.inv.euro<7, onClick:()=>{ state.inv.hasShoes=true; state.speedMult=1.35; state.inv.euro-=7; save(); openShop('berta'); }});
    } else {
      mPortrait.textContent="🧙‍♂️"; mTitle.textContent="Stefan Spielverderber"; mSub.textContent="Tests & Cheats";
      addRow({icon:"💶", name:"+50 €", button:"+50", onClick:()=>{ state.inv.euro+=50; save(); openShop('stefan'); }});
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

  // ----- Kontext-Button-Logik -----
  function updateContext(){
    let icon="❓", enabled=false, action=null;

    // Shops / Teich / Toolbox / Tutorial
    const fred = FRED_POS;
    const berta= toPx(NPCS.find(n=>n.id==="berta").x,  NPCS.find(n=>n.id==="berta").y);
    const stefan=STEFAN_POS;
    const near=(px,py,qx,qy,r)=>dist(px,py,qx,qy)<r;

    if(near(state.player.x,state.player.y,TUTORIAL.x,TUTORIAL.y,T*0.9)){
      icon="📜"; enabled=true; action=()=>{ ui.tutorial=true; };
    } else if(near(state.player.x,state.player.y,fred.x,fred.y,T*1.2) && state.isDay){
      icon="🛒"; enabled=true; action=()=>openShop('fred');
    } else if(near(state.player.x,state.player.y,berta.x,berta.y,T*1.2) && state.isDay){
      icon="🛒"; enabled=true; action=()=>openShop('berta');
    } else if(near(state.player.x,state.player.y,stefan.x,stefan.y,T*1.2)){
      icon="🧙‍♂️"; enabled=true; action=()=>openShop('stefan');
    } else if(near(state.player.x,state.player.y,POND.x+POND.w/2,POND.y+POND.h/2,T*2.0)){
      icon="💧"; enabled=state.inv.hasCan; action=()=>{ if(!state.inv.hasCan) return say("Keine Gießkanne."); state.inv.can=state.inv.canMax; save(); say("💧 Gießkanne aufgefüllt!"); };
    } else {
      // 1) Wenn trägt → Abladen im Yard ODER platzieren vor sich
      const g = placementTargetCenter();
      if(state.carry.has){
        if (inStoneYard(state.player.x, state.player.y)){
          icon="⬇️"; enabled=true; action=()=>{ state.carry.has=false; depositBoulderAtFred(); save(); };
        } else {
          const ok=canPlaceBoulder(g.x,g.y);
          icon = ok ? "📦" : "🚫"; enabled=ok; action=()=>{ state.carry.has=false; state.boulders.push({x:g.x,y:g.y}); if(SFX)SFX.play("drop"); dust(g.x,g.y); save(); };
        }
      } else {
        // 2) Nicht trägt → Felsen aufnehmen, Pflanzen, Erdbrocken, Kampf
        const bi=nearestBoulderIndex();
        if (bi>=0){
          icon="🪨"; enabled=true; action=()=>{ const b=state.boulders[bi]; state.boulders.splice(bi,1); state.carry.has=true; if(SFX)SFX.play("pickup"); };
        } else {
          const p=findNearbyPlant();
          if(p && p.stage>=3){ icon="🌾"; enabled=true; action=harvest; }
          else if(p && p.stage<3 && state.inv.hasCan && state.inv.can>0 && !p.watered){ icon="💧"; enabled=true; action=water; }
          else {
            // Erdbrocken
            const di = (function(){ let i=-1,bd=1e9; for(let k=0;k<state.dirts.length;k++){ const d=state.dirts[k]; const dd=dist(state.player.x,state.player.y,d.x,d.y); if(dd<T*0.7&&dd<bd){i=k;bd=dd;} } return i; })();
            if(di>=0){ icon="🪵"; enabled=true; action=()=>{ state.dirts.splice(di,1); const chance=0.10+rnd()*0.05; if(rnd()<chance){ state.inv.poop++; say("💩 Glück gehabt!"); } else say("🪵 Erdbrocken."); save(); if(SFX)SFX.play("pickup"); }; }
            else if(state.monsters.length>0){ icon="🎯"; enabled=true; action=fireAtNearestMonster; }
            else { icon="🚫"; enabled=false; }
          }
        }
      }
    }
    ui.ctxBtn.icon=icon; ui.ctxBtn.enabled=enabled; ui.ctxBtn.action=action;
  }

  // ----- Draw World -----
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
  function drawStoneYard(){
    const f=STONEYARD;
    ctx.fillStyle="rgba(180,180,180,0.10)"; ctx.fillRect(f.x,f.y,f.w,f.h);
    ctx.strokeStyle="#8a6a3a"; ctx.lineWidth=3;
    // Zaun Rechteck
    ctx.strokeRect(f.x, f.y, f.w, f.h);
    // Pfähle
    for(let x=f.x; x<=f.x+f.w; x+=T){ ctx.beginPath(); ctx.moveTo(x,f.y); ctx.lineTo(x,f.y+f.h); ctx.stroke(); }
    for(let y=f.y; y<=f.y+f.h; y+=T){ ctx.beginPath(); ctx.moveTo(f.x,y); ctx.lineTo(f.x+f.w,y); ctx.stroke(); }
    // Schild
    ctx.fillStyle="#f8f5e7"; const w=T*2.2,h=T*0.6; const sx=f.x+f.w/2-w/2, sy=f.y-h-T*0.3;
    ctx.fillRect(sx,sy,w,h); ctx.strokeStyle="#7b5b2b"; ctx.strokeRect(sx+.5,sy+.5,w-1,h-1);
    ctx.fillStyle="#333"; ctx.font=`bold ${Math.floor(T*0.30)}px system-ui`; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(`FELSEN-YARD (${state.yard.count}/20)`, sx+w/2, sy+h/2);
    ctx.textAlign="left"; ctx.textBaseline="alphabetic";
  }
  function drawPond(){
    const cx=POND.x+POND.w/2, cy=POND.y+POND.h/2, rx=POND.w*0.48, ry=POND.h*0.46;
    ctx.fillStyle="#1b4d6b"; ctx.beginPath(); ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle="rgba(180,220,255,0.3)"; ctx.lineWidth=2;
    for(let i=1;i<=4;i++){ ctx.beginPath(); ctx.ellipse(cx,cy, rx*i/4, ry*i/4, 0, 0, Math.PI*2); ctx.stroke(); }
  }
  function drawFred(){
    const p=FRED_POS, hx=p.x-T, hy=p.y-T;
    // Upgrade-Grafik
    ctx.fillStyle= state.yard.upgraded ? "#6b4630" : "#6b4630";
    ctx.fillRect(hx-T*0.5,hy-T*0.5,T*2,T*1.6);
    ctx.fillStyle= state.yard.upgraded ? "#b24f2f" : "#9b3b2e";
    ctx.fillRect(hx-T*0.6,hy-T*1.0,T*2.4,T*0.45);
    ctx.fillStyle="#2b1c11"; ctx.fillRect(hx+T*0.2,hy+T*0.6,T*0.5,T*0.7);
    const w=T*2.8,h=T*0.7; ctx.fillStyle="#f8f5e7"; ctx.fillRect(p.x-w/2,hy+T*1.25,w,h);
    ctx.fillStyle="#2b2b2b"; ctx.font=`bold ${Math.floor(T*0.34)}px system-ui`; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(state.yard.upgraded?"FECALFRED ++":"FECALFRED", p.x, hy + T*1.25 + h/2); ctx.textAlign="left"; ctx.textBaseline="alphabetic";
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
    const p=STEFAN_POS;
    ctx.fillStyle="#9c7a00"; ctx.fillRect(p.x-T*0.9,p.y-T*0.9,T*1.8,T*1.1);
    ctx.fillStyle="#ffd54a"; ctx.fillRect(p.x-T*1.2,p.y-T*1.25,T*2.4,T*0.5);
    ctx.fillStyle="#2b1c11"; ctx.fillRect(p.x-T*0.2,p.y-T*0.1,T*0.4,T*0.6);
    ctx.fillStyle="#f8f5e7"; ctx.fillRect(p.x-T*1.4,p.y+T*0.8,T*2.8,T*0.45);
    ctx.fillStyle="#2b2b2b"; ctx.font=`bold ${Math.floor(T*0.32)}px system-ui`; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText("STEFAN SPIELVERDERBER", p.x, p.y+T*1.02); ctx.textAlign="left"; ctx.textBaseline="alphabetic";
  }
  function drawClearing(){ const c=state.clear; ctx.fillStyle="#1a5a2d"; ctx.fillRect(c.x,c.y,c.w,c.h); ctx.strokeStyle="rgba(180,220,150,0.35)"; ctx.strokeRect(c.x,c.y,c.w,c.h); }
  function drawShack(){ if(!state.shackBuilt) return; const c=state.clear; const sx=c.x+c.w/2 - T*0.8, sy=c.y+c.h/2 - T*0.8; ctx.fillStyle="#5a4636"; ctx.fillRect(sx,sy,T*1.6,T*1.0); ctx.fillStyle="#a44b3a"; ctx.fillRect(sx - T*0.2, sy - T*0.45, T*2.0, T*0.45); ctx.fillStyle="#26180e"; ctx.fillRect(sx + T*0.6, sy + T*0.3, T*0.4, T*0.5); }

  function drawPlayer(){
    const p=state.player;
    // Körper
    ellipse(p.x,p.y,p.r,p.r,"#e6b35a");
    // Augenrichtung
    let fx=0,fy=0; if(p.dir==="left")fx=-1; else if(p.dir==="right")fx=1; else if(p.dir==="up")fy=-1; else fy=1;
    const sx=-fy, sy=fx, eR=p.r*0.11, off=6, ex=p.x+fx*(p.r*0.25), ey=p.y+fy*(p.r*0.25);
    // Augen
    ellipse(ex+sx*off, ey+sy*off, eR, eR, "#fff");
    ellipse(ex-sx*off, ey-sy*off, eR, eR, "#fff");
    ellipse(ex+sx*off+fx*eR*0.6, ey+sy*off+fy*eR*0.6, eR*0.55, eR*0.55, "#111");
    ellipse(ex-sx*off+fx*eR*0.6, ey-sy*off+fy*eR*0.6, eR*0.55, eR*0.55, "#111");
    // Mund: angestrengt wenn trägt
    ctx.fillStyle="#3b2a18";
    if(state.carry.has){
      ctx.beginPath(); ctx.moveTo(p.x-5,p.y+8); ctx.quadraticCurveTo(p.x,p.y+14,p.x+5,p.y+8); ctx.strokeStyle="#3b2a18"; ctx.lineWidth=2; ctx.stroke();
      // Schweiß
      ctx.fillStyle="rgba(180,220,255,0.8)"; ctx.beginPath(); ctx.ellipse(p.x+10,p.y-2,2,3,0,0,Math.PI*2); ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(p.x-5,p.y+10); ctx.quadraticCurveTo(p.x,p.y+8,p.x+5,p.y+10); ctx.strokeStyle="#3b2a18"; ctx.lineWidth=2; ctx.stroke();
    }
    // Getragener Felsen über Kopf
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

  // ----- HUD & Preview -----
  const HUD_H=48, HUD_Y=0;
  function drawHUD(){
    // Top-Bar
    ctx.fillStyle="rgba(0,0,0,0.55)";
    ctx.fillRect(0, HUD_Y, cv.clientWidth, HUD_H);

    // Stats
    let x=12,y=22;
    ctx.fillStyle="#fff"; ctx.font="bold 14px system-ui";
    ctx.fillText(`❤ ${state.hearts}`, x,y); x+=70;
    ctx.fillText(`🌽 ${state.inv.corn}`, x,y); x+=80;
    ctx.fillText(`🥬 ${state.inv.cabbage}`, x,y); x+=90;
    ctx.fillText(`💶 ${state.inv.euro}`, x,y); x+=90;
    if(state.inv.hasCan) ctx.fillText(`💧 ${state.inv.can}/${state.inv.canMax}`, x,y); x+=120;
    // Tragen-Hinweis
    if(state.carry.has){ ctx.fillStyle="#cbd5e1"; ctx.fillText("🚚 Trägt FELSEN", x,y); }

    // Uhr rechts
    const el=((performance.now()-state.dayBase)*state.timeScale)%DAY_TOTAL_MS;
    const hh=Math.floor((el/DAY_TOTAL_MS)*24), mm=Math.floor(((el/DAY_TOTAL_MS)*24-hh)*60);
    ctx.textAlign="right"; ctx.fillText(`${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')} ${state.isDay?'🌞':'🌙'}`, cv.clientWidth-48, y); ctx.textAlign="left";

    // Version
    ctx.fillStyle="#ddd"; ctx.font="12px system-ui"; ctx.fillText(state.version, 10, cv.clientHeight-10);

    // Joystick
    ctx.globalAlpha=.9; ellipse(ui.joy.cx,ui.joy.cy,ui.joy.r,ui.joy.r,"rgba(24,34,44,.55)");
    ellipse(ui.joy.cx,ui.joy.cy,ui.joy.r-6,ui.joy.r-6,"rgba(60,80,96,.18)");
    ellipse(ui.joy.cx+ui.joy.vx*(ui.joy.r-12), ui.joy.cy+ui.joy.vy*(ui.joy.r-12), 32,32, "#1f2937");
    ctx.globalAlpha=1;

    // Kontextbutton
    ellipse(ui.ctxBtn.x,ui.ctxBtn.y,ui.ctxBtn.r,ui.ctxBtn.r,ui.ctxBtn.enabled?"#2563eb":"#3b4551");
    ctx.fillStyle="#fff"; ctx.font="28px system-ui"; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(ui.ctxBtn.icon, ui.ctxBtn.x, ui.ctxBtn.y+2);
    ctx.textAlign="left"; ctx.textBaseline="alphabetic";

    // Neustart
    ellipse(ui.restart.x, ui.restart.y, ui.restart.r, "#3b4551");
    ctx.fillStyle="#fff"; ctx.font="18px system-ui"; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText("🔄", ui.restart.x, ui.restart.y+1);
    ctx.textAlign="left"; ctx.textBaseline="alphabetic";

    // Toast
    if(TOAST.t>0){ ctx.fillStyle="rgba(0,0,0,.8)"; const tw=ctx.measureText(TOAST.text).width+22;
      ctx.fillRect((cv.clientWidth-tw)/2, cv.clientHeight-120, tw, 30);
      ctx.fillStyle="#fff"; ctx.font="bold 14px system-ui";
      ctx.fillText(TOAST.text, (cv.clientWidth-tw)/2+11, cv.clientHeight-100);
    }
  }
  function drawPreview(){
    if(!state.carry.has) return; // nur beim Tragen
    const g=placementTargetCenter(), ok=canPlaceBoulder(g.x,g.y);
    ctx.globalAlpha=.6; drawBoulder(g.x,g.y); ctx.globalAlpha=1;
    // Overlayfarbe
    ctx.strokeStyle = ok ? "rgba(56,189,248,.85)" : "rgba(239,68,68,.9)";
    ctx.lineWidth=2; ctx.strokeRect(g.x-T/2+1, g.y-T/2+1, T-2, T-2);
  }

  function drawTutorialSign(){
    const x=TUTORIAL.x, y=TUTORIAL.y;
    ctx.fillStyle="#8b5a2b"; ctx.fillRect(x - T*0.06, y - T*0.5, T*0.12, T*0.9);
    const w=T*1.4,h=T*0.62; ctx.fillStyle="#f0e9d6"; ctx.fillRect(x - w/2, y - T*0.75, w, h);
    ctx.strokeStyle="#856d45"; ctx.strokeRect(x - w/2+0.5, y - T*0.75+0.5, w-1, h-1);
    ctx.fillStyle="#333"; ctx.font=`bold ${Math.floor(T*0.26)}px system-ui`; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText("TUTORIAL", x, y - T*0.60);
    ctx.font=`${Math.floor(T*0.20)}px system-ui`; ctx.textAlign="left";
    const lines=[
      "FELSEN: Space = aufnehmen/abstellen.",
      "Im Zaun bei Fred ablegen → 5 Felsen = 1💩.",
      "Bei 20 Felsen: Freds Shop-Upgrade.",
      "💩 → 🌽; 🥬-Saat bei Fred; Nacht = Monster."
    ]; let yy=y - T*0.25; for(const L of lines){ ctx.fillText(L, x - w/2 + 8, yy); yy += T*0.22; }
    ctx.textAlign="left"; ctx.textBaseline="alphabetic";
  }

  // ----- Toast -----
  const TOAST={t:0,text:""}; function say(s){ TOAST.text=s; TOAST.t=1.6; }

  // ----- Bullets -----
  function updateBullets(){
    for (let i=state.bullets.length-1;i>=0;i--){
      const b=state.bullets[i];
      b.x+=b.vx; b.y+=b.vy; b.life--;
      if (b.life<=0){ state.bullets.splice(i,1); continue; }
      if (b.x<0||b.y<0||b.x>MAP_W*T||b.y>MAP_H*T){ state.bullets.splice(i,1); continue; }
      for (let j=state.monsters.length-1;j>=0;j--){
        const m=state.monsters[j];
        if (dist(b.x,b.y,m.x,m.y)<T*0.4){
          if(SFX)SFX.play("hit");
          m.hp--; state.bullets.splice(i,1);
          if(m.hp<=0){ if(SFX)SFX.play("kill"); dropFromMonster(m.x,m.y); state.monsters.splice(j,1); }
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

  // ----- Loop -----
  function update(){
    const now=performance.now();
    const dt = update._t ? (now - update._t) : 16; update._t=now;

    updateDay(); updatePlants(); updatePlayer(); updateContext();
    maintainBoulderSpawn(dt);
    maintainMonsters(dt);
    updateMonsters(); updateBullets();
    if(TOAST.t>0){ TOAST.t-=dt/1000; if(TOAST.t<0) TOAST.t=0; }
  }
  function draw(){
    ctx.clearRect(0,0,cv.clientWidth,cv.clientHeight);
    drawBG();

    // Boden-Pickups zuerst
    for(const b of state.boulders) drawBoulder(b.x,b.y);
    for(const d of state.dirts)    drawDirt(d.x,d.y);

    drawClearing(); drawFence(); drawStoneYard(); drawPond(); drawTutorialSign();
    drawFred(); drawBerta(); drawStefan(); drawShack();

    drawPlants();

    // Monster & Bullets
    for(const m of state.monsters){ ellipse(m.x,m.y,T*0.36,T*0.33,"#6b1f1f"); ctx.fillStyle="#111"; ctx.beginPath(); ctx.arc(m.x-6,m.y-4,3,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(m.x+6,m.y-4,3,0,Math.PI*2); ctx.fill(); }
    ctx.fillStyle="#cbd5e1"; for(const b of state.bullets){ ctx.beginPath(); ctx.arc(b.x,b.y,4,0,Math.PI*2); ctx.fill(); }

    drawPlayer();

    // FX & Night overlay
    ctx.globalCompositeOperation='lighter';
    for(let i=FX.length-1;i>=0;i--){ const p=FX[i]; p.x+=p.vx; p.y+=p.vy; p.vx*=0.92; p.vy*=0.92; p.a*=0.96; p.t--; ctx.fillStyle=`rgba(240,220,180,${p.a})`; ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill(); if(p.t<=0||p.a<0.05) FX.splice(i,1); }
    ctx.globalCompositeOperation='source-over';
    if(!state.isDay){ ctx.fillStyle="rgba(0,0,0,.35)"; ctx.fillRect(0,0,cv.clientWidth,cv.clientHeight); }

    drawPreview(); drawHUD();
  }

  function cullOutOfWorld(){
    const min=T/2, maxX=MAP_W*T - T/2, maxY=MAP_H*T - T/2;
    state.boulders = state.boulders.filter(s => s.x>=min && s.x<=maxX && s.y>=min && s.y<=maxY);
    state.dirts    = state.dirts.filter(s => s.x>=min && s.x<=maxX && s.y>=min && s.y<=maxY);
    state.plants   = state.plants.filter(p => p.x>=min && p.x<=maxX && p.y>=min && p.y<=maxY);
  }

  // ----- Boot -----
  placeBertaBlockade();
  cullOutOfWorld();
  spawnPlayer();
  (function loop(){ update(); draw(); requestAnimationFrame(loop); })();
})();
