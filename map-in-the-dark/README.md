# Map in the Dark

A daily city geography game. You see a real map around a hidden city; every step opens the map further and
gives a new clue. Name the city in as few steps as you can.

- **One daily round of 5 cities × 6 steps.** The visible map grows from 70 km to 1,400 km across; a green circle,
  shrinking each step, always contains the city.
- **Satellite maps** from a commercial imagery provider (Esri, MapTiler or Mapbox, chosen with an environment variable),
  without labels. Without a provider key the game uses its bundled Natural Earth map (coastlines, lakes, rivers,
  built-up areas, roads, railways, borders and towns), so it always works.
- **Type your answer** with tolerant matching (case, spaces, accents, one typo, exonyms such as Bombay, Peking,
  Saigon, Kiev, New York).
- **Rewards:** points per step (100/80/60/45/30/20), XP, combo ×1–×5, a golden city with 2× XP, levels, streaks.
- **Unlimited bonus rounds** and **practice per continent**.
- **Static site:** no backend and no tracking. With satellite imagery the map needs a connection; the bundled map works
  offline after the first visit (service worker).

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
| `npm run data` | Rebuild all game data and map tiles (see below) |
| `npm run images` | Regenerate favicon, app icons and the Open Graph image |
| `npm run qa` | Play full rounds in Chromium with Playwright and save screenshots to `qa-screens/` (run after `build`) |
| `npm run qa:imagery` | Check the satellite layer with a mock imagery provider |

## Satellite imagery

The map shows satellite images when the build has an imagery provider and key. Set these environment variables
(see `.env.example`); they are read at build time:

| Variable | Value |
| --- | --- |
| `VITE_MAP_PROVIDER` | `esri`, `maptiler`, `mapbox` or `custom` |
| `VITE_MAP_KEY` | API key / access token from the provider |
| `VITE_MAP_URL` | `custom` only: XYZ template with `{z}`, `{x}`, `{y}` and optionally `{key}` |
| `VITE_MAP_ATTRIBUTION` | `custom` only: the attribution text the provider requires |

| Provider | Imagery | Commercial use | Account |
| --- | --- | --- | --- |
| **Esri** (recommended) | World Imagery (Maxar, Earthstar Geographics) | Yes, with “Powered by Esri” attribution (shown on the map) | Free ArcGIS Location Platform account, API key with the *Basemaps* privilege; free monthly tile allowance, then pay-as-you-go |
| **MapTiler** | Satellite | Yes on a paid plan; check the plan's terms | MapTiler Cloud account, API key |
| **Mapbox** | Satellite | Yes, with attribution | Mapbox account, public access token; free monthly allowance, then pay-as-you-go |

Check each provider's current pricing and terms before launch. Google Maps satellite tiles need the Map Tiles API with
session tokens and are not supported out of the box.

The key is embedded in the website (all browser map keys are). **Restrict it to your domain** in the provider's
dashboard (Esri: *Referrers*; MapTiler: *Allowed HTTP origins*; Mapbox: *URL restrictions*). If the provider rejects the
key, the map automatically falls back to the bundled map. The required attribution is drawn on the map and listed on
the Credits page; the Privacy page explains that the images are loaded from the provider.

`npm run qa:imagery` tests the imagery layer without a real provider: it builds with a mock provider and renders mock
satellite tiles from the bundled data, so overlays (pin, circles, borders) can be checked for alignment.

## Deploy

The build is a static folder with relative paths and hash routing (`#/play`), so it can be served from any path on any
static host. `netlify.toml` and `vercel.json` are included.

**Netlify**
1. Add new site → Import from Git → choose this repository and branch.
2. Base directory: `map-in-the-dark`. Build command: `npm run build`. Publish directory: `map-in-the-dark/dist`.
3. Site configuration → Environment variables: add `VITE_MAP_PROVIDER` and `VITE_MAP_KEY`.
4. Deploy, then add the site's domain to the key's allowed referrers.

**Vercel**
1. Add New Project → import the repository.
2. Root Directory: `map-in-the-dark` (framework is detected as Vite).
3. Environment Variables: add `VITE_MAP_PROVIDER` and `VITE_MAP_KEY`.
4. Deploy, then add the domain to the key's allowed referrers.

After changing an environment variable, redeploy so the build picks it up.

## How the map works

- With a provider configured, `src/map/satellite.ts` loads labeled-free satellite tiles (Web Mercator XYZ) and
  `AtlasView` draws them, using lower-zoom tiles as placeholders while sharper ones load. Country borders from Natural
  Earth are drawn on top.

- `scripts/build-tiles.mjs` cuts the Natural Earth 1:10m layers into 10° × 10° tiles (`public/data/tiles/{x}_{y}.json`),
  only where a city's map can reach: 272 tiles, about 12 MB raw / 4.5 MB gzipped in total, roughly 300 KB per city.
  Geometry is clipped, simplified (~200–600 m tolerance) and stored as delta-encoded integers.
