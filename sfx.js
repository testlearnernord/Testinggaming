const AudioCtx = window.AudioContext || window.webkitAudioContext;

export class SFX {
  constructor(manifest = {}) {
    this.manifest = manifest;
    this.ctx = null;
    this.buffers = new Map();
    this.ready = false;
    this.unlocking = false;
    this.pendingLoads = null;
    this.lastPlay = new Map();
    this.loops = new Map();
  }

  async unlock() {
    if (!AudioCtx) {
      this.ready = false;
      return null;
    }
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch (err) {
        console.warn("Audio resume failed", err);
      }
    }
    if (this.ready) {
      return true;
    }
    if (this.unlocking) {
      return this.pendingLoads;
    }

    const entries = Object.entries(this.manifest);
    this.unlocking = true;
    const loads = entries.map(([id, spec]) =>
      this.loadBuffer(id, spec).catch(err => {
        console.warn("SFX load failed", id, err);
        return null;
      })
    );
    this.pendingLoads = Promise.all(loads).finally(() => {
      this.unlocking = false;
      this.ready = true;
    });
    return this.pendingLoads;
  }

  async loadBuffer(id, spec) {
    if (!this.ctx) return null;
    if (this.buffers.has(id)) return this.buffers.get(id);

    const generator = typeof spec === "function" ? spec : spec?.create;
    if (typeof generator !== "function") {
      return null;
    }

    let buffer;
    try {
      buffer = generator(this.ctx);
      if (buffer instanceof Promise) {
        buffer = await buffer;
      }
    } catch (err) {
      console.warn(`SFX generator for ${id} failed`, err);
      return null;
    }

    if (!buffer || typeof buffer.getChannelData !== "function") {
      return null;
    }

    this.buffers.set(id, buffer);
    return buffer;
=======
  constructor(assets = {}) {
    this.assets = assets;
    this.ctx = null;
    this.buffers = new Map();
    this.unlocking = false;
    this.ready = false;
    this.lastPlay = new Map();
    this.cooldowns = new Map();
    this.pendingLoads = [];
  }

  async unlock() {
    if (this.unlocking) return this.pendingLoads;
    if (!AudioCtx) {
      this.ready = false;
      return null;
    }
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === "suspended") {
      try { await this.ctx.resume(); } catch (_) { /* ignore */ }
    }
    if (this.ready) return true;
    this.unlocking = true;
    const promises = Object.entries(this.assets).map(async ([id, generator]) => {
      if (this.buffers.has(id)) return;
      try {
        const buffer = await generator(this.ctx);
        if (buffer) {
          this.buffers.set(id, buffer);
        }
      } catch (err) {
        console.warn("SFX build failed", id, err);
      }
    });
    this.pendingLoads = Promise.all(promises).finally(() => {
      this.unlocking = false;
      this.ready = true;
    });
    return this.pendingLoads;
 
  }

  play(id, { volume = 0.8, playbackRate = 1, cooldown = 120 } = {}) {
    if (!this.ready || !this.ctx || !this.buffers.has(id)) return;
    const now = performance.now();
    const last = this.lastPlay.get(id) || 0;
    if (now - last < cooldown) return;
    this.lastPlay.set(id, now);

=======
    const buffer = this.buffers.get(id);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;

    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.ctx.destination);

=======
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.ctx.destination);
    try {
      source.start();
    } catch (err) {
      console.warn("SFX start failed", err);
    }
  }
}

  startLoop(id, { volume = 0.4, fadeMs = 800 } = {}) {
    if (!this.ready || !this.ctx || !this.buffers.has(id)) return null;
    if (this.loops.has(id)) return this.loops.get(id);

    const source = this.ctx.createBufferSource();
    source.buffer = this.buffers.get(id);
    source.loop = true;

    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain).connect(this.ctx.destination);

    try {
      source.start();
    } catch (err) {
      console.warn("SFX loop start failed", err);
      return null;
    }

    const now = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    if (fadeMs > 0) {
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(volume, now + fadeMs / 1000);
    } else {
      gain.gain.setValueAtTime(volume, now);
    }

    const handle = { source, gain };
    source.onended = () => {
      this.loops.delete(id);
    };
    this.loops.set(id, handle);
    return handle;
  }

  stopLoop(id, { fadeMs = 600 } = {}) {
    const handle = this.loops.get(id);
    if (!handle || !this.ctx) return;

    const now = this.ctx.currentTime;
    handle.gain.gain.cancelScheduledValues(now);
    if (fadeMs > 0) {
      handle.gain.gain.setValueAtTime(handle.gain.gain.value, now);
      handle.gain.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
      handle.source.stop(now + fadeMs / 1000 + 0.05);
    } else {
      handle.source.stop();
    }

    this.loops.delete(id);
  }
}

