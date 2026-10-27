import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CSSProperties, HTMLAttributes } from 'preact';
import { AtlasCanvas } from './AtlasCanvas';
import { GuessForm } from './GuessForm';
import { Results } from './Results';
import { IconBack, IconFire, IconMinus, IconPlus, IconStar, IconTarget } from './Icons';
import type { AtlasView } from '../map/AtlasView';
import { TARGETS, cityById, cityName, countryOfCity, nameIndex } from '../data';
import { AUTO_ADVANCE_SECONDS, QUESTIONS_PER_ROUND, REVEAL_VIEW_KM, STEPS } from '../game/config';
import { cityClues } from '../game/clues';
import { dailyNumber, utcDateKey } from '../game/dates';
import { describeLocation } from '../game/describe';
import { matchGuess } from '../game/matching';
import { revealPlan } from '../game/reveal';
import { applyGuess, createRound, currentTarget, isGolden, nextQuestion, skipStep } from '../game/round';
import { comboMultiplier, resultSquare } from '../game/scoring';
import { selectByTiers, selectDaily, selectPractice } from '../game/selection';
import type { Clue, RoundKind, RoundState } from '../game/types';
import { burst, cssVar, vibrate } from '../lib/fx';
import { recordQuestion, recordRound, saveCurrent } from '../lib/progress';
import { navigate } from '../lib/router';
import { sfx } from '../lib/sound';
import { saveStore } from '../lib/storage';
import { useStore } from '../lib/store';

interface Props {
  kind: RoundKind;
  continent?: string;
}

