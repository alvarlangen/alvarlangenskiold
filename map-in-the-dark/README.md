# Map in the Dark

A daily geography game. A dark map lights up piece by piece, and every step gives a new clue. Name the
country or city in as few steps as you can.

- **Two modes, two daily rounds** — Countries and Cities, each with its own daily round, streak, stats and share line.
- **5 questions × 6 steps** — the map lights up 12 → 28 → 46 → 66 → 84 → 100 % and a clue is added each step.
- **Type your answer** — tolerant matching (case, spaces, accents, one typo, exonyms such as UK, Holland, Burma, Bombay, Peking, Saigon).
- **Rewards** — points per step (100/80/60/45/30/20), XP, combo multiplier ×1–×5, a golden question with 2× XP, levels.
- **Unlimited bonus rounds** and **practice per continent**.
- **Static site** — no backend, no tracking, works offline after the first visit (service worker).

## Run locally

Requires Node 20+.

```bash
cd map-in-the-dark
npm install
npm run dev        # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Type-check and build the static site into `dist/` (also generates `dist/sw.js`) |
| `npm run preview` | Serve the production build |
| `npm test` | Unit tests (Vitest) |
| `npm run lint` | ESLint, zero warnings allowed |
| `npm run format` | Prettier |
| `npm run data` | Rebuild all game data (see below) |
| `npm run images` | Regenerate favicon, app icons and the Open Graph image |
| `npm run qa` | Play full rounds in Chromium with Playwright and save screenshots to `qa-screens/` (run after `build`) |

## Deploy

The build is a fully static folder with relative paths and hash routing (`#/play/countries`), so it can be
served from any path on any static host.

- **Netlify / Vercel / Cloudflare Pages:** build command `npm run build`, base directory `map-in-the-dark`, output `dist`.
- **GitHub Pages:** build and publish `dist/` (e.g. with `actions/upload-pages-artifact` + `actions/deploy-pages`).
  `dist/404.html` provides a themed not-found page for unknown paths.

## Project structure

```
map-in-the-dark/
  index.html              Entry, meta tags, Open Graph/Twitter cards
  public/                 Static files: icons, OG image, manifest, flags/, data/world.json, data/pieces/*.json
  scripts/                Data pipeline, image generation and QA (Node)
    data/cities-curated.mjs   Hand-curated city list with exonyms and facts
  src/
    game/                 Pure game engine (no DOM): config, rng, selection, matching, clues, scoring, round, growth
    map/                  Canvas renderer (d3-geo): 3D globe + flat map, lazy geometry loading
    components/           Preact UI (landing, game, results, stats, settings, pages)
    lib/                  Storage, theme, sound, haptics, router, progress persistence
    data/                 Generated JSON (countries, cities), country facts, SOURCES.md
    styles/               Design tokens (dark + light) and component styles
    sw-template.js        Service worker template (filled in at build time)
  tests/                  Vitest unit tests
```

### Technical choices

- **Vite + TypeScript + Preact** — small runtime (the landing page ships ~40 kB of gzipped JS; the game and its
  data load on demand).
- **Map: d3-geo on a 2D canvas.** The "3D globe" is an orthographic projection with an atmosphere glow; the flat map
  is Mercator. No WebGL is needed, so it works on every phone and there is no separate fallback path. The renderer only
  redraws while something moves.
- **Pieces** are computed at build time: seeded points inside the country, Lloyd-relaxed Voronoi cells clipped to the
  country polygon (24–40 pieces; 12 for microstates), with a Delaunay adjacency graph. At runtime a seeded,
  contiguous growth order decides which pieces light up, so the silhouette grows instead of appearing as dots.
  Lit areas smaller than ~18 px get a pulsing ring, so microstates are always visible.
- **Cities** appear as a point of light among ~10 nearby real towns (decoys). In step 1 all lights are identical; from
  step 2 the target's glow grows and the decoys fade.
- The camera starts on a seeded off-centre view and glides to the lit area in step 3, not earlier.

## Game rules in code

