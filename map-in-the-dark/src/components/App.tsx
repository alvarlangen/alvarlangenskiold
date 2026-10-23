import { useEffect } from 'preact/hooks';
import { Header, Footer } from './Header';
import { Landing } from './Landing';
import { lazy, Suspense } from 'preact/compat';
import { Stats } from './Stats';
import { Settings } from './Settings';
import { About, Credits, NotFound, PracticePage, Privacy } from './Pages';
import { LevelUpModal, Toasts } from './Overlays';
import { CONTINENTS } from '../data/continents';
import type { Mode } from '../game/types';
import { useRoute } from '../lib/router';

// The game, its data and the results view load on demand so the landing page stays light.
const Game = lazy(() => import('./Game').then((m) => m.Game));
const DailyResults = lazy(() => import('./Results').then((m) => m.DailyResults));

const MODES: Mode[] = ['countries', 'cities'];
const TITLES: Record<string, string> = {
  stats: 'Stats',
  settings: 'Settings',
  about: 'About',
  privacy: 'Privacy',
  credits: 'Credits',
  practice: 'Practice',
};

export function App() {
  const route = useRoute();
  const [path, query] = route.split('?');
  const parts = path.split('/').filter(Boolean);
  const [a, b, c] = parts;

  useEffect(() => {
    window.scrollTo(0, 0);
    const name = a
      ? (TITLES[a] ??
        (a === 'play' || a === 'bonus' || a === 'practice' ? 'Play' : a === 'results' ? 'Results' : 'Not found'))
      : '';
    document.title = name ? `${name} · Map in the Dark` : 'Map in the Dark — a daily geography game';
  }, [path]);

  let view;
  let isGame = false;
  const mode = MODES.includes(b as Mode) ? (b as Mode) : null;
  if (!a) view = <Landing />;
  else if (a === 'play' && mode && !c) {
    view = <Game key={`daily-${mode}`} mode={mode} kind="daily" />;
    isGame = true;
  } else if (a === 'bonus' && mode && !c) {
    view = <Game key={`bonus-${mode}-${query}`} mode={mode} kind="bonus" />;
    isGame = true;
  } else if (a === 'practice' && mode && c && (CONTINENTS as readonly string[]).includes(decodeURIComponent(c))) {
    view = (
      <Game key={`practice-${mode}-${c}-${query}`} mode={mode} kind="practice" continent={decodeURIComponent(c)} />
    );
    isGame = true;
  } else if (a === 'practice' && !b) view = <PracticePage />;
  else if (a === 'results' && mode) view = <DailyResults mode={mode} />;
  else if (a === 'stats') view = <Stats />;
  else if (a === 'settings') view = <Settings />;
  else if (a === 'about') view = <About />;
  else if (a === 'privacy') view = <Privacy />;
  else if (a === 'credits') view = <Credits />;
  else view = <NotFound />;

  return (
    <>
      <a class="skip-link" href="#main" onClick={(e) => (e.preventDefault(), document.getElementById('main')?.focus())}>
        Skip to content
      </a>
      {!isGame && <Header />}
      <main id="main" tabIndex={-1} style={{ outline: 'none' }}>
        <Suspense
          fallback={
            <div class="map-loading" style={{ position: 'fixed' }}>
              Loading…
            </div>
          }
        >
          {view}
        </Suspense>
      </main>
      {!isGame && <Footer />}
      <Toasts />
      <LevelUpModal />
    </>
  );
}
