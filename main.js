/* =========================================================================
   Poopboy – optimierte Mehrdatei-Version
   - Fullscreen + HiDPI
   - NPCs + Shops (Fred/Berta/Stefan)
   - Farm-Zaun + Lichtung + Tutorial-Schild
   - Teich-Kollision + Auffüllen
   - Tag/Nacht + Uhr
   - Steine (aufheben/platzieren) + Vorschau
   - Pflanzen (Poop → Mais / Kohlsaat → Kohl) + Gießen/Ernten
   - Berta-Blockade beim ersten Start/Neustart
   - Epischer Spawn-SFX + Staub
   - Version unten links
   ========================================================================= */

(() => {
  /* ---------- Canvas & DPI ---------- */
  const cv = document.getElementById("gameCanvas");
  const ctx = cv.getContext("2d", { alpha:false });
  function resizeCanvas() {
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

  /* ---------- Short names ---------- */
  const T = WORLD.TILE, MAP_W = WORLD.W, MAP_H = WORLD.H;

  /* ---------- DOM (modal) ---------- */
  const backdrop = document.getElementById("backdrop");
  const modal = document.getElementById("modal");
  const mList = document.getElementById("m_list");
  const mTitle = document.getElementById("m_title");
  const mSub = document.getElementById("m_sub");
  const mPortrait = document.getElementById("m_portrait");
  const mClose = document.getElementById("m_close");
  function openModal()  { backdrop.classList.add("open"); modal.classList.add("open"); }
  function closeModal() { modal.classList.remove("open"); backdrop.classList.remove("open"); }
  mClose.onclick = closeModal; backdrop.onclick = closeModal;

  /* ---------- Helpers ---------- */
  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  const dist = (ax,ay,bx,by)=>Math.hypot(ax-bx,ay-by);
  const toPx = (tx,ty)=>({x: tx*T, y: ty*T});
  const toRectPx = (r)=>({x:r.x*T, y:r.y*T, w:r.w*T, h:r.h*T});
  function rectsOverlap(a,b){ return a.x<b.x+b.w && a.x+a.w>b.x && a.y<b.y+b.h && a.y+a.h>b.y; }
  function ellipse(x,y,rx,ry,color){ ctx.fillStyle=color; ctx.beginPath(); ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2); ctx.fill(); }

  /* ---------- Areas ---------- */
  const FARM = toRectPx(MAPDATA.farm);
  const CLEAR = toRectPx(MAPDATA.clearing);
  const POND = toRectPx(MAPDATA.pondRect);
  const TUTORIAL = toPx(MAPDATA.tutorial.x+0.5, MAPDATA.tutorial.y+0.5);

  /* ---------- Entities / State ---------- */
  const state = {
    version: GAME_VERSION,
    player: { x: (CLEAR.x+T*1.2), y: (CLEAR.y + CLEAR.h/2), r: T*0.38, dir:"right" },
    inv: { stone:0, poop:0, corn:0, cabbage:0, euro:0, cabbageSeed:0, hasCan:false, can:0, canMax:CAN_MAX, hasShoes:false },
    speedMult: 1.0,
    isDay: true, wasDay: true, dayBase: performance.now(),
    stones: [], blocks: [], plants: [],
    monsters: [],
    bullets: [],
    uiSeed: null, // "poop"|"cabbageSeed"|"stone"|null
    bertaBlockadePlaced: false,
    rng: (Date.now() ^ 0x9e3779b9) >>> 0,
  };
  function rnd(){ let x=state.rng; x^=x<<13; x^=x>>>17; x^=x<<5; state.rng=x>>>0; return (x>>>0)/4294967296; }

  /* ---------- Save/Load ---------- */
  function save(){
    try{ localStorage.setItem("pb_save_v2", JSON.stringify({
      inv:state.inv, speedMult:state.speedMult, dayBase:state.dayBase, blocks:state.blocks,
      plants:state.plants, bertaBlockadePlaced:state.bertaBlockadePlaced
    })); }catch{}
  }
  (function load(){
    try{
      const d = JSON.parse(localStorage.getItem("pb_save_v2")||"null");
      if(!d) return;
      Object.assign(state.inv, d.inv||{});
      state.speedMult = d.speedMult||1.0;
      state.dayBase = d.dayBase||state.dayBase;
      if(Array.isArray(d.blocks)) state.blocks = d.blocks;
      if(Array.isArray(d.plants)) state.plants = d.plants;
      state.bertaBlockadePlaced = !!d.bertaBlockadePlaced;
    }catch{}
  })();

  /* ---------- Spawn / SFX ---------- */
  function spawnDust(x,y){
    for(let i=0;i<14;i++){
      const ang = Math.random()*Math.PI*2, sp = 1.5 + Math.random()*2.2;
      fx.push({ x,y,vx:Math.cos(ang)*sp, vy:Math.sin(ang)*sp, r:2.5+Math.random()*3, a:0.9, life:36 });
    }
  }
  function spawnPlayer(){
    state.player.x = CLEAR.x + T*1.2;
    state.player.y = CLEAR.y + CLEAR.h/2;
    state.player.dir="right";
    spawnDust(state.player.x, state.player.y);
    if (window.SFX) SFX.play("spawn");
  }

  /* ---------- Initial rocks ---------- */
  function canSpawnRockAt(x,y){
    const r = {x:x-T*0.5,y:y-T*0.5,w:T,h:T};
    if (rectsOverlap(r, POND)) return false;
    if (rectsOverlap(r, FARM)) return false;
    if (rectsOverlap(r, CLEAR)) return false;
    for (const b of state.blocks) if(rectsOverlap(r,{x:b.x-T*0.5,y:b.y-T*0.5,w:T,h:T})) return false;
    return true;
  }
  function spawnRandomStone(){
    let tries=80;
    while(tries--){
      const gx = Math.round(rnd()*MAP_W)*T + T/2;
      const gy = Math.round(rnd()*MAP_H)*T + T/2;
      if (canSpawnRockAt(gx,gy)){ state.stones.push({x:gx,y:gy}); return; }
    }
  }
  for(let i=0;i<120;i++) spawnRandomStone();

  // Berta-Blockade (einmalig pro Save)
  function placeBertaBlockade(){
    if (state.bertaBlockadePlaced) return;
    const b = NPCS.find(n=>n.id==="berta"); if(!b) return;
    const bp = toPx(b.x, b.y);
    const offsets = [[-1,0],[0,0],[1,0],[0,1]];
    for(const [ox,oy] of offsets){
      state.blocks.push({x: bp.x+ox*T, y: bp.y+oy*T});
    }
    state.bertaBlockadePlaced = true; save();
  }

  /* ---------- Day/Night ---------- */
  function updateDay(){
    const dt = (performance.now() - state.dayBase) % DAY_TOTAL_MS;
    state.isDay = dt < DAYLIGHT_MS;
  }

  /* ---------- Plants ---------- */
  function snapToTile(x,y){ return {x: Math.round(x/T)*T + 0, y: Math.round(y/T)*T + 0}; }
  function inFarm(x,y){ return x>=FARM.x && x<=FARM.x+FARM.w && y>=FARM.y && y<=FARM.y+FARM.h; }
  function plant(type){
    if(!state.isDay) return say("Nacht: Kein Anbau.");
    if(!inFarm(state.player.x, state.player.y)) return say("Nur im Feld!");
    const {x, y} = snapToTile(state.player.x, state.player.y);
    if (state.plants.some(p=>p.x===x && p.y===y)) return say("Hier wächst bereits etwas.");
    // Blocker verhindern
    for(const b of state.blocks) if (Math.hypot(x - b.x, y - b.y) < T*0.5) return say("Blockiert.");
    if(type==="corn"){
      if(state.inv.poop<=0) return say("💩 fehlt.");
      state.inv.poop--; state.plants.push({x,y,type:"corn",plantedAt:performance.now(),readyAt:performance.now()+PLANTS.corn.growMs,watered:false,stage:0});
      say("🌱 Mais wächst…"); save();
    } else {
      if(state.inv.cabbageSeed<=0) return say("🥬-Saat fehlt.");
      state.inv.cabbageSeed--; state.plants.push({x,y,type:"cabbage",plantedAt:performance.now(),readyAt:performance.now()+PLANTS.cabbage.growMs,watered:false,stage:0});
      say("🌱 Kohl wächst…"); save();
    }
  }
  function water(){
    if(!state.inv.hasCan) return say("Keine Gießkanne.");
    if(state.inv.can<=0) return say("Gießkanne leer.");
    const p = findNearbyPlant(); if(!p) return say("Geh näher an die Pflanze.");
    if(p.stage>=3) return say("Schon reif.");
    if(p.watered) return say("Schon gegossen.");
    p.watered = true;
    if (p.type==="corn"){
      p.readyAt = Math.max(performance.now()+10000, p.readyAt - 30000);
      say("💧 Mais: -30s");
    } else {
      p.readyAt = p.plantedAt + PLANTS.cabbage.wateredTotalMs;
      say("💧 Kohl: Gesamtzeit 40s");
    }
    state.inv.can--; save();
  }
  function harvest(){
    const p = findNearbyPlant(); if(!p) return;
    if (p.stage<3) return say("Noch nicht reif.");
    if (p.type==="corn"){
      if (rnd() < PLANTS.corn.chance){ state.inv.corn++; say("🌽 +1"); }
      else say("🌽 Ernte fehlgeschlagen.");
    } else state.inv.cabbage++, say("🥬 +1");
    state.plants.splice(state.plants.indexOf(p),1); save();
  }
  function findNearbyPlant(){
    let best=null, bestD=1e9;
    for(const p of state.plants){
      const d = dist(state.player.x,state.player.y,p.x,p.y);
      if (d<T*0.9 && d<bestD){best=p; bestD=d;}
    }
    return best;
  }
  function updatePlants(){
    const now = performance.now();
    for(const p of state.plants){
      const total = (p.type==="corn") ? PLANTS.corn.growMs : (p.watered ? PLANTS.cabbage.wateredTotalMs : PLANTS.cabbage.growMs);
      const prog = clamp(1 - ((p.readyAt - now)/total), 0, 1);
      p.stage = prog<0.33?0 : prog<0.66?1 : prog<0.99?2 : 3;
    }
  }

  /* ---------- Stones (pickup/place) ---------- */
  const STONE_R = T*0.36;
  function drawStone(x,y){
    ellipse(x, y, STONE_R, STONE_R*0.78, "#b9c2cc");
    ellipse(x - T*0.12, y - T*0.08, T*0.12, T*0.09, "#88929e");
  }
  function nearestLooseStoneIndex(){
    let idx=-1, best=1e9;
    for(let i=0;i<state.stones.length;i++){
      const s=state.stones[i]; const d=dist(state.player.x,state.player.y,s.x,s.y);
      if (d<T*0.9 && d<best){best=d; idx=i;}
    }
    return idx;
  }
  function nearestBlockIndex(){
    let idx=-1, best=1e9;
    for(let i=0;i<state.blocks.length;i++){
      const b=state.blocks[i]; const d=dist(state.player.x,state.player.y,b.x,b.y);
      if (d<T*0.9 && d<best){best=d; idx=i;}
    }
    return idx;
  }
  function canPlaceStone(px,py){
    if (rectsOverlap({x:px-T*0.5,y:py-T*0.5,w:T,h:T}, POND)) return false;
    if (Math.hypot(px-state.player.x, py-state.player.y) < state.player.r + STONE_R + 6) return false;
    for(const b of state.blocks) if (Math.hypot(px-b.x, py-b.y) < STONE_R*2) return false;
    for(const s of state.stones) if (Math.hypot(px-s.x, py-s.y) < STONE_R*2) return false;
    for(const p of state.plants) if (Math.hypot(px-p.x, py-p.y) < STONE_R*2) return false;
    return true;
  }

  /* ---------- UI: joystick + context ---------- */
  const ui = {
    joy:{ cx:110, cy:cv.clientHeight-110, r:68, knob:32, active:false, id:null, vx:0, vy:0 },
    ctxBtn:{ x:cv.clientWidth-84, y:cv.clientHeight-84, r:44, icon:"❓", enabled:false, action:null },
    dayTimer:0, tutorial:false
  };

  /* Pointer handlers */
  cv.addEventListener('pointerdown', e=>{
    const rect=cv.getBoundingClientRect();
    const x=e.clientX-rect.left, y=e.clientY-rect.top;
    // context?
    if (dist(x,y,ui.ctxBtn.x,ui.ctxBtn.y) <= ui.ctxBtn.r){
      if(ui.ctxBtn.enabled && ui.ctxBtn.action) ui.ctxBtn.action();
      return;
    }
    // joystick?
    if (dist(x,y,ui.joy.cx,ui.joy.cy) <= ui.joy.r){
      ui.joy.active=true; ui.joy.id=e.pointerId;
      const dx=x-ui.joy.cx, dy=y-ui.joy.cy; const m=Math.hypot(dx,dy); const s=Math.min(1,m/(ui.joy.r-8));
      ui.joy.vx=(m<8?0:dx/m)*s; ui.joy.vy=(m<8?0:dy/m)*s;
      return;
    }
    // HUD clicks – Saat/Stein wählen (grob klickbereiche)
    if (y<36){
      if (x<100)       state.uiSeed="stone";
      else if (x<180)  state.uiSeed="poop";
      else if (x<260)  state.uiSeed="cabbageSeed";
      else state.uiSeed=null;
      return;
    }
    // Tutorial schließen
    if (ui.tutorial) ui.tutorial=false;
  });
  cv.addEventListener('pointermove', e=>{
    if (!ui.joy.active || e.pointerId!==ui.joy.id) return;
    const rect=cv.getBoundingClientRect();
    const x=e.clientX-rect.left, y=e.clientY-rect.top;
    const dx=x-ui.joy.cx, dy=y-ui.joy.cy; const m=Math.hypot(dx,dy); const s=Math.min(1,m/(ui.joy.r-8));
    ui.joy.vx=(m<8?0:dx/m)*s; ui.joy.vy=(m<8?0:dy/m)*s;
  });
  window.addEventListener('pointerup', e=>{
    if (ui.joy.active && e.pointerId===ui.joy.id){ ui.joy.active=false; ui.joy.id=null; ui.joy.vx=ui.joy.vy=0; }
  });

  /* Keyboard (optional) */
  const keys=new Set();
  window.addEventListener('keydown', e=>keys.add(e.key.toLowerCase()));
  window.addEventListener('keyup',   e=>keys.delete(e.key.toLowerCase()));

  /* ---------- Player movement ---------- */
  function updatePlayer(){
    let dx=0, dy=0;
    if (keys.has('w')||keys.has('arrowup')) dy-=1;
    if (keys.has('s')||keys.has('arrowdown')) dy+=1;
    if (keys.has('a')||keys.has('arrowleft')) dx-=1;
    if (keys.has('d')||keys.has('arrowright')) dx+=1;
    dx += ui.joy.vx*2.5; dy += ui.joy.vy*2.5;

    const len=Math.hypot(dx,dy);
    if (len>0){
      const vx=dx/len, vy=dy/len;
      state.player.dir = Math.abs(vx)>Math.abs(vy)? (vx<0?"left":"right") : (vy<0?"up":"down");
      const sp = 3.6 * state.speedMult;
      let nx = clamp(state.player.x + vx*sp, T/2, MAP_W*T - T/2);
      let ny = clamp(state.player.y + vy*sp, T/2, MAP_H*T - T/2);

      const testX = {x:nx-T*0.5,y:state.player.y-T*0.5,w:T,h:T};
      const testY = {x:state.player.x-T*0.5,y:ny-T*0.5,w:T,h:T};

      let blockX=false,blockY=false;
      for(const b of state.blocks){ const r={x:b.x-T*0.5,y:b.y-T*0.5,w:T,h:T}; if(rectsOverlap(testX,r)) blockX=true; if(rectsOverlap(testY,r)) blockY=true; }
      if (rectsOverlap(testX,POND)) blockX=true;
      if (rectsOverlap(testY,POND)) blockY=true;

      if (!blockX) state.player.x=nx;
      if (!blockY) state.player.y=ny;
    }
  }

  /* ---------- Context button ---------- */
  function updateContext(){
    let icon="❓", enabled=false, action=null;

    // Near tutorial sign?
    if (dist(state.player.x,state.player.y,TUTORIAL.x,TUTORIAL.y) < T*0.9){
      icon="📜"; enabled=true; action=()=>{ ui.tutorial=true; };
    } else {
      // Shop NPCs?
      const fred = toPx(NPCS.find(n=>n.id==="fred").x, NPCS.find(n=>n.id==="fred").y);
      const berta = toPx(NPCS.find(n=>n.id==="berta").x, NPCS.find(n=>n.id==="berta").y);
      const stefan = toPx(NPCS.find(n=>n.id==="stefan").x, NPCS.find(n=>n.id==="stefan").y);
      if (dist(state.player.x,state.player.y, fred.x,fred.y) < T*1.2 && state.isDay){
        icon="🛒"; enabled=true; action=()=>openShop('fred');
      } else if (dist(state.player.x,state.player.y, berta.x,berta.y) < T*1.2 && state.isDay){
        icon="🛒"; enabled=true; action=()=>openShop('berta');
      } else if (dist(state.player.x,state.player.y, stefan.x,stefan.y) < T*1.2){
        icon="🧙‍♂️"; enabled=true; action=()=>openShop('stefan');
      } else if (dist(state.player.x,state.player.y, POND.x+POND.w/2, POND.y+POND.h/2) < T*2.0){
        icon="💧"; enabled=state.inv.hasCan; action=()=>{
          if(!state.inv.hasCan) return say("Keine Gießkanne.");
          if(!state.isDay) return say("Nacht: Der Teich ist still…");
          state.inv.can = state.inv.canMax; save(); say("💧 Gießkanne aufgefüllt!");
        };
      } else {
        // Plants first
        const p = findNearbyPlant();
        if (p && p.stage>=3){ icon="🌾"; enabled=true; action=harvest; }
        else if (p && p.stage<3 && state.inv.hasCan && state.inv.can>0 && !p.watered){ icon="💧"; enabled=true; action=water; }
        else {
          // Stones
          const bi = nearestBlockIndex();
          if (bi>=0){ icon="🪨"; enabled=true; action=()=>{ state.blocks.splice(bi,1); state.inv.stone++; save(); }; }
          else {
            const si = nearestLooseStoneIndex();
            if (si>=0){ icon="🪨"; enabled=true; action=()=>{ state.stones.splice(si,1); state.inv.stone++; save(); }; }
            else {
              // placement / planting
              const g = snapToTile(state.player.x,state.player.y);
              const px=g.x, py=g.y;
              if (state.uiSeed==="stone" && state.inv.stone>0 && canPlaceStone(px,py)){
                icon="📦"; enabled=true; action=()=>{ state.inv.stone--; state.blocks.push({x:px,y:py}); save(); };
              } else if (state.isDay && inFarm(px,py)){
                if (state.uiSeed==="poop" && state.inv.poop>0){ icon="💩"; enabled=true; action=()=>plant("corn"); }
                else if (state.uiSeed==="cabbageSeed" && state.inv.cabbageSeed>0){ icon="🥬"; enabled=true; action=()=>plant("cabbage"); }
                else { icon="🚫"; enabled=false; }
              } else icon="🚫";
            }
          }
        }
      }
    }

    ui.ctxBtn.icon=icon; ui.ctxBtn.enabled=enabled; ui.ctxBtn.action=action;
  }

  /* ---------- Shops ---------- */
  function addRow({icon,name,desc,price,button,disabled,onClick}){
    const row=document.createElement('div'); row.className="item";
    row.innerHTML=`<div class="iic">${icon}</div>
      <div class="ibody"><div class="iname">${name}</div><div class="idesc">${desc||""}</div></div>
      <div class="iprice">${price||""}</div>`;
    const btn=document.createElement('button'); btn.className="ghost"; btn.textContent=button||"OK";
    if(disabled) btn.disabled=true;
    btn.onclick=onClick||(()=>{});
    const col=document.createElement('div'); col.style.display="flex"; col.style.alignItems="center"; col.style.gap="10px";
    col.appendChild(btn); row.appendChild(col); mList.appendChild(row);
  }
  function openShop(kind){
    mList.innerHTML="";
    if(kind==='fred'){
      mPortrait.textContent="🧑‍🌾"; mTitle.textContent="Fecalfred"; mSub.textContent="Tags: Handel & Saat";
      addRow({icon:"🔁", name:"10 🪨 → 1 💩", desc:"Steine gegen Dünger tauschen.", price:"—", button:"Tauschen", disabled: state.inv.stone<ECON.stoneToPoop,
        onClick:()=>{ state.inv.stone-=ECON.stoneToPoop; state.inv.poop++; save(); openShop('fred'); }});
      addRow({icon:"🥬", name:"Kohl-Saat", desc:"Für dein Feld.", price:"4 €", button:"Kaufen", disabled: state.inv.euro<4,
        onClick:()=>{ state.inv.euro-=4; state.inv.cabbageSeed++; save(); openShop('fred'); }});
      addRow({icon:"🌽", name:"Mais verkaufen", desc:"+1 €", price:"+1 €", button:"Verkaufen", disabled: state.inv.corn<1,
        onClick:()=>{ state.inv.corn--; state.inv.euro+=ECON.cornSell; save(); openShop('fred'); }});
      addRow({icon:"🥬", name:"Kohl verkaufen", desc:"+7 €", price:"+7 €", button:"Verkaufen", disabled: state.inv.cabbage<1,
        onClick:()=>{ state.inv.cabbage--; state.inv.euro+=ECON.cabbageSell; save(); openShop('fred'); }});
    } else if (kind==='berta'){
      mPortrait.textContent="👩‍🎨"; mTitle.textContent="Berta Brown"; mSub.textContent="Upgrades (Tags)";
      addRow({icon:"💧", name:"Gießkanne", desc:"Permanent. 13 Nutzungen. Am Teich auffüllen.", price:"5 €", button: state.inv.hasCan?"Gekauft":"Kaufen",
        disabled: state.inv.hasCan || state.inv.euro<5, onClick:()=>{ state.inv.hasCan=true; state.inv.can=state.inv.canMax; state.inv.euro-=5; save(); openShop('berta'); }});
      addRow({icon:"👟", name:"Schnelle Schuhe", desc:"+35% Bewegung", price:"7 €", button: state.inv.hasShoes?"Gekauft":"Kaufen",
        disabled: state.inv.hasShoes || state.inv.euro<7, onClick:()=>{ state.inv.hasShoes=true; state.speedMult=1.35; state.inv.euro-=7; save(); openShop('berta'); }});
    } else {
      mPortrait.textContent="🧙‍♂️"; mTitle.textContent="Stefan Spielverderber"; mSub.textContent="Test/Cheats";
      addRow({icon:"💶", name:"+50 €", desc:"", price:"", button:"+50", onClick:()=>{ state.inv.euro+=50; save(); openShop('stefan'); }});
      addRow({icon:"🪨", name:"+20 Steine", desc:"", price:"", button:"+20", onClick:()=>{ state.inv.stone+=20; save(); openShop('stefan'); }});
      addRow({icon:"💩", name:"+10 Poop", desc:"", price:"", button:"+10", onClick:()=>{ state.inv.poop+=10; save(); openShop('stefan'); }});
      addRow({icon:"🥬", name:"+10 Kohlsaat", desc:"", price:"", button:"+10", onClick:()=>{ state.inv.cabbageSeed+=10; save(); openShop('stefan'); }});
      addRow({icon: state.god?"🛡️":"🗡️", name:"Godmode", desc:"Unverwundbar umschalten.", price:"", button: state.god?"AUS":"AN",
        onClick:()=>{ state.god=!state.god; openShop('stefan'); }});
      addRow({icon:"🌞", name:"Zu Tag", desc:"Killt Monster", price:"", button:"Tag", onClick:()=>{ state.dayBase = performance.now(); state.monsters.length=0; openShop('stefan'); }});
      addRow({icon:"🌙", name:"Zu Nacht", desc:"", price:"", button:"Nacht", onClick:()=>{ state.dayBase = performance.now() - (DAYLIGHT_MS-1); openShop('stefan'); }});
    }
    openModal();
  }

  /* ---------- Text hint ---------- */
  const toast = { t:0, text:"" };
  function say(s){ toast.text=s; toast.t=1.6; }

  /* ---------- FX ---------- */
  const fx = [];

  /* ---------- Draw world ---------- */
  function drawBackground(){
    const bgA = state.isDay ? "#13481e" : "#0a2a14";
    const bgB = state.isDay ? "#0f3a18" : "#092412";
    for(let y=0;y<MAP_H*T;y+=T) for(let x=0;x<MAP_W*T;x+=T){
      ctx.fillStyle = (((x+y)/T)%2===0) ? bgA : bgB; ctx.fillRect(x,y,T,T);
    }
  }
  function drawFenceWithGate(){
    const f=FARM;
    const t=12, gateW=T*1.2, gateC=f.x+f.w/2;
    const gateL=gateC-gateW/2, gateR=gateC+gateW/2;
    // Panels (for collision we just keep FARM rect)
    ctx.fillStyle="rgba(120,220,140,0.14)"; ctx.fillRect(f.x,f.y,f.w,f.h);
    ctx.strokeStyle="#916c3b"; ctx.lineWidth=4;
    // top
    ctx.beginPath(); ctx.moveTo(f.x,f.y); ctx.lineTo(f.x+f.w,f.y); ctx.stroke();
    // bottom with gate
    ctx.beginPath(); ctx.moveTo(f.x,f.y+f.h); ctx.lineTo(gateL,f.y+f.h); ctx.moveTo(gateR,f.y+f.h); ctx.lineTo(f.x+f.w,f.y+f.h); ctx.stroke();
    // sides
    ctx.beginPath(); ctx.moveTo(f.x,f.y); ctx.lineTo(f.x,f.y+f.h); ctx.moveTo(f.x+f.w,f.y); ctx.lineTo(f.x+f.w,f.y+f.h); ctx.stroke();
  }
  function drawClearing(){
    ctx.fillStyle="#1a5a2d"; ctx.fillRect(CLEAR.x,CLEAR.y,CLEAR.w,CLEAR.h);
    ctx.strokeStyle="rgba(180,220,150,0.35)"; ctx.strokeRect(CLEAR.x,CLEAR.y,CLEAR.w,CLEAR.h);
  }
  function drawPond(){
    const cx=POND.x+POND.w/2, cy=POND.y+POND.h/2, rx=POND.w*0.48, ry=POND.h*0.46;
    ctx.fillStyle="#1b4d6b"; ctx.beginPath(); ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle="rgba(180,220,255,0.3)"; ctx.lineWidth=2;
    for(let i=1;i<=4;i++){ ctx.beginPath(); ctx.ellipse(cx,cy, rx*i/4, ry*i/4, 0, 0, Math.PI*2); ctx.stroke(); }
  }
  function drawFred(){
    const n=NPCS.find(n=>n.id==="fred"); const p=toPx(n.x,n.y);
    const hx=p.x-T, hy=p.y-T;
    ctx.fillStyle="#6b4630"; ctx.fillRect(hx - T*0.5, hy - T*0.5, T*2, T*1.6);
    ctx.fillStyle="#9b3b2e"; ctx.fillRect(hx - T*0.6, hy - T*1.0, T*2.4, T*0.45);
    ctx.fillStyle="#2b1c11"; ctx.fillRect(hx + T*0.2, hy + T*0.6, T*0.5, T*0.7);
    // Schild
    const signW=T*2.6, signH=T*0.7;
    ctx.fillStyle="#f8f5e7"; ctx.fillRect(p.x - signW/2, hy + T*1.25, signW, signH);
    ctx.fillStyle="#2b2b2b"; ctx.font=`bold ${Math.floor(T*0.34)}px system-ui`; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText("FECALFRED", p.x, hy + T*1.25 + signH/2); ctx.textAlign="left"; ctx.textBaseline="alphabetic";
  }
  function drawBerta(){
    const n=NPCS.find(n=>n.id==="berta"); const p=toPx(n.x,n.y);
    ctx.fillStyle="#8b5a2b"; ctx.fillRect(p.x - T*0.8, p.y - T*0.6, T*0.15, T*1.3);
    ctx.fillRect(p.x + T*0.65, p.y - T*0.6, T*0.15, T*1.3);
    ctx.fillStyle="#f0e0c0"; ctx.fillRect(p.x - T*0.5, p.y - T*0.9, T*1.1, T*0.8);
    ctx.fillStyle="#f8f5e7"; ctx.fillRect(p.x - T*1.2, p.y + T*0.8, T*2.4, T*0.45);
    ctx.fillStyle="#2b2b2b"; ctx.font=`bold ${Math.floor(T*0.32)}px system-ui`; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText("BERTA BROWN", p.x, p.y + T*1.02); ctx.textAlign="left"; ctx.textBaseline="alphabetic";
  }
  function drawStefan(){
    const n=NPCS.find(n=>n.id==="stefan"); const p=toPx(n.x,n.y);
    ctx.fillStyle="#9c7a00"; ctx.fillRect(p.x - T*0.9, p.y - T*0.9, T*1.8, T*1.1);
    ctx.fillStyle="#ffd54a"; ctx.fillRect(p.x - T*1.2, p.y - T*1.25, T*2.4, T*0.5);
    ctx.fillStyle="#2b1c11"; ctx.fillRect(p.x - T*0.2, p.y - T*0.1, T*0.4, T*0.6);
    ctx.fillStyle="#f8f5e7"; ctx.fillRect(p.x - T*1.4, p.y + T*0.8, T*2.8, T*0.45);
    ctx.fillStyle="#2b2b2b"; ctx.font=`bold ${Math.floor(T*0.32)}px system-ui`; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText("STEFAN SPIELVERDERBER", p.x, p.y + T*1.02); ctx.textAlign="left"; ctx.textBaseline="alphabetic";
  }
  function drawTutorialSign(){
    // Pfahl + Schild
    ctx.fillStyle="#775836"; ctx.fillRect(TUTORIAL.x-6, TUTORIAL.y-24, 12, 48);
    ctx.fillStyle="#e8e0c8"; ctx.fillRect(TUTORIAL.x-40, TUTORIAL.y-46, 80, 30);
    ctx.fillStyle="#2b2b2b"; ctx.font="bold 12px system-ui"; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText("INFO", TUTORIAL.x, TUTORIAL.y-31);
    ctx.textAlign="left"; ctx.textBaseline="alphabetic";
  }

  /* ---------- Draw player ---------- */
  function drawPlayer(){
    const p=state.player;
    ellipse(p.x, p.y, p.r, p.r, "#e6b35a");
    let fx=0, fy=0; if(p.dir==="left")fx=-1; else if(p.dir==="right")fx=1; else if(p.dir==="up")fy=-1; else fy=1;
    const sideX=-fy, sideY=fx; const eyeOff=6, eyeR=p.r*0.11;
    const eBx=p.x + fx*(p.r*0.25), eBy=p.y + fy*(p.r*0.25);
    const Lx=eBx + sideX*eyeOff, Ly=eBy + sideY*eyeOff;
    const Rx=eBx - sideX*eyeOff, Ry=eBy - sideY*eyeOff;
    ellipse(Lx,Ly,eyeR,eyeR,"#fff"); ellipse(Rx,Ry,eyeR,eyeR,"#fff");
    ellipse(Lx+fx*eyeR*0.6,Ly+fy*eyeR*0.6,eyeR*0.55,eyeR*0.55,"#111");
    ellipse(Rx+fx*eyeR*0.6,Ry+fy*eyeR*0.6,eyeR*0.55,eyeR*0.55,"#111");
  }

  /* ---------- HUD ---------- */
  function drawHUD(){
    // Top bar
    ctx.fillStyle="rgba(0,0,0,0.35)"; ctx.fillRect(0,0,cv.clientWidth,36);
    ctx.fillStyle="#fff"; ctx.font="bold 14px system-ui";
    let x=10,y=22;
    ctx.fillText(`🪨 ${state.inv.stone}`, x,y); x+=70;
    ctx.fillText(`💩 ${state.inv.poop}`, x,y); x+=70;
    ctx.fillText(`🥬 ${state.inv.cabbageSeed}`, x,y); x+=90;
    ctx.fillText(`🌽 ${state.inv.corn}`, x,y); x+=70;
    ctx.fillText(`🥬 ${state.inv.cabbage}`, x,y); x+=70;
    ctx.fillText(`💶 ${state.inv.euro}`, x,y);

    // Uhr
    const elapsed=(performance.now()-state.dayBase)%DAY_TOTAL_MS;
    const hours=Math.floor((elapsed/DAY_TOTAL_MS)*24);
    const mins=Math.floor(((elapsed/DAY_TOTAL_MS)*24-hours)*60);
    const clock=`${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}`;
    ctx.textAlign="right"; ctx.fillText(`${clock} ${state.isDay?'🌞':'🌙'}`, cv.clientWidth-12, y); ctx.textAlign="left";

    // Version bottom-left
    ctx.fillStyle="#ddd"; ctx.font="12px system-ui"; ctx.fillText(state.version, 10, cv.clientHeight-10);

    // joystick
    ctx.globalAlpha=.9;
    ellipse(ui.joy.cx, ui.joy.cy, ui.joy.r, ui.joy.r, "rgba(24,34,44,.55)");
    ellipse(ui.joy.cx, ui.joy.cy, ui.joy.r-6, ui.joy.r-6, "rgba(60,80,96,.18)");
    ellipse(ui.joy.cx + ui.joy.vx*(ui.joy.r-12), ui.joy.cy + ui.joy.vy*(ui.joy.r-12), 32,32, "#1f2937");
    ctx.globalAlpha=1;

    // context
    ellipse(ui.ctxBtn.x, ui.ctxBtn.y, ui.ctxBtn.r, ui.ctxBtn.r, ui.ctxBtn.enabled?"#2563eb":"#3b4551");
    ctx.fillStyle="#fff"; ctx.font="32px system-ui"; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(ui.ctxBtn.icon, ui.ctxBtn.x, ui.ctxBtn.y+2); ctx.textAlign="left"; ctx.textBaseline="alphabetic";

    // toast
    if (toast.t>0){ ctx.fillStyle="rgba(0,0,0,.8)"; const tw=ctx.measureText(toast.text).width+22;
      ctx.fillRect((cv.clientWidth-tw)/2, cv.clientHeight-120, tw, 30);
      ctx.fillStyle="#fff"; ctx.font="bold 14px system-ui";
      ctx.fillText(toast.text, (cv.clientWidth-tw)/2+11, cv.clientHeight-100);
    }
  }

  /* ---------- placement preview ---------- */
  function drawPreview(){
    if (state.uiSeed!=="stone" || state.inv.stone<=0) return;
    if (nearestLooseStoneIndex()>=0 || nearestBlockIndex()>=0) return;
    const g=snapToTile(state.player.x,state.player.y);
    const ok=canPlaceStone(g.x,g.y);
    ctx.globalAlpha=.6;
    ellipse(g.x, g.y, STONE_R, STONE_R*0.78, ok?"rgba(56,189,248,.35)":"rgba(239,68,68,.45)");
    ctx.globalAlpha=1;
  }

  /* ---------- main loop ---------- */
  function loop(){
    updateDay(); updatePlants(); updatePlayer(); updateContext();

    // fade toast
    if (toast.t>0){ toast.t -= 1/60; if (toast.t<0) toast.t=0; }

    // draw
    ctx.clearRect(0,0,cv.clientWidth,cv.clientHeight);
    drawBackground();
    drawClearing(); drawFenceWithGate(); drawPond(); drawFred(); drawBerta(); drawStefan(); drawTutorialSign();

    // stones
    for(const s of state.stones) drawStone(s.x,s.y);
    for(const b of state.blocks) drawStone(b.x,b.y);

    // plants
    for(const p of state.plants){
      if (p.type==="corn"){
        ctx.fillStyle="#382a1d"; ctx.beginPath(); ctx.arc(p.x,p.y,T*0.28,0,Math.PI*2); ctx.fill();
        if (p.stage===0){ ctx.fillStyle="#63d16e"; ctx.fillRect(p.x-T*0.08, p.y-T*0.10, T*0.16, T*0.10); }
        else if (p.stage===1){ ctx.fillStyle="#58b368"; ctx.fillRect(p.x-T*0.12, p.y-T*0.20, T*0.24, T*0.22); }
        else if (p.stage===2){ ctx.save(); ctx.translate(p.x,p.y); ctx.fillStyle="#f2d24b"; ctx.beginPath(); ctx.ellipse(0,-T*0.05, T*0.10, T*0.20, 0, 0, Math.PI*2); ctx.fill(); ctx.fillStyle="#5cbc6b"; ctx.beginPath(); ctx.moveTo(-T*0.18,0); ctx.quadraticCurveTo(0,-T*0.30, T*0.18,0); ctx.quadraticCurveTo(0,T*0.05, -T*0.18,0); ctx.fill(); ctx.restore(); }
        else { ctx.save(); ctx.translate(p.x,p.y); ctx.fillStyle="#f2d24b"; ctx.beginPath(); ctx.ellipse(0,-T*0.05, T*0.16, T*0.26, 0, 0, Math.PI*2); ctx.fill(); ctx.fillStyle="#5cbc6b"; ctx.beginPath(); ctx.moveTo(-T*0.22,0); ctx.quadraticCurveTo(0,-T*0.35, T*0.22,0); ctx.quadraticCurveTo(0,T*0.05, -T*0.22,0); ctx.fill(); ctx.restore(); }
      } else {
        ctx.fillStyle="#352519"; ctx.beginPath(); ctx.arc(p.x,p.y,T*0.28,0,Math.PI*2); ctx.fill();
        if (p.stage===0){ ctx.fillStyle="#4e8f4e"; ctx.beginPath(); ctx.arc(p.x, p.y, T*0.10, 0, Math.PI*2); ctx.fill(); }
        else if (p.stage===1){ ctx.fillStyle="#4fa65b"; ctx.beginPath(); ctx.arc(p.x, p.y, T*0.16, 0, Math.PI*2); ctx.fill(); ctx.fillStyle="#3d7f43"; ctx.beginPath(); ctx.arc(p.x-6, p.y-2, 5, 0, Math.PI*2); ctx.fill(); ctx.arc(p.x+6, p.y+3, 4, 0, Math.PI*2); ctx.fill(); }
        else if (p.stage===2){ ctx.fillStyle="#58bb68"; ctx.beginPath(); ctx.arc(p.x, p.y, T*0.22, 0, Math.PI*2); ctx.fill(); ctx.fillStyle="#3d944a"; ctx.beginPath(); ctx.arc(p.x-8, p.y, 6, 0, Math.PI*2); ctx.fill(); ctx.arc(p.x+8, p.y, 6, 0, Math.PI*2); ctx.fill(); }
        else { ctx.fillStyle="#6bd17a"; ctx.beginPath(); ctx.arc(p.x, p.y, T*0.26, 0, Math.PI*2); ctx.fill(); ctx.fillStyle="#44a457"; ctx.beginPath(); ctx.arc(p.x-9, p.y-2, 7, 0, Math.PI*2); ctx.fill(); ctx.arc(p.x+9, p.y+2, 7, 0, Math.PI*2); ctx.fill(); }
      }
    }

    drawPlayer();
    drawPreview();
    // FX (spawn dust)
    ctx.globalCompositeOperation='lighter';
    for(let i=fx.length-1;i>=0;i--){
      const p=fx[i]; p.x+=p.vx; p.y+=p.vy; p.vx*=0.92; p.vy*=0.92; p.a*=0.96; p.life--; 
      ctx.fillStyle=`rgba(240,220,180,${p.a})`; ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
      if(p.life<=0||p.a<0.05) fx.splice(i,1);
    }
    ctx.globalCompositeOperation='source-over';

    // night overlay
    if (!state.isDay){ ctx.fillStyle="rgba(0,0,0,.35)"; ctx.fillRect(0,0,cv.clientWidth,cv.clientHeight); }

    drawHUD();

    requestAnimationFrame(loop);
  }

  /* ---------- Boot ---------- */
  placeBertaBlockade();
  spawnPlayer();
  loop();
})();
