import { QUESTIONS_PER_ROUND, TIER_BOUNDS } from './config';
import { randInt, rngFrom, shuffle } from './rng';
import type { Mode, Target } from './types';

export interface Selection {
  targets: string[];
  /** Index (0–4) of the golden question. */
  golden: number;
}

/**
 * Pick one target per difficulty tier so the round goes from well known to less known.
 * Deterministic for a given seed and pool.
 */
export function selectByTiers(
  pool: readonly Target[],
  seed: string,
  exclude: ReadonlySet<string> = new Set(),
): Selection {
  const ranked = pool.slice().sort((a, b) => a.rank - b.rank);
  const rng = rngFrom(seed);
  const n = ranked.length;
  const picked: string[] = [];
  for (let q = 0; q < QUESTIONS_PER_ROUND; q++) {
    const from = Math.floor(TIER_BOUNDS[q] * n);
    const to = Math.max(from + 1, Math.floor(TIER_BOUNDS[q + 1] * n));
    const tier = ranked.slice(from, to).filter((t) => !picked.includes(t.id));
    const fresh = tier.filter((t) => !exclude.has(t.id));
    const choices = fresh.length ? fresh : tier;
    picked.push(choices[randInt(rng, choices.length)].id);
  }
  return { targets: picked, golden: randInt(rng, QUESTIONS_PER_ROUND) };
}

/**
 * The daily round: the same five targets for everyone on a given UTC date and mode.
 *
 * Each tier is walked through a seeded permutation, one target per day, so a target does not come
 * back until its whole tier has been used (no chaining on previous days is needed, so any date can be
 * computed independently and offline).
 */
export function selectDaily(pool: readonly Target[], mode: Mode, day: number): Selection {
  const ranked = pool.slice().sort((a, b) => a.rank - b.rank);
  const n = ranked.length;
  const d = Math.max(0, day - 1);
  const targets: string[] = [];
  for (let q = 0; q < QUESTIONS_PER_ROUND; q++) {
    const from = Math.floor(TIER_BOUNDS[q] * n);
    const to = Math.max(from + 1, Math.floor(TIER_BOUNDS[q + 1] * n));
    const tier = ranked.slice(from, to);
    const cycle = Math.floor(d / tier.length);
    const perm = shuffle(tier, rngFrom(`daily:${mode}:tier${q}:cycle${cycle}`));
    targets.push(perm[d % tier.length].id);
  }
  const golden = randInt(rngFrom(`daily:${mode}:golden:${day}`), QUESTIONS_PER_ROUND);
  return { targets, golden };
}

/** Practice: five targets from one continent, ordered easiest first. */
export function selectPractice(pool: readonly Target[], continent: string, seed: string): Selection {
  const rng = rngFrom(seed);
  const inContinent = pool.filter((t) => t.continent === continent);
  const chosen = shuffle(inContinent, rng)
    .slice(0, QUESTIONS_PER_ROUND)
    .sort((a, b) => a.rank - b.rank);
  return { targets: chosen.map((t) => t.id), golden: randInt(rng, chosen.length) };
}
