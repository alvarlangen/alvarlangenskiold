/**
 * Everything the game remembers, stored in localStorage only (never sent anywhere).
 * All access is wrapped in try/catch: private mode, quotas or disabled storage fall back to memory.
 */
import { createStore } from './store';
import type { QuestionResult, RoundState } from '../game/types';
import type { StreakState } from '../game/progress';

export type MotionSetting = 'system' | 'reduce' | 'full';

export interface Settings {
  sound: boolean;
  haptics: boolean;
  suggestions: boolean;
  motion: MotionSetting;
}

export interface DailyRecord {
  score: number;
  xp: number;
  results: QuestionResult[];
  dayNo: number;
}

export interface SaveData {
  v: 2;
  xp: number;
  settings: Settings;
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

const KEY = 'map-in-the-dark:v2';
const OLD_KEY = 'map-in-the-dark:v1';

export const defaultSettings = (): Settings => ({ sound: true, haptics: true, suggestions: true, motion: 'system' });

export const defaultSave = (): SaveData => ({
  v: 2,
  xp: 0,
  settings: defaultSettings(),
  streak: { current: 0, best: 0, lastDay: null },
  combo: 0,
  rounds: 0,
  bestScore: 0,
  stepHist: [0, 0, 0, 0, 0, 0, 0],
  continents: {},
  daily: {},
  current: null,
});

/** Merge a possibly older/partial save with defaults so missing fields never crash the app. */
function hydrate(raw: unknown): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<SaveData>;
  return {
    ...d,
    ...r,
    v: 2,
    xp: typeof r.xp === 'number' && r.xp >= 0 ? r.xp : 0,
    settings: { ...d.settings, ...(r.settings ?? {}) },
    streak: { ...d.streak, ...(r.streak ?? {}) },
    stepHist: Array.isArray(r.stepHist) && r.stepHist.length === 7 ? r.stepHist : d.stepHist,
    continents: r.continents ?? {},
    daily: r.daily ?? {},
    // Rounds saved by the old (countries + cities) version are not resumed.
    current: r.current && Array.isArray(r.current.targets) && !('mode' in r.current) ? r.current : null,
  };
}

/** One-time migration from v1, which stored separate Countries and Cities progress. */
function migrate(): unknown {
  const old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null');
  if (!old) return null;
  const c = old.modes?.cities ?? {};
  return { xp: old.xp, settings: old.settings, ...c, current: null };
}

function read(): SaveData {
  try {
    const s = localStorage.getItem(KEY);
    return hydrate(s ? JSON.parse(s) : migrate());
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

export function resetAll() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(OLD_KEY);
  } catch {
    /* ignore */
  }
  saveStore.set({ ...defaultSave(), settings: saveStore.get().settings });
}
