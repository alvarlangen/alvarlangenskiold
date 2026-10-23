#!/usr/bin/env node
/**
 * Build src/data/countries.json — the metadata for every country target.
 *
 * Sources (all bundled at build time, nothing is fetched at runtime):
 *  - world-countries (mledoze/countries, ODbL)      names, ISO codes, region, languages, currencies, borders, area
 *  - Natural Earth 1:10m admin-0 (public domain)     POP_EST, used ONLY for internal difficulty ranking
 *  - world-atlas (Natural Earth, public domain)      geometry, used to find the nearest countries across the sea
 *  - Hand-curated overrides in this file             main languages, short currency names, transcontinental
 *                                                    continents, exonyms/alternative names
 *
 * Run: node scripts/build-countries.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { feature } from 'topojson-client';
import { geoDistance, geoArea } from 'd3-geo';

const require = createRequire(import.meta.url);
const worldCountries = require('world-countries');
const atlas50 = require('world-atlas/countries-50m.json');
const atlas10 = require('world-atlas/countries-10m.json');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, 'scripts/.cache');
const OUT = path.join(ROOT, 'src/data/countries.json');

// Natural Earth population (only for ranking). Fetched once into scripts/.cache.
const NE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson';
async function loadNaturalEarth() {
  const file = path.join(CACHE, 'ne_10m_admin_0_countries.geojson');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(CACHE, { recursive: true });
    const res = await fetch(NE_URL);
    if (!res.ok) throw new Error(`Natural Earth download failed: ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Targets: the 193 UN members + Vatican City, plus Kosovo, Palestine and Taiwan (see README "Special cases"). */
const EXTRA = ['UNK', 'PSE', 'TWN'];

/** English display-name overrides (clean, common English names). */
const NAME = {
  COD: 'Democratic Republic of the Congo',
  COG: 'Republic of the Congo',
  TUR: 'Turkey',
  FSM: 'Micronesia',
  STP: 'São Tomé and Príncipe',
  VAT: 'Vatican City',
  GMB: 'The Gambia',
  BHS: 'The Bahamas',
};

