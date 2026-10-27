import { useEffect, useRef, useState } from 'preact/hooks';
import { AtlasCanvas } from './AtlasCanvas';
import { IconArrow, IconBolt, IconCheck, IconFire, IconLayers, IconStar } from './Icons';
import type { AtlasView } from '../map/AtlasView';
import { CONTINENTS } from '../data/continents';
import { SATELLITE } from '../map/satellite';
import { POINTS_BY_STEP, QUESTIONS_PER_ROUND, SEARCH_KM_BY_STEP, VIEW_KM_BY_STEP } from '../game/config';
import { dailyNumber, formatCountdown, utcDateKey } from '../game/dates';
import { visibleStreak } from '../game/progress';
import { offsetKm } from '../game/reveal';
import { levelFromXp } from '../game/scoring';
import { useCountdown } from '../lib/countdown';
import { navigate } from '../lib/router';
import { saveStore } from '../lib/storage';
import { useStore } from '../lib/store';
import { reducedMotion } from '../lib/theme';

/** Demo area for the landing page: Trondheim, Norway, which is not one of the game's cities. */
const DEMO_CITY: [number, number] = [10.395, 63.43];

function HeroMap() {
  const viewRef = useRef<AtlasView | null>(null);
  const [step, setStep] = useState(1);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (reducedMotion()) {
      setStep(3);
      return;
    }
    const t = setInterval(() => setStep((s) => (s % 6) + 1), 2600);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const radiusKm = VIEW_KM_BY_STEP[step - 1] / 2;
    const win = { center: offsetKm(DEMO_CITY, radiusKm * 0.2, 3.6), radiusKm };
    const r = SEARCH_KM_BY_STEP[step - 1];
    const search = r > 0 ? { center: offsetKm(DEMO_CITY, r * 0.45, 0.8), radiusKm: r } : null;
    v.setScene({ bounds: win, search, pin: null });
    if (step === 1) v.fitCircle(win);
    else v.frameCircle(win, 1100);
  }, [step, ready]);
  return (
    <div class="hero-map">
      <AtlasCanvas
        class="map"
        label="Example: a real map that opens up step by step around a hidden city"
        interactive={false}
        onReady={(v) => {
          viewRef.current = v;
          setReady(true);
        }}
      />
      <span class="demo-tag" aria-hidden="true">
        <strong>Step {step}</strong> · map {VIEW_KM_BY_STEP[step - 1].toLocaleString('en')} km wide
      </span>
    </div>
  );
}

function PlayCard() {
  const save = useStore(saveStore);
  const today = utcDateKey();
  const done = save.daily[today];
  const cur = save.current && save.current.dateKey === today ? save.current : null;
  const streak = visibleStreak(save.streak, today);
  const status = done
    ? `Done today · ${done.score} points`
    : cur
      ? `${cur.results.length} of ${QUESTIONS_PER_ROUND} cities played`
      : `${QUESTIONS_PER_ROUND} new cities today`;
  return (
    <a class={`play-card${done ? ' done' : ''}`} href={done ? '#/results' : '#/play'}>
      <span class="pc-icon">{done ? <IconCheck /> : <IconArrow />}</span>
      <span style={{ minWidth: 0 }}>
        <span class="pc-title">
          {done ? 'See today’s result' : cur ? 'Continue today’s round' : `Play Daily #${dailyNumber(today)}`}
        </span>
        <br />
        <span class="pc-sub">{status}</span>
      </span>
      <span class="pc-status">
        <span class={`chip${streak ? ' chip-gold' : ''}`} title="Daily streak">
          <IconFire class="icon" style={{ width: '14px', height: '14px' }} />
          <strong class="mono">{streak}</strong>
        </span>
      </span>
    </a>
  );
}

const STEPS_INFO = [
  ['Continent', 'Europe'],
  ['Country’s language · Currency', 'Norwegian · Krone'],
  ['Country’s flag colors', 'Red, White, Blue'],
  ['City name', 'T · 9 letters'],
  ['Country name', 'N · 6 letters'],
  ['Country’s neighbors', 'Finland, Sweden, Russia'],
];

