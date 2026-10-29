#!/usr/bin/env node
/**
 * QA for the satellite layer without network access to a real provider.
 *
 * Builds the site with a "custom" imagery provider pointing at https://mock-imagery.test, then serves
 * that host from Playwright: each requested XYZ tile is rendered on the fly from the bundled Natural
 * Earth tiles in satellite-like colours. If the map overlays (borders, search circle, pin) line up with
 * the mock imagery, the Web Mercator tile maths is right. It also counts the tile requests of a round
 * (they cost money with a real provider), and checks that a provider refusing every tile (403) falls back
 * to the bundled imagery. Screenshots go to qa-screens/imagery-*.png.
 */
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'qa-screens');
const DIST = path.join(ROOT, 'dist-imagery-qa');
fs.mkdirSync(OUT, { recursive: true });

execSync(`npx vite build --outDir ${DIST} --emptyOutDir`, {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_MAP_PROVIDER: 'custom',
    VITE_MAP_URL: 'https://mock-imagery.test/{z}/{x}/{y}.png',
    VITE_MAP_ATTRIBUTION: 'Mock imagery for QA',
  },
});

const tileCache = new Map();
const loadTile = (key) => {
  if (!tileCache.has(key)) {
    const f = path.join(ROOT, 'public/data/tiles', `${key}.json`);
    tileCache.set(key, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
  }
  return tileCache.get(key);
};
const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

function renderTile(z, x, y) {
  const n = 2 ** z;
  const px = (lon, lat) => [
    ((lon + 180) / 360) * n * 256 - x * 256,
    ((Math.PI - merc(lat)) / (2 * Math.PI)) * n * 256 - y * 256,
  ];
  const lon0 = (x / n) * 360 - 180;
  const lon1 = ((x + 1) / n) * 360 - 180;
  const latOf = (yy) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * yy) / n))) * 180) / Math.PI;
  const lat1 = latOf(y);
  const lat0 = latOf(y + 1);
  const keys = [];
  for (let ty = Math.floor(lat0 / 10); ty <= Math.floor(lat1 / 10); ty++)
    for (let tx = Math.floor(lon0 / 10); tx <= Math.floor((lon1 - 1e-9) / 10); tx++) keys.push([tx, ty]);
  const parts = { land: '', urban: '', lake: '', river: '', major: '' };
  for (const [tx, ty] of keys) {
    const t = loadTile(`${tx}_${ty}`);
    if (!t) continue;
    const dec = (flat) => {
      let a = 0;
      let b = 0;
      let d = '';
      for (let i = 0; i < flat.length; i += 2) {
        a += flat[i];
        b += flat[i + 1];
        const [sx, sy] = px(tx * 10 + a / 1000, ty * 10 + b / 1000);
        d += `${i ? 'L' : 'M'}${sx.toFixed(1)},${sy.toFixed(1)}`;
      }
      return d;
    };
    for (const l of ['land', 'urban', 'lake'])
      for (const rings of t[l] ?? []) parts[l] += rings.map((r) => dec(r) + 'Z').join('');
    for (const l of ['river', 'major']) for (const r of t[l] ?? []) parts[l] += dec(r);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
    <rect width="256" height="256" fill="#14324a"/>
    <path d="${parts.land}" fill="#5d7342" fill-rule="evenodd"/>
    <path d="${parts.urban}" fill="#9a9488" fill-rule="evenodd"/>
    <path d="${parts.lake}" fill="#1d3f57" fill-rule="evenodd"/>
    <path d="${parts.river}" fill="none" stroke="#2b5470" stroke-width="2"/>
    <path d="${parts.major}" fill="none" stroke="#c9c2b3" stroke-width="1.4"/>
    <rect width="256" height="256" fill="none" stroke="#ffffff" stroke-opacity=".15"/>
  </svg>`;
  return new Resvg(svg).render().asPng();
}

const PORT = 4182;
const server = spawn('npx', ['vite', 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 2500));
const fallback = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath: fs.existsSync(fallback) ? fallback : undefined });
const errors = [];
for (const [name, viewport] of [
  ['mobile', { width: 390, height: 844 }],
  ['desktop', { width: 1440, height: 900 }],
]) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: name === 'mobile' ? 2 : 1,
    serviceWorkers: 'block',
  });
  let requests = 0;
  await ctx.route('https://mock-imagery.test/**', (route) => {
    requests++;
    const m = route
      .request()
      .url()
      .match(/\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if (!m) return route.fulfill({ status: 404 });
    return route.fulfill({ status: 200, contentType: 'image/png', body: renderTile(+m[1], +m[2], +m[3]) });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/#/bonus?r=imagery`);
  await page.waitForSelector('.clue-current');
  await new Promise((r) => setTimeout(r, 3000));
  await page.screenshot({ path: path.join(OUT, `imagery-${name}-step1.png`) });
  for (let i = 0; i < 3; i++) {
    await page.click('.guess-actions .btn');
    await new Promise((r) => setTimeout(r, 1300));
  }
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(OUT, `imagery-${name}-step4.png`) });
  for (let i = 0; i < 3; i++) {
    const b = await page.$('.guess-actions .btn');
    if (b) await b.click();
    await new Promise((r) => setTimeout(r, 600));
  }
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: path.join(OUT, `imagery-${name}-reveal.png`) });
  console.log(`${name}: ${requests} provider tile requests for one city (6 steps + reveal)`);
  await ctx.close();
}

// Provider refuses every tile: the bundled imagery must take over.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route('https://mock-imagery.test/**', (route) => route.fulfill({ status: 403 }));
  let bundled = 0;
  ctx.on('request', (r) => {
    if (/\/imagery\/\d+\/\d+\/\d+\.webp$/.test(r.url())) bundled++;
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`fallback: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/#/bonus?r=imagery`);
  await page.waitForSelector('.clue-current');
  await new Promise((r) => setTimeout(r, 4000));
  await page.screenshot({ path: path.join(OUT, 'imagery-fallback.png') });
  console.log(`fallback: ${bundled} bundled tiles loaded after the provider refused`);
  if (!bundled) errors.push('fallback: the bundled imagery was not used');
  await ctx.close();
}
await browser.close();
server.kill();
fs.rmSync(DIST, { recursive: true, force: true });
console.log(errors.length ? errors.join('\n') : 'No page errors');
process.exit(0);
