import { describe, expect, it } from 'vitest';
import { COUNTRIES, CITIES, TARGETS, countryById, nameIndex } from '../src/data';
import { POINTS_BY_STEP, QUESTIONS_PER_ROUND, STEPS } from '../src/game/config';
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
import { cityClues, countryClues, lettersClue } from '../src/game/clues';
import { applyGuess, createRound, nextQuestion, roundScore, skipStep } from '../src/game/round';
import { growthOrder, litCountForStep } from '../src/game/growth';
import { addDays, dailyNumber, msUntilNextDaily, utcDateKey } from '../src/game/dates';
import { completeDay, visibleStreak } from '../src/game/progress';
import { shareLine } from '../src/game/share';

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
  for (const mode of ['countries', 'cities'] as const) {
    it(`gives the same five ${mode} for the same date`, () => {
      const a = selectDaily(TARGETS[mode], mode, 1);
      const b = selectDaily(TARGETS[mode], mode, 1);
      expect(a).toEqual(b);
      expect(a.targets).toHaveLength(QUESTIONS_PER_ROUND);
      expect(new Set(a.targets).size).toBe(QUESTIONS_PER_ROUND);
      expect(a.golden).toBeGreaterThanOrEqual(0);
      expect(a.golden).toBeLessThan(QUESTIONS_PER_ROUND);
    });

    it(`gives different ${mode} on different days and modes do not share a seed`, () => {
      const days = Array.from({ length: 10 }, (_, i) => selectDaily(TARGETS[mode], mode, i + 1).targets.join());
      expect(new Set(days).size).toBe(10);
    });

    it(`orders ${mode} from easier to harder`, () => {
      const rank = new Map(TARGETS[mode].map((t) => [t.id, t.rank]));
      for (let d = 1; d <= 30; d++) {
        const ranks = selectDaily(TARGETS[mode], mode, d).targets.map((id) => rank.get(id)!);
        for (let i = 1; i < ranks.length; i++) expect(ranks[i]).toBeGreaterThan(ranks[i - 1]);
      }
    });

    it(`does not repeat a ${mode} target on consecutive days`, () => {
      for (let d = 1; d <= 60; d++) {
        const today = new Set(selectDaily(TARGETS[mode], mode, d).targets);
        const tomorrow = selectDaily(TARGETS[mode], mode, d + 1).targets;
        expect(tomorrow.some((id) => today.has(id))).toBe(false);
      }
    });
  }

  it('bonus selection is deterministic per seed', () => {
    expect(selectByTiers(TARGETS.countries, 'x')).toEqual(selectByTiers(TARGETS.countries, 'x'));
  });

  it('practice picks only the chosen continent', () => {
    const s = selectPractice(TARGETS.countries, 'Oceania', 'seed');
    expect(s.targets).toHaveLength(5);
    for (const id of s.targets) expect(countryById.get(id)!.continents[0]).toBe('Oceania');
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
    const d1 = xpToNext(2) - xpToNext(1);
    expect(xpToNext(3) - xpToNext(2)).toBe(d1);
    expect(levelFromXp(0)).toMatchObject({ level: 1, into: 0 });
    expect(levelFromXp(xpToNext(1))).toMatchObject({ level: 2, into: 0 });
    expect(levelFromXp(xpToNext(1) + xpToNext(2) + 5)).toMatchObject({ level: 3, into: 5 });
  });

  it('maps results to emoji squares', () => {
    expect([1, 2, 3, 6, null].map(resultSquare).join('')).toBe('🟩🟩🟨🟨🟥');
  });
});

