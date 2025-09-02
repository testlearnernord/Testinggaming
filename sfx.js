// Lightweight audio manager with pooled HTMLAudioElements, now with more SFX
export class SFX {
  constructor(manifest) {
    this.buf = new Map();
    this.enabled = true;
    this.load(manifest);
  }
  load(manifest) {
    for (const [k, url] of Object.entries(manifest)) {
      const a = new Audio(url);
      a.preload = "auto";
      this.buf.set(k, a);
    }
  }
  play(key, vol = 1) {
    if (!this.enabled) return;
    const src = this.buf.get(key);
    if (!src) return;
    const a = src.cloneNode();
    a.volume = vol;
    a.play().catch(() => { });
  }
}
