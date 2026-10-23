import { describe, expect, it } from 'vitest';
import TILE_INDEX from '../src/data/tiles.json';
import { CITIES, COUNTRIES, TARGETS, countryById, nameIndex } from '../src/data';
import { POINTS_BY_STEP, QUESTIONS_PER_ROUND, SEARCH_KM_BY_STEP, STEPS, WINDOW_KM_BY_STEP } from '../src/game/config';
import { selectByTiers, selectDaily, selectPractice } from '../src/game/selection';
import {
  comboMultiplier,
  levelFromXp,
  nextStreak,
  pointsForStep,
  resultSquare,
  xpForQuestion,
  xpToNext,
} from '../src/game/scoring';
import { evaluateGuess, levenshtein, matchGuess, normalizeName, suggest } from '../src/game/matching';
import { cityClues, lettersClue } from '../src/game/clues';
import { applyGuess, createRound, nextQuestion, roundScore, skipStep } from '../src/game/round';
import { addDays, dailyNumber, msUntilNextDaily, utcDateKey } from '../src/game/dates';
import { completeDay, visibleStreak } from '../src/game/progress';
import { shareLine } from '../src/game/share';
import { distanceKm, offsetKm, revealPlan } from '../src/game/reveal';
import { describeLocation } from '../src/game/describe';

const city = (id: string) => CITIES.find((c) => c.id === id)!;

