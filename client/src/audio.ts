/** Tiny synthesised SFX so there are no audio assets to license. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;

  /** Browsers only allow audio after a user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  dribble(volume = 0.5): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.16);
    this.burst(0.03, 2500, 'highpass', volume * 0.25);
  }

  rim(volume = 0.5): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const f of [620, 1340, 2150]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(volume * 0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.36);
    }
  }

  board(volume = 0.5): void {
    this.burst(0.12, 400, 'lowpass', volume);
  }

  swish(): void {
    this.burst(0.35, 3200, 'bandpass', 0.35);
  }

  cheer(): void {
    this.burst(1.8, 1100, 'bandpass', 0.22, 0.25);
  }

  whistle(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const g = ctx.createGain();
    o.frequency.value = 2900;
    lfo.frequency.value = 38;
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.02);
    g.gain.setValueAtTime(0.12, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.45);
    lfo.stop(t + 0.45);
  }

  buzzer(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const f of [180, 183]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.08, t + 0.03);
      g.gain.setValueAtTime(0.08, t + 0.9);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.05);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 1.1);
    }
  }

  private burst(dur: number, freq: number, type: BiquadFilterType, volume: number, attack = 0.005): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(volume, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }
}