/** Main/official languages shown in clue 2 (max 3 shown). Countries not listed use world-countries as-is. */
const LANG = {
  AFG: ['Dari', 'Pashto'],
  ARG: ['Spanish'],
  AUT: ['German'],
  AZE: ['Azerbaijani'],
  BDI: ['Kirundi', 'French'],
  BEL: ['Dutch', 'French', 'German'],
  BIH: ['Bosnian', 'Croatian', 'Serbian'],
  BLR: ['Belarusian', 'Russian'],
  BLZ: ['English'],
  BOL: ['Spanish', 'Quechua', 'Aymara'],
  BWA: ['English', 'Tswana'],
  CAF: ['French', 'Sango'],
  CAN: ['English', 'French'],
  CHE: ['German', 'French', 'Italian'],
  CMR: ['French', 'English'],
  COD: ['French'],
  COG: ['French'],
  COM: ['Comorian', 'Arabic', 'French'],
  CYP: ['Greek', 'Turkish'],
  CZE: ['Czech'],
  DJI: ['French', 'Arabic'],
  ERI: ['Tigrinya', 'Arabic', 'English'],
  FIN: ['Finnish', 'Swedish'],
  FJI: ['English', 'Fijian', 'Fiji Hindi'],
  GNB: ['Portuguese'],
  GNQ: ['Spanish', 'French', 'Portuguese'],
  HTI: ['Haitian Creole', 'French'],
  IND: ['Hindi', 'English'],
  IRL: ['Irish', 'English'],
  IRN: ['Persian'],
  IRQ: ['Arabic', 'Kurdish'],
  ISR: ['Hebrew'],
  JAM: ['English'],
  KAZ: ['Kazakh', 'Russian'],
  KEN: ['Swahili', 'English'],
  KGZ: ['Kyrgyz', 'Russian'],
  KIR: ['English', 'Gilbertese'],
  LBN: ['Arabic'],
  LKA: ['Sinhala', 'Tamil'],
  LSO: ['Sesotho', 'English'],
  LUX: ['Luxembourgish', 'French', 'German'],
  MAR: ['Arabic', 'Berber'],
  MDA: ['Romanian'],
  MDG: ['Malagasy', 'French'],
  MHL: ['Marshallese', 'English'],
  MKD: ['Macedonian', 'Albanian'],
  MLT: ['Maltese', 'English'],
  MUS: ['English', 'French'],
  MWI: ['English', 'Chichewa'],
  MYS: ['Malay'],
  NAM: ['English'],
  NOR: ['Norwegian'],
  NZL: ['English', 'Māori'],
  PAK: ['Urdu', 'English'],
  PER: ['Spanish', 'Quechua', 'Aymara'],
  PHL: ['Filipino', 'English'],
  PLW: ['Palauan', 'English'],
  PNG: ['Tok Pisin', 'English', 'Hiri Motu'],
  PRY: ['Spanish', 'Guaraní'],
  RWA: ['Kinyarwanda', 'French', 'English'],
  SDN: ['Arabic', 'English'],
  SGP: ['English', 'Malay', 'Mandarin', 'Tamil'],
  SOM: ['Somali', 'Arabic'],
  SWZ: ['Swazi', 'English'],
  SYC: ['Seychellois Creole', 'English', 'French'],
  TCD: ['French', 'Arabic'],
  TJK: ['Tajik'],
  TKM: ['Turkmen'],
  TLS: ['Tetum', 'Portuguese'],
  TON: ['Tongan', 'English'],
  TUV: ['Tuvaluan', 'English'],
  TZA: ['Swahili', 'English'],
  UGA: ['English', 'Swahili'],
  UZB: ['Uzbek'],
  VAT: ['Italian', 'Latin'],
  VUT: ['Bislama', 'English', 'French'],
  WSM: ['Samoan', 'English'],
  ZAF: ['Zulu', 'Xhosa', 'Afrikaans', 'English', '+7 more'],
  ZWE: ['English', 'Shona', 'Ndebele', '+13 more'],
  CHN: ['Mandarin Chinese'],
  TWN: ['Mandarin Chinese'],
  NRU: ['Nauruan', 'English'],
  IDN: ['Indonesian'],
  NPL: ['Nepali'],
  MDV: ['Dhivehi'],
  ARE: ['Arabic'],
  MNE: ['Montenegrin'],
  NGA: ['English'],
  AND: ['Catalan'],
  SLV: ['Spanish'],
  GRC: ['Greek'],
  ETH: ['Amharic'],
  SSD: ['English'],
  LBY: ['Arabic'],
  DZA: ['Arabic', 'Berber'],
  UNK: ['Albanian', 'Serbian'],
};

/**
 * Short currency name for clue 2. Pattern "Swedish · Krona": the issuing country's own currency is shown
 * without the demonym; a foreign currency is shown in full ("US dollar", "Euro").
 * Keys are country codes (overrides) — the generic rule is in shortCurrency().
 */
const CURRENCY = {
  BGR: 'Euro', // Bulgaria joined the euro area on 1 January 2026
  CUB: 'Peso',
  FSM: 'US dollar',
  ZWE: 'Zimbabwe Gold (ZiG)',
  VEN: 'Bolívar',
  PAN: 'Balboa & US dollar',
  BHS: 'Dollar',
  BRN: 'Dollar',
  BTN: 'Ngultrum',
  KHM: 'Riel',
  KIR: 'Australian dollar',
  TUV: 'Australian dollar',
  LSO: 'Loti',
  NAM: 'Dollar',
  SWZ: 'Lilangeni',
  PSE: 'Israeli shekel & Jordanian dinar',
  BIH: 'Convertible mark',
  ISR: 'New shekel',
  TWN: 'New Taiwan dollar',
  VNM: 'Dong',
  MNG: 'Tögrög',
  UZB: 'Som',
  SLE: 'Leone',
  TLS: 'US dollar',
  STP: 'Dobra',
  MRT: 'Ouguiya',
  ARE: 'Dirham',
  GBR: 'Pound sterling',
  USA: 'Dollar',
  SSD: 'Pound',
  CHE: 'Franc',
  LIE: 'Swiss franc',
};