const audioManifest = {
  pickup: { create: ctx => createPickupBuffer(ctx) },
  plant: { create: ctx => createPlantBuffer(ctx) },
  sell: { create: ctx => createSellBuffer(ctx) },
  water: { create: ctx => createWaterBuffer(ctx) },
  ui: { create: ctx => createUiBuffer(ctx) },
  footstepSoft: { create: ctx => createFootstepBuffer(ctx, { seed: 31, hardness: 0.25, energy: 0.9, crunch: 0.1, duration: 0.32 }) },
  footstepGrass: { create: ctx => createFootstepBuffer(ctx, { seed: 59, hardness: 0.45, energy: 1, crunch: 0.35, duration: 0.28 }) },
  footstepSprint: { create: ctx => createFootstepBuffer(ctx, { seed: 73, hardness: 0.6, energy: 1.2, crunch: 0.2, duration: 0.22 }) },
  musicFarm: { create: ctx => createMusicBuffer(ctx) },
};

export const globalSfx = new SFX(audioManifest);

export function primeAudioUnlock() {
  const events = ["pointerdown", "touchstart", "keydown"];
  let musicStarted = false;
  const handler = async () => {
    await globalSfx.unlock();
    if (!musicStarted) {
      musicStarted = true;
      globalSfx.startLoop("musicFarm", { volume: 0.32, fadeMs: 1200 });
    }
    for (const type of events) {
      window.removeEventListener(type, handler, true);
    }
  };
  for (const type of events) {
    window.addEventListener(type, handler, { passive: true, capture: true });
  }
}

function createPickupBuffer(ctx) {
  const duration = 0.24;
  return renderLayers(
    ctx,
    duration,
    [
      (t) => {
        const env = adsr(t, duration, 0.005, 0.06, 0.6, 0.1);
        const freq = glide(820, 1380, t, duration, 0.75);
        return env * Math.sin(2 * Math.PI * freq * t);
      },
      (t) => {
        const env = adsr(t, duration, 0.01, 0.08, 0.45, 0.1);
        const freq = glide(1240, 1860, t, duration, 1.25);
        return 0.42 * env * Math.sin(2 * Math.PI * freq * t + 0.6);
      },
    ],
    { fadeOut: 0.05, normalize: 0.9 }
  );
}

function createPlantBuffer(ctx) {
  const duration = 0.34;
  return renderLayers(
    ctx,
    duration,
    [
      (t) => {
        const env = adsr(t, duration, 0.012, 0.08, 0.55, 0.14);
        const freq = glide(220, 160, t, duration, 0.8);
        return 0.6 * env * Math.sin(2 * Math.PI * freq * t);
      },
      createNoiseLayer({
        seed: 521,
        smoothing: 0.38,
        scale: 0.42,
        envelope: (time) => adsr(time, duration, 0.01, 0.1, 0.4, 0.12),
      }),
    ],
    { fadeOut: 0.08, normalize: 0.88 }
  );
}