- `src/map/AtlasView.ts` draws the tiles on a 2D canvas in Mercator, with a fog that hides everything outside the
  current window, the green search circle, a scale bar and the answer pin. It redraws only while something moves.
- `src/game/reveal.ts` decides, per question and seed, where the window and the search circle sit. The window is
  centred slightly off the city; the circle contains the city but is offset in a seeded direction, so no single town
  dot gives the answer away early. Sizes are in `src/game/config.ts` (`WINDOW_KM_BY_STEP`, `SEARCH_KM_BY_STEP`).

Without satellite imagery, the bundled Natural Earth map (1:10 million) shows the city's built-up area, main roads,
rivers and coast, but not individual streets.

## Project structure

```
map-in-the-dark/
  index.html            Entry, meta tags, Open Graph/Twitter cards
  public/               Icons, OG image, manifest, flags/, data/tiles/
  scripts/              Data pipeline, map tiles, images and QA (Node)
    data/cities-curated.mjs   Hand-curated city list with exonyms and facts
  src/
    game/               Pure game engine: config, rng, selection, matching, clues, reveal, scoring, round
    map/                Tile loader and canvas atlas renderer
    components/         Preact UI (landing, game, results, stats, settings, pages)
    lib/                Storage, motion preference, sound, haptics, router, progress persistence
    data/               Generated JSON (countries, cities, tile index), SOURCES.md
    styles/             Design tokens (white + green) and component styles
    sw-template.js      Service worker template (filled in at build time)
  tests/                Vitest unit tests
```

## Game rules in code

All tunable values are in [`src/game/config.ts`](src/game/config.ts).

- **Daily selection** (`src/game/selection.ts`): cities are ranked easiest → hardest and split into five tiers. Each
  tier is walked through a seeded permutation, one city per day, so every player gets the same five cities on a UTC
  date, no city repeats on consecutive days, and any date can be computed offline. Daily #1 is 2026-10-23.
- **Clues:** continent; country's language and currency; country's flag colors; first letter and length of the city
  name; first letter and length of the country name; the country's neighbours (or nearest countries across the sea).
- **Name matching** (`src/game/matching.ts`): normalisation, exact match on names and alternatives, then Levenshtein ≤ 1
  for names of ≥ 5 characters. Unknown names are reported and not counted. Shared names (Valencia, Córdoba) are
  clarified in the suggestion list.
- **XP** = 20 × points/100 × combo × (2 if golden). Combo = 1 + ⌊streak/3⌋, capped at 5.

## Data

Everything is bundled; nothing is fetched from other services at runtime. See [`src/data/SOURCES.md`](src/data/SOURCES.md).

| Source | Used for | License |
| --- | --- | --- |
| Natural Earth 1:10m | the map: land, lakes, rivers, urban areas, roads, railways, borders | Public domain |
| GeoNames via all-the-cities | city coordinates, towns on the map; population for ranking only | CC BY 4.0 |
| world-countries (mledoze/countries) | languages, currencies, borders, names for the clues | ODbL |
| flag-icons | flag colors (extracted) and flag images after the reveal | MIT |

```bash
npm run data      # build-countries → build-cities → build-flags → build-tiles
npm test          # includes data-quality tests (coordinates, borders, tiles around every city, no population)
```

Natural Earth GeoJSON layers are downloaded once into `scripts/.cache/` (git-ignored).

**Difficulty:** `log10(population) + 0.5 if capital + 1.1 × fame (0–2, hand-assigned)`. Population is never shipped or
shown. **Special cases:** Hong Kong is a city in China (its clues are China's); Kosovo, Palestine and Taiwan count as
countries for clues; Sri Lanka's dataset border with India is removed (it has none); Bulgaria uses the euro since
2026; Zimbabwe uses the ZiG. Flag colors were extracted automatically and reviewed by hand (47 corrections in
`scripts/build-flags.mjs`).

## Extending

- **Add a city:** add a line to `scripts/data/cities-curated.mjs` (`[name, ISO2, GeoNames name or null, alternative
  names, fame 0–2, fact or null]`), then run `node scripts/build-cities.mjs`, `node scripts/build-flags.mjs` and
  `node --max-old-space-size=6000 scripts/build-tiles.mjs`.
- **Add an alternative name:** the alt list in `cities-curated.mjs`.
- **Add a clue type:** add a `ClueKind` in `src/game/types.ts`, produce it in `src/game/clues.ts`, update the tests.
- **Change pacing:** `WINDOW_KM_BY_STEP`, `SEARCH_KM_BY_STEP` and points in `src/game/config.ts`.
- **Add a map layer:** add the Natural Earth file to `LAYERS` in `scripts/build-tiles.mjs` and draw it in `AtlasView.draw`.

## Licenses

Code: MIT. Data: public domain (Natural Earth), CC BY 4.0 (GeoNames), ODbL (world-countries), MIT (flag-icons).
Fonts: Figtree and IBM Plex Mono (SIL OFL) via Fontsource.
