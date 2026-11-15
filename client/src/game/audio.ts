// Every sound is synthesised with WebAudio — no audio files to load.
import type { WeaponClass } from '../../../shared/config';

export interface AudioSettings { master: number; sfx: number; music: number; muted: boolean }

class Audio {
  private ctx: AudioContext | null = null;
  private sfxGain!: GainNode;
  private musicGain!: GainNode;
  private masterGain!: GainNode;
  private noise!: AudioBuffer;
  private settings: AudioSettings = { master: 0.8, sfx: 0.9, music: 0.6, muted: false };

  /** Browsers only allow audio after a user gesture; call this from one. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.masterGain = this.ctx.createGain(); this.masterGain.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain(); this.sfxGain.connect(this.masterGain);
      this.musicGain = this.ctx.createGain(); this.musicGain.connect(this.masterGain);
      this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.apply(this.settings);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  apply(s: AudioSettings): void {
    this.settings = s;
    if (!this.ctx) return;
    this.masterGain.gain.value = s.muted ? 0 : s.master;
    this.sfxGain.gain.value = s.sfx;
    this.musicGain.gain.value = s.music;
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'square', slideTo?: number, when = 0, pan = 0, music = false): void {
    const c = this.ctx;
    if (!c || vol <= 0.001) return;
    const t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    this.out(g, pan, music);
    o.start(t); o.stop(t + dur + 0.02);
  }

  private burst(dur: number, vol: number, freq: number, q = 0.8, type: BiquadFilterType = 'lowpass', when = 0, pan = 0): void {
    const c = this.ctx;
    if (!c || vol <= 0.001) return;
    const t = c.currentTime + when;
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g);
    this.out(g, pan, false);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }

  private out(node: AudioNode, pan: number, music: boolean): void {
    const c = this.ctx!;
    const dest = music ? this.musicGain : this.sfxGain;
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); node.connect(p); p.connect(dest); }
    else node.connect(dest);
  }

  shot(cls: WeaponClass, vol = 1, pan = 0): void {
    switch (cls) {
      case 'pistol': this.burst(0.09, 0.5 * vol, 2600, 0.7, 'lowpass', 0, pan); this.tone(520, 0.08, 0.22 * vol, 'square', 140, 0, pan); break;
      case 'smg': this.burst(0.06, 0.38 * vol, 3400, 0.7, 'lowpass', 0, pan); this.tone(680, 0.05, 0.16 * vol, 'square', 220, 0, pan); break;
      case 'rifle': this.burst(0.12, 0.5 * vol, 2000, 0.7, 'lowpass', 0, pan); this.tone(360, 0.1, 0.25 * vol, 'sawtooth', 90, 0, pan); break;
      case 'shotgun': this.burst(0.28, 0.75 * vol, 1200, 0.5, 'lowpass', 0, pan); this.tone(170, 0.2, 0.35 * vol, 'sawtooth', 50, 0, pan); break;
      case 'sniper': this.burst(0.45, 0.8 * vol, 900, 0.5, 'lowpass', 0, pan); this.tone(900, 0.3, 0.3 * vol, 'sawtooth', 60, 0, pan); break;
    }
  }
  punch(vol = 1, pan = 0): void { this.burst(0.08, 0.3 * vol, 500, 1, 'lowpass', 0, pan); }
  reload(): void { this.tone(900, 0.04, 0.12, 'square'); this.burst(0.05, 0.2, 4000, 2, 'bandpass', 0.12); this.tone(1300, 0.05, 0.14, 'square', undefined, 0.26); }
  empty(): void { this.tone(1500, 0.03, 0.1, 'square'); }
  pickup(): void { this.tone(660, 0.07, 0.18, 'triangle'); this.tone(990, 0.1, 0.18, 'triangle', undefined, 0.06); }
  step(vol = 1, pan = 0): void { this.burst(0.05, 0.1 * vol, 700 + Math.random() * 300, 1.2, 'bandpass', 0, pan); }
  hit(): void { this.tone(1100, 0.06, 0.22, 'triangle', 700); }
  hurt(): void { this.tone(220, 0.14, 0.3, 'sawtooth', 90); this.burst(0.08, 0.25, 900); }
  wall(vol = 1, pan = 0): void { this.burst(0.04, 0.12 * vol, 3000, 3, 'bandpass', 0, pan); }
  kill(): void { [660, 880, 1320].forEach((f, i) => this.tone(f, 0.12, 0.22, 'triangle', undefined, i * 0.07)); }
  death(): void { [440, 330, 220, 147].forEach((f, i) => this.tone(f, 0.22, 0.24, 'sawtooth', undefined, i * 0.14)); }
  boom(vol = 1, pan = 0): void { this.burst(0.7, 0.9 * vol, 500, 0.4, 'lowpass', 0, pan); this.tone(110, 0.5, 0.5 * vol, 'sine', 30, 0, pan); }
  heal(): void { [523, 659, 784].forEach((f, i) => this.tone(f, 0.14, 0.14, 'sine', undefined, i * 0.08)); }
  dash(): void { this.burst(0.18, 0.25, 1800, 0.8, 'highpass'); }
  click(): void { this.tone(720, 0.04, 0.1, 'triangle'); }
  land(): void { this.burst(0.2, 0.35, 400); this.tone(140, 0.2, 0.3, 'sine', 60); }
  zoneWarn(): void { for (let i = 0; i < 3; i++) this.tone(740, 0.16, 0.2, 'square', 620, i * 0.28); }
  countdown(): void { this.tone(880, 0.08, 0.12, 'square'); }
  revive(): void { [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.14, 0.16, 'triangle', undefined, i * 0.07)); }

  victory(): void {
    const notes = [523, 659, 784, 1047, 784, 1047, 1319, 1568];
    notes.forEach((f, i) => { this.tone(f, i === notes.length - 1 ? 0.9 : 0.2, 0.22, 'triangle', undefined, i * 0.15, 0, true); this.tone(f / 2, 0.22, 0.12, 'square', undefined, i * 0.15, 0, true); });
  }
  defeat(): void {
    [392, 370, 330, 262, 196].forEach((f, i) => this.tone(f, i === 4 ? 0.9 : 0.3, 0.2, 'triangle', undefined, i * 0.26, 0, true));
  }
}

export const audio = new Audio();
