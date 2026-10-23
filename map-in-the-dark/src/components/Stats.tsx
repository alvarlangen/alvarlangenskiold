import { CONTINENTS } from '../data/continents';
import { addDays, utcDateKey } from '../game/dates';
import { visibleStreak } from '../game/progress';
import { levelFromXp } from '../game/scoring';
import { saveStore } from '../lib/storage';
import { useStore } from '../lib/store';

/** Bar chart of the step in which questions were solved (plus lost). Plain SVG. */
function StepChart({ hist }: { hist: number[] }) {
  const max = Math.max(1, ...hist);
  const W = 340;
  const H = 170;
  const bw = 34;
  const gap = (W - bw * 7) / 8;
  const labels = ['1', '2', '3', '4', '5', '6', '✕'];
  const best = hist.slice(0, 6).indexOf(Math.max(...hist.slice(0, 6)));
  return (
    <svg
      class="chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Solved by step: ${hist
        .slice(0, 6)
        .map((v, i) => `step ${i + 1}: ${v}`)
        .join(', ')}; lost: ${hist[6]}`}
    >
      {hist.map((v, i) => {
        const h = (v / max) * (H - 50);
        const x = gap + i * (bw + gap);
        const y = H - 24 - h;
        return (
          <g key={i}>
            <rect
              class={`bar${i === 6 ? ' lost' : i !== best || !v ? ' dim' : ''}`}
              x={x}
              y={y}
              width={bw}
              height={Math.max(2, h)}
              rx="5"
            />
            <text class="val" x={x + bw / 2} y={y - 6} text-anchor="middle">
              {v}
            </text>
            <text x={x + bw / 2} y={H - 6} text-anchor="middle">
              {labels[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Stats() {
  const save = useStore(saveStore);
  const m = save;
  const lvl = levelFromXp(save.xp);
  const today = utcDateKey();
  const solved = m.stepHist.slice(0, 6).reduce((a, b) => a + b, 0);
  const total = solved + m.stepHist[6];
  const avgStep = solved ? m.stepHist.slice(0, 6).reduce((a, v, i) => a + v * (i + 1), 0) / solved : 0;
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));

  return (
    <div class="page">
      <h1>Your stats</h1>
      <div class="stat-grid" style={{ marginBottom: '22px' }}>
        <div class="stat">
          <div class="v accent mono">{lvl.level}</div>
          <div class="l">Level</div>
        </div>
        <div class="stat">
          <div class="v gold mono">{save.xp}</div>
          <div class="l">Total XP</div>
        </div>
        <div class="stat">
          <div class="v mono">
            {lvl.into}/{lvl.needed}
          </div>
          <div class="l">XP to level {lvl.level + 1}</div>
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat">
          <div class="v gold mono">{visibleStreak(m.streak, today)}</div>
          <div class="l">Current streak</div>
        </div>
        <div class="stat">
          <div class="v mono">{m.streak.best}</div>
          <div class="l">Best streak</div>
        </div>
        <div class="stat">
          <div class="v mono">{m.rounds}</div>
          <div class="l">Rounds played</div>
        </div>
        <div class="stat">
          <div class="v mono">{m.bestScore}</div>
          <div class="l">Best daily score</div>
        </div>
        <div class="stat">
          <div class="v mono">{total ? Math.round((solved / total) * 100) : 0}%</div>
          <div class="l">Hit rate</div>
        </div>
        <div class="stat">
          <div class="v mono">{avgStep ? avgStep.toFixed(1) : '–'}</div>
          <div class="l">Average solving step</div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gap: '16px',
          marginTop: '22px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        }}
      >
        <section class="card panel-card" aria-labelledby="dist-h">
          <h2 id="dist-h" style={{ fontSize: '1rem' }}>
            Solved in step
          </h2>
          {total ? <StepChart hist={m.stepHist} /> : <p class="lede">Play a round to see your distribution.</p>}
        </section>

        <section class="card panel-card" aria-labelledby="cont-h">
          <h2 id="cont-h" style={{ fontSize: '1rem' }}>
            Hit rate by continent
          </h2>
          {CONTINENTS.map((c) => {
            const v = m.continents[c];
            const p = v && v.played ? v.won / v.played : 0;
            return (
              <div class="hbar" key={c}>
                <span>{c}</span>
                <span class="track" role="img" aria-label={`${c}: ${v ? `${v.won} of ${v.played}` : 'not played'}`}>
                  <i style={{ width: `${p * 100}%` }} />
                </span>
                <span class="pct">{v ? `${Math.round(p * 100)}%` : '–'}</span>
              </div>
            );
          })}
        </section>

        <section class="card panel-card" aria-labelledby="hist-h">
          <h2 id="hist-h" style={{ fontSize: '1rem' }}>
            Last 14 days
          </h2>
          <div class="history">
            {days.map((d) => {
              const r = m.daily[d];
              return (
                <div
                  key={d}
                  class={`hday${r ? ' played' : ''}${d === today ? ' today' : ''}`}
                  style={r ? { '--p': String(Math.max(0.15, r.score / 500)) } : undefined}
                  title={r ? `${d}: ${r.score} points` : `${d}: not played`}
                  aria-label={r ? `${d}: ${r.score} points` : `${d}: not played`}
                >
                  {r ? r.score : d.slice(8)}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
