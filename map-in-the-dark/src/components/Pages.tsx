import { POINTS_BY_STEP, WINDOW_KM_BY_STEP } from '../game/config';
import { PracticePicker } from './Landing';

export function About() {
  return (
    <div class="page page-narrow prose">
      <h1>How to play</h1>
      <p>
        Every day there are five hidden cities. For each one you see a real map of its surroundings: coastlines, lakes,
        rivers, built-up areas, roads, railways, borders and towns, but no names. The hidden city is always inside the
        green circle.
      </p>
      <h2>Six steps</h2>
      <ol>
        <li>Continent · map {WINDOW_KM_BY_STEP[0] * 2} km across</li>
        <li>The country’s language and currency · {WINDOW_KM_BY_STEP[1] * 2} km</li>
        <li>The colors of the country’s flag · {WINDOW_KM_BY_STEP[2] * 2} km</li>
        <li>First letter and length of the city’s name · {WINDOW_KM_BY_STEP[3] * 2} km</li>
        <li>First letter and length of the country’s name · {WINDOW_KM_BY_STEP[4] * 2} km</li>
        <li>The country’s neighbors · {WINDOW_KM_BY_STEP[5] * 2} km</li>
      </ol>
      <h2>Rules</h2>
      <ul>
        <li>Type the city’s name. There are no multiple-choice options.</li>
        <li>
          A wrong guess opens the map further and gives the next clue. A wrong guess in step 6 reveals the answer.
        </li>
        <li>“I don’t know” moves to the next step without guessing.</li>
        <li>Points per step: {POINTS_BY_STEP.join(', ')}. A perfect round is 500 points.</li>
        <li>Cities get less famous through the round. One golden city gives double XP.</li>
        <li>The daily round is the same for everyone and changes at midnight UTC.</li>
      </ul>
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
        Your progress (XP, streak, statistics, today’s round) and your settings are stored only in your own browser,
        using localStorage. This data never leaves your device. You can delete it at any time under Settings, or by
        clearing your browser’s site data.
      </p>
      <h2>Network requests</h2>
      <p>
        All game data, maps, fonts and images are served from this website itself. The game makes no requests to
        third-party services.
      </p>
      <h2>Sharing</h2>
      <p>Sharing copies a short text with your emoji result. Nothing is sent by the game itself.</p>
    </div>
  );
}

export function Credits() {
  return (
    <div class="page page-narrow prose">
      <h1>Credits</h1>
      <p>
        All data is bundled with the game at build time; nothing is fetched from other services while you play. Data
        fetched on 2026-10-23.
      </p>
      <h2>Map and data sources</h2>
      <ul>
        <li>
          <strong>Natural Earth</strong> 1:10m — land, lakes, rivers, urban areas, roads, railways, country and province
          borders. Public domain.{' '}
          <a href="https://www.naturalearthdata.com/" rel="noopener">
            naturalearthdata.com
          </a>
        </li>
        <li>
          <strong>GeoNames</strong> — city coordinates and the towns shown as dots, via the <code>all-the-cities</code>{' '}
          package. Creative Commons Attribution 4.0.{' '}
          <a href="https://www.geonames.org/" rel="noopener">
            geonames.org
          </a>
        </li>
        <li>
          <strong>world-countries</strong> (mledoze/countries) — country names, languages, currencies and borders used
          in the clues. Open Database License (ODbL).{' '}
          <a href="https://github.com/mledoze/countries" rel="noopener">
            github.com/mledoze/countries
          </a>
        </li>
        <li>
          <strong>flag-icons</strong> by Panayiotis Lipiridis — flag images after each answer and the source for the
          extracted flag colors. MIT License.{' '}
          <a href="https://github.com/lipis/flag-icons" rel="noopener">
            github.com/lipis/flag-icons
          </a>
        </li>
        <li>Hand-curated: the city list, English names and alternative spellings, and every “Did you know” fact.</li>
      </ul>
      <h2>Software and fonts</h2>
      <ul>
        <li>Preact, Vite (MIT), polygon-clipping (MIT); resvg-js (MPL-2.0, build only)</li>
        <li>Fonts: Figtree and IBM Plex Mono (SIL Open Font License), self-hosted via Fontsource</li>
      </ul>
      <p>The logo, icons and sound effects are original and made in code for this game.</p>
    </div>
  );
}

export function PracticePage() {
  return (
    <div class="page page-narrow">
      <h1>Practice</h1>
      <p class="lede">Free play with full XP. Pick a continent.</p>
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
        <h1>This page is off the map</h1>
        <p class="coords mono">0°00′N 0°00′E · nothing here</p>
        <a class="btn btn-primary" href="#/">
          Back to the start
        </a>
      </div>
    </div>
  );
}
