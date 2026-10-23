#!/usr/bin/env node
/**
 * Generate all raster images from original SVG code: favicon PNG, apple-touch-icon, PWA icons
 * (including maskable) and the 1200×630 Open Graph image. The OG image draws a real map excerpt
 * from the game's own Natural Earth tiles. Rendered with resvg; no external images.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PUB = path.join(ROOT, 'public');
const CACHE = path.join(ROOT, 'scripts/.cache');

/** Convert a WOFF 1.0 font (zlib-compressed tables) to a plain TrueType file that resvg can load. */
function woffToTtf(buf) {
  const numTables = buf.readUInt16BE(12);
  const flavor = buf.readUInt32BE(4);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const o = 44 + i * 20;
    const offset = buf.readUInt32BE(o + 4);
    const compLength = buf.readUInt32BE(o + 8);
    const origLength = buf.readUInt32BE(o + 12);
    const raw = buf.subarray(offset, offset + compLength);
    tables.push({
      tag: buf.readUInt32BE(o),
      checksum: buf.readUInt32BE(o + 16),
      data: compLength < origLength ? zlib.inflateSync(raw) : raw,
    });
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

fs.mkdirSync(CACHE, { recursive: true });
// Figtree ships only as a variable woff2, so the generated images use IBM Plex Mono (static woff).
const FONT = path.join(ROOT, 'node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff');
const fontFile = path.join(CACHE, 'plex-mono-500.ttf');
fs.writeFileSync(fontFile, woffToTtf(fs.readFileSync(FONT)));

const LOGO_INNER = `
    <path d="M10 42c8-4 12 2 20-2s10-12 18-12 6 6 6 6" fill="none" stroke="#bfe3cc" stroke-width="3" stroke-linecap="round"/>
    <circle cx="40" cy="26" r="11" fill="#ffffff" fill-opacity=".18" stroke="#ffffff" stroke-width="2.5"/>
    <circle cx="36" cy="29" r="3.5" fill="#ffffff"/>`;

const mark = (size, { bg = true, pad = 0 } = {}) => {
  const k = (size - pad * 2) / 64;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bg ? `<rect width="${size}" height="${size}" fill="#1d7a45"/>` : ''}
  <g transform="translate(${pad} ${pad}) scale(${k})">
    ${bg ? '' : '<rect x="2" y="2" width="60" height="60" rx="16" fill="#1d7a45"/>'}${LOGO_INNER}
  </g>
</svg>`;
};

function png(svg, file) {
  const r = new Resvg(svg, {
    font: { fontFiles: [fontFile], loadSystemFonts: false, defaultFontFamily: 'IBM Plex Mono' },
  });
  fs.writeFileSync(path.join(PUB, file), r.render().asPng());
}

fs.writeFileSync(path.join(PUB, 'favicon.svg'), mark(64, { bg: false }));
png(mark(32), 'favicon-32.png');
png(mark(180, { pad: 14 }), 'apple-touch-icon.png');
png(mark(192, { pad: 12 }), 'icon-192.png');
png(mark(512, { pad: 32 }), 'icon-512.png');
png(mark(512, { pad: 96 }), 'icon-maskable-512.png');

// ── Open Graph image: a real map excerpt (Skagerrak: Norway, Sweden and Denmark) from the game's tiles ──
const tiles = [
  [0, 5],
  [1, 5],
].map(([x, y]) => ({
  ox: x * 10,
  oy: y * 10,
  t: JSON.parse(fs.readFileSync(path.join(PUB, `data/tiles/${x}_${y}.json`), 'utf8')),
}));
const W = 1200;
const H = 630;
const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const view = { lon: 9.4, lat: 58.4, kmWide: 520 };
const k = (W * 6371 * Math.cos((view.lat * Math.PI) / 180)) / view.kmWide; // pixels per radian
const px = (lon, lat) => [W * 0.6 + (k * (lon - view.lon) * Math.PI) / 180, H / 2 - k * (merc(lat) - merc(view.lat))];
const decode = (flat, ox, oy) => {
  const pts = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < flat.length; i += 2) {
    x += flat[i];
    y += flat[i + 1];
    pts.push(px(ox + x / 1000, oy + y / 1000));
  }
  return pts;
};
const d = (pts, close) => `M${pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join('L')}${close ? 'Z' : ''}`;
const polys = (l) =>
  tiles
    .map(({ t, ox, oy }) => (t[l] ?? []).map((rings) => rings.map((r) => d(decode(r, ox, oy), true)).join('')).join(''))
    .join('');
const lines = (l) =>
  tiles.map(({ t, ox, oy }) => (t[l] ?? []).map((r) => d(decode(r, ox, oy), false)).join('')).join('');
const towns = [];
for (const { t, ox, oy } of tiles) {
  for (let i = 0; i < (t.town ?? []).length; i += 3) {
    const [x, y] = px(ox + t.town[i] / 1000, oy + t.town[i + 1] / 1000);
    if (x > -10 && x < W + 10 && y > -10 && y < H + 10) {
      towns.push(
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${[3, 4, 5, 6][t.town[i + 2]]}" fill="#3c443d" stroke="#fff" stroke-width="1.5"/>`,
      );
    }
  }
}
const [cx, cy] = px(10.68, 59.3);
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="fade" x1="0" x2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset=".4" stop-color="#fff" stop-opacity=".92"/>
      <stop offset=".6" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#cde2e6"/>
  <path d="${polys('land')}" fill="#f9f8f3" fill-rule="evenodd"/>
  <path d="${polys('urban')}" fill="#e9e0cd" fill-rule="evenodd"/>
  <path d="${polys('lake')}" fill="#cde2e6" fill-rule="evenodd"/>
  <path d="${lines('river')}" fill="none" stroke="#8fbccb" stroke-width="1.6"/>
  <path d="${lines('rail')}" fill="none" stroke="#b5aea0" stroke-width="1.2" stroke-dasharray="6 3"/>
  <path d="${lines('road')}" fill="none" stroke="#dccfb7" stroke-width="1.6"/>
  <path d="${lines('major')}" fill="none" stroke="#e2aa58" stroke-width="2.8" stroke-linecap="round"/>
  <path d="${lines('border')}" fill="none" stroke="#8b877b" stroke-width="2" stroke-dasharray="10 4 3 4"/>
  ${towns.join('')}
  <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="64" fill="#1d7a45" fill-opacity=".13" stroke="#1d7a45" stroke-width="4"/>
  <rect width="${W}" height="${H}" fill="url(#fade)"/>
  <rect x="64" y="96" width="72" height="72" rx="18" fill="#1d7a45"/>
  <g transform="translate(68 100)">${LOGO_INNER}</g>
  <text x="62" y="270" font-family="IBM Plex Mono" font-size="64" fill="#15211a">Map in the Dark</text>
  <text x="64" y="330" font-family="IBM Plex Mono" font-size="27" fill="#4b5a50">Which city is hiding on the map?</text>
  <rect x="64" y="400" width="336" height="60" rx="30" fill="#1d7a45"/>
  <text x="232" y="438" text-anchor="middle" font-family="IBM Plex Mono" font-size="24" fill="#ffffff">5 cities · 6 clues</text>
</svg>`;
png(og, 'og-image.png');
console.log('Images written to public/');
