#!/usr/bin/env node
/**
 * Build src/data/cities.json from the curated list (scripts/data/cities-curated.mjs) and GeoNames
 * (cities1000 via the all-the-cities package, CC BY 4.0). Every target is a capital: one per country,
 * except Vatican City. The build fails if a country has none or several.
 *
 * Population is only used to compute the rank and is not written to the output.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { CITIES } from './data/cities-curated.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const all = require('all-the-cities');
const countries = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/countries.json'), 'utf8'));
const byIso2 = Object.fromEntries(countries.map((c) => [c.iso2.toUpperCase(), c]));
/** GeoNames country code → game country. */
const COUNTRY_OF = { XK: 'XK' };
/** Countries without a target: Vatican City lies inside Rome, so its map would show Rome. */
const NO_TARGET = new Set(['VA']);

const slug = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const out = [];
const seen = new Set();
for (const [name, cc, gname, alts, fame, fact, coords] of CITIES) {
  const lookup = gname || name;
  const matches = all.filter((c) => c.country === cc && c.name === lookup);
  if (!matches.length && !coords) throw new Error(`GeoNames match not found: ${lookup} (${cc})`);
  const g = matches.sort((a, b) => b.population - a.population)[0] ?? {
    loc: { coordinates: coords },
    population: 0,
  };
  const country = byIso2[COUNTRY_OF[cc] || cc];
  if (!country) throw new Error(`Country not in targets: ${cc} for ${name}`);
  const id = `${slug(name)}-${cc.toLowerCase()}`;
  if (seen.has(id)) throw new Error(`Duplicate city ${id}`);
  seen.add(id);
  const [lon, lat] = g.loc.coordinates;
  const pop = Math.max(g.population, 20000);

  out.push({
    id,
    name,
    altNames: alts,
    country: country.id,
    lonlat: [+lon.toFixed(4), +lat.toFixed(4)],
    capital: true,
    fact,
    _score: Math.log10(pop) + fame * 1.1,
  });
}

// Exactly one capital per country.
const perCountry = {};
for (const c of out) (perCountry[c.country] ||= []).push(c.id);
const problems = countries
  .filter((c) => !NO_TARGET.has(c.iso2.toUpperCase()) && perCountry[c.id]?.length !== 1)
  .map((c) => `${c.name}: ${perCountry[c.id]?.join(', ') ?? 'none'}`);
if (problems.length) throw new Error(`Need exactly one capital per country:\n${problems.join('\n')}`);

out.sort((a, b) => b._score - a._score);
out.forEach((c, i) => {
  c.rank = i + 1;
  delete c._score;
});

// Name collisions are fine (e.g. Valencia, Spain and Valencia, Venezuela) — the UI clarifies them.
const names = {};
for (const c of out) (names[c.name.toLowerCase()] ||= []).push(c.id);
const dup = Object.entries(names).filter(([, v]) => v.length > 1);
console.log('Shared names:', dup.map(([k, v]) => `${k} (${v.join(', ')})`).join('; ') || 'none');

fs.writeFileSync(path.join(ROOT, 'src/data/cities.json'), JSON.stringify(out, null, 1));

console.log(`Wrote ${out.length} cities`);