const FAQ: [string, string][] = [
  [
    'What is Map in the Dark?',
    'A daily city geography game. You see a real map around a hidden city. Each step shows more of the map and gives a new clue. Name the city in as few steps as you can.',
  ],
  [
    'What is on the map?',
    SATELLITE
      ? 'Real satellite images of the area around the city, with country borders drawn on top. Place names are hidden. The map zooms out each step; from step 3 a green circle marks where the city is.'
      : 'Coastlines, lakes, rivers, built-up areas, main roads, railways, borders and towns from Natural Earth and GeoNames. Place names are hidden. The map zooms out each step; from step 3 a green circle marks where the city is.',
  ],
  ['When does a new round start?', 'Every day at midnight UTC. Everyone gets the same five cities on the same day.'],
  [
    'How is my score calculated?',
    `A correct guess in step 1 gives ${POINTS_BY_STEP[0]} points, then ${POINTS_BY_STEP.slice(1).join(', ')} for steps 2 to 6. A wrong guess in step 6 reveals the answer and gives 0. A perfect round is 500.`,
  ],
  [
    'What are combos and golden cities?',
    'Answer correctly several times in a row to raise your combo multiplier (one step for every three in a row, up to ×5). One city per round is golden and gives double XP. Missing a city resets the combo.',
  ],
  [
    'Do I have to spell names perfectly?',
    'No. Case, spaces and accents don’t matter, one small typo is forgiven for longer names, and common alternatives work, such as Bombay, Peking, Saigon, Kiev or New York.',
  ],
  [
    'Is my data stored anywhere?',
    'Only in your own browser. There are no accounts, no tracking and nothing is sent to a server. You can reset everything in Settings.',
  ],
  [
    'Can I play more than once a day?',
    'Yes. After the daily round you can play unlimited bonus rounds, or practice one continent at a time.',
  ],
];

export function Landing() {
  const save = useStore(saveStore);
  const lvl = levelFromXp(save.xp);
  const ms = useCountdown();
  return (
    <div class="page">
      <section class="hero" aria-labelledby="hero-h">
        <div class="hero-copy">
          <div class="eyebrow">
            Daily #{dailyNumber(utcDateKey())} · {QUESTIONS_PER_ROUND} cities · 6 clues each
          </div>
          <h1 id="hero-h">
            Which city is <em>hiding</em> on the map?
          </h1>
          <p class="lede">
            You start with a small piece of a real map. Every step shows more of it and gives you a new clue. Type the
            city’s name. The fewer steps you need, the more points you score.
          </p>
          <div class="play-grid">
            <PlayCard />
          </div>
          <div class="hero-meta">
            <a class="chip" href="#/stats" style={{ textDecoration: 'none' }}>
              <IconStar class="icon" style={{ width: '14px', height: '14px' }} /> Level{' '}
              <strong class="mono">{lvl.level}</strong>
            </a>
            <a class="chip" href={`#/bonus?r=${Date.now().toString(36)}`} style={{ textDecoration: 'none' }}>
              <IconBolt class="icon" style={{ width: '14px', height: '14px' }} /> Bonus round
            </a>
            <a class="chip" href="#/practice" style={{ textDecoration: 'none' }}>
              <IconLayers class="icon" style={{ width: '14px', height: '14px' }} /> Practice
            </a>
          </div>
          <p class="countdown">
            Next daily round in <span class="mono">{formatCountdown(ms)}</span>
          </p>
        </div>
        <HeroMap />
      </section>

      <section class="section" aria-labelledby="how-h">
        <div class="section-head">
          <h2 id="how-h">How it works</h2>
          <p>
            Each city starts with a satellite close-up of its centre, about {VIEW_KM_BY_STEP[0]} km across. A wrong
            guess or “I don’t know” zooms the map out and gives the next clue. By step 6 you see{' '}
            {VIEW_KM_BY_STEP[5].toLocaleString('en')} km of the continent. From step 3 a green circle marks where the
            city is.
          </p>
        </div>
        <ol class="step-list" aria-label="The six steps of a question">
          {STEPS_INFO.map(([t, d], i) => (
            <li key={i}>
              <span class="n">{i + 1}</span>
              <span>
                <span class="t">{t}</span>
                <br />
                <span class="d">
                  Map {VIEW_KM_BY_STEP[i].toLocaleString('en')} km wide · e.g. {d}
                </span>
              </span>
              <span class="pts">{POINTS_BY_STEP[i]} pts</span>
            </li>
          ))}
        </ol>
      </section>

      <section class="section" aria-labelledby="practice-h" id="practice">
        <div class="section-head">
          <h2 id="practice-h">Practice one continent</h2>
          <p>Free play with full XP.</p>
        </div>
        <PracticePicker />
      </section>

      <section class="section faq" aria-labelledby="faq-h">
        <div class="section-head">
          <h2 id="faq-h">Questions</h2>
        </div>
        {FAQ.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </section>
    </div>
  );
}

export function PracticePicker() {
  return (
    <div class="continent-grid">
      {CONTINENTS.map((c) => (
        <button
          key={c}
          class="btn"
          style={{ justifyContent: 'space-between' }}
          onClick={() => navigate(`/practice/${encodeURIComponent(c)}?r=${Date.now().toString(36)}`)}
        >
          {c} <span aria-hidden="true">→</span>
        </button>
      ))}
    </div>
  );
}
