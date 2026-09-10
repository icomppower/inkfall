import { Rng } from './sim/rng';
import { clamp, lerp } from './sim/rng';
import { RAVINE_S, COURSE_LENGTH } from './sim/constants';
import type { SurfaceType } from './sim/constants';

export interface AudioState {
  speed: number;          // m/s
  wheelRpm: number;
  surface: SurfaceType;
  rough: number;
  brake: number;
  pedal: number;
  sliding: boolean;
  airborne: boolean;
  boosting: boolean;
  rain: number;           // 0..1
  s: number;              // track position
  section: number;
  crashed: boolean;
  finished: boolean;
}

/** 宮商角徵羽 — the Chinese pentatonic, as semitone offsets from the tonic. */
const PENTATONIC = [0, 2, 4, 7, 9];
const BPM = 128;
const BEAT = 60 / BPM;
const ROOT_HZ = 146.83;   // D3

function midiToHz(semitonesAboveRoot: number): number {
  return ROOT_HZ * Math.pow(2, semitonesAboveRoot / 12);
}

/**
 * Everything you hear is generated here: no audio files, no samples. SFX are filtered
 * noise and impulse trains; the music is a seeded pentatonic generator with
 * Karplus-Strong plucks standing in for a guzheng.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  muted = false;
  started = false;
  notesPlayed = 0;
  lastDegrees: number[] = [];

  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private toneFilter!: BiquadFilterNode;
  private analyser!: AnalyserNode;
  private analysisBuf!: Float32Array<ArrayBuffer>;

  private noise!: AudioBuffer;
  private wind!: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode };
  private tyre!: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode };
  private rainBed!: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode };
  private falls!: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode };
  private crowd!: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode };
  private squeal!: { osc: OscillatorNode; filter: BiquadFilterNode; gain: GainNode };
  private shimmer!: { osc: OscillatorNode; gain: GainNode };

  private rng: Rng;
  private plucks = new Map<number, AudioBuffer>();
  private nextBeat = 0;
  private beatIndex = 0;
  private nextClick = 0;
  private nextGrain = 0;
  private seed: string;

  constructor(seed: string) {
    this.seed = seed;
    this.rng = new Rng(`audio:${seed}`);
  }

  /** Must be called from a real user gesture. Safe to call repeatedly. */
  start(): void {
    if (this.started) { void this.ctx?.resume(); return; }
    const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.started = true;
    this.build();
    void this.ctx.resume();
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = this.rng.next() * 2 - 1;
      last = last * 0.32 + w * 0.68;      // a touch of brown, so it reads as air not hiss
      d[i] = last;
    }
    return buf;
  }

  private loopNoise(gainValue: number, type: BiquadFilterType, freq: number, q = 1):
  { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    src.connect(filter).connect(gain).connect(this.sfxBus);
    src.start();
    return { src, filter, gain };
  }

  private build(): void {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    // Rain closes the mix down: everything past this point gets low-passed.
    this.toneFilter = ctx.createBiquadFilter();
    this.toneFilter.type = 'lowpass';
    this.toneFilter.frequency.value = 18000;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analysisBuf = new Float32Array(this.analyser.fftSize);
    this.master.connect(this.toneFilter).connect(this.analyser).connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.42;
    this.musicBus.connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);

    this.noise = this.makeNoise(3.0);
    this.wind = this.loopNoise(0, 'bandpass', 520, 0.7);
    this.tyre = this.loopNoise(0, 'bandpass', 900, 1.2);
    this.rainBed = this.loopNoise(0, 'highpass', 1400, 0.6);
    this.falls = this.loopNoise(0, 'bandpass', 700, 0.5);
    this.crowd = this.loopNoise(0, 'bandpass', 420, 2.2);

    const squealOsc = ctx.createOscillator();
    squealOsc.type = 'sawtooth';
    squealOsc.frequency.value = 2380;
    const squealFilter = ctx.createBiquadFilter();
    squealFilter.type = 'bandpass';
    squealFilter.frequency.value = 2500;
    squealFilter.Q.value = 14;
    const squealGain = ctx.createGain();
    squealGain.gain.value = 0;
    squealOsc.connect(squealFilter).connect(squealGain).connect(this.sfxBus);
    squealOsc.start();
    this.squeal = { osc: squealOsc, filter: squealFilter, gain: squealGain };

    const shimmerOsc = ctx.createOscillator();
    shimmerOsc.type = 'triangle';
    shimmerOsc.frequency.value = midiToHz(36);
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.value = 0;
    shimmerOsc.connect(shimmerGain).connect(this.musicBus);
    shimmerOsc.start();
    this.shimmer = { osc: shimmerOsc, gain: shimmerGain };

    this.nextBeat = ctx.currentTime + 0.15;
    this.nextClick = ctx.currentTime;
    this.nextGrain = ctx.currentTime;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.02);
  }

  toggleMute(): void { this.setMuted(!this.muted); }

  /** Mix brightness in Hz — rain closes this down. */
  get toneHz(): number {
    return this.ctx ? this.toneFilter.frequency.value : 0;
  }

  /** RMS of the master bus — used by the gate to prove the graph is actually sounding. */
  level(): number {
    if (!this.ctx) return 0;
    this.analyser.getFloatTimeDomainData(this.analysisBuf);
    let sum = 0;
    for (let i = 0; i < this.analysisBuf.length; i++) sum += this.analysisBuf[i] * this.analysisBuf[i];
    return Math.sqrt(sum / this.analysisBuf.length);
  }

  // ---- Karplus-Strong, rendered to a buffer so short delays are not a problem.
  private pluck(freq: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const key = Math.round(freq * 4) * 100 + Math.round(decay * 10);
    const cached = this.plucks.get(key);
    if (cached) return cached;
    const sr = ctx.sampleRate;
    const n = Math.max(2, Math.round(sr / freq));
    const len = Math.floor(sr * decay);
    const buf = ctx.createBuffer(1, len, sr);
    const out = buf.getChannelData(0);
    const line = new Float32Array(n);
    const rng = new Rng(`pluck:${key}:${this.seed}`);
    for (let i = 0; i < n; i++) line[i] = rng.next() * 2 - 1;
    const damp = 0.5;
    const feedback = Math.pow(0.001, 1 / (freq * decay));   // decay to -60 dB
    let idx = 0, prev = 0;
    for (let i = 0; i < len; i++) {
      const cur = line[idx];
      const filtered = damp * cur + (1 - damp) * prev;
      prev = filtered;
      out[i] = filtered * 0.7;
      line[idx] = filtered * feedback;
      idx = (idx + 1) % n;
    }
    // Soften the attack so it reads as a plucked string, not a click.
    const atk = Math.min(len, Math.floor(sr * 0.004));
    for (let i = 0; i < atk; i++) out[i] *= i / atk;
    this.plucks.set(key, buf);
    return buf;
  }

  private playBuffer(buf: AudioBuffer, when: number, gain: number, dest: AudioNode, rate = 1): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(dest);
    src.start(when);
  }

  /** A short noise grain — gravel spit, rock clatter, tyre scrub. */
  private grain(when: number, gain: number, freq: number, q: number, dur: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loopStart = 0;
    const offset = this.rng.next() * 2.5;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + dur * 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(filter).connect(g).connect(this.sfxBus);
    src.start(when, offset, dur);
  }

  /** Low sine thump with a pitch drop: landings, crashes, the drum. */
  private thump(when: number, gain: number, f0: number, f1: number, dur: number, dest?: AudioNode): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, when);
    osc.frequency.exponentialRampToValueAtTime(f1, when + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g).connect(dest ?? this.sfxBus);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  impact(strength: number, surface: SurfaceType): void {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this.thump(t, 0.55 * strength, 150, 48, 0.22);
    const woody = surface === 'wood';
    this.grain(t, 0.32 * strength, woody ? 1600 : surface === 'rock' ? 2600 : 1100, woody ? 6 : 2.5, 0.16);
  }

  crash(): void {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 7; i++) {
      const when = t + i * (0.09 + this.rng.next() * 0.07);
      this.thump(when, 0.30 - i * 0.03, 120 - i * 8, 40, 0.18);
      this.grain(when, 0.24, 900 + this.rng.next() * 2200, 3, 0.13);
    }
  }

  /** Per-frame mix update plus the music and impulse-train schedulers. */
  update(st: AudioState, dt: number): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const tc = Math.max(0.02, dt * 2);
    const set = (p: AudioParam, v: number) => p.setTargetAtTime(v, now, tc);

    const v = st.speed;
    // Wind: filtered noise scaled by speed.
    set(this.wind.gain.gain, clamp(v * v * 0.00055, 0, 0.30));
    set(this.wind.filter.frequency, 380 + v * 34);

    // Tyre layer, per surface.
    const tyreCfg: Record<string, { f: number; q: number; g: number }> = {
      tarmac: { f: 620, q: 0.9, g: 0.055 },
      hardpack: { f: 900, q: 1.1, g: 0.075 },
      rock: { f: 1500, q: 1.6, g: 0.090 },
      dirt: { f: 780, q: 1.0, g: 0.070 },
      wood: { f: 480, q: 2.4, g: 0.085 },
      stone: { f: 1100, q: 1.3, g: 0.075 },
      void: { f: 600, q: 1, g: 0 },
    };
    const cfg = tyreCfg[st.surface] ?? tyreCfg.dirt;
    const ground = st.airborne ? 0 : 1;
    set(this.tyre.filter.frequency, cfg.f + v * 12);
    set(this.tyre.gain.gain, ground * clamp(cfg.g * (0.25 + v * 0.10) * (st.sliding ? 2.3 : 1), 0, 0.42));

    // Granular bursts on the loose surfaces, and rock clatter.
    if (ground && (st.rough > 0.02 || st.sliding)) {
      const rate = clamp(v * (st.sliding ? 3.2 : 1.4) * (0.4 + st.rough * 8), 0, 90);
      while (this.nextGrain < now + 0.1) {
        this.nextGrain += 1 / Math.max(rate, 1);
        const when = Math.max(this.nextGrain, now);
        this.grain(when, 0.07 + this.rng.next() * 0.10,
          st.surface === 'rock' ? 2200 + this.rng.next() * 2600 : 1100 + this.rng.next() * 1400,
          st.surface === 'rock' ? 5 : 2, 0.05 + this.rng.next() * 0.06);
      }
    } else {
      this.nextGrain = Math.max(this.nextGrain, now);
    }

    // Freewheel click train at wheel RPM, only when coasting.
    const clicksPerSec = (st.wheelRpm / 60) * 18;
    if (!st.airborne && st.pedal < 0.05 && clicksPerSec > 0.5) {
      while (this.nextClick < now + 0.1) {
        this.nextClick += 1 / clicksPerSec;
        this.grain(Math.max(this.nextClick, now), 0.05, 4200, 12, 0.012);
      }
    } else {
      this.nextClick = Math.max(this.nextClick, now);
    }

    // Brake squeal.
    set(this.squeal.gain.gain, clamp(st.brake * (v - 4) * 0.010, 0, 0.10));
    set(this.squeal.filter.frequency, 2100 + v * 26);

    // Rain bed, waterfall at the gap, crowd at the village.
    set(this.rainBed.gain.gain, clamp(st.rain * 0.16, 0, 0.16));
    const dFalls = Math.abs(st.s - RAVINE_S);
    set(this.falls.gain.gain, clamp((1 - dFalls / 190) * 0.15, 0, 0.15));
    const dVillage = Math.max(0, COURSE_LENGTH - 120 - st.s);
    set(this.crowd.gain.gain, clamp((1 - dVillage / 200) * 0.12, 0, 0.12));

    // Rain closes the mix; boost opens a shimmer on top.
    set(this.toneFilter.frequency, lerp(18000, 2600, st.rain));
    set(this.shimmer.gain.gain, st.boosting ? 0.05 : 0);

    this.scheduleMusic(st, now);
  }

  /** Seeded generative pentatonic, layered by speed and section. */
  private scheduleMusic(st: AudioState, now: number): void {
    while (this.nextBeat < now + 0.25) {
      const when = Math.max(this.nextBeat, now + 0.01);
      const beat = this.beatIndex;
      const bar = Math.floor(beat / 4);
      const inBar = beat % 4;
      // Intensity: the ridge is sparse and airy, the jump line is full, the finish resolves.
      const speedI = clamp(st.speed / 18, 0, 1);
      const sectionI = st.section === 1 ? 0.35 : st.section === 3 ? 1.0 : st.section === 5 ? 0.7 : 0.65;
      const intensity = clamp(speedI * 0.55 + sectionI * 0.55, 0, 1.2);

      // Lead: guzheng-like plucks on the pentatonic.
      const notes = intensity > 0.85 ? 2 : 1;
      for (let k = 0; k < notes; k++) {
        if (this.rng.next() > 0.34 + intensity * 0.45) continue;
        const octave = this.rng.next() < 0.30 + intensity * 0.3 ? 24 : 12;
        const degree = PENTATONIC[Math.floor(this.rng.next() * PENTATONIC.length)];
        const semis = degree + octave;
        this.lastDegrees.push(degree);
        if (this.lastDegrees.length > 64) this.lastDegrees.shift();
        this.playBuffer(this.pluck(midiToHz(semis), 1.6), when + k * BEAT * 0.5,
          0.20 + intensity * 0.14, this.musicBus);
        this.notesPlayed++;
      }

      // Sub bass on the bar.
      if (inBar === 0) {
        const semis = PENTATONIC[bar % PENTATONIC.length] - 12;
        this.thump(when, 0.16 + intensity * 0.08, midiToHz(semis), midiToHz(semis) * 0.99, BEAT * 1.8, this.musicBus);
      }
      // Low drum, occasionally.
      if (inBar === 2 && this.rng.next() < 0.22 + intensity * 0.28) {
        this.thump(when, 0.22, 96, 44, 0.24, this.musicBus);
      }
      // Noise hats.
      if (intensity > 0.5 && this.rng.next() < 0.55) {
        this.grain(when + BEAT * 0.5, 0.035 + intensity * 0.02, 8200, 3, 0.035);
      }

      this.nextBeat += BEAT;
      this.beatIndex++;
    }
  }
}