/** Transcontinental countries (clue 1 shows both). The first continent is the "home" continent for practice mode. */
const CONTINENTS = {
  RUS: ['Europe', 'Asia'],
  TUR: ['Asia', 'Europe'],
  KAZ: ['Asia', 'Europe'],
  AZE: ['Asia', 'Europe'],
  GEO: ['Asia', 'Europe'],
  EGY: ['Africa', 'Asia'],
};

/**
 * Land border corrections. world-countries lists Sri Lanka as bordering India, but the two are
 * separated by the Palk Strait (Adam's Bridge is a chain of shoals), so Sri Lanka is an island nation.
 */
const BORDER_FIX = { LKA: [] };

/** Capital display overrides (world-countries is occasionally outdated or lists several). */
const CAPITAL = {
  BOL: 'Sucre (constitutional), La Paz (seat of government)',
  ZAF: 'Pretoria, Cape Town and Bloemfontein',
  SWZ: 'Mbabane (administrative), Lobamba (royal and legislative)',
  PSE: 'Ramallah (administrative)',
  ISR: 'Jerusalem (disputed internationally)',
  MYS: 'Kuala Lumpur',
  NLD: 'Amsterdam',
  KIR: 'South Tarawa',
  CIV: 'Yamoussoukro (official), Abidjan (economic)',
  LKA: 'Sri Jayawardenepura Kotte (official), Colombo (commercial)',
  BEN: 'Porto-Novo',
  NRU: 'Yaren (de facto)',
  USA: 'Washington, D.C.',
  YEM: "Sana'a",
};

