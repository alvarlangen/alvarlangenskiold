#!/usr/bin/env node
/**
 * Split every country into 24–40 contiguous pieces (12 for microstates) and write public/data/pieces/{ID}.json.
 *
 * Method
 *  1. Take the Natural Earth geometry from world-atlas (1:50m, or 1:10m for small countries and
 *     anything missing at 50m). Somaliland and Northern Cyprus are merged into Somalia and Cyprus.
 *  2. Unwrap longitudes for countries that cross the antimeridian, then work in a locally
 *     equal-ish planar space (x = lon·cos(lat₀), y = lat).
 *  3. Scatter seed points inside the country (area-weighted, seeded RNG), run Lloyd relaxation so the
 *     cells are evenly sized, build a Voronoi diagram and clip each cell to the country polygon.
 *  4. Store each piece's polygon, its share of the country's area and its Delaunay neighbours.
 *     The game grows a contiguous region over this adjacency graph at runtime.
 *
 * Polygons are rewound to d3-geo's winding convention (clockwise exterior) and quantised.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { feature } from 'topojson-client';
import { Delaunay } from 'd3-delaunay';
import { geoArea, geoBounds, geoCentroid } from 'd3-geo';
import polygonClipping from 'polygon-clipping';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const countries = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/countries.json'), 'utf8'));
const t50 = require('world-atlas/countries-50m.json');
const t10 = require('world-atlas/countries-10m.json');
const f50 = feature(t50, t50.objects.countries).features;
const f10 = feature(t10, t10.objects.countries).features;
const wc = Object.fromEntries(require('world-countries').map((c) => [c.cca3, c]));

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s) => [...s].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7);

const asMulti = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);

/**
 * Vatican City collapses to a zero-area sliver in the quantised 1:10m TopoJSON, so it gets a
 * hand-traced approximation of its walls (≈0.44 km²), documented in the README.
 */
const MANUAL = {
  VAT: [
    [
      [
        [12.4457, 41.9017],
        [12.4462, 41.904],
        [12.448, 41.9055],
        [12.451, 41.907],
        [12.4535, 41.9073],
        [12.4568, 41.9058],
        [12.4583, 41.903],
        [12.457, 41.9014],
        [12.4545, 41.9005],
        [12.45, 41.9002],
        [12.4457, 41.9017],
      ],
    ],
  ],
};

function geometryOf(c) {
  if (MANUAL[c.id]) return MANUAL[c.id];
  const ccn3 = wc[c.id].ccn3;
  const pick = (list, test) => list.find(test);
  const small = c.area < 60000;
  let f;
  if (c.id === 'UNK') f = pick(small ? f10 : f50, (x) => x.properties.name === 'Kosovo');
  else f = pick(small ? f10 : f50, (x) => x.id === ccn3) || pick(f10, (x) => x.id === ccn3);
  if (!f) throw new Error(`No geometry for ${c.id}`);
  let polys = asMulti(f.geometry);
  const extra = { SOM: 'Somaliland', CYP: 'N. Cyprus' }[c.id];
  if (extra) {
    const e = pick(small ? f10 : f50, (x) => x.properties.name === extra);
    if (e) polys = polygonClipping.union(polys, asMulti(e.geometry));
  }
  return polys;
}

/** Shift negative longitudes by +360 for countries straddling the antimeridian. */
function unwrap(polys) {
  let east = false;
  let west = false;
  for (const p of polys)
    for (const [x] of p[0]) {
      if (x > 150) east = true;
      if (x < -150) west = true;
    }
  if (!(east && west)) return polys;
  return polys.map((p) => p.map((r) => r.map(([x, y]) => [x < 0 ? x + 360 : x, y])));
}

function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return a / 2;
}
const polyArea = (p) => Math.abs(ringArea(p[0])) - p.slice(1).reduce((s, r) => s + Math.abs(ringArea(r)), 0);

function simplifyRing(pts, tol) {
  if (pts.length <= 8) return pts;
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
  const out = pts.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : pts;
}

function pointInRing(x, y, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const pointInPoly = (x, y, p) => pointInRing(x, y, p[0]) && !p.slice(1).some((h) => pointInRing(x, y, h));

function centroidOf(mp) {
  let cx = 0;
  let cy = 0;
  let A = 0;
  for (const p of mp) {
    const r = p[0];
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
      cx += (r[j][0] + r[i][0]) * f;
      cy += (r[j][1] + r[i][1]) * f;
      A += f;
    }
  }
  if (Math.abs(A) < 1e-14) return null;
  return [cx / (3 * A), cy / (3 * A)];
}

function bboxOf(polys) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of polys)
    for (const [x, y] of p[0]) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  return [x0, y0, x1, y1];
}

