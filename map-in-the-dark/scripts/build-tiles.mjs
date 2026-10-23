#!/usr/bin/env node
/**
 * Build the real regional map: Natural Earth 1:10m layers cut into 10° × 10° tiles
 * (public/data/tiles/{x}_{y}.json), only where a city target's reveal window can reach.
 *
 * Layers per tile: land, lakes, built-up urban areas, rivers, roads (major / minor), railways,
 * country borders, state/province borders and towns (GeoNames points). Geometry is clipped to the tile, simplified and stored
 * as delta-encoded integers (1/1000°). Natural Earth is public domain.
 *
 * Run after build-cities.mjs (it reads src/data/cities.json to know which tiles are needed).
 */
import fs from 'node:fs';
import path from 'node:path';
import polygonClipping from 'polygon-clipping';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, 'scripts/.cache');
const OUT = path.join(ROOT, 'public/data/tiles');
const TILE = 10;
const SCALE = 1000;
/** Largest reveal radius in km (step 6) plus margin for panning. Keep in sync with src/game/config.ts. */
const REACH_KM = 900;

const LAYERS = {
  land: ['ne_10m_land'],
  lake: ['ne_10m_lakes', 'ne_10m_lakes_europe', 'ne_10m_lakes_north_america'],
  urban: ['ne_10m_urban_areas'],
  river: ['ne_10m_rivers_lake_centerlines', 'ne_10m_rivers_europe', 'ne_10m_rivers_north_america'],
  road: ['ne_10m_roads'],
  rail: ['ne_10m_railroads'],
  border: ['ne_10m_admin_0_boundary_lines_land'],
  admin1: ['ne_10m_admin_1_states_provinces_lines'],
};
const POLY = new Set(['land', 'lake', 'urban']);
/** Simplification tolerance in degrees per layer. */
const TOL = {
  land: 0.004,
  lake: 0.004,
  urban: 0.002,
  river: 0.004,
  road: 0.003,
  rail: 0.004,
  border: 0.004,
  admin1: 0.006,
};

