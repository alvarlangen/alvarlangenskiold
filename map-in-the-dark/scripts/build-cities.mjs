#!/usr/bin/env node
/**
 * Build src/data/cities.json from the curated list (scripts/data/cities-curated.mjs) and GeoNames
 * (cities1000 via the all-the-cities package, CC BY 4.0).
 *
 * For each city: coordinates, country, alternative names, fact, difficulty rank, and ~10 "decoy"
 * points of light (other real towns nearby) so that no single light gives the answer away in step 1.
 * Population is only used to compute the rank and is not written to the output.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { geoDistance } from 'd3-geo';
import { CITIES } from './data/cities-curated.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const all = require('all-the-cities');
const countries = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/countries.json'), 'utf8'));
const byIso2 = Object.fromEntries(countries.map((c) => [c.iso2.toUpperCase(), c]));
/** GeoNames country code → game country (Hong Kong is a special administrative region of China). */
const COUNTRY_OF = { HK: 'CN', XK: 'XK' };

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s) => [...s].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 11);
const slug = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const R = 6371;
const big = all.filter((c) => c.population >= 20000 && !['PPLX', 'PPLH', 'PPLQ', 'PPLW'].includes(c.featureCode));

const out = [];
const seen = new Set();
for (const [name, cc, gname, alts, fame, fact] of CITIES) {
  const lookup = gname || name;
  const matches = all.filter((c) => c.country === cc && c.name === lookup);
  if (!matches.length) throw new Error(`GeoNames match not found: ${lookup} (${cc})`);
  const g = matches.sort((a, b) => b.population - a.population)[0];
  const country = byIso2[COUNTRY_OF[cc] || cc];
  if (!country) throw new Error(`Country not in targets: ${cc} for ${name}`);
  const id = `${slug(name)}-${cc.toLowerCase()}`;
  if (seen.has(id)) throw new Error(`Duplicate city ${id}`);
  seen.add(id);
  const [lon, lat] = g.loc.coordinates;
  const pop = Math.max(g.population, 20000);
  const capital = g.featureCode === 'PPLC' || g.featureCode === 'PPLG';

  // Decoys: real towns 40–700 km away (radius grows until we have enough), deterministic per city.
  const rng = mulberry32(hash(id));
  let decoys = [];
  for (const [pool, maxKm] of [
    [big, 450],
    [big, 700],
    [big, 1100],
    [all, 1100],
    [all, 1800],
  ]) {
    const near = pool
      .filter((c) => c.cityId !== g.cityId)
      .map((c) => ({ c, d: geoDistance([lon, lat], c.loc.coordinates) * R }))
      .filter((x) => x.d > 40 && x.d < maxKm);
    if (near.length >= 10 || (pool === all && maxKm === 1800)) {
      // Prefer larger towns but keep some randomness; avoid near-duplicates.
      near.sort((a, b) => b.c.population * (0.5 + rng()) - a.c.population * (0.5 + rng()));
      for (const x of near) {
        if (decoys.length >= 11) break;
        const p = x.c.loc.coordinates;
        if (decoys.every((q) => geoDistance(p, q) * R > 35)) decoys.push(p);
      }
      break;
    }
  }
  decoys = decoys.map(([a, b]) => [+a.toFixed(3), +b.toFixed(3)]);
  if (decoys.length < 4) console.warn(`Only ${decoys.length} decoys for ${name}`);

  out.push({
    id,
    name,
    altNames: alts,
    country: country.id,
    lonlat: [+lon.toFixed(4), +lat.toFixed(4)],
    capital,
    fact,
    decoys,
    _score: Math.log10(pop) + (capital ? 0.5 : 0) + fame * 1.1,
  });
}

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
// Tiny list of city lights for the landing-page globe (kept separate so the landing page stays light).
fs.writeFileSync(
  path.join(ROOT, 'src/data/lights.json'),
  JSON.stringify(out.slice(0, 90).map((c) => c.lonlat.map((v) => +v.toFixed(1)))),
);
console.log(`Wrote ${out.length} cities`);
