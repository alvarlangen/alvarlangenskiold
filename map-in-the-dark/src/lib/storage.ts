/**
 * Everything the game remembers, stored in localStorage only (never sent anywhere).
 * All access is wrapped in try/catch: private mode, quotas or disabled storage fall back to memory.
 */
import { createStore } from './store';
import type { Mode, QuestionResult, RoundState } from '../game/types';
import type { StreakState } from '../game/progress';

export type ThemeSetting = 'system' | 'dark' | 'light';
export type MotionSetting = 'system' | 'reduce' | 'full';

export interface Settings {
  sound: boolean;
  haptics: boolean;
  theme: ThemeSetting;
  suggestions: boolean;
  projection: 'globe' | 'flat';
  motion: MotionSetting;
}

export interface DailyRecord {
  score: number;
  xp: number;
  results: QuestionResult[];
  dayNo: number;
}

export interface ModeData {
  streak: StreakState;
  combo: number;
  rounds: number;
  bestScore: number;
  /** Correct answers per step 1–6, then losses (index 6). */
  stepHist: number[];
  continents: Record<string, { played: number; won: number }>;
  daily: Record<string, DailyRecord>;
  /** In-progress daily round (resumed after a reload). */
  current: RoundState | null;
}

export interface SaveData {
  v: 1;
  xp: number;
  settings: Settings;
  modes: Record<Mode, ModeData>;
  seenIntro: boolean;
}

const KEY = 'map-in-the-dark:v1';

export const defaultSettings = (): Settings => ({
  sound: true,
  haptics: true,
  theme: 'system',
  suggestions: true,
  projection: 'globe',
  motion: 'system',
});

const defaultMode = (): ModeData => ({
  streak: { current: 0, best: 0, lastDay: null },
  combo: 0,
  rounds: 0,
  bestScore: 0,
  stepHist: [0, 0, 0, 0, 0, 0, 0],
  continents: {},
  daily: {},
  current: null,
});

export const defaultSave = (): SaveData => ({
  v: 1,
  xp: 0,
  settings: defaultSettings(),
  modes: { countries: defaultMode(), cities: defaultMode() },
  seenIntro: false,
});

/** Merge a possibly older/partial save with defaults so missing fields never crash the app. */
function hydrate(raw: unknown): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<SaveData>;
  const mode = (m?: Partial<ModeData>): ModeData => {
    const base = defaultMode();
    if (!m) return base;
    return {
      ...base,
      ...m,
      streak: { ...base.streak, ...(m.streak ?? {}) },
      stepHist: Array.isArray(m.stepHist) && m.stepHist.length === 7 ? m.stepHist : base.stepHist,
      continents: m.continents ?? {},
      daily: m.daily ?? {},
      current: m.current ?? null,
    };
  };
  return {
    v: 1,
    xp: typeof r.xp === 'number' && r.xp >= 0 ? r.xp : 0,
    settings: { ...d.settings, ...(r.settings ?? {}) },
    modes: { countries: mode(r.modes?.countries), cities: mode(r.modes?.cities) },
    seenIntro: !!r.seenIntro,
  };
}

function read(): SaveData {
  try {
    const s = localStorage.getItem(KEY);
    return hydrate(s ? JSON.parse(s) : null);
  } catch {
    return defaultSave();
  }
}

export const saveStore = createStore<SaveData>(read());

saveStore.subscribe((v) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // Storage unavailable or full: keep playing with in-memory state.
  }
});

// Keep several open tabs in sync.
try {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && e.newValue) {
      try {
        const next = hydrate(JSON.parse(e.newValue));
        if (JSON.stringify(next) !== JSON.stringify(saveStore.get())) saveStore.set(next);
      } catch {
        /* ignore malformed */
      }
    }
  });
} catch {
  /* non-browser */
}

export function updateSettings(patch: Partial<Settings>) {
  saveStore.set((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
}

export function updateMode(mode: Mode, fn: (m: ModeData) => ModeData) {
  saveStore.set((s) => ({ ...s, modes: { ...s.modes, [mode]: fn(s.modes[mode]) } }));
}

export function resetAll() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  saveStore.set({ ...defaultSave(), settings: saveStore.get().settings });
}