describe('name matching', () => {
  const c = nameIndex('countries');
  const t = nameIndex('cities');

  it('normalises case, spaces, punctuation and diacritics', () => {
    expect(normalizeName("  Côte d'Ivoire ")).toBe('cotedivoire');
    expect(normalizeName('St. Lucia')).toBe('saintlucia');
    expect(normalizeName('SÃO TOMÉ')).toBe('saotome');
  });

  it('accepts alternative names and exonyms', () => {
    const cases: [string, string][] = [
      ['USA', 'USA'],
      ['United States', 'USA'],
      ['United States of America', 'USA'],
      ['america', 'USA'],
      ['UK', 'GBR'],
      ['United Kingdom', 'GBR'],
      ['Great Britain', 'GBR'],
      ['Czechia', 'CZE'],
      ['Czech Republic', 'CZE'],
      ['Ivory Coast', 'CIV'],
      ["Côte d'Ivoire", 'CIV'],
      ['cote divoire', 'CIV'],
      ['Burma', 'MMR'],
      ['Myanmar', 'MMR'],
      ['Holland', 'NLD'],
      ['the netherlands', 'NLD'],
      ['Türkiye', 'TUR'],
      ['Turkey', 'TUR'],
      ['Eswatini', 'SWZ'],
      ['Swaziland', 'SWZ'],
      ['East Timor', 'TLS'],
      ['Cabo Verde', 'CPV'],
      ['DRC', 'COD'],
      ['Vatican', 'VAT'],
    ];
    for (const [guess, id] of cases) expect(evaluateGuess(c, guess, id), guess).toBe(true);
    const cityCases: [string, string][] = [
      ['Bombay', 'mumbai-in'],
      ['Peking', 'beijing-cn'],
      ['Saigon', 'ho-chi-minh-city-vn'],
      ['Ho Chi Minh City', 'ho-chi-minh-city-vn'],
      ['New York', 'new-york-city-us'],
      ['Calcutta', 'kolkata-in'],
      ['Kiev', 'kyiv-ua'],
      ['Rangoon', 'yangon-mm'],
      ['Sao Paulo', 'sao-paulo-br'],
      ['zurich', 'zurich-ch'],
    ];
    for (const [guess, id] of cityCases) expect(evaluateGuess(t, guess, id), guess).toBe(true);
  });

  it('allows one typo for names of at least five characters', () => {
    expect(evaluateGuess(c, 'Swedan', 'SWE')).toBe(true);
    expect(evaluateGuess(c, 'Argentna', 'ARG')).toBe(true);
    expect(evaluateGuess(c, 'Pertugal', 'PRT')).toBe(true);
    // Short names must be exact: "Irak" is not accepted for Iraq through typo tolerance.
    expect(matchGuess(c, 'Peri').status).toBe('unknown');
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });

  it('reports unknown names without counting them', () => {
    expect(matchGuess(c, 'Atlantis').status).toBe('unknown');
    expect(evaluateGuess(c, 'Atlantis', 'SWE')).toBeNull();
    expect(matchGuess(c, '   ').status).toBe('empty');
  });

  it('treats a wrong but known name as wrong', () => {
    expect(evaluateGuess(c, 'Norway', 'SWE')).toBe(false);
  });

  it('handles ambiguous names with a clarification', () => {
    const v = suggest(t, 'Valen');
    const labels = v.map((s) => s.label);
    expect(labels).toContain('Valencia · Spain');
    expect(labels).toContain('Valencia · Venezuela');
    expect(evaluateGuess(t, 'Valencia', 'valencia-ve')).toBe(true);
    expect(evaluateGuess(t, 'Valencia', 'valencia-es')).toBe(true);
    const congo = matchGuess(c, 'Congo');
    expect(congo.status === 'match' && congo.ids.sort()).toEqual(['COD', 'COG']);
    expect(suggest(c, 'Geor')[0].value).toBe('Georgia');
    expect(evaluateGuess(t, 'Sydney', 'sydney-au')).toBe(true);
  });

  it('only suggests after two characters', () => {
    expect(suggest(c, 's')).toEqual([]);
    expect(suggest(c, 'sw').length).toBeGreaterThan(0);
  });
});

