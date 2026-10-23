#!/usr/bin/env node
/**
 * Generate all raster images from original SVG code: favicon PNG, apple-touch-icon, PWA icons
 * (including maskable) and the 1200×630 Open Graph image. Uses resvg (no external images).
 * The OG image draws a real lit country silhouette (Italy's pieces) on a dark globe.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { geoOrthographic, geoPath, geoGraticule10 } from 'd3-geo';
import zlib from 'node:zlib';
import { merge } from 'topojson-client';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PUB = path.join(ROOT, 'public');

/** Convert a WOFF 1.0 font (zlib-compressed tables) to a plain TrueType buffer that resvg can load. */
function woffToTtf(buf) {
  const numTables = buf.readUInt16BE(12);
  const flavor = buf.readUInt32BE(4);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const o = 44 + i * 20;
    const tag = buf.readUInt32BE(o);
    const offset = buf.readUInt32BE(o + 4);
    const compLength = buf.readUInt32BE(o + 8);
    const origLength = buf.readUInt32BE(o + 12);
    const checksum = buf.readUInt32BE(o + 16);
    const raw = buf.subarray(offset, offset + compLength);
    tables.push({ tag, checksum, data: compLength < origLength ? zlib.inflateSync(raw) : raw });
  }
  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = 2 ** entrySelector * 16;
  const header = Buffer.alloc(12 + numTables * 16);
  header.writeUInt32BE(flavor, 0);
  header.writeUInt16BE(numTables, 4);
  header.writeUInt16BE(searchRange, 6);
  header.writeUInt16BE(entrySelector, 8);
  header.writeUInt16BE(numTables * 16 - searchRange, 10);
  let offset = header.length;
  const bodies = [];
  tables.forEach((t, i) => {
    const o = 12 + i * 16;
    header.writeUInt32BE(t.tag, o);
    header.writeUInt32BE(t.checksum, o + 4);
    header.writeUInt32BE(offset, o + 8);
    header.writeUInt32BE(t.data.length, o + 12);
    const padded = Buffer.alloc((t.data.length + 3) & ~3);
    t.data.copy(padded);
    bodies.push(padded);
    offset += padded.length;
  });
  return Buffer.concat([header, ...bodies]);
}

const FONT_DIR = path.join(ROOT, 'node_modules/@fontsource/unbounded/files');
const CACHE = path.join(ROOT, 'scripts/.cache');
fs.mkdirSync(CACHE, { recursive: true });
const fontFiles = ['600', '700'].map((w) => {
  const out = path.join(CACHE, `unbounded-${w}.ttf`);
  fs.writeFileSync(out, woffToTtf(fs.readFileSync(path.join(FONT_DIR, `unbounded-latin-${w}-normal.woff`))));
  return out;
});

