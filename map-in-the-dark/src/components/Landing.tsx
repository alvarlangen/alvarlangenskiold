import { useEffect, useState } from 'preact/hooks';
import { MapCanvas } from './MapCanvas';
import { useCountdown } from '../lib/countdown';
import { IconBolt, IconCheck, IconCity, IconFire, IconFlag, IconGlobe, IconLayers, IconStar } from './Icons';
import { CONTINENTS } from '../data/continents';
import LIGHTS from '../data/lights.json';
import { POINTS_BY_STEP, QUESTIONS_PER_ROUND } from '../game/config';
import { dailyNumber, formatCountdown, utcDateKey } from '../game/dates';
import { visibleStreak } from '../game/progress';
import { levelFromXp } from '../game/scoring';
import { modeLabel } from '../game/share';
import type { Mode } from '../game/types';
import { navigate } from '../lib/router';
import { saveStore } from '../lib/storage';
import { useStore } from '../lib/store';
import { reducedMotion } from '../lib/theme';

function useStatus(mode: Mode) {
  const save = useStore(saveStore);
  const today = utcDateKey();
  const m = save.modes[mode];
  const done = m.daily[today];
  const cur = m.current && m.current.dateKey === today ? m.current : null;
  const streak = visibleStreak(m.streak, today);
  if (done) return { done: true, text: `Done · ${done.score} pts`, streak };
  if (cur) return { done: false, text: `${cur.results.length} of ${QUESTIONS_PER_ROUND}`, streak };
  return { done: false, text: 'New today', streak };
}

function PlayCard({ mode }: { mode: Mode }) {
  const st = useStatus(mode);
  const Icon = mode === 'countries' ? IconFlag : IconCity;
  return (
    <a class={`play-card${st.done ? ' done' : ''}`} href={st.done ? `#/results/${mode}` : `#/play/${mode}`}>
      <span class="pc-icon">{st.done ? <IconCheck /> : <Icon />}</span>
      <span>
        <span class="pc-title">Play {modeLabel(mode)}</span>
        <br />
        <span class="pc-sub">
          {modeLabel(mode)}: {st.done ? 'done' : st.text.toLowerCase()}
        </span>
      </span>
      <span class="pc-status">
        <span class={`chip${st.streak ? ' chip-gold' : ''}`} title="Daily streak">
          <IconFire class="icon" style={{ width: '14px', height: '14px' }} />
          <strong class="mono">{st.streak}</strong>
        </span>
      </span>
    </a>
  );
}

// "How it works" demo: an abstract blob of hex cells that lights up over six steps.
const HEX: [number, number][] = [];
for (let q = -4; q <= 4; q++)
  for (let r = -3; r <= 3; r++) {
    const x = q * 1.5;
    const y = (r + q / 2) * Math.sqrt(3);
    const d = Math.hypot(x * 0.8, y);
    if (d < 5.6 + Math.sin(q * 1.7 + r) * 0.9) HEX.push([x, y]);
  }
const START: [number, number] = [-3, 1];
const HEX_ORDER = HEX.map((p, i) => ({ i, d: Math.hypot(p[0] - START[0], p[1] - START[1]) + ((i * 37) % 10) / 14 }))
  .sort((a, b) => a.d - b.d)
  .map((x) => x.i);
// viewBox that fits every cell (radius 0.92) with a small margin.
const HEX_BOX = (() => {
  const xs = HEX.map((p) => p[0]);
  const ys = HEX.map((p) => p[1] - 1.6);
  const m = 1.1;
  const x0 = Math.min(...xs) - m;
  const y0 = Math.min(...ys) - m;
  return `${x0} ${y0} ${Math.max(...xs) + m - x0} ${Math.max(...ys) + m - y0 + 2.6}`;
})();
const hexPath = (cx: number, cy: number, s: number) =>
  Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 3) * k;
    return `${(cx + s * Math.cos(a)).toFixed(2)},${(cy + s * Math.sin(a)).toFixed(2)}`;
  }).join(' ');