function newRound(kind: RoundKind, continent?: string): RoundState {
  const today = utcDateKey();
  const combo = saveStore.get().combo;
  if (kind === 'daily') {
    const sel = selectDaily(TARGETS, dailyNumber(today));
    return createRound({ kind, seed: `daily:${today}`, dateKey: today, ...sel, streak: combo });
  }
  const seed = `${kind}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
  const sel =
    kind === 'practice' && continent ? selectPractice(TARGETS, continent, seed) : selectByTiers(TARGETS, seed);
  return createRound({ kind, seed, dateKey: today, ...sel, streak: combo, continent });
}

/** Tracks the visual viewport so the map and guess field both stay visible with the keyboard open. */
function useViewport() {
  const [kbOpen, setKbOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    const on = () => {
      const h = vv ? vv.height : window.innerHeight;
      root.style.setProperty('--vvh', `${Math.round(h)}px`);
      setKbOpen(!!vv && window.innerHeight - vv.height > 140);
      if (vv && vv.offsetTop) window.scrollTo(0, 0);
    };
    on();
    vv?.addEventListener('resize', on);
    vv?.addEventListener('scroll', on);
    window.addEventListener('resize', on);
    return () => {
      vv?.removeEventListener('resize', on);
      vv?.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
      root.style.removeProperty('--vvh');
    };
  }, []);
  return kbOpen;
}

function Swatches({ clue, small }: { clue: Clue; small?: boolean }) {
  if (!clue.swatches) return null;
  return (
    <span class="swatches" aria-label={`Colors: ${clue.text}`}>
      {clue.swatches.map((s, i) => (
        <span class="swatch" key={i}>
          <i style={{ background: s.hex }} aria-hidden="true" />
          {!small && s.name}
        </span>
      ))}
    </span>
  );
}

export function Game({ kind, continent }: Props) {
  const save = useStore(saveStore);
  const settings = save.settings;
  const [round, setRound] = useState<RoundState | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; tone?: 'bad' | 'warn' } | null>(null);
  const [shake, setShake] = useState(0);
  const [comboBump, setComboBump] = useState(0);
  const [announce, setAnnounce] = useState('');
  const [autoOn, setAutoOn] = useState(true);
  const [focused, setFocused] = useState(false);
  const viewRef = useRef<AtlasView | null>(null);
  const [viewReady, setViewReady] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const shownRef = useRef('');
  const kbOpen = useViewport();

  // ── Start or resume the round ──
  useEffect(() => {
    const today = utcDateKey();
    if (kind === 'daily') {
      const s = saveStore.get();
      if (s.daily[today]) {
        navigate('/results', true);
        return;
      }
      if (s.current && s.current.dateKey === today && !s.current.finished) {
        setRound(s.current);
        return;
      }
    }
    setRound(newRound(kind, continent));
  }, [kind, continent]);

  // Persist the daily round after every change so a reload resumes it.
  useEffect(() => {
    if (round && round.kind === 'daily' && !round.finished) saveCurrent(round);
  }, [round]);

  const targetId = round ? currentTarget(round) : null;
  const city = targetId ? cityById.get(targetId) : undefined;
  const country = targetId ? countryOfCity(targetId) : undefined;
  const step = round?.step ?? 1;
  const revealed = !!round?.revealed;
  const lastResult = revealed && round ? round.results[round.results.length - 1] : null;

  const plan = useMemo(
    () => (city && round ? revealPlan(city.lonlat, `${round.seed}:${round.index}:${city.id}`) : null),
    [city, round?.seed, round?.index],
  );
  const clues = useMemo(() => (city && country ? cityClues(city, country) : []), [city, country]);

  // ── Map scene and camera ──
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !plan || !city || !round) return;
    const win = plan.view[step - 1];
    view.setScene({
      bounds: revealed ? null : win,
      search: revealed ? null : plan.search[step - 1],
      pin: revealed ? { at: city.lonlat, label: city.name } : null,
    });
    const key = `${round.seed}:${round.index}`;
    const shown = shownRef.current;
    shownRef.current = `${key}:${step}:${revealed}`;
    if (!shown.startsWith(`${key}:`)) {
      // New question: jump straight to the first view (no flight across the world).
      view.fitCircle(win);
    } else if (revealed) {
      view.flyTo(city.lonlat[0], city.lonlat[1], view.fitK(city.lonlat[1], REVEAL_VIEW_KM / 2), 1300);
    } else {
      view.frameCircle(win, 1000);
    }
  }, [viewReady, plan, step, revealed, round?.index]);

  // ── Accessibility: describe what the map shows ──
  const mapLabel = useMemo(() => {
    if (!plan || !country) return 'Map';
    const win = plan.view[step - 1];
    const where = describeLocation(win.center[0], win.center[1], country.continents[0]);
    if (revealed && city) return `Map of the area around ${city.name}, ${country.name}.`;
    const search = plan.search[step - 1];
    const circle = search
      ? ` A green circle ${search.radiusKm * 2} km wide contains the city.`
      : ' The city is on the map.';
    return `Satellite map of an area ${win.radiusKm * 2} km across in ${where}.${circle}`;
  }, [plan, step, revealed, country, city]);

  // Announce new clues.
  useEffect(() => {
    if (!round || revealed || !clues.length) return;
    const c = clues[step - 1];
    setAnnounce(`Step ${step} of ${STEPS}. ${c.label}: ${c.text}.`);
  }, [step, round?.index, clues, revealed]);

  // ── Actions ──
  const finishEffects = (next: RoundState) => {
    const r = next.results[next.results.length - 1];
    const cont = countryOfCity(r.id)?.continents[0] ?? 'Unknown';
    recordQuestion(r, cont, next.streak);
    const name = cityName(r.id);
    if (r.solvedAt) {
      sfx.correct(r.multiplier);
      vibrate(35);
      const rect = inputRef.current?.getBoundingClientRect();
      burst(rect ? rect.left + rect.width / 2 : innerWidth / 2, rect ? rect.top : innerHeight / 2, [
        cssVar('--accent'),
        cssVar('--accent-2'),
        cssVar('--map-major'),
        '#9fd3b2',
      ]);
      setComboBump((n) => n + 1);
      setAnnounce(`Correct! ${name}. ${r.points} points, ${r.xp} XP.`);
    } else {
      sfx.wrong();
      vibrate([40, 50, 40]);
      setAnnounce(`The answer was ${name}.`);
    }
    setFeedback(null);
    setAutoOn(true);
    setTimeout(() => nextRef.current?.focus({ preventScroll: true }), 50);
  };

  const onGuess = (text: string) => {
    if (!round || round.revealed || !targetId) return;
    const m = matchGuess(nameIndex(), text);
    if (m.status === 'empty') return;
    if (m.status === 'unknown') {
      setFeedback({ text: 'No city by that name in the game. Try again.', tone: 'warn' });
      setShake((n) => n + 1);
      return;
    }
    const correct = m.ids.includes(targetId);
    const label = correct ? cityName(targetId) : m.ids.length === 1 ? cityName(m.ids[0]) : text.trim();
    if (!correct && round.guesses.includes(label)) {
      setFeedback({ text: `You already tried ${label}.`, tone: 'warn' });
      return;
    }
    const next = applyGuess(round, label, correct);
    setRound(next);
    if (next.revealed) finishEffects(next);
    else {
      sfx.wrong();
      setTimeout(() => sfx.light(next.step), 260);
      vibrate([30, 40, 30]);
      setShake((n) => n + 1);
      setFeedback({ text: `Not ${label}. The map opens up a little more.`, tone: 'bad' });
    }
  };

  const onSkip = () => {
    if (!round || round.revealed) return;
    const next = skipStep(round);
    setRound(next);
    setFeedback(null);
    if (next.revealed) finishEffects(next);
    else sfx.light(next.step);
  };

  const [finished, setFinished] = useState<RoundState | null>(null);
  const onNext = useCallback(() => {
    if (!round || !round.revealed) return;
    const next = nextQuestion(round);
    if (next.finished) {
      recordRound(next);
      if (next.kind === 'daily') navigate('/results', true);
      else setFinished(next);
      return;
    }
    setRound(next);
    setFeedback(null);
    sfx.light(1);
    setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 80);
  }, [round]);

  // Auto-advance after the reveal.
  useEffect(() => {
    if (!revealed || !autoOn) return;
    const t = setTimeout(onNext, AUTO_ADVANCE_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [revealed, autoOn, onNext]);

  if (finished) {
    return (
      <div class="page">
        <Results
          kind={finished.kind}
          results={finished.results}
          dateKey={finished.dateKey}
          continent={finished.continent}
        />
      </div>
    );
  }

  if (!round || !targetId || !city || !country) return <div class="game" aria-busy="true" />;

  const golden = isGolden(round);
  const title =
    kind === 'daily'
      ? `Daily #${dailyNumber(round.dateKey)}`
      : kind === 'bonus'
        ? 'Bonus round'
        : `Practice · ${round.continent}`;

  const segClass = (i: number) => {
    const r = round.results[i];
    let c = 'seg';
    if (r) {
      const sq = resultSquare(r.solvedAt);
      c += sq === '🟩' ? ' s-green' : sq === '🟨' ? ' s-yellow' : ' s-red';
    } else if (i === round.index) c += ' current';
    if (i === round.golden) c += ' golden';
    return c;
  };

  const currentClue = clues[step - 1];
  const pastClues = clues.slice(0, revealed ? STEPS : step - 1);
  const panelProps: HTMLAttributes<HTMLElement> = { onPointerDown: () => revealed && setAutoOn(false) };
  const win = plan?.view[step - 1];

  return (
    <div class={`game${kbOpen && focused ? ' kb-open' : ''}`}>
      <header class="game-top">
        <button class="icon-btn" aria-label="Back to start" onClick={() => navigate('/')}>
          <IconBack />
        </button>
        <div class="game-title">
          <div class="gt-mode">{title}</div>
          <div class="segments" role="img" aria-label={`City ${round.index + 1} of ${QUESTIONS_PER_ROUND}`}>
            {Array.from({ length: QUESTIONS_PER_ROUND }, (_, i) => (
              <span key={i} class={segClass(i)} />
            ))}
          </div>
        </div>
        <span
          key={comboBump}
          class={`combo-badge${round.streak >= 2 ? ' hot' : ''}${comboBump ? ' bump' : ''}`}
          title={`Combo: ${round.streak} in a row`}
          aria-label={`Combo multiplier ×${comboMultiplier(round.streak)}, ${round.streak} correct in a row`}
        >
          <IconFire class="icon" style={{ width: '14px', height: '14px' }} />×{comboMultiplier(round.streak)}
        </span>
      </header>

      <div class="map-wrap">
        <AtlasCanvas
          class="map"
          label={mapLabel}
          onReady={(v) => {
            viewRef.current = v;
            setViewReady(true);
          }}
        />
        <div class="map-overlay-top">
          <div class="stepbar" role="img" aria-label={`Step ${step} of ${STEPS}`}>
            <span class="lbl">Step {revealed ? STEPS : step}/6</span>
            {Array.from({ length: STEPS }, (_, i) => (
              <span
                key={i}
                class={`dot${i < step || revealed ? ' on' : ''}${i === step - 1 && !revealed ? ' now' : ''}`}
              />
            ))}
          </div>
          {golden && !revealed && (
            <span class="golden-banner">
              <IconStar class="icon" style={{ width: '15px', height: '15px' }} /> Golden city · 2× XP
            </span>
          )}
        </div>
        <div class="map-controls">
          <button
            class="icon-btn"
            aria-label="Center the map"
            title="Center the map"
            onClick={() => {
              const view = viewRef.current;
              if (!view || !win) return;
              if (revealed)
                view.flyTo(city.lonlat[0], city.lonlat[1], view.fitK(city.lonlat[1], REVEAL_VIEW_KM / 2), 800);
              else view.frameCircle(win, 800);
            }}
          >
            <IconTarget />
          </button>
          <button class="icon-btn" aria-label="Zoom in" onClick={() => viewRef.current?.zoomBy(1.6)}>
            <IconPlus />
          </button>
          <button class="icon-btn" aria-label="Zoom out" onClick={() => viewRef.current?.zoomBy(1 / 1.6)}>
            <IconMinus />
          </button>
        </div>
      </div>

      <section class="panel" aria-label="Clues and guess" {...panelProps}>
        <div class="panel-inner">
          <div class="sr-only" aria-live="polite" aria-atomic="true">
            {announce}
          </div>
          {!revealed && currentClue && (
            <>
              <div class="clue-current" key={`${round.index}-${step}`}>
                <span class="clue-num" aria-hidden="true">
                  {step}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div class="clue-label">{currentClue.label}</div>
                  {currentClue.swatches ? (
                    <Swatches clue={currentClue} />
                  ) : (
                    <div class="clue-text">{currentClue.text}</div>
                  )}
                </div>
              </div>
              {pastClues.length > 0 && (
                <div class="clue-history" aria-label="Earlier clues">
                  {pastClues
                    .map((c, i) => (
                      <div class="clue-past" key={i}>
                        <span class="cp-n">{i + 1}</span>
                        <span class="cp-l">{c.label}</span>
                        {c.swatches ? <Swatches clue={c} small /> : <span class="cp-t">{c.text}</span>}
                      </div>
                    ))
                    .reverse()}
                </div>
              )}
              {round.guesses.length > 0 && (
                <div class="guesses" aria-label="Your guesses">
                  {round.guesses.map((g, i) => (
                    <span key={i} class={`guess-chip${g === '—' ? ' skip' : ''}`}>
                      {g === '—' ? 'Skipped' : g}
                    </span>
                  ))}
                </div>
              )}
              <GuessForm
                index={nameIndex()}
                placeholder="Type a city…"
                suggestionsOn={settings.suggestions}
                shake={shake}
                onSubmit={onGuess}
                inputRef={inputRef}
                onFocusChange={setFocused}
                onType={() => feedback?.tone === 'warn' && setFeedback(null)}
              />
              <div class={`feedback${feedback?.tone ? ` ${feedback.tone}` : ''}`} role="status">
                {feedback?.text ??
                  (step === STEPS
                    ? 'Last step: a wrong guess reveals the answer.'
                    : plan?.search[step - 1]
                      ? 'The city is inside the green circle.'
                      : 'The city is on this map.')}
              </div>
              <div class="guess-actions">
                <button class="btn btn-ghost btn-sm" type="button" onClick={onSkip}>
                  {step === STEPS ? 'Give up' : 'I don’t know'}
                </button>
              </div>
            </>
          )}

          {revealed && lastResult && (
            <div class="reveal">
              <div class="reveal-head">
                <div class="reveal-flag">
                  <img src={`flags/${country.flagFile}.svg`} alt={`Flag of ${country.name}`} width="64" height="48" />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div class={`reveal-status ${lastResult.solvedAt ? 'ok' : 'lost'}`}>
                    {lastResult.solvedAt ? `Correct in step ${lastResult.solvedAt}` : 'The answer was'}
                  </div>
                  <div class="reveal-name">{city.name}</div>
                  <div class="reveal-sub">
                    {city.capital ? 'Capital of' : 'City in'} {country.name}
                  </div>
                </div>
              </div>
              <div class="reward-row">
                <span class="reward accent">
                  <b>+{lastResult.points}</b> points
                </span>
                <span class="reward gold">
                  <b>+{lastResult.xp}</b> XP
                  {lastResult.golden && lastResult.xp > 0 ? ' · golden 2×' : ''}
                </span>
                {lastResult.solvedAt && lastResult.multiplier > 1 && (
                  <span class="reward gold">
                    <b>×{lastResult.multiplier}</b> combo
                  </span>
                )}
              </div>
              {city.fact && (
                <p class="fact">
                  <span class="fact-l">Did you know</span>
                  {city.fact}
                </p>
              )}
              <button
                ref={nextRef}
                class="btn btn-primary btn-lg next-btn"
                onClick={onNext}
                style={{ '--auto-dur': `${AUTO_ADVANCE_SECONDS}s` } as CSSProperties}
              >
                {round.index + 1 >= QUESTIONS_PER_ROUND ? 'See results' : 'Next city'}
                {autoOn && (
                  <span class="auto" style={{ animationDuration: `${AUTO_ADVANCE_SECONDS}s` }} aria-hidden="true" />
                )}
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