function createSellBuffer(ctx) {
  const duration = 0.4;
  return renderLayers(
    ctx,
    duration,
    [
      (t) => {
        const env = adsr(t, duration, 0.008, 0.08, 0.55, 0.12);
        const freq = glide(480, 720, t, duration, 0.9);
        return env * Math.sin(2 * Math.PI * freq * t);
      },
      (t) => {
        const env = adsr(t, duration, 0.012, 0.12, 0.5, 0.14);
        const freq = glide(720, 990, t, duration, 1.1);
        return 0.55 * env * Math.sin(2 * Math.PI * freq * t + 1.2);
      },
      (t) => {
        const env = adsr(t, duration, 0.02, 0.16, 0.4, 0.1);
        const freq = glide(960, 1320, t, duration, 1.4);
        return 0.22 * env * Math.sin(2 * Math.PI * freq * t * 1.5 + 0.3);
      },
    ],
    { fadeOut: 0.08, normalize: 0.85 }
  );
}

function createWaterBuffer(ctx) {
  const duration = 0.68;
  return renderLayers(
    ctx,
    duration,
    [
      createNoiseLayer({
        seed: 811,
        smoothing: 0.55,
        scale: 0.6,
        envelope: (t) => adsr(t, duration, 0.02, 0.18, 0.5, 0.22),
      }),
      createNoiseLayer({
        seed: 833,
        smoothing: 0.12,
        scale: 0.28,
        envelope: (t) => adsr(t, duration, 0.01, 0.14, 0.4, 0.22),
      }),
      (t) => {
        const env = adsr(t, duration, 0.04, 0.18, 0.35, 0.24);
        const freq = glide(140, 120, t, duration, 1);
        return 0.3 * env * Math.sin(2 * Math.PI * freq * t + 1.6);
      },
    ],
    { fadeOut: 0.14, normalize: 0.82 }
  );
}

function createUiBuffer(ctx) {
  const duration = 0.18;
  return renderLayers(
    ctx,
    duration,
    [
      (t) => {
        const env = adsr(t, duration, 0.004, 0.05, 0.5, 0.06);
        const freq = glide(880, 1240, t, duration, 0.9);
        return env * Math.sin(2 * Math.PI * freq * t);
      },
      (t) => {
        const env = adsr(t, duration, 0.008, 0.05, 0.45, 0.07);
        const freq = glide(1320, 1760, t, duration, 1.2);
        return 0.35 * env * Math.sin(2 * Math.PI * freq * t + 0.4);
      },
    ],
    { fadeOut: 0.04, normalize: 0.88 }
  );
}

function createFootstepBuffer(ctx, { duration = 0.3, seed = 1, hardness = 0.4, energy = 1, crunch = 0.2 } = {}) {
  const baseFreq = 65 + hardness * 45;
  const bodyEnv = (t) => adsr(t, duration, 0.004, 0.05, 0.55, 0.08);
  const noiseEnv = (t) => adsr(t, duration, 0.002, 0.05, 0.4 + hardness * 0.2, 0.12);
  const crunchEnv = (t) => adsr(t, duration, 0.001, 0.03, 0.3, 0.06);

  const layers = [
    (t) => energy * 0.7 * bodyEnv(t) * Math.sin(2 * Math.PI * baseFreq * t),
    (t) => energy * 0.45 * bodyEnv(t) * Math.sin(2 * Math.PI * baseFreq * 2.1 * t + 0.5),
    createNoiseLayer({
      seed: 900 + seed,
      smoothing: 0.18 + hardness * 0.12,
      scale: energy * (0.32 + hardness * 0.24),
      envelope: noiseEnv,
    }),
  ];

  if (crunch > 0) {
    layers.push(
      createNoiseLayer({
        seed: 1400 + seed,
        smoothing: 0.05,
        scale: energy * crunch * 0.38,
        envelope: crunchEnv,
      })
    );
  }

  return renderLayers(ctx, duration, layers, { fadeOut: 0.06, normalize: 0.92 });
}