All tunable values live in [`src/game/config.ts`](src/game/config.ts): points per step, lit fractions, XP base,
combo step and cap, golden multiplier, level curve, epoch date (Daily #1 = 2026-10-23) and difficulty tiers.

- **Daily selection** (`src/game/selection.ts`): targets are ranked easiest → hardest and split into five tiers.
  Each tier is walked through a seeded permutation (`daily:<mode>:tier<k>:cycle<c>`), one target per day, so every
  player gets the same five targets on a UTC date, a target never repeats on consecutive days, and any date can be
  computed offline. The reset is at midnight UTC.
- **Name matching** (`src/game/matching.ts`): normalisation (case, spaces, punctuation, diacritics, "St." → "Saint",
  leading "The"), exact match on names and alternatives, then Levenshtein ≤ 1 for names of ≥ 5 characters. Unknown
  names are reported and not counted. Shared names (Valencia, Córdoba, Congo) are clarified in the suggestion list,
  and either spelling counts if it names the answer.
- **XP** = 20 × points/100 × combo × (2 if golden). Combo = 1 + ⌊streak/3⌋, capped at 5; a lost question resets it.
  Level *n → n+1* needs 60 + 30·(n−1) XP.

## Data

Everything is bundled; nothing is fetched from third parties at runtime. Sources, licenses and the fetch date are
listed in [`src/data/SOURCES.md`](src/data/SOURCES.md) and on the in-game Credits page.

| Source | Used for | License |
| --- | --- | --- |
| world-countries (mledoze/countries) | names, ISO codes, region, languages, currencies, borders, area, capitals | ODbL |
| Natural Earth via world-atlas | country shapes, world map; population estimate for ranking only | Public domain |
| GeoNames via all-the-cities | city coordinates, decoys; population for ranking only | CC BY 4.0 |
| flag-icons | flag colors (extracted) and flag images after the reveal | MIT |

### Updating the data

```bash
npm run data      # build-countries → build-flags → build-pieces → build-cities → build-world
npm test          # data-quality tests: completeness, symmetric borders, coordinates, no population in clues
```

The Natural Earth admin-0 GeoJSON (for population estimates) is downloaded once into `scripts/.cache/`.

### Difficulty ranking

- **Countries:** `0.55·z(log population) + 0.45·z(log area) + 1.2 if in a hand-picked "well known" list`.
  Ranks 1–30 feed question 1, …, the smallest and least known states feed question 5. Every country has six
  meaningful clues (island nations get "nearest across the sea" instead of neighbours), so no question is unfair.
- **Cities:** `log10(population) + 0.5 if capital + 1.1 × fame (0–2)`, where fame is hand-assigned.
- Population is never written to the shipped JSON and never appears in the UI; a unit test checks this.

### Special cases and choices

- **Targets:** the 193 UN members, Vatican City, plus **Kosovo, Palestine and Taiwan** (widely recognised as
  separate geographic entities; included without taking a political position).
- **Merged geometry:** Somaliland is part of Somalia and Northern Cyprus part of Cyprus (internationally recognised
  borders). Western Sahara is not a target and is shown as a neighbour of Morocco and Mauritania.
- **Transcontinental:** Russia, Turkey, Kazakhstan, Azerbaijan and Georgia are "Europe and Asia"; Egypt is "Africa and
  Asia". Practice mode files them under their first continent.
- **Borders** come from world-countries with two corrections: China's list excludes Hong Kong and Macau, and Sri Lanka
  has no land border with India (the dataset listed one). A test checks that all borders are symmetric.
  Territories of other states keep their sovereign in brackets, e.g. "French Guiana (France)".
- **Island nations** show the three nearest countries across the sea, measured between the main landmasses.
- **Vatican City** collapses to a sliver in the 1:10m TopoJSON, so it uses a hand-traced outline of its walls.
- **Currencies** are shown without the demonym for a country's own currency ("Swedish · Krona"); foreign currencies keep
  their full name ("US dollar"). Bulgaria uses the euro since 1 January 2026; Zimbabwe uses the ZiG.
- **Flag colors** are extracted by rasterising each flag, snapping pixels to nine named colors and dropping colors
  under 2.5 % of the flag, ordered by first appearance reading left-to-right, top-to-bottom. All 197 results were
  reviewed and 47 corrected by hand (`FLAG_OVERRIDES` in `scripts/build-flags.mjs`).
- **Hong Kong** is a city target in China (a special administrative region), so its clues are China's.
- **Facts:** one hand-written sentence per country and for most cities; cities where no fact could be verified
  confidently have none.

## Extending

- **Add a city:** add a line to `scripts/data/cities-curated.mjs` (`[name, ISO2, GeoNames name or null, alternative
  names, fame 0–2, fact or null]`) and run `node scripts/build-cities.mjs`.
- **Add a country/territory:** add its `cca3` to `EXTRA` in `scripts/build-countries.mjs`, provide overrides
  (language, currency, alt names) if needed, run `npm run data`, and add a fact to `src/data/country-facts.json`.
- **Add an alternative name:** `ALT` in `build-countries.mjs` (countries) or the alt list in `cities-curated.mjs`.
- **Add or change a clue type:** add a `ClueKind` in `src/game/types.ts`, produce it in `src/game/clues.ts`, and
  update the order tests in `tests/engine.test.ts`. The UI renders any clue with a label and text (and optional swatches).
- **Change scoring or pacing:** edit `src/game/config.ts`.

## Privacy

No accounts, cookies, analytics or third-party requests. Progress is stored in `localStorage` only.

## Licenses

Code: MIT. Data: see the table above (ODbL for world-countries data, CC BY 4.0 for GeoNames, public domain for
Natural Earth, MIT for flag-icons). Fonts: Unbounded, Instrument Sans, Martian Mono (SIL OFL) via Fontsource.
