/**
 * Tunable game constants. Everything that affects scoring and progression lives here.
 */

/** Points awarded for a correct guess in step 1…6. A wrong guess in step 6 scores 0. */
export const POINTS_BY_STEP = [100, 80, 60, 45, 30, 20] as const;

/** Steps per question and questions per round. */
export const STEPS = 6;
export const QUESTIONS_PER_ROUND = 5;

/** Fraction of a country's area lit at the end of step 1…6. */
export const LIT_FRACTION_BY_STEP = [0.12, 0.28, 0.46, 0.66, 0.84, 1] as const;

/** Step in which the camera first glides to the lit area (1-based). */
export const CAMERA_FOCUS_STEP = 3;

/** XP = XP_BASE × (points / 100) × combo multiplier × (GOLDEN_MULTIPLIER if golden). */
export const XP_BASE = 20;
export const GOLDEN_MULTIPLIER = 2;

/** Combo: +1 multiplier for every COMBO_STEP correct answers in a row, capped at COMBO_MAX. */
export const COMBO_STEP = 3;
export const COMBO_MAX = 5;

/** Level n → n+1 requires LEVEL_BASE_XP + (n − 1) × LEVEL_XP_INCREMENT XP (linear growth). */
export const LEVEL_BASE_XP = 60;
export const LEVEL_XP_INCREMENT = 30;

/** Daily #1 is this UTC date. The daily round resets at midnight UTC. */
export const EPOCH_DATE = '2026-10-23';

/**
 * Difficulty tiers for the five questions of a round, as fractions of the ranked target list
 * (rank 1 = easiest). Question k is drawn from [TIER_BOUNDS[k], TIER_BOUNDS[k+1]).
 */
export const TIER_BOUNDS = [0, 0.15, 0.33, 0.56, 0.79, 1] as const;

/** Seconds before the reveal advances to the next question automatically. */
export const AUTO_ADVANCE_SECONDS = 8;

/** Typo tolerance: names of at least this many characters accept a Levenshtein distance of 1. */
export const TYPO_MIN_LENGTH = 5;

export const GAME_TITLE = 'Map in the Dark';