const URL_BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
async function load(name) {
  const file = path.join(CACHE, `${name}.geojson`);
  if (!fs.existsSync(file)) {
    const res = await fetch(`${URL_BASE}${name}.geojson`);
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')).features;
}

// ── Which tiles are needed ──
const cities = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/cities.json'), 'utf8'));
const needed = new Set();
const tileKey = (tx, ty) => `${tx}_${ty}`;
for (const c of cities) {
  const [lon, lat] = c.lonlat;
  const dLat = REACH_KM / 111;
  const dLon = REACH_KM / (111 * Math.max(0.15, Math.cos((lat * Math.PI) / 180)));
  for (let y = Math.floor((lat - dLat) / TILE); y <= Math.floor((lat + dLat) / TILE); y++) {
    for (let x = Math.floor((lon - dLon) / TILE); x <= Math.floor((lon + dLon) / TILE); x++) {
      const wx = ((((x + 18) % 36) + 36) % 36) - 18; // wrap around the antimeridian
      if (y >= -9 && y < 9) needed.add(tileKey(wx, y));
    }
  }
}

// ── Geometry helpers ──
function simplify(pts, tol) {
  if (pts.length <= 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0;
    let mi = -1;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > md) {
        md = d;
        mi = i;
      }
    }
    if (md > tol && mi > 0) {
      keep[mi] = 1;
      stack.push([a, mi], [mi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Closed rings: split at the point farthest from the start so Douglas–Peucker has a real baseline. */
function simplifyRing(ring, tol) {
  let m = 0;
  let md = -1;
  for (let i = 1; i < ring.length - 1; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > md) {
      md = d;
      m = i;
    }
  }
  if (m === 0) return ring;
  return [...simplify(ring.slice(0, m + 1), tol).slice(0, -1), ...simplify(ring.slice(m), tol)];
}

/** Clip a polyline to a rectangle, returning the pieces inside (Liang–Barsky per segment). */
function clipLine(line, [x0, y0, x1, y1]) {
  const out = [];
  let cur = null;
  for (let i = 0; i < line.length - 1; i++) {
    let [ax, ay] = line[i];
    let [bx, by] = line[i + 1];
    let t0 = 0;
    let t1 = 1;
    const dx = bx - ax;
    const dy = by - ay;
    const p = [-dx, dx, -dy, dy];
    const q = [ax - x0, x1 - ax, ay - y0, y1 - ay];
    let ok = true;
    for (let k = 0; k < 4; k++) {
      if (p[k] === 0) {
        if (q[k] < 0) ok = false;
      } else {
        const r = q[k] / p[k];
        if (p[k] < 0) t0 = Math.max(t0, r);
        else t1 = Math.min(t1, r);
      }
    }
    if (!ok || t0 > t1) {
      if (cur) {
        out.push(cur);
        cur = null;
      }
      continue;
    }
    const s = [ax + t0 * dx, ay + t0 * dy];
    const e = [ax + t1 * dx, ay + t1 * dy];
    if (!cur) cur = [s];
    cur.push(e);
    if (t1 < 1) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out.filter((l) => l.length > 1);
}

const bboxOf = (coords) => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of coords) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
};

function tilesFor([x0, y0, x1, y1]) {
  const keys = [];
  for (let y = Math.floor(y0 / TILE); y <= Math.floor(y1 / TILE); y++)
    for (let x = Math.floor(x0 / TILE); x <= Math.floor(Math.min(x1, 179.999) / TILE); x++)
      if (needed.has(tileKey(x, y))) keys.push([x, y]);
  return keys;
}

const enc = (pts, ox, oy) => {
  const flat = [];
  let px = 0;
  let py = 0;
  for (const [x, y] of pts) {
    const ix = Math.round((x - ox) * SCALE);
    const iy = Math.round((y - oy) * SCALE);
    if (flat.length && ix === px && iy === py) continue;
    flat.push(ix - px, iy - py);
    px = ix;
    py = iy;
  }
  return flat;
};

const roadClass = (p) => {
  if (/Ferry|Track/.test(p.type)) return -1;
  return /Major|Beltway|Bypass/.test(p.type) ? 1 : 0;
};

// ── Build ──
const tiles = new Map([...needed].map((k) => [k, {}]));
for (const [layer, files] of Object.entries(LAYERS)) {
  let count = 0;
  for (const file of files) {
    const feats = await load(file);
    for (const f of feats) {
      const g = f.geometry;
      if (!g) continue;
      let cls = 0;
      if (layer === 'road') {
        cls = roadClass(f.properties);
        if (cls < 0) continue;
      }
      if (POLY.has(layer)) {
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        for (const poly of polys) {
          for (const [tx, ty] of tilesFor(bboxOf(poly[0]))) {
            const rect = [
              [
                [tx * TILE, ty * TILE],
                [tx * TILE + TILE, ty * TILE],
                [tx * TILE + TILE, ty * TILE + TILE],
                [tx * TILE, ty * TILE + TILE],
                [tx * TILE, ty * TILE],
              ],
            ];
            let clipped;
            try {
              clipped = polygonClipping.intersection(poly, rect);
            } catch {
              continue;
            }
            const t = tiles.get(tileKey(tx, ty));
            for (const cp of clipped) {
              const rings = cp.map((r) => simplifyRing(r, TOL[layer])).filter((r) => r.length >= 4);
              if (!rings.length) continue;
              (t[layer] ||= []).push(rings.map((r) => enc(r.slice(0, -1), tx * TILE, ty * TILE)));
              count++;
            }
          }
        }
      } else {
        const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
        for (const line of lines) {
          for (const [tx, ty] of tilesFor(bboxOf(line))) {
            const t = tiles.get(tileKey(tx, ty));
            for (const piece of clipLine(line, [tx * TILE, ty * TILE, tx * TILE + TILE, ty * TILE + TILE])) {
              const s = simplify(piece, TOL[layer]);
              if (s.length < 2) continue;
              const e = enc(s, tx * TILE, ty * TILE);
              if (e.length < 4) continue;
              if (layer === 'road') (t[cls ? 'major' : 'road'] ||= []).push(e);
              else (t[layer] ||= []).push(e);
              count++;
            }
          }
        }
      }
    }
  }
  console.log(`${layer}: ${count} pieces`);
}

// Towns (GeoNames, CC BY 4.0): every place of 10,000+ people, drawn as unlabeled dots. The target city
// is one of them, so it looks exactly like its neighbours until the search area narrows.
let towns = 0;
for (const c of require('all-the-cities')) {
  if (c.population < 10000 || ['PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH'].includes(c.featureCode)) continue;
  const [x, y] = c.loc.coordinates;
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  const t = tiles.get(tileKey(tx, ty));
  if (!t) continue;
  const size = c.population >= 1e6 ? 3 : c.population >= 250000 ? 2 : c.population >= 50000 ? 1 : 0;
  (t.town ||= []).push(Math.round((x - tx * TILE) * SCALE), Math.round((y - ty * TILE) * SCALE), size);
  towns++;
}
console.log(`town: ${towns}`);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let bytes = 0;
let written = 0;
for (const [k, t] of tiles) {
  if (!Object.keys(t).length) continue;
  const json = JSON.stringify(t);
  bytes += json.length;
  written++;
  fs.writeFileSync(path.join(OUT, `${k}.json`), json);
}
// Index of tiles that exist, so the client never requests empty ocean tiles.
fs.writeFileSync(
  path.join(ROOT, 'src/data/tiles.json'),
  JSON.stringify([...tiles].filter(([, t]) => Object.keys(t).length).map(([k]) => k)),
);
console.log(`${written} tiles, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