describe('clues', () => {
  it('formats letters clues', () => {
    expect(lettersClue('Sweden')).toBe('S · 6 letters');
    expect(lettersClue('New Zealand')).toBe('N · 10 letters · 2 words');
    expect(lettersClue('Guinea-Bissau')).toBe('G · 12 letters · 2 words');
  });

  it('gives countries six clues in the specified order', () => {
    const se = countryClues(countryById.get('SWE')!);
    expect(se.map((c) => c.kind)).toEqual([
      'continent',
      'languageCurrency',
      'neighborCount',
      'flagColors',
      'letters',
      'neighbors',
    ]);
    expect(se[0].text).toBe('Europe');
    expect(se[1].text).toBe('Swedish · Krona');
    expect(se[2].text).toBe('2 neighboring countries');
    expect(se[3].swatches!.map((s) => s.name)).toEqual(['Blue', 'Yellow']);
    expect(se[4].text).toBe('S · 6 letters');
    expect(se[5].text).toBe('Finland, Norway');
  });

  it('describes island nations and transcontinental countries', () => {
    const jp = countryClues(countryById.get('JPN')!);
    expect(jp[2].text).toBe('Island nation, no land borders');
    expect(jp[5].text).toMatch(/^Nearest across the sea: /);
    expect(countryClues(countryById.get('RUS')!)[0].text).toBe('Europe and Asia');
  });

  it('gives cities six clues in the specified order', () => {
    const city = CITIES.find((c) => c.id === 'stockholm-se')!;
    const clues = cityClues(city, countryById.get(city.country)!);
    expect(clues.map((c) => c.kind)).toEqual([
      'continent',
      'languageCurrency',
      'flagColors',
      'cityLetters',
      'countryLetters',
      'neighbors',
    ]);
    expect(clues[3].text).toBe('S · 9 letters');
    expect(clues[4].text).toBe('S · 6 letters');
  });

  it('never mentions population in any clue', () => {
    const all = [
      ...COUNTRIES.flatMap((c) => countryClues(c)),
      ...CITIES.flatMap((c) => cityClues(c, countryById.get(c.country)!)),
    ];
    for (const clue of all) {
      expect(`${clue.label} ${clue.text}`).not.toMatch(/popul|inhabit|people|million|residents/i);
    }
    // And no population figure is shipped in the data at all.
    for (const c of [...COUNTRIES, ...CITIES]) expect(JSON.stringify(c)).not.toMatch(/"pop/i);
  });
});

describe('data quality', () => {
  it('has complete country records', () => {
    expect(COUNTRIES.length).toBe(197);
    for (const c of COUNTRIES) {
      expect(c.name && c.continentLabel && c.currency && c.capital, c.id).toBeTruthy();
      expect(c.languages.length, c.id).toBeGreaterThan(0);
      expect(c.flag.length, c.id).toBeGreaterThan(0);
      expect(c.fact, c.id).toBeTruthy();
      if (c.island) expect(c.nearest.length, c.id).toBe(3);
      else expect(c.neighborNames.length, c.id).toBe(c.borders.length);
    }
  });

  it('has symmetric land borders between targets', () => {
    for (const c of COUNTRIES) {
      for (const b of c.borders) {
        const n = countryById.get(b);
        if (n) expect(n.borders, `${c.id}↔${b}`).toContain(c.id);
      }
    }
  });

  it('has 300–500 cities in known countries with plausible coordinates', () => {
    expect(CITIES.length).toBeGreaterThanOrEqual(300);
    expect(CITIES.length).toBeLessThanOrEqual(500);
    for (const c of CITIES) {
      expect(countryById.has(c.country), c.id).toBe(true);
      const [lon, lat] = c.lonlat;
      expect(Math.abs(lon) <= 180 && Math.abs(lat) <= 90, c.id).toBe(true);
      expect(c.decoys.length, c.id).toBeGreaterThanOrEqual(4);
    }
  });

  it('spot-checks known values', () => {
    const near = (a: number, b: number, tol = 0.6) => Math.abs(a - b) < tol;
    const city = (id: string) => CITIES.find((c) => c.id === id)!;
    expect(near(city('paris-fr').lonlat[0], 2.35) && near(city('paris-fr').lonlat[1], 48.86)).toBe(true);
    expect(near(city('sydney-au').lonlat[1], -33.87)).toBe(true);
    expect(near(city('reykjavik-is').lonlat[1], 64.14)).toBe(true);
    expect(countryById.get('BRA')!.borders).toHaveLength(10);
    expect(countryById.get('CHN')!.borders).toHaveLength(14);
    expect(countryById.get('LSO')!.neighborNames).toEqual(['South Africa']);
    expect(countryById.get('BGR')!.currency).toBe('Euro');
  });
});

describe('round state machine', () => {
  const base = () =>
    createRound({
      mode: 'countries',
      kind: 'daily',
      seed: 's',
      dateKey: '2026-10-23',
      targets: ['A', 'B', 'C', 'D', 'E'],
      golden: 1,
    });

  it('ends a question on a correct guess with the step score', () => {
    let s = base();
    s = applyGuess(s, 'X', false);
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
    let s = base();
    s = nextQuestion(applyGuess(s, 'A', true));
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

describe('map growth', () => {
  // 1×6 strip of equal pieces: growth must be contiguous.
  const neighbors = [[1], [0, 2], [1, 3], [2, 4], [3, 5], [4]];
  const centroids: [number, number][] = neighbors.map((_, i) => [i, 0]);
  it('grows a contiguous region', () => {
    const order = growthOrder(neighbors, centroids, 'seed');
    expect(order.slice().sort()).toEqual([0, 1, 2, 3, 4, 5]);
    for (let k = 1; k < order.length; k++) {
      const lit = new Set(order.slice(0, k));
      expect(neighbors[order[k]].some((j) => lit.has(j))).toBe(true);
    }
  });
  it('lights roughly the target area per step', () => {
    const order = [0, 1, 2, 3, 4, 5];
    const areas = [1, 1, 1, 1, 1, 1];
    expect([1, 2, 3, 4, 5, 6].map((s) => litCountForStep(order, areas, s))).toEqual([1, 2, 3, 4, 6, 6]);
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
    expect(shareLine('countries', 'daily', 1, [r(1), r(3), r(2), r(null), r(1)])).toBe(
      'Map in the Dark · Countries #1 🟩🟨🟩🟥🟩',
    );
  });
});

import { describeLocation } from '../src/game/describe';
describe('map text alternative', () => {
  it('describes where the lit area is', () => {
    expect(describeLocation(25, -28, 'Africa')).toBe('southern Africa');
    expect(describeLocation(37, 55, 'Europe')).toBe('eastern Europe');
    expect(describeLocation(28, 64, 'Europe')).toBe('north-eastern Europe');
    expect(describeLocation(15, 2, 'Africa')).toBe('central Africa');
  });
});