function build(c) {
  let polys = unwrap(geometryOf(c));
  const [bx0, by0, bx1, by1] = bboxOf(polys);
  const lat0 = (by0 + by1) / 2;
  const k = Math.max(0.2, Math.cos((lat0 * Math.PI) / 180));
  // To planar space.
  polys = polys.map((p) => p.map((r) => r.map(([x, y]) => [x * k, y])));
  const diag = Math.hypot((bx1 - bx0) * k, by1 - by0);
  polys = polys.map((p) => p.map((r) => simplifyRing(r, diag * 0.0025)));
  const areas = polys.map(polyArea);
  const total = areas.reduce((a, b) => a + b, 0);
  if (polys.length > 20) polys = polys.filter((_, i) => areas[i] > total * 0.0004);

  const tiny = c.area < 1500;
  const n = tiny ? 12 : Math.round(Math.min(40, Math.max(24, 18 + 4 * Math.log10(c.area))));
  const rng = mulberry32(hash(c.id));
  const [x0, y0, x1, y1] = bboxOf(polys);

  // Area-weighted rejection sampling: pick a polygon proportional to area, then a point inside it.
  const pa = polys.map(polyArea);
  const pt = pa.reduce((a, b) => a + b, 0);
  const pb = polys.map((p) => bboxOf([p]));
  const seeds = [];
  let guard = 0;
  while (seeds.length < n && guard++ < 200000) {
    let r = rng() * pt;
    let i = 0;
    while (i < pa.length - 1 && r > pa[i]) r -= pa[i++];
    const [a0, b0, a1, b1] = pb[i];
    const x = a0 + rng() * (a1 - a0);
    const y = b0 + rng() * (b1 - b0);
    if (pointInPoly(x, y, polys[i])) seeds.push([x, y]);
  }
  if (seeds.length < 3) throw new Error(`Seeding failed for ${c.id}`);

  const pad = Math.max(x1 - x0, y1 - y0) * 0.1 + 1e-6;
  const bounds = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  let cells = [];
  let pts = seeds;
  for (let iter = 0; iter < 4; iter++) {
    const vor = Delaunay.from(pts).voronoi(bounds);
    cells = pts.map((_, i) => {
      const cell = vor.cellPolygon(i);
      if (!cell) return [];
      try {
        return polygonClipping.intersection([cell], polys);
      } catch {
        return [];
      }
    });
    if (iter < 3) {
      pts = pts.map((p, i) => (cells[i].length ? centroidOf(cells[i]) || p : p));
    }
  }
  const del = Delaunay.from(pts);
  const keepIdx = cells.map((cl, i) => (cl.length ? i : -1)).filter((i) => i >= 0);
  const remap = new Map(keepIdx.map((old, i) => [old, i]));

  const prec = tiny ? 1e4 : c.area < 30000 ? 2e3 : 1e3;
  const q = (v) => Math.round(v * prec) / prec;
  const out = keepIdx.map((i) => {
    // Back to lon/lat, rewind (reverse) to d3's clockwise-exterior convention, quantise.
    const mp = cells[i].map((p) => p.map((r) => r.map(([x, y]) => [q(x / k), q(y)]).reverse()));
    return { mp, nb: [...del.neighbors(i)].filter((j) => remap.has(j)).map((j) => remap.get(j)) };
  });
  const geoms = out.map((o) => ({ type: 'MultiPolygon', coordinates: o.mp }));
  const ga = geoms.map((g) => geoArea(g));
  for (let i = 0; i < ga.length; i++) {
    if (ga[i] > 2 * Math.PI) throw new Error(`Winding error for ${c.id} piece ${i}`);
  }
  const gTotal = ga.reduce((a, b) => a + b, 0);
  const all = { type: 'MultiPolygon', coordinates: out.flatMap((o) => o.mp) };
  const [[lo0, la0], [lo1, la1]] = geoBounds(all);
  // Delta-encode each ring as a flat integer array: [x0, y0, dx1, dy1, …] in units of 1/prec degrees.
  const enc = (ring) => {
    const flat = [];
    let px = 0;
    let py = 0;
    for (const [x, y] of ring.slice(0, -1)) {
      const ix = Math.round(x * prec);
      const iy = Math.round(y * prec);
      flat.push(ix - px, iy - py);
      px = ix;
      py = iy;
    }
    return flat;
  };
  return {
    s: prec,
    p: out.map((o) => o.mp.map((poly) => poly.map(enc))),
    a: ga.map((v) => +(v / gTotal).toFixed(4)),
    n: out.map((o) => o.nb),
    area: gTotal * 6371 ** 2,
    c: geoCentroid(all).map((v) => +v.toFixed(3)),
    b: [lo0, la0, lo1, la1].map((v) => +v.toFixed(3)),
  };
}

const result = {};
for (const c of countries) {
  result[c.id] = build(c);
  // Sanity check: the geometry's spherical area should be in the same ballpark as the official area.
  const km2 = result[c.id].area;
  const ratio = km2 / c.area;
  if (ratio < 0.3 || ratio > 3) console.warn(`Area check ${c.id}: geometry ${km2.toFixed(0)} km² vs ${c.area} km²`);
}
for (const r of Object.values(result)) delete r.area;
const counts = Object.values(result).map((r) => r.p.length);
// One small file per country in public/data/pieces/, lazy-loaded by the game (and cached by the service worker).
const dir = path.join(ROOT, 'public/data/pieces');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
let bytes = 0;
for (const [id, r] of Object.entries(result)) {
  const json = JSON.stringify(r);
  bytes += json.length;
  fs.writeFileSync(path.join(dir, `${id}.json`), json);
}
console.log(
  `Pieces for ${counts.length} countries: min ${Math.min(...counts)}, max ${Math.max(...counts)}, ` +
    `total ${(bytes / 1024).toFixed(0)} KB in public/data/pieces/`,
);
