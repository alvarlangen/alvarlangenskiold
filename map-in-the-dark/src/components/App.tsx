import { useEffect } from 'preact/hooks';
import { lazy, Suspense } from 'preact/compat';
import { Header, Footer } from './Header';
import { Landing } from './Landing';
import { Stats } from './Stats';
import { Settings } from './Settings';
import { About, Credits, NotFound, PracticePage, Privacy } from './Pages';
import { LevelUpModal, Toasts } from './Overlays';
import { CONTINENTS } from '../data/continents';
import { useRoute } from '../lib/router';

// The game, its data and the results view load on demand so the landing page stays light.
const Game = lazy(() => import('./Game').then((m) => m.Game));
const DailyResults = lazy(() => import('./Results').then((m) => m.DailyResults));

const TITLES: Record<string, string> = {
  stats: 'Stats',
  settings: 'Settings',
  about: 'How to play',
  privacy: 'Privacy',
  credits: 'Credits',
  practice: 'Practice',
  play: 'Play',
  bonus: 'Bonus round',
  results: 'Results',
};

export function App() {
  const route = useRoute();
  const [path, query] = route.split('?');
  const [a, b] = path.split('/').filter(Boolean);

  useEffect(() => {
    window.scrollTo(0, 0);
    const name = a ? (TITLES[a] ?? 'Not found') : '';
    document.title = name ? `${name} · Map in the Dark` : 'Map in the Dark';
  }, [path]);

  let view;
  let isGame = false;
  const continent = b ? decodeURIComponent(b) : '';
  if (!a) view = <Landing />;
  else if (a === 'play' && !b) {
    view = <Game key="daily" kind="daily" />;
    isGame = true;
  } else if (a === 'bonus' && !b) {
    view = <Game key={`bonus-${query}`} kind="bonus" />;
    isGame = true;
  } else if (a === 'practice' && (CONTINENTS as readonly string[]).includes(continent)) {
    view = <Game key={`practice-${continent}-${query}`} kind="practice" continent={continent} />;
    isGame = true;
  } else if (a === 'practice' && !b) view = <PracticePage />;
  else if (a === 'results' && !b) view = <DailyResults />;
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
