#!/usr/bin/env node
/**
 * Visual QA: drives the production build in Chromium with Playwright, plays full daily rounds
 * and saves screenshots to qa-screens/ (mobile 390 px and desktop 1440 px, dark and light themes).
 * Usage: npm run build && node scripts/qa.mjs   (starts `vite preview` itself)
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'qa-screens');
fs.mkdirSync(OUT, { recursive: true });
const cities = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/cities.json'), 'utf8'));
const nameOf = (id) => cities.find((c) => c.id === id).name;

const PORT = 4179;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'pipe' });
await new Promise((res) => {
  server.stdout.on('data', (d) => d.toString().includes(String(PORT)) && res());
  setTimeout(res, 6000);
});
const BASE = `http://localhost:${PORT}/`;
const only = process.argv[2];

const fallback = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (fs.existsSync(fallback) ? fallback : undefined),
});
const errors = [];

async function context(kind, scheme) {
  const opts =
    kind === 'mobile'
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 } };
  const ctx = await browser.newContext({ ...opts, colorScheme: scheme, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${kind}/${scheme}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${kind}/${scheme}] ${e.message}`));
  return { ctx, page };
}

const shot = (page, name, full = false) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function round(page, tag, plan) {
  await page.goto(`${BASE}#/play`);
  await page.waitForSelector('.clue-current', { timeout: 15000 });
  await wait(1500);
  for (let q = 0; q < 5; q++) {
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem('map-in-the-dark:v2')).current);
    const answer = nameOf(state.targets[state.index]);
    const p = plan[q];
    if (q === 0) await shot(page, `${tag}-q1-step1`);
    for (let s = 0; s < p.skips; s++) {
      await page.click('.guess-actions .btn');
      await wait(400);
    }
    if (p.wrong) {
      await page.fill('#guess', p.wrong);
      await page.keyboard.press('Enter');
      await wait(500);
      if (q === 0) await shot(page, `${tag}-q1-after-wrong`);
    }
    if (q === 0) {
      await page.fill('#guess', 'Atlantis');
      await page.keyboard.press('Enter');
      await wait(300);
      await page.fill('#guess', answer.slice(0, 3));
      await wait(300);
      await shot(page, `${tag}-q1-suggestions`);
      await page.fill('#guess', '');
    }
    if (q === 2) {
      await wait(1800);
      await shot(page, `${tag}-q3-step${1 + p.skips + (p.wrong ? 1 : 0)}`);
    }
    if (p.lose) {
      for (let s = 0; s < 6; s++) {
        const btn = await page.$('.guess-actions .btn');
        if (!btn) break;
        await btn.click();
        await wait(300);
      }
    } else {
      await page.fill('#guess', p.typo ? answer.toLowerCase().slice(0, -1) + 'x' : answer);
      await page.keyboard.press('Enter');
    }
    await page.waitForSelector('.reveal', { timeout: 5000 });
    await wait(1700);
    const lvl = await page.$('.modal');
    if (lvl) {
      await shot(page, `${tag}-levelup`);
      await page.click('.modal .btn');
    }
    if (q === 0 || q === 4) await shot(page, `${tag}-q${q + 1}-reveal`);
    await page.click('.next-btn');
    await wait(500);
  }
  await page.waitForSelector('.results', { timeout: 8000 });
  await wait(1400);
  await shot(page, `${tag}-results`, true);
}

const plan = [{ skips: 0 }, { skips: 1, wrong: 'Paris' }, { skips: 2 }, { skips: 4 }, { lose: true }];

for (const [kind, scheme] of [
  ['mobile', 'light'],
  ['desktop', 'light'],
]) {
  if (only && !`${kind}-${scheme}`.includes(only)) continue;
  const { ctx, page } = await context(kind, scheme);
  const tag = `${kind}-${scheme}`;
  await page.goto(BASE);
  await wait(2500);
  await shot(page, `${tag}-landing`);
  await shot(page, `${tag}-landing-full`, true);
  if (scheme === 'light') {
    await round(page, tag, plan);
    await page.goto(`${BASE}#/`);
    await wait(1500);
    await shot(page, `${tag}-landing-after`);
  }
  for (const r of ['stats', 'settings', 'about', 'credits', 'privacy', 'nowhere']) {
    await page.goto(`${BASE}#/${r}`);
    await wait(700);
    await shot(page, `${tag}-${r}`, true);
  }
  if (kind === 'mobile') {
    await page.goto(`${BASE}#/bonus?r=qa`);
    await page.waitForSelector('.clue-current');
    await wait(2500);
    await shot(page, `${tag}-bonus-step1`);
    for (let i = 0; i < 5; i++) {
      await page.click('.guess-actions .btn');
      await wait(1400);
      await shot(page, `${tag}-bonus-step${i + 2}`);
    }
  }
  await ctx.close();
}

await browser.close();
server.kill();
fs.writeFileSync(path.join(OUT, 'errors.txt'), errors.join('\n'));
console.log(errors.length ? `Console errors:\n${errors.join('\n')}` : 'No console errors');
