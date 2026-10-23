/** Pure helpers for streaks and stats (the storage layer persists what these return). */
import { daysBetween } from './dates';

export interface StreakState {
  current: number;
  best: number;
  lastDay: string | null;
}

/** Update a daily streak when the daily round for `day` is completed. */
export function completeDay(s: StreakState, day: string): StreakState {
  if (s.lastDay === day) return s;
  const gap = s.lastDay ? daysBetween(s.lastDay, day) : Infinity;
  const current = gap === 1 ? s.current + 1 : 1;
  return { current, best: Math.max(s.best, current), lastDay: day };
}

/** The streak as shown today: broken if the last completed day is before yesterday. */
export function visibleStreak(s: StreakState, today: string): number {
  if (!s.lastDay) return 0;
  const gap = daysBetween(s.lastDay, today);
  return gap <= 1 ? s.current : 0;
}