function createMusicBuffer(ctx) {
  const sampleRate = ctx.sampleRate;
  const bpm = 82;
  const beats = 16;
  const secondsPerBeat = 60 / bpm;
  const duration = beats * secondsPerBeat;
  const length = Math.max(1, Math.floor(duration * sampleRate));
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const channel = buffer.getChannelData(0);

  const chords = [
    { notes: [261.63, 329.63, 392], bass: 65.41 },
    { notes: [293.66, 349.23, 440], bass: 73.42 },
    { notes: [329.63, 392.0, 493.88], bass: 82.41 },
    { notes: [246.94, 392.0, 523.25], bass: 98.0 },
  ];
  const leadPattern = [0, 2, 4, 7, 4, 2, 0, -3];
  const noise = makeNoise(4242);
  let hatState = 0;

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const beat = t / secondsPerBeat;
    const chordIndex = Math.floor(beat / 4) % chords.length;
    const chord = chords[chordIndex];
    const chordProgress = (beat % 4) / 4;
    const chordEnv = Math.sin(Math.PI * chordProgress) ** 2;

    let pad = 0;
    for (const freq of chord.notes) {
      pad += Math.sin(2 * Math.PI * freq * t);
      pad += 0.45 * Math.sin(2 * Math.PI * freq * 2 * t + 0.3);
    }
    channel[i] += 0.18 * chordEnv * (pad / chord.notes.length);

    const bassEnv = Math.sin(Math.PI * Math.min(1, chordProgress * 1.1)) ** 2;
    channel[i] += 0.22 * bassEnv * Math.sin(2 * Math.PI * chord.bass * t + 0.15 * chordIndex);

    const quarter = Math.floor(beat);
    const quarterPos = beat - quarter;
    if (quarterPos < 0.45) {
      const freq = chord.notes[quarter % chord.notes.length] * 2;
      const pluckEnv = Math.sin(Math.PI * (quarterPos / 0.45)) ** 2;
      channel[i] += 0.12 * pluckEnv * Math.sin(2 * Math.PI * freq * t + 1.3);
    }

    const step = Math.floor(beat * 2);
    const stepPos = beat * 2 - step;
    const leadEnv = Math.sin(Math.PI * Math.min(1, stepPos)) ** 2;
    const noteOffset = leadPattern[step % leadPattern.length];
    const leadFreq = chord.notes[0] * Math.pow(2, noteOffset / 12);
    channel[i] += 0.08 * leadEnv * Math.sin(2 * Math.PI * leadFreq * t + 0.4 * chordIndex);

    const hatPhase = beat * 4 - Math.floor(beat * 4);
    let hatEnv = 0;
    if (hatPhase < 0.08) {
      hatEnv = Math.exp(-hatPhase * 34);
    }
    hatState = hatState * 0.5 + noise() * 0.5;
    channel[i] += 0.03 * hatEnv * hatState;
  }

  finalizeChannel(channel, sampleRate, {
    normalize: 0.55,
    loop: true,
    crossFade: 0.1,
    fadeIn: 0.02,
    fadeOut: 0,
  });

  return buffer;
}

function renderLayers(ctx, duration, layers, options = {}) {
  const sampleRate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(duration * sampleRate));
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const channel = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    let sample = 0;
    for (const layer of layers) {
      sample += layer(t, i, sampleRate) || 0;
    }
    channel[i] = sample;
  }

  finalizeChannel(channel, sampleRate, options);
  return buffer;
}

