import { POINTS_BY_STEP } from '../game/config';
import { PracticePicker } from './Landing';

export function About() {
  return (
    <div class="page page-narrow prose">
      <h1>About</h1>
      <p>
        <strong>Map in the Dark</strong> is a daily geography game. Every day there are two rounds — Countries and
        Cities — of five questions each. A question starts on a dark map. Six steps light it up piece by piece, and each
        step adds a clue: the continent, language and currency, the neighbors, the colors of the flag, the first letter
        and length of the name, and finally the names of the neighboring countries.
      </p>
      <h2>Rules in short</h2>
      <ul>
        <li>Type the name of the target. There are no multiple-choice options.</li>
        <li>A wrong guess lights up the next step. A wrong guess in step 6 reveals the answer.</li>
        <li>“I don’t know” skips to the next step without guessing.</li>
        <li>Points per step: {POINTS_BY_STEP.join(', ')}. A perfect round is 500 points.</li>
        <li>Questions get harder through the round. One golden question gives double XP.</li>
        <li>The daily round is the same for everyone and changes at midnight UTC.</li>
      </ul>
      <h2>How the targets are chosen</h2>
      <p>
        Countries are ranked by a familiarity score built from their size and a hand-picked “well known” boost. Cities
        are ranked the same way, with a bonus for capitals and famous cities. Each round takes one target from each of
        five difficulty tiers, from easiest to hardest.
      </p>
      <h2>Practice</h2>
      <p>Free play, one continent at a time:</p>
      <PracticePicker />
    </div>
  );
}

export function Privacy() {
  return (
    <div class="page page-narrow prose">
      <h1>Privacy</h1>
      <p>
        <strong>Map in the Dark collects no personal data.</strong> There are no accounts, no analytics, no advertising,
        no cookies and no tracking of any kind.
      </p>
      <h2>What is stored, and where</h2>
      <p>
        Your progress (XP, streaks, statistics, today’s round) and your settings are stored only in your own browser,
        using localStorage. This data never leaves your device. You can delete it at any time under Settings → Reset
        saved data, or by clearing your browser’s site data.
      </p>
      <h2>Network requests</h2>
      <p>
        All game data, maps, fonts and images are served from this website itself. The game makes no requests to
        third-party services. A service worker caches the game so it works offline.
      </p>
      <h2>Sharing</h2>
      <p>
        Sharing copies a short text with your emoji result to your clipboard or the share sheet of your device. Nothing
        is sent by the game itself.
      </p>
    </div>
  );
}

export function Credits() {
  return (
    <div class="page page-narrow prose">
      <h1>Credits</h1>
      <p>
        All data is bundled with the game at build time; nothing is fetched while you play. Data fetched on 2026-10-23.
      </p>
      <h2>Data sources</h2>
      <ul>
        <li>
          <strong>Natural Earth</strong> — country geometry (1:10m and 1:50m) via the <code>world-atlas</code> package,
          and statistics used only for the internal difficulty ranking. Public domain.{' '}
          <a href="https://www.naturalearthdata.com/" rel="noopener">
            naturalearthdata.com
          </a>
        </li>
        <li>
          <strong>world-countries</strong> (mledoze/countries) — names, ISO codes, regions, languages, currencies, land
          borders and areas. Open Database License (ODbL).{' '}
          <a href="https://github.com/mledoze/countries" rel="noopener">
            github.com/mledoze/countries
          </a>
        </li>
        <li>
          <strong>GeoNames</strong> — city coordinates, decoy towns and ranking statistics, via the{' '}
          <code>all-the-cities</code> package. Creative Commons Attribution 4.0.{' '}
          <a href="https://www.geonames.org/" rel="noopener">
            geonames.org
          </a>
        </li>
        <li>
          <strong>flag-icons</strong> by Panayiotis Lipiridis — flag images shown after each answer, and the source for
          the extracted flag colors. MIT License.{' '}
          <a href="https://github.com/lipis/flag-icons" rel="noopener">
            github.com/lipis/flag-icons
          </a>
        </li>
        <li>
          Hand-curated additions: English display names, main languages, short currency names, alternative names and
          exonyms, transcontinental continents, flag-color corrections and every “Did you know” fact.
        </li>
      </ul>
      <h2>Software</h2>
      <ul>
        <li>d3-geo, d3-delaunay, topojson-client, topojson-simplify (ISC)</li>
        <li>Preact (MIT), Vite (MIT), polygon-clipping (MIT), resvg-js (MPL-2.0, build only)</li>
        <li>Fonts: Unbounded, Instrument Sans and Martian Mono (SIL Open Font License), self-hosted via Fontsource</li>
      </ul>
      <h2>Design</h2>
      <p>The logo, icons, illustrations and sound effects are original and made in code for this game.</p>
    </div>
  );
}

export function PracticePage() {
  return (
    <div class="page page-narrow">
      <h1>Practice</h1>
      <p class="lede">Free play with full XP. Pick a mode and a continent.</p>
      <PracticePicker />
    </div>
  );
}

export function NotFound() {
  return (
    <div class="page lost-page">
      <div>
        <div class="code" aria-hidden="true">
          404
        </div>
        <h1>Lost in the dark</h1>
        <p class="coords mono">00°00′00″N 00°00′00″E · Null Island · nothing here</p>
        <a class="btn btn-primary" href="#/">
          Back to the map
        </a>
      </div>
    </div>
  );
}
