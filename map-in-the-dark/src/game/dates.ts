import { EPOCH_DATE } from './config';

const DAY_MS = 86_400_000;

/** UTC calendar date as "YYYY-MM-DD". The daily round changes at midnight UTC. */
export function utcDateKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

const keyToMs = (key: string) => Date.parse(`${key}T00:00:00Z`);

/** Daily number: EPOCH_DATE is #1. */
export function dailyNumber(key: string): number {
  return Math.round((keyToMs(key) - keyToMs(EPOCH_DATE)) / DAY_MS) + 1;
}

/** Shift a date key by n days. */
export function addDays(key: string, n: number): string {
  return new Date(keyToMs(key) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((keyToMs(b) - keyToMs(a)) / DAY_MS);
}

/** Milliseconds until the next midnight UTC. */
export function msUntilNextDaily(now: Date = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}

/** "hh:mm:ss" countdown string. */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}
