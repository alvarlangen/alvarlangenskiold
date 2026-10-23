/**
 * Applies finished questions and rounds to the saved profile (XP, combo, stats, streak, history).
 * The game rules themselves live in src/game; this only persists their results.
 */
import { completeDay } from '../game/progress';
import { levelFromXp } from '../game/scoring';
import { dailyNumber } from '../game/dates';
import type { QuestionResult, RoundState } from '../game/types';
import { saveStore } from './storage';
import { levelUpStore } from './ui';

/** Record one answered question. Returns true if the player levelled up. */
export function recordQuestion(r: QuestionResult, continent: string, streak: number): boolean {
  const before = levelFromXp(saveStore.get().xp).level;
  saveStore.set((s) => {
    const stepHist = s.stepHist.slice();
    stepHist[r.solvedAt == null ? 6 : r.solvedAt - 1]++;
    const c = s.continents[continent] ?? { played: 0, won: 0 };
    return {
      ...s,
      xp: s.xp + r.xp,
      combo: streak,
      stepHist,
      continents: { ...s.continents, [continent]: { played: c.played + 1, won: c.won + (r.solvedAt ? 1 : 0) } },
    };
  });
  const after = levelFromXp(saveStore.get().xp).level;
  if (after > before) {
    levelUpStore.set(after);
    return true;
  }
  return false;
}

/** Persist the in-progress daily round so a reload resumes it. */
export function saveCurrent(round: RoundState | null) {
  saveStore.set((s) => ({ ...s, current: round }));
}

/** Record a finished round. Daily rounds update the streak, best score and history. */
export function recordRound(round: RoundState) {
  const score = round.results.reduce((a, r) => a + r.points, 0);
  const xp = round.results.reduce((a, r) => a + r.xp, 0);
  saveStore.set((s) => {
    const next = { ...s, rounds: s.rounds + 1 };
    if (round.kind !== 'daily') return next;
    return {
      ...next,
      current: null,
      streak: completeDay(s.streak, round.dateKey),
      bestScore: Math.max(s.bestScore, score),
      daily: { ...s.daily, [round.dateKey]: { score, xp, results: round.results, dayNo: dailyNumber(round.dateKey) } },
    };
  });
}
