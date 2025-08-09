/* =========================================================================
   SFX ENGINE – lightweight, no assets, mobile-friendly (iOS unlock)
   Exposes global: window.SFX
   API:
     SFX.play(name)           -> plays preset by name
     SFX.mute(on)             -> mute/unmute
     SFX.setVolume(0..1)      -> master volume
     SFX.setRate(f)           -> global time/pitch scaling (1 = normal)
     SFX.ambience.fire(on)    -> enable/disable subtle campfire noise
   ========================================================================= */
(function () {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null, unlocked = false, queue = [];
  let master = null, rate = 1;
  let fireNode = null;

  function ensure() {
    if (!ctx) ctx = new AC();
    if (!master) {
      master = ctx.createGain();
      master.gain.value = 0.9;              // default volume
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  function unlock() {
    ensure(); unlocked = true;
    // flush queued plays
    const q = queue.slice(); queue.length = 0;
    q.forEach(fn => { try { fn(); } catch(_){} });
  }

  // ---- core oneshot synth ----
  function oneShot({
    type="sine", freq=440, time=0.08, vol=0.2,
    attack=0.005, decay=0.06, slide=0, start=0,
    lpFreq=0, hpFreq=0, noise=false, detune=0
  } = {}) {
    if (!ctx || !unlocked) return;
    const now = ctx.currentTime + (start||0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(vol, now + attack/rate);
    g.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(attack+decay, time)/rate);

    let src;
    if (noise) {
      const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * time), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i=0;i<data.length;i++) data[i] = Math.random()*2 - 1;
      const n = ctx.createBufferSource();
      n.buffer = buffer; n.loop = false;
      src = n;
    } else {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(Math.max(1, freq), now);
      if (slide) o.frequency.linearRampToValueAtTime(Math.max(1, freq + slide), now + time/rate);
      if (detune) o.detune.setValueAtTime(detune, now);
      src = o;
    }

    // optional filters
    let last = src;
    if (hpFreq > 0) {
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = hpFreq;
      last.connect(hp); last = hp;
    }
    if (lpFreq > 0) {
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = lpFreq;
      last.connect(lp); last = lp;
    }

    last.connect(g); g.connect(master);
    if (src.start) src.start(now);
    if (src.stop)  src.stop(now + (time + 0.05)/rate);
  }

  // small helper for simple tones
  function tone(opts){ if (!unlocked){ queue.push(()=>tone(opts)); return; } ensure(); oneShot(opts); }

  // ---- presets (short & distinctive) ----
  const presets = {
    ui:       ()=> tone({type:"triangle", freq:680, time:0.06, vol:0.16}),
    deny:     ()=> tone({type:"square",   freq:180, time:0.10, vol:0.2}),
    pickup:   ()=> { tone({type:"sine", freq:740, time:0.07, vol:0.2, slide:80}); },
    drop:     ()=> tone({type:"triangle", freq:260, time:0.10, vol:0.22}),
    coin:     ()=> { tone({type:"square", freq:800, time:0.05, vol:0.16}); tone({type:"square", freq:1200, time:0.06, vol:0.16, start:0.04}); },
    shoot:    ()=> tone({type:"square", freq:540, time:0.07, vol:0.18, slide:-140}),
    hit:      ()=> tone({type:"sawtooth", freq:220, time:0.07, vol:0.22}),
    kill:     ()=> { tone({type:"triangle", freq:420, time:0.06, vol:0.22}); tone({type:"triangle", freq:620, time:0.07, vol:0.22, start:0.055}); },
    day:      ()=> tone({type:"sine", freq:880, time:0.12, vol:0.16}),
    night:    ()=> tone({type:"sine", freq:330, time:0.12, vol:0.16}),
    cook_hit: ()=> tone({type:"triangle", freq:900, time:0.05, vol:0.18}),
    cook_miss:()=> tone({type:"square", freq:220, time:0.08, vol:0.18}),
    cook_doneEpic: ()=> { tone({type:"triangle", freq:700, time:0.06, vol:0.2}); tone({type:"triangle", freq:940, time:0.08, vol:0.22, start:0.06}); },

    // footsteps (randomized)
    step: ()=> {
      const f = 240 + Math.random()*40;
      tone({type:"triangle", freq:f, time:0.035, vol:0.12, hpFreq:180});
    },

    // EPIC SPAWN (deep drum + echo + rising note)
    spawn: ()=> {
      if (!unlocked){ queue.push(presets.spawn); return; }
      ensure();
      // drum
      tone({type:"sine", freq:90, time:0.55, vol:0.7, slide:-45, attack:0.008, decay:0.5, lpFreq:800});
      // echo pulse
      tone({type:"sine", freq:60, time:0.35, vol:0.35, start:0.12, attack:0.01, decay:0.3, lpFreq:700});
      // rising
      tone({type:"triangle", freq:200, time:0.42, vol:0.28, start:0.18, slide:220, attack:0.01, decay:0.4});
    }
  };

  // ---- ambience: subtle campfire noise (loop) ----
  function fireOn() {
    if (!unlocked){ queue.push(fireOn); return; }
    ensure();
    if (fireNode) return;
    const g = ctx.createGain(); g.gain.value = 0.06;
    const lp = ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value = 1600;
    const hp = ctx.createBiquadFilter(); hp.type="highpass"; hp.frequency.value = 180;

    // gentle crackle: short noise grains
    const buffer = ctx.createBuffer(1, 2048, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i=0;i<data.length;i++) data[i] = Math.random()*2-1;

    const src = ctx.createBufferSource();
    src.buffer = buffer; src.loop = true; src.playbackRate.value = 0.6;

    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(master);
    src.start();
    fireNode = { src, g };
  }
  function fireOff() {
    if (!fireNode) return;
    try { fireNode.src.stop(); } catch(_) {}
    fireNode = null;
  }

  // ---- public API ----
  const SFX = {
    play(name) {
      const fn = presets[name];
      if (!fn) return;
      if (!unlocked) { queue.push(()=>presets[name]()); return; }
      ensure(); fn();
    },
    mute(on=true){ ensure(); master.gain.value = on ? 0 : 0.9; },
    setVolume(v){ ensure(); master.gain.value = Math.max(0, Math.min(1, v)); },
    setRate(r){ rate = Math.max(0.25, Math.min(3, r||1)); },
    ambience: {
      fire: (on)=> on ? fireOn() : fireOff()
    },
    // for game boot to call once
    _unlock: unlock
  };

  // iOS/Safari unlock on first user gesture
  window.addEventListener("pointerdown", () => SFX._unlock(), { once:true });
  window.addEventListener("touchstart", () => SFX._unlock(), { once:true, passive:true });

  window.SFX = SFX;
})();
