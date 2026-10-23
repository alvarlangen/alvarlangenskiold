import { TYPO_MIN_LENGTH } from './config';
import type { Target } from './types';

/**
 * Normalise a name for comparison: case-, space-, punctuation- and diacritic-insensitive.
 * "Côte d'Ivoire" → "cotedivoire", "St. Lucia" → "saintlucia", "Bosnia & Herzegovina" → "bosniaandherzegovina".
 */
export function normalizeName(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[æ]/g, 'ae')
    .replace(/[ø]/g, 'o')
    .replace(/[đ]/g, 'd')
    .replace(/[ł]/g, 'l')
    .replace(/[ı]/g, 'i')
    .replace(/&/g, ' and ')
    .replace(/[’'‘`ʻ.\-–,()]/g, ' ')
    .replace(/\bst\b/g, 'saint')
    .replace(/\bste\b/g, 'sainte')
    .replace(/^\s*the\s+/, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Levenshtein distance with an early exit once it exceeds `max`. */
export function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

export interface NameIndex {
  /** normalised name → target ids */
  exact: Map<string, Set<string>>;
  /** Entries for autocomplete: one per (target, spelling). */
  entries: { key: string; words: string[]; label: string; id: string; viaAlt: boolean }[];
  byId: Map<string, Target>;
}

export function buildNameIndex(targets: readonly Target[]): NameIndex {
  const exact = new Map<string, Set<string>>();
  const entries: NameIndex['entries'] = [];
  const byId = new Map<string, Target>();
  for (const t of targets) {
    byId.set(t.id, t);
    const spellings = [t.name, ...t.altNames];
    const seenKeys = new Set<string>();
    spellings.forEach((label, i) => {
      const key = normalizeName(label);
      if (!key || seenKeys.has(key)) return;
      seenKeys.add(key);
      if (!exact.has(key)) exact.set(key, new Set());
      exact.get(key)!.add(t.id);
      const words = label
        .split(/[\s\-–'’.,()]+/)
        .map(normalizeName)
        .filter(Boolean);
      entries.push({ key, words, label, id: t.id, viaAlt: i > 0 });
    });
  }
  return { exact, entries, byId };
}

export type MatchResult =
  { status: 'match'; ids: string[]; typo: boolean } | { status: 'unknown' } | { status: 'empty' };

/**
 * Resolve free text to target ids.
 *  1. Exact normalised match against names and alternative names.
 *  2. Otherwise, for inputs of ≥ TYPO_MIN_LENGTH characters, any name within Levenshtein distance 1.
 */
export function matchGuess(index: NameIndex, input: string): MatchResult {
  const key = normalizeName(input);
  if (!key) return { status: 'empty' };
  const hit = index.exact.get(key);
  if (hit) return { status: 'match', ids: [...hit], typo: false };
  if (key.length >= TYPO_MIN_LENGTH) {
    const ids = new Set<string>();
    for (const [k, set] of index.exact) {
      if (k.length >= TYPO_MIN_LENGTH && levenshtein(key, k, 1) <= 1) set.forEach((id) => ids.add(id));
    }
    if (ids.size) return { status: 'match', ids: [...ids], typo: true };
  }
  return { status: 'unknown' };
}

/** Is the guess correct for this answer? Returns null if the text names no known target. */
export function evaluateGuess(index: NameIndex, input: string, answerId: string): boolean | null {
  const m = matchGuess(index, input);
  if (m.status !== 'match') return null;
  return m.ids.includes(answerId);
}

export interface Suggestion {
  id: string;
  /** Text inserted into the field. */
  value: string;
  /** Display label, e.g. "Valencia · Spain" or "Mumbai (Bombay)". */
  label: string;
}

/**
 * Autocomplete: names starting with the typed text (after 2 characters), then names containing it.
 * Targets that share a display name are clarified with their qualifier.
 */
export function suggest(index: NameIndex, input: string, limit = 6): Suggestion[] {
  const key = normalizeName(input);
  if (key.length < 2) return [];
  const nameCount = new Map<string, number>();
  for (const t of index.byId.values()) {
    const k = normalizeName(t.name);
    nameCount.set(k, (nameCount.get(k) ?? 0) + 1);
  }
  const scored: { s: number; e: NameIndex['entries'][number] }[] = [];
  for (const e of index.entries) {
    // Whole-name prefix first, then names with a word starting with the input ("Volta" → Upper Volta).
    const prefix = e.key.startsWith(key);
    if (!prefix && !e.words.some((w) => w.startsWith(key))) continue;
    scored.push({ s: (prefix ? 0 : 10) + (e.viaAlt ? 2 : 0) + e.key.length / 100, e });
  }
  scored.sort((a, b) => a.s - b.s);
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const { e } of scored) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const t = index.byId.get(e.id)!;
    const ambiguous = (nameCount.get(normalizeName(t.name)) ?? 0) > 1 || (index.exact.get(e.key)?.size ?? 0) > 1;
    let label = t.name;
    if (e.viaAlt && e.label.length <= 22 && normalizeName(e.label) !== normalizeName(t.name))
      label = `${t.name} (${e.label})`;
    if (ambiguous && t.qualifier) label = `${label} · ${t.qualifier}`;
    out.push({ id: t.id, value: t.name, label });
    if (out.length >= limit) break;
  }
  return out;
}
