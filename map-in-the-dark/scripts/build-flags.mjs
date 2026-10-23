#!/usr/bin/env node
/**
 * Derive flag colours for clue "Flag colours" from the flag-icons SVGs (MIT).
 *
 * Each 4:3 flag is rasterised with resvg, every pixel is snapped to the nearest named colour
 * (CIE Lab distance against several reference shades per name), colours covering less than
 * MIN_SHARE of the flag are dropped (coat-of-arms details, anti-aliasing), and the remaining colours
 * are ordered by first appearance reading the flag left-to-right, top-to-bottom.
 * The swatch shown in-game is the average real colour of the pixels assigned to that name.
 *
 * Manual corrections after visual review live in FLAG_OVERRIDES (documented in README).
 * Writes `flag` into src/data/countries.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Resvg } from '@resvg/resvg-js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FILE = path.join(ROOT, 'src/data/countries.json');
const FLAGS = path.join(path.dirname(require.resolve('flag-icons/package.json')), 'flags/4x3');

const MIN_SHARE = 0.025;
const W = 160;

/** Named colours with reference shades taken from real flags. */
const NAMED = {
  Red: ['#d52b1e', '#ce1126', '#e30a17', '#c8102e', '#ef3340', '#da251d', '#ff0000', '#bc002d', '#e4002b'],
  Maroon: ['#8d1b3d', '#8a1538', '#7b3f00', '#9e1b32', '#6d2c3c'],
  Orange: ['#ff8200', '#f77f00', '#ff9933', '#ff883e', '#e05206', '#ff7900'],
  Yellow: [
    '#ffd100',
    '#fcd116',
    '#ffce00',
    '#ffcc00',
    '#f7e017',
    '#ffe000',
    '#fecb00',
    '#f1bf00',
    '#ffc72c',
    '#eeb500',
    '#ffde00',
  ],
  Green: [
    '#009a49',
    '#00843d',
    '#007a3d',
    '#078930',
    '#009639',
    '#006a4e',
    '#00a651',
    '#1eb53a',
    '#009b3a',
    '#00732f',
    '#239f40',
    '#006233',
    '#3a7728',
    '#43b02a',
  ],
  'Light blue': [
    '#75aadb',
    '#6cace4',
    '#74acdf',
    '#4189dd',
    '#00a1de',
    '#5eb6e4',
    '#41b6e6',
    '#009fca',
    '#3d8ed0',
    '#62b5e5',
  ],
  Blue: [
    '#0033a0',
    '#002868',
    '#0055a4',
    '#003893',
    '#00247d',
    '#0d5eaf',
    '#003580',
    '#012169',
    '#0038a8',
    '#1e50a0',
    '#002b7f',
    '#003f87',
    '#0039a6',
    '#21468b',
    '#000080',
  ],
  White: ['#ffffff', '#f0f0f0', '#fafafa'],
  Black: ['#000000', '#222222', '#101010'],
};

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToLab([r, g, b]) {
  const f = (c) => {
    c /= 255;
    return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92;
  };
  const [R, G, B] = [f(r), f(g), f(b)];
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const g3 = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  [x, y, z] = [g3(x), g3(y), g3(z)];
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const REFS = Object.entries(NAMED).flatMap(([name, list]) => list.map((h) => ({ name, lab: rgbToLab(hexToRgb(h)) })));

const cache = new Map();
function nameOf(r, g, b) {
  const key = (r << 16) | (g << 8) | b;
  if (cache.has(key)) return cache.get(key);
  const lab = rgbToLab([r, g, b]);
  let best = null;
  let bd = Infinity;
  for (const ref of REFS) {
    const d = (lab[0] - ref.lab[0]) ** 2 + (lab[1] - ref.lab[1]) ** 2 + (lab[2] - ref.lab[2]) ** 2;
    if (d < bd) {
      bd = d;
      best = ref.name;
    }
  }
  cache.set(key, best);
  return best;
}

/**
 * Manual corrections after checking the extracted colours against the real flags.
 * Values are named colours in reading order. Only used where the automatic result was wrong or noisy.
 */
const FLAG_OVERRIDES = {
  USA: ['Red', 'White', 'Blue'],
  GBR: ['Blue', 'White', 'Red'],
  AUS: ['Blue', 'White', 'Red'],
  NZL: ['Blue', 'Red', 'White'],
  THA: ['Red', 'White', 'Blue'],
  DNK: ['Red', 'White'],
  NOR: ['Red', 'White', 'Blue'],
  GRC: ['Blue', 'White'],
  MAR: ['Red', 'Green'],
  KAZ: ['Light blue', 'Yellow'],
  UZB: ['Light blue', 'White', 'Red', 'Green'],
  UGA: ['Black', 'Yellow', 'Red', 'White'],
  MYS: ['Red', 'White', 'Blue', 'Yellow'],
  PHL: ['Blue', 'Red', 'White', 'Yellow'],
  BFA: ['Red', 'Green', 'Yellow'],
  NPL: ['Red', 'Blue', 'White'],
  ECU: ['Yellow', 'Blue', 'Red'],
  TKM: ['Green', 'Red', 'White'],
  KGZ: ['Red', 'Yellow'],
  NAM: ['Blue', 'Red', 'Green', 'White', 'Yellow'],
  SRB: ['Red', 'Blue', 'White'],
  SLE: ['Green', 'White', 'Blue'],
  LBR: ['Red', 'White', 'Blue'],
  ARM: ['Red', 'Blue', 'Orange'],
  MDA: ['Blue', 'Yellow', 'Red'],
  MKD: ['Red', 'Yellow'],
  EST: ['Blue', 'Black', 'White'],
  UNK: ['Blue', 'Yellow', 'White'],
  DJI: ['Light blue', 'Green', 'White', 'Red'],
  TLS: ['Red', 'Yellow', 'Black', 'White'],
  CYP: ['White', 'Orange', 'Green'],
  TTO: ['Red', 'White', 'Black'],
  MNE: ['Red', 'Yellow'],
  BLZ: ['Blue', 'Red', 'White'],
  WSM: ['Red', 'Blue', 'White'],
  KNA: ['Green', 'Yellow', 'Black', 'Red', 'White'],
  SMR: ['White', 'Light blue'],
  GNB: ['Red', 'Yellow', 'Green', 'Black'],
  LVA: ['Maroon', 'White'],
  QAT: ['White', 'Maroon'],
  AFG: ['Black', 'Red', 'Green'],
  SDN: ['Red', 'White', 'Black', 'Green'],
  SSD: ['Black', 'Red', 'Green', 'White', 'Blue', 'Yellow'],
  ARG: ['Light blue', 'White', 'Yellow'],
  VEN: ['Yellow', 'Blue', 'Red', 'White'],
  BRA: ['Green', 'Yellow', 'Blue', 'White'],
  IND: ['Orange', 'White', 'Green', 'Blue'],
};

const SWATCH = {
  Red: '#d52b1e',
  Maroon: '#8a1538',
  Orange: '#ff8200',
  Yellow: '#ffd100',
  Green: '#009a49',
  'Light blue': '#6cace4',
  Blue: '#0039a6',
  White: '#ffffff',
  Black: '#000000',
};

const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

export function extract(svg) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: W }, background: 'rgba(0,0,0,0)' }).render();
  const { width, height, pixels } = png;
  const stats = new Map();
  let total = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (pixels[i + 3] < 200) continue;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const n = nameOf(r, g, b);
      let s = stats.get(n);
      if (!s) {
        // Order key: column-major position of the first pixel for vertical layouts would differ,
        // so we keep the reading-order index (row-major) of the first occurrence.
        s = { n: 0, r: 0, g: 0, b: 0, first: y * width + x };
        stats.set(n, s);
      }
      s.n++;
      s.r += r;
      s.g += g;
      s.b += b;
      total++;
    }
  }
  return [...stats.entries()]
    .filter(([, s]) => s.n / total >= MIN_SHARE)
    .sort((a, b) => a[1].first - b[1].first)
    .map(([name, s]) => ({ name, hex: toHex(s.r / s.n, s.g / s.n, s.b / s.n), share: +(s.n / total).toFixed(3) }));
}

const countries = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const iso2File = { unk: 'xk' };
for (const c of countries) {
  const code = iso2File[c.id.toLowerCase()] || c.iso2;
  const svg = fs.readFileSync(path.join(FLAGS, `${code}.svg`), 'utf8');
  let colors = extract(svg);
  const ov = FLAG_OVERRIDES[c.id];
  if (ov) {
    colors = ov.map((name) => colors.find((x) => x.name === name) || { name, hex: NAMED[name][0], share: 0 });
  }
  if (!colors.length) throw new Error(`No flag colours for ${c.id}`);
  // Swatches use one canonical shade per colour name, so the same name always looks the same.
  c.flag = colors.map(({ name }) => ({ name, hex: SWATCH[name] }));
  c.flagFile = code;
}
fs.writeFileSync(FILE, JSON.stringify(countries, null, 1));

// Copy the flag SVGs of all targets to public/flags (shown only after the answer is revealed).
const outDir = path.join(ROOT, 'public/flags');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
for (const c of countries)
  fs.copyFileSync(path.join(FLAGS, `${c.flagFile}.svg`), path.join(outDir, `${c.flagFile}.svg`));
console.log(`Flag colours written for ${countries.length} countries`);
