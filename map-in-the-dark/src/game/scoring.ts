import {
  COMBO_MAX,
  COMBO_STEP,
  GOLDEN_MULTIPLIER,
  LEVEL_BASE_XP,
  LEVEL_XP_INCREMENT,
  POINTS_BY_STEP,
  STEPS,
  XP_BASE,
} from './config';

/** Points for answering correctly in `step` (1-based). Returns 0 for a lost question. */
export function pointsForStep(step: number, correct: boolean): number {
  if (!correct || step < 1 || step > STEPS) return 0;
  return POINTS_BY_STEP[step - 1];
}

/** Combo multiplier for a streak of `streak` correct answers in a row (including the current one). */
export function comboMultiplier(streak: number): number {
  if (streak <= 0) return 1;
  return Math.min(COMBO_MAX, 1 + Math.floor(streak / COMBO_STEP));
}

/** Next combo streak after a question: +1 on a correct answer, reset on a lost question. */
export const nextStreak = (streak: number, correct: boolean) => (correct ? streak + 1 : 0);

/** XP for a question. */
export function xpForQuestion(points: number, multiplier: number, golden: boolean): number {
  return Math.round(XP_BASE * (points / 100) * multiplier * (golden ? GOLDEN_MULTIPLIER : 1));
}

/** XP needed to go from `level` to `level + 1`. Grows linearly. */
export const xpToNext = (level: number) => LEVEL_BASE_XP + (level - 1) * LEVEL_XP_INCREMENT;

export interface LevelInfo {
  level: number;
  /** XP earned inside the current level. */
  into: number;
  /** XP required to complete the current level. */
  needed: number;
  progress: number;
}

/** Level derived from total XP (level 1 at 0 XP). */
export function levelFromXp(totalXp: number): LevelInfo {
  let level = 1;
  let rest = Math.max(0, Math.floor(totalXp));
  while (rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level++;
  }
  const needed = xpToNext(level);
  return { level, into: rest, needed, progress: rest / needed };
}

/** Emoji square for a question result: 🟩 steps 1–2, 🟨 steps 3–6, 🟥 lost. */
export function resultSquare(solvedAt: number | null): string {
  if (solvedAt == null) return '🟥';
  return solvedAt <= 2 ? '🟩' : '🟨';
}