function finalizeChannel(channel, sampleRate, options = {}) {
  const {
    fadeIn = 0.002,
    fadeOut = 0.02,
    normalize = 0.9,
    loop = false,
    crossFade = 0,
    dcBlock = true,
  } = options;

  if (loop && crossFade > 0) {
    applyLoopCrossfade(channel, sampleRate, crossFade);
  }

  if (fadeIn > 0) {
    applyFade(channel, sampleRate, fadeIn, true);
  }
  if (!loop && fadeOut > 0) {
    applyFade(channel, sampleRate, fadeOut, false);
  }

  if (dcBlock) {
    let sum = 0;
    for (let i = 0; i < channel.length; i++) {
      sum += channel[i];
    }
    const mean = sum / channel.length;
    if (Math.abs(mean) > 1e-7) {
      for (let i = 0; i < channel.length; i++) {
        channel[i] -= mean;
      }
    }
  }

  if (normalize > 0) {
    let peak = 0;
    for (let i = 0; i < channel.length; i++) {
      const value = Math.abs(channel[i]);
      if (value > peak) peak = value;
    }
    if (peak > 0) {
      const target = normalize;
      const maxScale = 4;
      const scale = Math.max(Math.min(target / peak, maxScale), target < peak ? target / peak : 1 / maxScale);
      if (Math.abs(scale - 1) > 1e-3) {
        for (let i = 0; i < channel.length; i++) {
          channel[i] *= scale;
        }
      }
    }
=======
function envelopeAt(t, duration, attack, release, sustain = 1) {
  const a = Math.max(0.001, attack);
  const r = Math.max(0.001, release);
  if (t < a) return (t / a) * sustain;
  if (t > duration - r) {
    const rel = Math.max(0, duration - t);
    return (rel / r) * sustain;
  }
  return sustain;
}

function waveSample(type, phase) {
  switch (type) {
    case "square":
      return Math.sign(Math.sin(phase)) || 0;
    case "saw": {
      const normalized = phase / (2 * Math.PI);
      return 2 * (normalized - Math.floor(normalized + 0.5));
    }
    case "triangle":
      return (2 / Math.PI) * Math.asin(Math.sin(phase));
    default:
      return Math.sin(phase);
  }
}

function createChirpBuffer(
  ctx,
  {
    startFreq,
    endFreq = startFreq,
    duration = 0.2,
    attack = 0.01,
    release = 0.12,
    type = "sine",
    volume = 0.4,
  }
) {
  const sr = ctx.sampleRate;
  const frames = Math.max(1, Math.floor(duration * sr));
  const buffer = ctx.createBuffer(1, frames, sr);
  const data = buffer.getChannelData(0);
  let phase = 0;
  for (let i = 0; i < frames; i += 1) {
    const t = i / sr;
    const progress = i / frames;
    const freq = startFreq + (endFreq - startFreq) * progress;
    phase += (freq * 2 * Math.PI) / sr;
    const env = envelopeAt(t, duration, attack, release);
    data[i] = waveSample(type, phase) * env * volume;
  }
  return buffer;
}

function createNoiseBuffer(
  ctx,
  { duration = 0.35, attack = 0.01, release = 0.25, volume = 0.32, smooth = 0.18 }
) {
  const sr = ctx.sampleRate;
  const frames = Math.max(1, Math.floor(duration * sr));
  const buffer = ctx.createBuffer(1, frames, sr);
  const data = buffer.getChannelData(0);
  const s = Math.min(Math.max(smooth, 0), 1);
  let last = 0;
  for (let i = 0; i < frames; i += 1) {
    const t = i / sr;
    const env = envelopeAt(t, duration, attack, release);
    const white = Math.random() * 2 - 1;
    last += s * (white - last);
    data[i] = last * env * volume;
  }
  return buffer;
}

function mixBuffers(ctx, buffers) {
  if (!buffers.length) {
    return ctx.createBuffer(1, 1, ctx.sampleRate);
  }
  const frames = Math.max(...buffers.map((b) => b.length));
  const mixed = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = mixed.getChannelData(0);
  let max = 0;
  for (const buffer of buffers) {
    const input = buffer.getChannelData(0);
    for (let i = 0; i < input.length; i += 1) {
      data[i] += input[i];
      const abs = Math.abs(data[i]);
      if (abs > max) max = abs;
    }
  }
  if (max > 1) {
    const inv = 1 / max;
    for (let i = 0; i < data.length; i += 1) {
      data[i] *= inv;
    }
  }
  return mixed;
}

export const sfxRegistry = {
  pickup: (ctx) =>
    createChirpBuffer(ctx, {
      startFreq: 880,
      endFreq: 1320,
      duration: 0.12,
      attack: 0.005,
      release: 0.08,
      type: "triangle",
      volume: 0.38,
    }),
  plant: (ctx) =>
    mixBuffers(ctx, [
      createChirpBuffer(ctx, {
        startFreq: 320,
        endFreq: 210,
        duration: 0.2,
        attack: 0.01,
        release: 0.14,
        type: "sine",
        volume: 0.28,
      }),
      createNoiseBuffer(ctx, {
        duration: 0.22,
        attack: 0.005,
        release: 0.16,
        volume: 0.18,
        smooth: 0.1,
      }),
    ]),
  sell: (ctx) =>
    createChirpBuffer(ctx, {
      startFreq: 520,
      endFreq: 680,
      duration: 0.18,
      attack: 0.005,
      release: 0.16,
      type: "square",
      volume: 0.3,
    }),
  water: (ctx) =>
    createNoiseBuffer(ctx, {
      duration: 0.45,
      attack: 0.02,
      release: 0.28,
      volume: 0.32,
      smooth: 0.24,
    }),
  ui: (ctx) =>
    createChirpBuffer(ctx, {
      startFreq: 700,
      endFreq: 520,
      duration: 0.1,
      attack: 0.005,
      release: 0.08,
      type: "triangle",
      volume: 0.34,
    }),
};

export const globalSfx = new SFX(sfxRegistry);

export function primeAudioUnlock() {
  const events = ["pointerdown", "touchstart", "keydown"];
  const handler = async () => {
    await globalSfx.unlock();
    for (const type of events) {
      window.removeEventListener(type, handler, true);
    }
  };
  for (const type of events) {
    window.addEventListener(type, handler, { passive: true, capture: true });
  }
}

function applyFade(channel, sampleRate, seconds, fadeIn) {
  const samples = Math.min(channel.length, Math.floor(seconds * sampleRate));
  if (samples <= 0) return;
  if (samples === 1) {
    const index = fadeIn ? 0 : channel.length - 1;
    channel[index] = 0;
    return;
  }
  for (let i = 0; i < samples; i++) {
    const denom = samples > 1 ? samples - 1 : 1;
    const ratio = denom === 0 ? 1 : i / denom;
    const index = fadeIn ? i : channel.length - samples + i;
    const factor = fadeIn ? ratio : 1 - ratio;
    channel[index] *= factor;
  }
}

function applyLoopCrossfade(channel, sampleRate, seconds) {
  const samples = Math.min(channel.length >> 1, Math.floor(seconds * sampleRate));
  if (samples <= 0) return;
  const start = new Float32Array(samples);
  const end = new Float32Array(samples);
  start.set(channel.subarray(0, samples));
  end.set(channel.subarray(channel.length - samples));
  for (let i = 0; i < samples; i++) {
    const mix = i / samples;
    const blended = start[i] * (1 - mix) + end[i] * mix;
    channel[i] = blended;
    channel[channel.length - samples + i] = blended;
  }
}

function adsr(t, duration, attack, decay, sustainLevel, release) {
  if (t < 0 || t > duration) return 0;
  if (attack > 0 && t < attack) {
    return t / attack;
  }
  const decayStart = attack;
  const decayEnd = attack + decay;
  const sustainStart = decayEnd;
  const sustainEnd = Math.max(sustainStart, duration - release);

  if (t < decayEnd) {
    if (decay <= 0) return 1;
    const progress = (t - decayStart) / decay;
    return 1 - (1 - sustainLevel) * progress;
  }

  if (t < sustainEnd) {
    return sustainLevel;
  }

  if (release <= 0) {
    return sustainLevel;
  }

  const releaseProgress = (t - sustainEnd) / release;
  return Math.max(0, sustainLevel * (1 - releaseProgress));
}

function glide(start, end, t, duration, curve = 1) {
  if (duration <= 0) return end;
  const progress = Math.min(1, Math.max(0, t / duration));
  const eased = curve !== 1 ? Math.pow(progress, curve) : progress;
  return start + (end - start) * eased;
}

function makeNoise(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

function createNoiseLayer({ seed = 1, smoothing = 0.2, scale = 0.4, envelope = () => 1 }) {
  const random = makeNoise(seed);
  let value = 0;
  return (t, i, sampleRate) => {
    value += smoothing * (random() - value);
    return envelope(t, i, sampleRate) * value * scale;
  };
}
