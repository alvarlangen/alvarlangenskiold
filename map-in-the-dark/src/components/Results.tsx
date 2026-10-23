import { useEffect, useState } from 'preact/hooks';
import { IconArrow, IconCopy, IconShare } from './Icons';
import { cityName, countryOfCity } from '../data';
import { dailyNumber, formatCountdown } from '../game/dates';
import { levelFromXp, resultSquare } from '../game/scoring';
import { shareLine, shareText } from '../game/share';
import type { QuestionResult, RoundKind } from '../game/types';
import { useCountdown } from '../lib/countdown';
import { navigate } from '../lib/router';
import { saveStore } from '../lib/storage';
import { useStore } from '../lib/store';
import { toast } from '../lib/ui';

interface Props {
  kind: RoundKind;
  results: QuestionResult[];
  dateKey: string;
  continent?: string;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers / restricted contexts.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function Results({ kind, results, dateKey, continent }: Props) {
  const save = useStore(saveStore);
  const ms = useCountdown();
  const score = results.reduce((a, r) => a + r.points, 0);
  const xp = results.reduce((a, r) => a + r.xp, 0);
  const lvl = levelFromXp(save.xp);
  const dayNo = dailyNumber(dateKey);
  const otherBest = Object.entries(save.daily)
    .filter(([k]) => k !== dateKey)
    .reduce((a, [, r]) => Math.max(a, r.score), 0);
  const isBest = kind === 'daily' && score > otherBest && Object.keys(save.daily).length > 1;
  const line = shareLine(kind, dayNo, results);
  const url = location.href.split('#')[0];
  const text = shareText(line, score, url);
  const canShare = typeof navigator.share === 'function';
  const [barW, setBarW] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setBarW(lvl.progress * 100), 120);
    return () => clearTimeout(t);
  }, [lvl.progress]);

  const heading = kind === 'daily' ? `Daily #${dayNo}` : kind === 'bonus' ? 'Bonus round' : `Practice · ${continent}`;

  return (
    <div class="results">
      <section class="card result-hero" aria-labelledby="res-h">
        <div class="eyebrow">{heading}</div>
        <h1 id="res-h" class="sr-only">
          Round complete
        </h1>
        <div class="big mono" aria-label={`${score} of 500 points`}>
          {score}
        </div>
        <div class="of">of 500 points</div>
        <div
          class="squares"
          aria-label={results.map((r) => (r.solvedAt ? `solved in step ${r.solvedAt}` : 'lost')).join(', ')}
        >
          {results.map((r) => resultSquare(r.solvedAt)).join('')}
        </div>
        {kind === 'daily' && (
          <div class="hero-meta" style={{ justifyContent: 'center' }}>
            {isBest ? (
              <span class="chip chip-gold">New personal best</span>
            ) : (
              otherBest > 0 && (
                <span class="chip">
                  Personal best <strong class="mono">{Math.max(otherBest, score)}</strong>
                </span>
              )
            )}
            <span class="chip chip-accent">
              Streak <strong class="mono">{save.streak.current}</strong>
            </span>
          </div>
        )}
      </section>

      <section class="result-rows" aria-label="Cities">
        {results.map((r, i) => (
          <div class="result-row" key={i}>
            <span aria-hidden="true">{resultSquare(r.solvedAt)}</span>
            <span class="rr-name">
              {cityName(r.id)}
              <span class="rr-country">, {countryOfCity(r.id)?.name}</span>
              {r.golden ? ' ★' : ''}
            </span>
            <span class="rr-step">{r.solvedAt ? `step ${r.solvedAt}` : 'lost'}</span>
            <span class="rr-pts">{r.points}</span>
          </div>
        ))}
      </section>

      <section class="card" aria-label="Experience">
        <div class="stat-grid">
          <div class="stat">
            <div class="v gold mono">+{xp}</div>
            <div class="l">XP this round</div>
          </div>
          <div class="stat">
            <div class="v accent mono">{lvl.level}</div>
            <div class="l">Level</div>
          </div>
          <div class="stat">
            <div class="v mono">×{Math.min(5, 1 + Math.floor(save.combo / 3))}</div>
            <div class="l">Combo ({save.combo} in a row)</div>
          </div>
        </div>
        <div style={{ marginTop: '16px' }}>
          <div
            class="xpbar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={lvl.needed}
            aria-valuenow={lvl.into}
            aria-label="Level progress"
          >
            <i style={{ width: `${barW}%` }} />
          </div>
          <div class="xp-meta">
            <span class="mono">
              {lvl.into} / {lvl.needed} XP
            </span>
            <span>to level {lvl.level + 1}</span>
          </div>
        </div>
      </section>

      <section class="actions-col" aria-label="Share and continue">
        <div class="actions-row">
          <button
            class="btn"
            onClick={async () =>
              toast((await copy(text)) ? 'Result copied' : 'Could not copy. Select and copy it manually.')
            }
          >
            <IconCopy /> Copy result
          </button>
          {canShare ? (
            <button
              class="btn"
              onClick={() =>
                navigator.share({ title: 'Map in the Dark', text: `${line}\n${score}/500 points`, url }).catch(() => {})
              }
            >
              <IconShare /> Share
            </button>
          ) : (
            <button class="btn" onClick={() => navigate('/stats')}>
              Stats
            </button>
          )}
        </div>
        <button class="btn btn-primary btn-lg" onClick={() => navigate(`/bonus?r=${Date.now().toString(36)}`)}>
          Bonus round <IconArrow />
        </button>
        <button class="btn btn-ghost" onClick={() => navigate('/')}>
          Back to start
        </button>
        <p class="countdown" style={{ textAlign: 'center' }}>
          Next daily round in <span class="mono">{formatCountdown(ms)}</span> (midnight UTC)
        </p>
      </section>
    </div>
  );
}

/** Route view for a finished daily round. */
export function DailyResults() {
  const save = useStore(saveStore);
  const today = new Date().toISOString().slice(0, 10);
  const days = Object.keys(save.daily).sort();
  const key = save.daily[today] ? today : days[days.length - 1];
  const rec = key ? save.daily[key] : undefined;
  if (!rec) {
    return (
      <div class="page page-narrow">
        <h1>No results yet</h1>
        <p class="lede">You haven’t finished a daily round yet.</p>
        <button class="btn btn-primary" onClick={() => navigate('/play')}>
          Play today’s round
        </button>
      </div>
    );
  }
  return (
    <div class="page">
      <Results kind="daily" results={rec.results} dateKey={key!} />
    </div>
  );
}
