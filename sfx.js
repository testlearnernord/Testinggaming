// Modern audio manager with WebAudio acceleration, randomised pitch and graceful fallbacks
export class SFX {
  constructor(manifest) {
    this.enabled = true;
    this.entries = new Map();
    this.ctx = null;
    this.useWebAudio = false;
    this.ready = this.init(manifest);
  }

  async init(manifest) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      try {
        this.ctx = new AudioCtx();
        this.useWebAudio = true;
      } catch (_) {
        this.ctx = null;
        this.useWebAudio = false;
      }
    }

    const loaders = Object.entries(manifest).map(async ([key, value]) => {
      const urls = Array.isArray(value) ? value : [value];
      const entry = { urls, buffers: [], html: [] };
      this.entries.set(key, entry);

      await Promise.all(urls.map(async (url) => {
        if (this.ctx) {
          try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const arr = await res.arrayBuffer();
            const buffer = await new Promise((resolve, reject) => {
              this.ctx.decodeAudioData(arr.slice(0), resolve, reject);
            });
            entry.buffers.push(buffer);
          } catch (_) {
            // fallback handled by HTML audio below
          }
        }

        try {
          const tag = new Audio(url);
          tag.preload = "auto";
          tag.onerror = () => { /* ignore decode errors, fallback already in place */ };
          entry.html.push(tag);
        } catch (_) {
          // Ignore environments without HTMLAudioElement support
        }
      }));
    });

    await Promise.all(loaders);
    if (this.entries.size === 0) this.enabled = false;
  }

  pick(list) {
    if (!list || !list.length) return null;
    return list[Math.floor(Math.random() * list.length)];
  }

  play(key, volumeOrOpts = 1, maybeOpts) {
    if (!this.enabled) return;
    const entry = this.entries.get(key);
    if (!entry) return;

    let opts;
    if (typeof volumeOrOpts === "object") {
      opts = volumeOrOpts || {};
    } else {
      opts = maybeOpts || {};
      if (typeof volumeOrOpts === "number") opts.volume = volumeOrOpts;
    }

    let volume = typeof opts.volume === "number" ? opts.volume : 1;
    volume = Math.min(1, Math.max(0, volume));

    let rate = typeof opts.rate === "number" ? opts.rate : 1;
    const rateVariance = opts.rateRange ?? opts.randomRate;
    if (Array.isArray(rateVariance)) {
      const [min, max] = rateVariance;
      rate = min + Math.random() * (max - min);
    } else if (typeof rateVariance === "number") {
      rate = rate * (1 + (Math.random() * 2 - 1) * rateVariance);
    }
    rate = Math.max(0.25, rate);

    let detune = typeof opts.detune === "number" ? opts.detune : 0;
    const detuneVariance = opts.detuneRange ?? opts.randomDetune;
    if (Array.isArray(detuneVariance)) {
      const [min, max] = detuneVariance;
      detune += min + Math.random() * (max - min);
    } else if (typeof detuneVariance === "number") {
      detune += (Math.random() * 2 - 1) * detuneVariance;
    }

    let offset = typeof opts.offset === "number" ? opts.offset : 0;
    const offsetVariance = opts.offsetRange;
    if (Array.isArray(offsetVariance)) {
      const [min, max] = offsetVariance;
      offset += min + Math.random() * (max - min);
    } else if (typeof offsetVariance === "number") {
      offset += (Math.random() * 2 - 1) * offsetVariance;
    }
    offset = Math.max(0, offset);

    if (this.ctx && this.useWebAudio && entry.buffers.length) {
      const buffer = this.pick(entry.buffers);
      if (!buffer) return;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      if (detune) source.detune.value = detune;
      if (rate !== 1) source.playbackRate.value = rate;
      const gain = this.ctx.createGain();
      gain.gain.value = volume;
      source.connect(gain).connect(this.ctx.destination);
      if (this.ctx.state === "suspended") {
        this.ctx.resume().catch(() => {});
      }
      try {
        source.start(0, offset);
      } catch (_) {
        source.start();
      }
      return;
    }

    const clip = this.pick(entry.html);
    if (!clip) return;
    const node = clip.cloneNode();
    node.volume = volume;
    if (rate !== 1 && node.playbackRate) node.playbackRate = rate;
    if (offset) {
      try { node.currentTime = offset; } catch (_) { /* ignore */ }
    }
    node.play().catch(() => {});
  }
}
