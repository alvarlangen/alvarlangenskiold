/**
 * Round state machine — pure functions, no DOM. The UI keeps a RoundState and replaces it with the
 * value returned by these functions.
 */
import { QUESTIONS_PER_ROUND, STEPS } from './config';
import { comboMultiplier, nextStreak, pointsForStep, resultSquare, xpForQuestion } from './scoring';
import type { QuestionResult, RoundKind, RoundState } from './types';

export function createRound(opts: {
  kind: RoundKind;
  seed: string;
  dateKey: string;
  targets: string[];
  golden: number;
  streak?: number;
  continent?: string;
}): RoundState {
  return {
    kind: opts.kind,
    seed: opts.seed,
    dateKey: opts.dateKey,
    continent: opts.continent,
    targets: opts.targets,
    golden: opts.golden,
    index: 0,
    step: 1,
    revealed: false,
    results: [],
    guesses: [],
    streak: opts.streak ?? 0,
    finished: false,
  };
}

export const currentTarget = (s: RoundState) => s.targets[s.index];
export const isGolden = (s: RoundState, i = s.index) => i === s.golden;

function finishQuestion(s: RoundState, correct: boolean, guesses: string[]): RoundState {
  const streak = nextStreak(s.streak, correct);
  const multiplier = correct ? comboMultiplier(streak) : 1;
  const points = pointsForStep(s.step, correct);
  const golden = isGolden(s);
  const result: QuestionResult = {
    id: currentTarget(s),
    solvedAt: correct ? s.step : null,
    points,
    xp: xpForQuestion(points, multiplier, golden),
    golden,
    multiplier,
    guesses,
  };
  return { ...s, revealed: true, streak, results: [...s.results, result], guesses };
}

/**
 * Apply a guess that has already been matched to a known target.
 * Correct → question ends. Wrong → next step (or lost on step 6).
 */
export function applyGuess(s: RoundState, guess: string, correct: boolean): RoundState {
  if (s.revealed || s.finished) return s;
  const guesses = [...s.guesses, guess];
  if (correct) return finishQuestion(s, true, guesses);
  if (s.step >= STEPS) return finishQuestion(s, false, guesses);
  return { ...s, step: s.step + 1, guesses };
}

/** "I don't know": advance one step without guessing (on step 6 this gives up the question). */
export function skipStep(s: RoundState): RoundState {
  if (s.revealed || s.finished) return s;
  const guesses = [...s.guesses, '—'];
  if (s.step >= STEPS) return finishQuestion(s, false, guesses);
  return { ...s, step: s.step + 1, guesses };
}

/** Move on after the reveal. */
export function nextQuestion(s: RoundState): RoundState {
  if (!s.revealed) return s;
  if (s.index + 1 >= Math.min(QUESTIONS_PER_ROUND, s.targets.length)) return { ...s, finished: true };
  return { ...s, index: s.index + 1, step: 1, revealed: false, guesses: [] };
}

export const roundScore = (s: RoundState) => s.results.reduce((a, r) => a + r.points, 0);
export const roundXp = (s: RoundState) => s.results.reduce((a, r) => a + r.xp, 0);
export const roundSquares = (s: RoundState) => s.results.map((r) => resultSquare(r.solvedAt)).join('');

/** Maximum possible round score (5 × 100). */
export const MAX_ROUND_SCORE = QUESTIONS_PER_ROUND * 100;