/** Exonyms and alternative English names accepted as answers (in addition to world-countries data). */
const ALT = {
  USA: ['USA', 'US', 'U.S.', 'U.S.A.', 'United States of America', 'America', 'The States'],
  GBR: ['UK', 'U.K.', 'Great Britain', 'Britain', 'United Kingdom of Great Britain and Northern Ireland'],
  CZE: ['Czech Republic', 'Czechia'],
  CIV: ["Côte d'Ivoire", 'Cote dIvoire', 'Ivory Coast'],
  MMR: ['Burma'],
  NLD: ['Holland', 'The Netherlands'],
  TUR: ['Türkiye', 'Turkiye'],
  SWZ: ['Swaziland'],
  MKD: ['Macedonia'],
  TLS: ['East Timor', 'Timor Leste'],
  CPV: ['Cabo Verde'],
  COD: ['DR Congo', 'DRC', 'Congo-Kinshasa', 'Zaire', 'Democratic Republic of Congo', 'Congo'],
  COG: ['Congo-Brazzaville', 'Congo Republic', 'Republic of Congo', 'Congo'],
  KOR: ['Korea', 'Republic of Korea', 'S Korea'],
  PRK: ['DPRK', 'N Korea', "Democratic People's Republic of Korea"],
  ARE: ['UAE', 'Emirates', 'U.A.E.'],
  VAT: ['Vatican', 'Holy See', 'Vatican City State'],
  FSM: ['Federated States of Micronesia', 'FSM'],
  LAO: ['Lao PDR', 'Lao'],
  RUS: ['Russian Federation'],
  IRN: ['Persia'],
  SYR: ['Syrian Arab Republic'],
  VNM: ['Viet Nam'],
  BRN: ['Brunei Darussalam'],
  BHS: ['Bahamas'],
  GMB: ['Gambia'],
  KNA: ['St Kitts and Nevis', 'Saint Kitts', 'St. Kitts and Nevis', 'St Kitts'],
  LCA: ['St Lucia', 'St. Lucia'],
  VCT: ['St Vincent and the Grenadines', 'Saint Vincent', 'St Vincent', 'St. Vincent and the Grenadines'],
  ATG: ['Antigua'],
  TTO: ['Trinidad'],
  STP: ['Sao Tome', 'Sao Tome and Principe', 'São Tomé'],
  BIH: ['Bosnia', 'Bosnia-Herzegovina'],
  CAF: ['CAR', 'Central Africa'],
  DOM: ['Dominican Rep', 'DR'],
  GNQ: ['Eq Guinea'],
  PNG: ['PNG'],
  SLB: ['Solomons', 'Solomon'],
  MHL: ['Marshalls'],
  TWN: ['Republic of China', 'ROC', 'Chinese Taipei', 'Formosa'],
  PSE: ['State of Palestine', 'Palestinian Territories'],
  UNK: ['Kosova'],
  MDA: ['Moldavia'],
  BLR: ['Byelorussia', 'Belorussia'],
  KGZ: ['Kirghizia', 'Kyrgyz Republic'],
  LKA: ['Ceylon'],
  THA: ['Siam'],
  BFA: ['Upper Volta'],
  BEN: ['Dahomey'],
  ZWE: ['Rhodesia'],
  ZMB: ['Northern Rhodesia'],
  ESP: ['España', 'Espana'],
  DEU: ['Deutschland'],
  CHE: ['Swiss Confederation', 'Schweiz', 'Suisse', 'Svizzera'],
  IRL: ['Eire', 'Éire', 'Republic of Ireland'],
  NZL: ['Aotearoa'],
  ISL: ['Ísland'],
  GRC: ['Hellas', 'Ellada'],
  HRV: ['Hrvatska'],
  ALB: ['Shqipëria', 'Shqiperia'],
  GEO: ['Sakartvelo'],
  JPN: ['Nippon', 'Nihon'],
  IND: ['Bharat', 'Bhārat'],
  FIN: ['Suomi'],
  HUN: ['Magyarország', 'Magyarorszag'],
  POL: ['Polska'],
  SWE: ['Sverige'],
  NOR: ['Norge', 'Noreg'],
  DNK: ['Danmark'],
  AUT: ['Österreich', 'Osterreich'],
  ITA: ['Italia'],
  MEX: ['México'],
  BRA: ['Brasil'],
  PER: ['Perú'],
};

/** "Well known" boost for difficulty ranking: countries most players know regardless of size. */
const FAME = new Set([
  'USA',
  'CAN',
  'MEX',
  'BRA',
  'ARG',
  'GBR',
  'FRA',
  'DEU',
  'ITA',
  'ESP',
  'PRT',
  'RUS',
  'CHN',
  'JPN',
  'IND',
  'AUS',
  'EGY',
  'ZAF',
  'TUR',
  'GRC',
  'SWE',
  'NOR',
  'CHL',
  'KOR',
  'SAU',
  'NZL',
  'IRL',
  'CHE',
  'NLD',
  'ISL',
  'CUB',
  'PER',
  'THA',
  'IDN',
  'POL',
  'UKR',
  'FIN',
  'DNK',
  'MAR',
  'ISR',
  'IRN',
  'PHL',
  'VNM',
  'COL',
  'KEN',
  'NGA',
  'MDG',
  'JAM',
]);

const dataByCca3 = Object.fromEntries(worldCountries.map((c) => [c.cca3, c]));
const targets = worldCountries.filter((c) => c.independent || EXTRA.includes(c.cca3));

function continentOf(c) {
  if (CONTINENTS[c.cca3]) return CONTINENTS[c.cca3];
  if (c.region === 'Americas') return [c.subregion === 'South America' ? 'South America' : 'North America'];
  if (c.region === 'Antarctic') return ['Antarctica'];
  return [c.region];
}

