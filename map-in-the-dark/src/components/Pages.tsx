import { POINTS_BY_STEP, VIEW_KM_BY_STEP } from '../game/config';
import { PracticePicker } from './Landing';
import { FALLBACK, SATELLITE } from '../map/satellite';

export function About() {
  return (
    <div class="page page-narrow prose">
      <h1>How to play</h1>
      <p>
        Every day there are five hidden European capitals. For each one you start with a satellite close-up of its
        centre, without any names. Each step zooms the map out and gives a new clue; from step 3 a green circle marks
        where the capital is.
      </p>
      <h2>Six steps</h2>
      <ol>
        <li>A deep cut from history · map {VIEW_KM_BY_STEP[0].toLocaleString('en')} km across</li>
        <li>Someone from the city · {VIEW_KM_BY_STEP[1].toLocaleString('en')} km</li>
        <li>Pop culture or an event · {VIEW_KM_BY_STEP[2].toLocaleString('en')} km</li>
        <li>Famous history · {VIEW_KM_BY_STEP[3].toLocaleString('en')} km</li>
        <li>A landmark or tradition · {VIEW_KM_BY_STEP[4].toLocaleString('en')} km</li>
        <li>Almost a giveaway · {VIEW_KM_BY_STEP[5].toLocaleString('en')} km</li>
      </ol>
      <h2>Rules</h2>
      <ul>
        <li>Type the capital’s name. There are no multiple-choice options.</li>
        <li>
          A wrong guess opens the map further and gives the next clue. A wrong guess in step 6 reveals the answer.
        </li>
        <li>“I don’t know” moves to the next step without guessing.</li>
        <li>Points per step: {POINTS_BY_STEP.join(', ')}. A perfect round is 500 points.</li>
        <li>Capitals get less famous through the round. One golden capital gives double XP.</li>
        <li>The daily round is the same for everyone and changes at midnight UTC.</li>
      </ul>
      <h2>Practice</h2>
      <p>Free play with all European capitals:</p>
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
      {SATELLITE?.external ? (
        <p>
          The game data, fonts and images are served from this website itself. The satellite images on the map are
          loaded from our imagery provider ({SATELLITE.attribution}). Like any website, the provider receives your IP
          address and the page address when your browser downloads the images. Nothing else is sent.
        </p>
      ) : (
        <p>
          All game data, maps, fonts and images are served from this website itself. The game makes no requests to
          third-party services.
        </p>
      )}
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
        The game data is bundled with the game at build time
        {SATELLITE?.external ? '; the satellite images are loaded from the imagery provider while you play' : ''}. Data
        fetched on 2026-10-23.
      </p>
      <h2>Map and data sources</h2>
      <ul>
        {(SATELLITE?.id === 'local' || FALLBACK) && (
          <li>
            <strong>Satellite imagery</strong>: ESA WorldCover Sentinel-2 RGBNIR yearly median composite 2021 (10 m), ©
            ESA WorldCover project, contains modified Copernicus Sentinel data (2021) processed by the ESA WorldCover
            consortium. Creative Commons Attribution 4.0. Colours adjusted and water areas recoloured for the game.
            {FALLBACK ? ' Used when the online imagery is unavailable.' : ''}{' '}
            <a href="https://esa-worldcover.org/" rel="noopener">
              esa-worldcover.org
            </a>
          </li>
        )}
        {SATELLITE?.external && (
          <li>
            <strong>Satellite imagery</strong>: {SATELLITE.attribution}.
          </li>
        )}
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
        <li>
          Hand-written: the clues for every capital, the list of capitals, English names and alternative spellings, and
          every “Did you know” fact.
        </li>
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
      <p class="lede">Free play with full XP.</p>
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