const DEMO_STEPS = [
  { t: 'Continent', d: 'Europe' },
  { t: 'Language · Currency', d: 'Swedish · Krona' },
  { t: 'Neighbors', d: '2 neighboring countries' },
  { t: 'Flag colors', d: 'Blue, Yellow' },
  { t: 'First letter · Length', d: 'S · 6 letters' },
  { t: 'Neighboring countries', d: 'Finland, Norway' },
];
const FRACTIONS = [0.12, 0.28, 0.46, 0.66, 0.84, 1];

function HowDemo() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (reducedMotion()) {
      setStep(2);
      return;
    }
    const t = setInterval(() => setStep((s) => (s + 1) % 7), 1700);
    return () => clearInterval(t);
  }, []);
  const s = Math.min(step, 5);
  const lit = new Set(HEX_ORDER.slice(0, Math.max(1, Math.round(FRACTIONS[s] * HEX.length))));
  return (
    <div class="how">
      <div class="glass demo" aria-hidden="true">
        <svg viewBox={HEX_BOX} preserveAspectRatio="xMidYMin meet">
          {HEX.map(([x, y], i) => (
            <polygon
              key={i}
              class={`demo-cell${lit.has(i) && step < 6 ? ' on' : ''}`}
              points={hexPath(x, y - 1.6, 0.92)}
              stroke-width="0.06"
            />
          ))}
        </svg>
        <div class="demo-clue">
          <span class="step-no">STEP {s + 1}</span>
          <span>
            <strong>{DEMO_STEPS[s].t}:</strong> {DEMO_STEPS[s].d}
          </span>
        </div>
      </div>
      <ol class="step-list" aria-label="The six steps of a question">
        {DEMO_STEPS.map((d, i) => (
          <li key={i} class={i === s && step < 6 ? 'active' : ''}>
            <span class="n">{i + 1}</span>
            <span>
              <span class="t">{d.t}</span>
              <br />
              <span class="d">
                {Math.round(FRACTIONS[i] * 100)}% of the map lit · e.g. {d.d}
              </span>
            </span>
            <span class="pts">{POINTS_BY_STEP[i]} pts</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const FAQ: [string, string][] = [
  [
    'What is Map in the Dark?',
    'A daily geography game. A dark map lights up piece by piece and every step adds a clue. Name the country or city in as few steps as you can.',
  ],
  [
    'When does a new daily round start?',
    'Every day at midnight UTC. Everyone gets the same five targets on the same day, separately for Countries and Cities.',
  ],
  [
    'How is my score calculated?',
    `A correct guess in step 1 gives ${POINTS_BY_STEP[0]} points, then ${POINTS_BY_STEP.slice(1).join(', ')} for steps 2 to 6. A wrong guess in step 6 reveals the answer and gives 0. A perfect round is 500.`,
  ],
  [
    'What are combos and golden questions?',
    'Answer correctly several times in a row to raise your combo multiplier (one step for every three in a row, up to ×5). One question per round is golden and gives double XP. A lost question resets the combo.',
  ],
  [
    'Do I have to spell names perfectly?',
    'No. Case, spaces and accents don’t matter, one small typo is forgiven for longer names, and common alternatives work — USA, UK, Holland, Czech Republic, Ivory Coast, Burma, Bombay, Peking, Saigon and many more.',
  ],
  [
    'Is my data stored anywhere?',
    'Only in your own browser (localStorage). There are no accounts, no tracking and nothing is sent to a server. You can reset everything in Settings.',
  ],
  [
    'Does it work offline?',
    'Yes. After your first visit the game, maps and data are cached on your device, so you can play without a connection.',
  ],
  [
    'Can I play more than once a day?',
    'Yes. After the daily round, start unlimited bonus rounds with full XP, or practice one continent at a time.',
  ],
];

export function Landing() {
  const save = useStore(saveStore);
  const lvl = levelFromXp(save.xp);
  const ms = useCountdown();
  const lights = LIGHTS as [number, number][];
  const today = utcDateKey();
  return (
    <>
      <div class="page">
        <section class="hero" aria-labelledby="hero-h">
          <div class="hero-globe">
            <MapCanvas
              class="map"
              label="A slowly rotating globe with city lights"
              interactive={false}
              autoRotate
              onReady={(v) => {
                v.setView(15, 22, 1);
                v.setScene({ kind: 'ambient', lights });
              }}
            />
          </div>
          <div class="hero-copy">
            <div class="eyebrow">Daily #{dailyNumber(today)} · 5 targets · 6 clues each</div>
            <h1 id="hero-h">
              Find the country hidden <em>in the dark</em>.
            </h1>
            <p class="lede">
              A dark map lights up piece by piece. Every step brings a new clue. Type your guess — the fewer steps you
              need, the more points you score.
            </p>
            <div class="play-grid">
              <PlayCard mode="countries" />
              <PlayCard mode="cities" />
            </div>
            <div class="hero-meta">
              <a class="chip chip-gold" href="#/stats" style={{ textDecoration: 'none' }}>
                <IconStar class="icon" style={{ width: '14px', height: '14px' }} /> Level{' '}
                <strong class="mono">{lvl.level}</strong>
              </a>
              <a class="chip" href={`#/bonus/countries?r=${today}`} style={{ textDecoration: 'none' }}>
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
        </section>

        <section class="section" aria-labelledby="how-h">
          <div class="section-head">
            <div class="eyebrow">How it works</div>
            <h2 id="how-h">Six steps from darkness to daylight</h2>
            <p>
              Each question starts in the dark. In step 1 a first piece lights up together with the first clue. A wrong
              guess or “I don’t know” lights up more of the map and reveals the next clue.
            </p>
          </div>
          <HowDemo />
        </section>

        <section class="section" aria-labelledby="xp-h">
          <div class="section-head">
            <div class="eyebrow">Rewards</div>
            <h2 id="xp-h">Every answer counts</h2>
          </div>
          <div class="features">
            <div class="glass feature">
              <div class="f-icon">
                <IconBolt />
              </div>
              <h3>XP and levels</h3>
              <p>
                Each question earns XP: 20 × your score share × combo. Levels rise steadily — level up for a little
                celebration.
              </p>
            </div>
            <div class="glass feature gold">
              <div class="f-icon">
                <IconFire />
              </div>
              <h3>Combo ×1 → ×5</h3>
              <p>Every three correct answers in a row add +1 to your multiplier. Lose a question and it resets.</p>
            </div>
            <div class="glass feature gold">
              <div class="f-icon">
                <IconStar />
              </div>
              <h3>Golden question</h3>
              <p>One question in every round is golden and marked before it starts. It pays double XP.</p>
            </div>
            <div class="glass feature">
              <div class="f-icon">
                <IconGlobe />
              </div>
              <h3>Two daily rounds</h3>
              <p>
                Countries and Cities each have their own daily round, streak, stats and share line. Come back tomorrow
                to keep the streak.
              </p>
            </div>
          </div>
        </section>

        <section class="section" aria-labelledby="practice-h" id="practice">
          <div class="section-head">
            <div class="eyebrow">Practice</div>
            <h2 id="practice-h">Train one continent at a time</h2>
            <p>Free play with full XP. Pick a mode and a continent.</p>
          </div>
          <PracticePicker />
        </section>

        <section class="section faq" aria-labelledby="faq-h">
          <div class="section-head">
            <div class="eyebrow">FAQ</div>
            <h2 id="faq-h">Questions, answered</h2>
          </div>
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </section>
      </div>
    </>
  );
}

export function PracticePicker() {
  const [mode, setMode] = useState<Mode>('countries');
  return (
    <div>
      <div class="tabs" role="tablist" aria-label="Mode">
        {(['countries', 'cities'] as Mode[]).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}>
            {modeLabel(m)}
          </button>
        ))}
      </div>
      <div class="features">
        {CONTINENTS.map((c) => (
          <button
            key={c}
            class="btn"
            style={{ justifyContent: 'space-between' }}
            onClick={() => navigate(`/practice/${mode}/${encodeURIComponent(c)}?r=${Date.now().toString(36)}`)}
          >
            {c} <span aria-hidden="true">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}