function shortCurrency(c) {
  if (CURRENCY[c.cca3]) return CURRENCY[c.cca3];
  const entries = Object.entries(c.currencies || {});
  if (!entries.length) throw new Error(`No currency for ${c.cca3}`);
  const [code, { name }] = entries[0];
  if (code === 'EUR') return 'Euro';
  if (code === 'XOF' || code === 'XAF') return 'CFA franc';
  if (code === 'XCD') return 'East Caribbean dollar';
  if (code === 'USD') return 'US dollar';
  if (code === 'AUD') return 'Australian dollar';
  if (code === 'ZAR' && c.cca3 !== 'ZAF') return 'South African rand';
  const own = code.slice(0, 2) === c.cca2;
  const last = name.split(' ').pop();
  const cap = last.charAt(0).toUpperCase() + last.slice(1);
  return own ? cap : name.charAt(0).toUpperCase() + name.slice(1);
}

/** Latin-script check for alt names coming from the dataset (we accept native names typed on a Latin keyboard). */
const isLatin = (s) => /^[\p{Script=Latin}\s.'’\-()&,]+$/u.test(s);

function altNamesOf(c, display) {
  const set = new Set([c.name.common, c.name.official, ...(ALT[c.cca3] || [])]);
  for (const a of c.altSpellings || []) if (a.length >= 4 && isLatin(a)) set.add(a);
  for (const n of Object.values(c.name.native || {})) {
    if (isLatin(n.common)) set.add(n.common);
  }
  set.delete(display);
  // Never accept a bare two-letter code from the dataset as an alias except the curated ones.
  return [...set].filter((s) => s && s.length > 1);
}

// --- Geometry (for nearest countries across the sea and for the geometry centroid) ---
const geoms = new Map();
function addAtlas(topo) {
  const fc = feature(topo, topo.objects.countries);
  for (const f of fc.features) {
    const key = f.id ?? f.properties.name;
    if (!geoms.has(key)) geoms.set(key, f);
  }
}
addAtlas(atlas50);
const fc10 = feature(atlas10, atlas10.objects.countries);
function geometryOf(c) {
  if (c.cca3 === 'UNK') return geoms.get('Kosovo');
  return geoms.get(c.ccn3) || fc10.features.find((f) => f.id === c.ccn3);
}

/**
 * Sampled outer-ring vertices of a country's main landmasses: the largest polygons that together cover
 * 85% of its area. This keeps far-flung dependencies inside a geometry (e.g. Tokelau in New Zealand's
 * Natural Earth shape) from distorting "nearest countries across the sea".
 */
function vertices(f, maxPts = 400) {
  const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)
    .map((p) => ({ p, a: geoArea({ type: 'Polygon', coordinates: p }) }))
    .sort((x, y) => y.a - x.a);
  const total = polys.reduce((s, x) => s + x.a, 0);
  const pts = [];
  let acc = 0;
  for (const { p, a } of polys) {
    for (const pt of p[0]) pts.push(pt);
    acc += a;
    if (acc >= total * 0.85) break;
  }
  const step = Math.max(1, Math.floor(pts.length / maxPts));
  return pts.filter((_, i) => i % step === 0);
}