const mark = (size, { bg = true, pad = 0 } = {}) => {
  const s = size;
  const k = (s - pad * 2) / 64;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <radialGradient id="o" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#173a66"/><stop offset="1" stop-color="#040b18"/></radialGradient>
    <filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${2.2 * k}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  ${bg ? `<rect width="${s}" height="${s}" fill="#050a14"/>` : ''}
  <g transform="translate(${pad} ${pad}) scale(${k})">
    <circle cx="32" cy="32" r="27" fill="url(#o)" stroke="#36e4ff" stroke-opacity=".5" stroke-width="1.2"/>
    <path d="M5.5 32h53M32 5c-9 8-9 46 0 54M32 5c9 8 9 46 0 54" stroke="#7fdcff" stroke-opacity=".25" fill="none"/>
    <path d="M30 22l7-3 6 4-1 7-6 3-6-4z" fill="#36e4ff" filter="url(#g)"/>
    <path d="M37 33l5-3 3 5-3 4-5-1z" fill="#36e4ff" fill-opacity=".55"/>
  </g>
</svg>`;
};

function png(svg, file, width) {
  const r = new Resvg(svg, {
    fitTo: width ? { mode: 'width', value: width } : { mode: 'original' },
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Unbounded' },
  });
  fs.writeFileSync(path.join(PUB, file), r.render().asPng());
}

// Favicon SVG (transparent) + PNG fallbacks.
fs.writeFileSync(path.join(PUB, 'favicon.svg'), mark(64, { bg: false }));
png(mark(32), 'favicon-32.png');
png(mark(180, { pad: 14 }), 'apple-touch-icon.png');
png(mark(192, { pad: 12 }), 'icon-192.png');
png(mark(512, { pad: 32 }), 'icon-512.png');
png(mark(512, { pad: 96 }), 'icon-maskable-512.png');

// Open Graph image.
const world = JSON.parse(fs.readFileSync(path.join(PUB, 'data/world.json'), 'utf8'));
const land = merge(world, world.objects.countries.geometries);
const raw = JSON.parse(fs.readFileSync(path.join(PUB, 'data/pieces/ITA.json'), 'utf8'));
const decode = (flat, s) => {
  const out = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < flat.length; i += 2) {
    x += flat[i];
    y += flat[i + 1];
    out.push([x / s, y / s]);
  }
  out.push(out[0]);
  return out;
};
const pieces = raw.p.map((polys) => ({
  type: 'MultiPolygon',
  coordinates: polys.map((rings) => rings.map((r) => decode(r, raw.s))),
}));
const proj = geoOrthographic().rotate([-12, -40]).scale(1500).translate([900, 330]).clipAngle(90);
const p = geoPath(proj);
// Light a contiguous ~45% of Italy, growing from the north.
const cent = pieces.map((g) => p.centroid(g));
const lit = [...pieces.keys()].sort((a, b) => cent[a][1] - cent[b][1]).slice(0, Math.round(pieces.length * 0.45));

const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="bg" cx="70%" cy="20%" r="90%"><stop offset="0" stop-color="#0e2a4a"/><stop offset="1" stop-color="#050a14"/></radialGradient>
    <radialGradient id="sea" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#0d2140"/><stop offset="1" stop-color="#030913"/></radialGradient>
    <radialGradient id="atm" cx="50%" cy="50%" r="50%"><stop offset=".86" stop-color="#3cc8ff" stop-opacity=".35"/><stop offset="1" stop-color="#3cc8ff" stop-opacity="0"/></radialGradient>
    <linearGradient id="fade" x1="0" x2="1"><stop offset="0" stop-color="#050a14" stop-opacity=".92"/><stop offset=".45" stop-color="#050a14" stop-opacity=".35"/><stop offset="1" stop-color="#050a14" stop-opacity="0"/></linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="900" cy="330" r="1740" fill="url(#atm)"/>
  <circle cx="900" cy="330" r="1500" fill="url(#sea)"/>
  <path d="${p(geoGraticule10())}" stroke="#78c8ff" stroke-opacity=".12" fill="none"/>
  <path d="${p(land)}" fill="#6ebeff" fill-opacity=".08" stroke="#8cd2ff" stroke-opacity=".25" stroke-width="1"/>
  <g filter="url(#glow)">${lit.map((i) => `<path d="${p(pieces[i])}" fill="#36e4ff" fill-opacity=".88" stroke="#e0faff" stroke-opacity=".6" stroke-width="1"/>`).join('')}</g>
  <rect width="1200" height="630" fill="url(#fade)"/>
  <text x="72" y="210" font-family="Unbounded" font-weight="700" font-size="76" fill="#e9f2ff">Map in</text>
  <text x="72" y="300" font-family="Unbounded" font-weight="700" font-size="76" fill="#36e4ff">the Dark</text>
  <text x="74" y="372" font-family="Unbounded" font-weight="600" font-size="26" fill="#a3b6cf">A daily geography game</text>
  <g font-family="Unbounded" font-weight="600" font-size="20">
    <rect x="72" y="440" width="252" height="52" rx="26" fill="#36e4ff"/>
    <text x="198" y="473" text-anchor="middle" fill="#001820">6 clues · 5 targets</text>
    <rect x="340" y="440" width="176" height="52" rx="26" fill="none" stroke="#ffc65c" stroke-opacity=".7"/>
    <text x="428" y="473" text-anchor="middle" fill="#ffc65c">New daily</text>
  </g>
</svg>`;
png(og, 'og-image.png');
console.log('Images written to public/');
