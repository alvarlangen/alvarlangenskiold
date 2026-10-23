/**
 * Tiny synthesised sound effects (WebAudio, no audio files).
 * The AudioContext is created lazily on the first sound, which always follows a user gesture.
 */
import { saveStore } from './storage';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audio(): AudioContext | null {
  if (!saveStore.get().settings.sound) return null;
  try {
    if (!ctx) {
      const AC =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

interface Tone {
  freq: number;
  to?: number;
  at?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
}

function play(tones: Tone[]) {
  const ac = audio();
  if (!ac || !master) return;
  const t0 = ac.currentTime + 0.01;
  for (const t of tones) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    const start = t0 + (t.at ?? 0);
    osc.type = t.type ?? 'sine';
    osc.frequency.setValueAtTime(t.freq, start);
    if (t.to) osc.frequency.exponentialRampToValueAtTime(t.to, start + t.dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(t.gain ?? 0.5, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, start + t.dur);
    osc.connect(g).connect(master);
    osc.start(start);
    osc.stop(start + t.dur + 0.05);
  }
}

/** Semitone helper. */
const st = (base: number, n: number) => base * 2 ** (n / 12);

export const sfx = {
  /** A piece lights up / a new clue appears. */
  light(step = 1) {
    const f = st(440, step * 2);
    play([
      { freq: f, to: f * 1.5, dur: 0.18, type: 'sine', gain: 0.25 },
      { freq: f * 2, dur: 0.12, at: 0.04, type: 'triangle', gain: 0.08 },
    ]);
  },
  /** Correct answer — pitch rises with the combo multiplier. */
  correct(combo = 1) {
    const base = st(523.25, (Math.min(5, combo) - 1) * 2);
    play(
      [0, 4, 7, 12].map((n, i) => ({
        freq: st(base, n),
        dur: 0.22,
        at: i * 0.07,
        type: 'triangle' as const,
        gain: 0.35,
      })),
    );
  },
  wrong() {
    play([
      { freq: 220, to: 130, dur: 0.28, type: 'sawtooth', gain: 0.12 },
      { freq: 110, to: 80, dur: 0.3, type: 'sine', gain: 0.3 },
    ]);
  },
  levelUp() {
    const notes = [0, 4, 7, 12, 16, 19, 24];
    play(notes.map((n, i) => ({ freq: st(392, n), dur: 0.3, at: i * 0.08, type: 'triangle' as const, gain: 0.3 })));
    play([{ freq: st(392, 24), dur: 0.9, at: 0.56, type: 'sine', gain: 0.25 }]);
  },
  tap() {
    play([{ freq: 880, dur: 0.05, type: 'sine', gain: 0.12 }]);
  },
};
