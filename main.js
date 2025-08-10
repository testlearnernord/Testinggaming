/* ... Kopf bleibt wie gehabt ... */
(() => {
  /* ... Setup wie gehabt ... */

  // ===== State =====
  const state={ /* ... wie zuvor ... */ };

  function rnd(){ /* ... wie zuvor ... */ }

  // >>> NEW: sanitize all numeric inventory counters to avoid NaN issues
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

  // ===== Save/Load =====
  function save(){ /* wie zuvor */ }
  (function load(){
    try{
      const d=JSON.parse(localStorage.getItem("pb_save_v7")||"null");
      if(d){ /* ... wie zuvor ... */ }
    }catch{}
  })();

  // >>> call sanitize right after load to fix old broken saves
  sanitizeInv();

  /* ... FX, Spawn, Spawns etc. wie zuvor ... */

  // ===== Pflanzen =====
  function plant(type){
    if(!inFarm(state.player.x,state.player.y)) return say("Nur im Feld!");
    const {x,y}=tileCenterFromPx(state.player.x,state.player.y);
    if(state.plants.some(p=>p.x===x&&p.y===y)) return say("Hier wächst bereits etwas.");
    for(const b of state.boulders) if(Math.hypot(x-b.x,y-b.y)<T*0.5) return say("Blockiert durch Felsen.");

    if(type==="corn"){
      // >>> STRICT check (handles NaN and negatives)
      if (!(state.inv.poop > 0)) return say("💩 fehlt.");
      state.inv.poop = (state.inv.poop|0) - 1;
      state.plants.push({x,y,type:"corn",plantedAt:performance.now(),readyAt:performance.now()+PLANTS.corn.growMs,watered:false,stage:0});
      say("🌱 Mais wächst…");
    } else {
      if (!(state.inv.cabbageSeed > 0)) return say("🥬-Saat fehlt.");
      state.inv.cabbageSeed = (state.inv.cabbageSeed|0) - 1;
      state.plants.push({x,y,type:"cabbage",plantedAt:performance.now(),readyAt:performance.now()+PLANTS.cabbage.growMs,watered:false,stage:0});
      say("🌱 Kohl wächst…");
    }
    save();
  }

  /* ... water/harvest/updatePlants unverändert ... */

  // ===== Shops (nur relevante Stellen gezeigt) =====
  function openShop(kind){
    mList.innerHTML="";
    if(kind==='stefan'){
      /* ... andere Cheats ... */
      // >>> FIXED: add to cabbageSeed (seeds), save, refresh
      addRow({icon:"🥬", name:"+10 Kohlsaat", button:"+10",
        onClick:()=>{ state.inv.cabbageSeed = (state.inv.cabbageSeed|0) + 10; sanitizeInv(); save(); openShop('stefan'); }});
      // >>> Yard +19 (für schnelles Upgrade)
      addRow({icon:"🧱", name:"Yard +19 Felsen", desc:"Schnelltest fürs Upgrade", button:"+19",
        onClick:()=>{ state.yard.count = Math.min(19, (state.yard.count|0) + 19); sanitizeInv(); save(); openShop('stefan'); }});
      /* ... Rest wie zuvor ... */
    }
    /* ... fred/berta wie zuvor ... */
    openModal();
  }

  // ===== HUD (zeige Seeds damit klar ist, dass der Cheat wirkt) =====
  function drawHUD(){
    const HUD_H=48, HUD_Y=0; ctx.fillStyle="rgba(0,0,0,0.55)"; ctx.fillRect(0, HUD_Y, cv.clientWidth, HUD_H);
    let x=12,y=22; ctx.fillStyle="#fff"; ctx.font="bold 14px system-ui";
    ctx.fillText(`❤ ${state.hearts}`, x,y); x+=62;
    ctx.fillText(`💩 ${state.inv.poop|0}`, x,y); x+=62;
    ctx.fillText(`🌽 ${state.inv.corn|0}`, x,y); x+=62;
    ctx.fillText(`🥬 ${state.inv.cabbage|0}`, x,y); x+=72;
    // >>> show seeds so you see the cheat immediately
    ctx.fillText(`🌱🥬 ${state.inv.cabbageSeed|0}`, x,y); x+=88;
    ctx.fillText(`💶 ${state.inv.euro|0}`, x,y); x+=72;
    ctx.fillText(`🔹 ${state.inv.ammo|0}`, x,y); x+=72;
    if(state.inv.hasCan) ctx.fillText(`💧 ${state.inv.can|0}/${state.inv.canMax|0}`, x,y), x+=120;
    /* ... Rest (Carry-Info, Buttons etc.) wie zuvor ... */
  }

  /* ... Rest der Datei (Bewegung, Kontext-Button, Render, Loop) bleibt unverändert ... */

  // ===== Boot =====
  placeBertaBlockade();
  cullOutOfWorld();
  spawnPlayer();
  (function loop(){ update(); draw(); requestAnimationFrame(loop); })();
})();
