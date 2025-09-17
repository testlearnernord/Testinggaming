const AudioCtx = window.AudioContext || window.webkitAudioContext;

export class SFX {
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
    const buffer = this.buffers.get(id);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
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