describe('dates', () => {
  it('numbers days from 2026-10-23 = #1', () => {
    expect(dailyNumber('2026-10-23')).toBe(1);
    expect(dailyNumber('2026-10-24')).toBe(2);
    expect(dailyNumber('2027-10-23')).toBe(366);
  });
  it('rolls over at midnight UTC', () => {
    expect(utcDateKey(new Date('2026-10-23T23:59:59Z'))).toBe('2026-10-23');
    expect(utcDateKey(new Date('2026-10-24T00:00:00Z'))).toBe('2026-10-24');
    expect(msUntilNextDaily(new Date('2026-10-23T23:59:00Z'))).toBe(60_000);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('seeded selection', () => {
  it('gives the same five cities for the same date', () => {
    const a = selectDaily(TARGETS, 1);
    expect(selectDaily(TARGETS, 1)).toEqual(a);
    expect(a.targets).toHaveLength(QUESTIONS_PER_ROUND);
    expect(new Set(a.targets).size).toBe(QUESTIONS_PER_ROUND);
    expect(a.golden).toBeGreaterThanOrEqual(0);
    expect(a.golden).toBeLessThan(QUESTIONS_PER_ROUND);
  });

  it('gives different cities on different days', () => {
    const days = Array.from({ length: 10 }, (_, i) => selectDaily(TARGETS, i + 1).targets.join());
    expect(new Set(days).size).toBe(10);
  });

  it('orders a round from better-known to less-known cities', () => {
    const rank = new Map(TARGETS.map((t) => [t.id, t.rank]));
    for (let d = 1; d <= 30; d++) {
      const ranks = selectDaily(TARGETS, d).targets.map((id) => rank.get(id)!);
      for (let i = 1; i < ranks.length; i++) expect(ranks[i]).toBeGreaterThan(ranks[i - 1]);
    }
  });

  it('never repeats a city on consecutive days', () => {
    for (let d = 1; d <= 60; d++) {
      const today = new Set(selectDaily(TARGETS, d).targets);
      expect(selectDaily(TARGETS, d + 1).targets.some((id) => today.has(id))).toBe(false);
    }
  });

  it('bonus selection is deterministic per seed', () => {
    expect(selectByTiers(TARGETS, 'x')).toEqual(selectByTiers(TARGETS, 'x'));
  });

  it('practice picks only the chosen continent', () => {
    const s = selectPractice(TARGETS, 'Oceania', 'seed');
    expect(s.targets).toHaveLength(5);
    for (const id of s.targets) expect(countryById.get(city(id).country)!.continents[0]).toBe('Oceania');
  });
});

describe('scoring', () => {
  it('awards the configured points per step', () => {
    expect([1, 2, 3, 4, 5, 6].map((s) => pointsForStep(s, true))).toEqual([100, 80, 60, 45, 30, 20]);
    expect(POINTS_BY_STEP).toHaveLength(STEPS);
    expect(pointsForStep(6, false)).toBe(0);
  });

  it('raises the combo multiplier every three in a row, capped at ×5', () => {
    expect([0, 1, 2, 3, 5, 6, 9, 12, 30].map(comboMultiplier)).toEqual([1, 1, 1, 2, 2, 3, 4, 5, 5]);
    expect(nextStreak(4, true)).toBe(5);
    expect(nextStreak(4, false)).toBe(0);
  });

  it('computes XP = 20 × points/100 × combo × golden', () => {
    expect(xpForQuestion(100, 1, false)).toBe(20);
    expect(xpForQuestion(80, 2, false)).toBe(32);
    expect(xpForQuestion(60, 1, true)).toBe(24);
    expect(xpForQuestion(100, 5, true)).toBe(200);
    expect(xpForQuestion(0, 3, true)).toBe(0);
  });

  it('uses linearly rising level requirements', () => {
    expect(xpToNext(3) - xpToNext(2)).toBe(xpToNext(2) - xpToNext(1));
    expect(levelFromXp(0)).toMatchObject({ level: 1, into: 0 });
    expect(levelFromXp(xpToNext(1))).toMatchObject({ level: 2, into: 0 });
    expect(levelFromXp(xpToNext(1) + xpToNext(2) + 5)).toMatchObject({ level: 3, into: 5 });
  });

  it('maps results to emoji squares', () => {
    expect([1, 2, 3, 6, null].map(resultSquare).join('')).toBe('🟩🟩🟨🟨🟥');
  });
});

describe('name matching', () => {
  const idx = nameIndex();

  it('normalises case, spaces, punctuation and diacritics', () => {
    expect(normalizeName('  São Paulo ')).toBe('saopaulo');
    expect(normalizeName('St. Louis')).toBe('saintlouis');
    expect(normalizeName('ZÜRICH')).toBe('zurich');
  });

  it('accepts alternative names and exonyms', () => {
    const cases: [string, string][] = [
      ['Bombay', 'mumbai-in'],
      ['Peking', 'beijing-cn'],
      ['Saigon', 'ho-chi-minh-city-vn'],
      ['Ho Chi Minh City', 'ho-chi-minh-city-vn'],
      ['New York', 'new-york-city-us'],
      ['NYC', 'new-york-city-us'],
      ['Calcutta', 'kolkata-in'],
      ['Kiev', 'kyiv-ua'],
      ['Rangoon', 'yangon-mm'],
      ['Sao Paulo', 'sao-paulo-br'],
      ['zurich', 'zurich-ch'],
      ['München', 'munich-de'],
      ['Lisboa', 'lisbon-pt'],
    ];
    for (const [guess, id] of cases) expect(evaluateGuess(idx, guess, id), guess).toBe(true);
  });

  it('allows one typo for names of at least five characters', () => {
    expect(evaluateGuess(idx, 'Stokholm', 'stockholm-se')).toBe(true);
    expect(evaluateGuess(idx, 'Barcelonna', 'barcelona-es')).toBe(true);
    expect(matchGuess(idx, 'Lmia').status).toBe('unknown'); // short names must be exact
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });

  it('reports unknown names without counting them', () => {
    expect(matchGuess(idx, 'Atlantis').status).toBe('unknown');
    expect(evaluateGuess(idx, 'Atlantis', 'paris-fr')).toBeNull();
    expect(matchGuess(idx, '   ').status).toBe('empty');
  });

  it('treats a wrong but known name as wrong', () => {
    expect(evaluateGuess(idx, 'Oslo', 'stockholm-se')).toBe(false);
  });

  it('clarifies shared names in the suggestion list', () => {
    const labels = suggest(idx, 'Valen').map((s) => s.label);
    expect(labels).toContain('Valencia · Spain');
    expect(labels).toContain('Valencia · Venezuela');
    expect(evaluateGuess(idx, 'Valencia', 'valencia-ve')).toBe(true);
    expect(evaluateGuess(idx, 'Valencia', 'valencia-es')).toBe(true);
    expect(evaluateGuess(idx, 'Sydney', 'sydney-au')).toBe(true);
  });

  it('only suggests after two characters', () => {
    expect(suggest(idx, 's')).toEqual([]);
    expect(suggest(idx, 'st').length).toBeGreaterThan(0);
  });
});

describe('clues', () => {
  it('formats letters clues', () => {
    expect(lettersClue('Sweden')).toBe('S · 6 letters');
    expect(lettersClue('New Zealand')).toBe('N · 10 letters · 2 words');
    expect(lettersClue('Guinea-Bissau')).toBe('G · 12 letters · 2 words');
  });

  it('gives six clues in the specified order', () => {
    const c = city('stockholm-se');
    const clues = cityClues(c, countryById.get(c.country)!);
    expect(clues.map((x) => x.kind)).toEqual([
      'continent',
      'languageCurrency',
      'flagColors',
      'cityLetters',
      'countryLetters',
      'neighbors',
    ]);
    expect(clues[0].text).toBe('Europe');
    expect(clues[1].text).toBe('Swedish · Krona');
    expect(clues[2].swatches!.map((s) => s.name)).toEqual(['Blue', 'Yellow']);
    expect(clues[3].text).toBe('S · 9 letters');
    expect(clues[4].text).toBe('S · 6 letters');
    expect(clues[5].text).toBe('Finland, Norway');
  });

  it('describes island countries and transcontinental countries', () => {
    expect(cityClues(city('tokyo-jp'), countryById.get('JPN')!)[5].text).toMatch(/^Nearest across the sea: /);
    expect(cityClues(city('moscow-ru'), countryById.get('RUS')!)[0].text).toBe('Europe and Asia');
  });

  it('never mentions population in any clue or shipped data', () => {
    for (const c of CITIES) {
      for (const clue of cityClues(c, countryById.get(c.country)!)) {
        expect(`${clue.label} ${clue.text}`).not.toMatch(/popul|inhabit|people|million|residents/i);
      }
    }
    for (const c of [...COUNTRIES, ...CITIES]) expect(JSON.stringify(c)).not.toMatch(/"pop/i);
  });
});

describe('data quality', () => {
  it('has 300–500 cities in known countries with plausible coordinates', () => {
    expect(CITIES.length).toBeGreaterThanOrEqual(300);
    expect(CITIES.length).toBeLessThanOrEqual(500);
    for (const c of CITIES) {
      const country = countryById.get(c.country);
      expect(country, c.id).toBeTruthy();
      expect(country!.languages.length && country!.currency && country!.flag.length, c.id).toBeTruthy();
      const [lon, lat] = c.lonlat;
      expect(Math.abs(lon) <= 180 && Math.abs(lat) <= 90, c.id).toBe(true);
    }
  });

  it('has symmetric land borders between countries', () => {
    for (const c of COUNTRIES) {
      for (const b of c.borders) {
        const n = countryById.get(b);
        if (n) expect(n.borders, `${c.id}↔${b}`).toContain(c.id);
      }
    }
  });

  it('spot-checks known values', () => {
    const near = (a: number, b: number, tol = 0.6) => Math.abs(a - b) < tol;
    expect(near(city('paris-fr').lonlat[0], 2.35) && near(city('paris-fr').lonlat[1], 48.86)).toBe(true);
    expect(near(city('sydney-au').lonlat[1], -33.87)).toBe(true);
    expect(near(city('reykjavik-is').lonlat[1], 64.14)).toBe(true);
    expect(near(city('cape-town-za').lonlat[0], 18.42)).toBe(true);
    expect(countryById.get('LSO')!.neighborNames).toEqual(['South Africa']);
    expect(countryById.get('BGR')!.currency).toBe('Euro');
  });

  it('has map tiles around every city', () => {
    const tiles = new Set(TILE_INDEX as string[]);
    for (const c of CITIES) {
      const key = `${Math.floor(c.lonlat[0] / 10)}_${Math.floor(c.lonlat[1] / 10)}`;
      expect(tiles.has(key), c.id).toBe(true);
    }
  });
});

describe('map reveal', () => {
  it('keeps the city inside every window and search circle', () => {
    for (const c of CITIES.slice(0, 120)) {
      const plan = revealPlan(c.lonlat, `seed:${c.id}`);
      plan.window.forEach((w, i) => {
        expect(w.radiusKm).toBe(WINDOW_KM_BY_STEP[i]);
        expect(distanceKm(w.center, c.lonlat)).toBeLessThan(w.radiusKm * 0.5);
      });
      plan.search.forEach((s, i) => {
        expect(s.radiusKm).toBe(SEARCH_KM_BY_STEP[i]);
        expect(distanceKm(s.center, c.lonlat)).toBeLessThan(s.radiusKm);
      });
    }
  });

  it('does not centre the search circle on the city', () => {
    const c = city('paris-fr');
    const plan = revealPlan(c.lonlat, 'x');
    expect(distanceKm(plan.search[0].center, c.lonlat)).toBeGreaterThan(SEARCH_KM_BY_STEP[0] * 0.25);
  });

  it('is deterministic and the window grows every step', () => {
    const c = city('lima-pe');
    expect(revealPlan(c.lonlat, 's')).toEqual(revealPlan(c.lonlat, 's'));
    for (let i = 1; i < STEPS; i++) expect(WINDOW_KM_BY_STEP[i]).toBeGreaterThan(WINDOW_KM_BY_STEP[i - 1]);
  });

  it('measures offsets in kilometres', () => {
    const p = offsetKm([10, 60], 50, Math.PI / 2);
    expect(Math.abs(distanceKm([10, 60], p) - 50)).toBeLessThan(1);
  });

  it('describes the visible area for screen readers', () => {
    expect(describeLocation(25, -28, 'Africa')).toBe('southern Africa');
    expect(describeLocation(37, 55, 'Europe')).toBe('eastern Europe');
    expect(describeLocation(28, 64, 'Europe')).toBe('north-eastern Europe');
  });
});

describe('round state machine', () => {
  const base = () =>
    createRound({ kind: 'daily', seed: 's', dateKey: '2026-10-23', targets: ['A', 'B', 'C', 'D', 'E'], golden: 1 });

  it('ends a question on a correct guess with the step score', () => {
    let s = applyGuess(base(), 'X', false);
    expect(s.step).toBe(2);
    s = applyGuess(s, 'A', true);
    expect(s.revealed).toBe(true);
    expect(s.results[0]).toMatchObject({ solvedAt: 2, points: 80, xp: 16 });
  });

  it('loses the question on a wrong guess in step 6', () => {
    let s = base();
    for (let i = 0; i < 5; i++) s = skipStep(s);
    expect(s.step).toBe(6);
    s = applyGuess(s, 'X', false);
    expect(s.results[0]).toMatchObject({ solvedAt: null, points: 0 });
  });

  it('doubles XP on the golden question and resets the combo on a loss', () => {
    let s = nextQuestion(applyGuess(base(), 'A', true));
    s = applyGuess(s, 'B', true);
    expect(s.results[1]).toMatchObject({ golden: true, xp: 40 });
    s = nextQuestion(s);
    for (let i = 0; i < 6; i++) s = skipStep(s);
    expect(s.streak).toBe(0);
    expect(roundScore(s)).toBe(200);
  });

  it('finishes after five questions', () => {
    let s = base();
    for (let q = 0; q < 5; q++) s = nextQuestion(applyGuess(s, 'x', true));
    expect(s.finished).toBe(true);
    expect(s.results).toHaveLength(5);
  });
});

describe('streaks and sharing', () => {
  it('counts consecutive days and breaks on a gap', () => {
    let s = { current: 0, best: 0, lastDay: null as string | null };
    s = completeDay(s, '2026-10-23');
    s = completeDay(s, '2026-10-24');
    s = completeDay(s, '2026-10-24');
    expect(s.current).toBe(2);
    expect(visibleStreak(s, '2026-10-25')).toBe(2);
    expect(visibleStreak(s, '2026-10-26')).toBe(0);
    s = completeDay(s, '2026-10-27');
    expect(s).toMatchObject({ current: 1, best: 2 });
  });

  it('builds the share line', () => {
    const r = (solvedAt: number | null) => ({
      id: '',
      solvedAt,
      points: 0,
      xp: 0,
      golden: false,
      multiplier: 1,
      guesses: [],
    });
    expect(shareLine('daily', 1, [r(1), r(3), r(2), r(null), r(1)])).toBe('Map in the Dark #1 🟩🟨🟩🟥🟩');
  });
});