async function main() {
  const ne = await loadNaturalEarth();
  const pop = {};
  for (const f of ne.features) {
    const p = f.properties;
    const key = p.ISO_A3 !== '-99' ? p.ISO_A3 : p.ADM0_A3;
    if (!pop[key] || p.POP_EST > pop[key]) pop[key] = p.POP_EST;
  }
  pop.UNK = pop.KOS ?? pop.UNK;
  // Fold Somaliland and Northern Cyprus into internationally recognised borders for ranking.
  pop.SOM += pop.SOL || 0;

  const verts = new Map();
  for (const c of targets) {
    const g = geometryOf(c);
    if (!g) throw new Error(`No geometry for ${c.cca3}`);
    verts.set(c.cca3, vertices(g));
  }

  const out = [];
  for (const c of targets) {
    const display = NAME[c.cca3] || c.name.common;
    const continents = continentOf(c);
    const borders = (BORDER_FIX[c.cca3] ?? c.borders).filter(
      (b) => !(c.cca3 === 'CHN' && (b === 'HKG' || b === 'MAC')),
    );
    const neighborNames = borders.map((b) => {
      const n = dataByCca3[b];
      if (!n) throw new Error(`Unknown border ${b} for ${c.cca3}`);
      const nm = NAME[b] || n.name.common;
      // Territories of another state are labelled with their sovereign for clarity.
      const sov = { GUF: 'France', GIB: 'UK', HKG: 'China', MAC: 'China', ESH: null }[b];
      return sov ? `${nm} (${sov})` : nm;
    });

    // Nearest target countries across the sea (used for island nations in clue 6).
    let nearest = [];
    if (!borders.length) {
      const mine = verts.get(c.cca3);
      const d = [];
      // Pre-filter on centroid distance, then refine on sampled boundary vertices.
      const candidates = targets
        .filter((o) => o.cca3 !== c.cca3)
        .map((o) => [geoDistance([c.latlng[1], c.latlng[0]], [o.latlng[1], o.latlng[0]]), o])
        .sort((a, b) => a[0] - b[0])
        .slice(0, 25)
        .map((x) => x[1]);
      for (const o of candidates) {
        let best = Infinity;
        const theirs = verts.get(o.cca3);
        for (let i = 0; i < mine.length; i++) {
          for (let j = 0; j < theirs.length; j++) {
            const dist = geoDistance(mine[i], theirs[j]);
            if (dist < best) best = dist;
          }
        }
        d.push([best, NAME[o.cca3] || o.name.common]);
      }
      d.sort((a, b) => a[0] - b[0]);
      nearest = d.slice(0, 3).map((x) => x[1]);
    }

    const g = geometryOf(c);
    const population = pop[c.cca3];
    if (!population) throw new Error(`No population for ${c.cca3}`);

    out.push({
      id: c.cca3,
      iso2: c.cca2.toLowerCase(),
      name: display,
      altNames: altNamesOf(c, display),
      continents,
      continentLabel: continents.join(' and '),
      languages: LANG[c.cca3] || Object.values(c.languages),
      currency: shortCurrency(c),
      borders,
      neighborNames,
      island: borders.length === 0,
      nearest,
      capital: CAPITAL[c.cca3] || c.capital.join(', '),
      latlng: c.latlng,
      area: c.area,
      geoArea: geoArea(g),
      // Internal only, never shown: used to compute `rank`. Removed below.
      _pop: population,
    });
  }

  // --- Difficulty ranking ---
  // score = 0.55·z(log population) + 0.45·z(log area) + 1.2 if "famous". Higher = easier.
  const z = (arr) => {
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    const s = Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
    return arr.map((v) => (v - m) / s);
  };
  const zp = z(out.map((c) => Math.log10(c._pop)));
  const za = z(out.map((c) => Math.log10(c.area)));
  out.forEach((c, i) => {
    c._score = 0.55 * zp[i] + 0.45 * za[i] + (FAME.has(c.id) ? 1.2 : 0);
  });
  out.sort((a, b) => b._score - a._score);
  out.forEach((c, i) => {
    c.rank = i + 1;
    delete c._pop;
    delete c._score;
  });

  // Sanity checks: no missing fields.
  for (const c of out) {
    for (const k of ['id', 'name', 'continentLabel', 'currency', 'capital']) {
      if (!c[k]) throw new Error(`Missing ${k} for ${c.id}`);
    }
    if (!c.languages.length) throw new Error(`No languages for ${c.id}`);
    if (c.island && c.nearest.length < 3) throw new Error(`No nearest for ${c.id}`);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`Wrote ${out.length} countries to ${path.relative(ROOT, OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
