import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CSSProperties, HTMLAttributes } from 'preact';
import { MapCanvas } from './MapCanvas';
import { GuessForm } from './GuessForm';
import { Results } from './Results';
import { IconBack, IconFire, IconGlobe, IconMap, IconMinus, IconPlus, IconStar, IconTarget } from './Icons';
import type { MapView, Scene } from '../map/MapView';
import { loadPieces, type CountryPieces } from '../map/geodata';
import { TARGETS, cityById, countryOfTarget, nameIndex, targetName } from '../data';
import { AUTO_ADVANCE_SECONDS, CAMERA_FOCUS_STEP, QUESTIONS_PER_ROUND, STEPS } from '../game/config';
import { cityClues, countryClues } from '../game/clues';
import { dailyNumber, utcDateKey } from '../game/dates';
import { describeLocation } from '../game/describe';
import { growthOrder, litCountForStep } from '../game/growth';
import { matchGuess } from '../game/matching';
import { rngFrom } from '../game/rng';
import { applyGuess, createRound, currentTarget, isGolden, nextQuestion, skipStep } from '../game/round';
import { comboMultiplier, resultSquare } from '../game/scoring';
import { selectByTiers, selectDaily, selectPractice } from '../game/selection';
import { modeLabel } from '../game/share';
import type { Clue, Mode, RoundKind, RoundState } from '../game/types';
import { burst, cssVar, vibrate } from '../lib/fx';
import { recordQuestion, recordRound, saveCurrent } from '../lib/progress';
import { navigate } from '../lib/router';
import { sfx } from '../lib/sound';
import { saveStore, updateSettings } from '../lib/storage';
import { useStore } from '../lib/store';

interface Props {
  mode: Mode;
  kind: RoundKind;
  continent?: string;
}

function newRound(mode: Mode, kind: RoundKind, continent?: string): RoundState {
  const today = utcDateKey();
  const combo = saveStore.get().modes[mode].combo;
  if (kind === 'daily') {
    const sel = selectDaily(TARGETS[mode], mode, dailyNumber(today));
    return createRound({ mode, kind, seed: `daily:${today}`, dateKey: today, ...sel, streak: combo });
  }
  const seed = `${kind}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
  const sel =
    kind === 'practice' && continent
      ? selectPractice(TARGETS[mode], continent, seed)
      : selectByTiers(TARGETS[mode], seed);
  return createRound({ mode, kind, seed, dateKey: today, ...sel, streak: combo, continent });
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

export function Game({ mode, kind, continent }: Props) {
  const save = useStore(saveStore);
  const settings = save.settings;
  const [round, setRound] = useState<RoundState | null>(null);
  const [pieces, setPieces] = useState<CountryPieces | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; tone?: 'bad' | 'warn' } | null>(null);
  const [shake, setShake] = useState(0);
  const [comboBump, setComboBump] = useState(0);
  const [announce, setAnnounce] = useState('');
  const [autoOn, setAutoOn] = useState(true);
  const [focused, setFocused] = useState(false);
  const viewRef = useRef<MapView | null>(null);
  const [viewReady, setViewReady] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const focusedStepRef = useRef<string>('');
  const kbOpen = useViewport();

  // ── Start or resume the round ──
  useEffect(() => {
    const today = utcDateKey();
    if (kind === 'daily') {
      const m = saveStore.get().modes[mode];
      if (m.daily[today]) {
        navigate(`/results/${mode}`, true);
        return;
      }
      if (m.current && m.current.dateKey === today && !m.current.finished) {
        setRound(m.current);
        return;
      }
    }
    setRound(newRound(mode, kind, continent));
  }, [mode, kind, continent]);

  // Persist the daily round after every change so a reload resumes it.
  useEffect(() => {
    if (round && round.kind === 'daily' && !round.finished) saveCurrent(mode, round);
  }, [round, mode]);

  const targetId = round ? currentTarget(round) : null;
  const country = round && targetId ? countryOfTarget(mode, targetId) : undefined;
  const city = mode === 'cities' && targetId ? cityById.get(targetId) : undefined;

  // ── Load geometry for the current country ──
  useEffect(() => {
    setPieces(null);
    setLoadError(false);
    if (!targetId || mode !== 'countries') return;
    let alive = true;
    loadPieces(targetId)
      .then((p) => alive && setPieces(p))
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, [targetId, mode]);

  const order = useMemo(
    () =>
      pieces && round && targetId
        ? growthOrder(pieces.neighbors, pieces.centroids, `${round.seed}:${round.index}:${targetId}`)
        : [],
    [pieces, round?.seed, round?.index, targetId],
  );

  const clues = useMemo(() => {
    if (!targetId || !country) return [];
    return mode === 'countries' ? countryClues(country) : city ? cityClues(city, country) : [];
  }, [targetId, country, city, mode]);

  const step = round?.step ?? 1;
  const revealed = !!round?.revealed;
  const lastResult = revealed && round ? round.results[round.results.length - 1] : null;

  // ── Scene ──
  const litCount = pieces ? litCountForStep(order, pieces.areas, step) : 0;
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !round) return;
    let scene: Scene = null;
    if (mode === 'countries' && pieces) {
      scene = { kind: 'country', pieces: pieces.pieces, lit: order.slice(0, litCount), reveal: revealed };
    } else if (mode === 'cities' && city) {
      scene = { kind: 'city', target: city.lonlat, decoys: city.decoys, step, reveal: revealed };
    }
    view.setScene(scene);
  }, [viewReady, pieces, order, litCount, revealed, city, step, mode, round?.index]);

  // ── Camera ──
  const focusOf = useCallback((): { lon: number; lat: number; zoom: number } | null => {
    const view = viewRef.current;
    if (!view) return null;
    if (mode === 'countries' && pieces) {
      const [w, s, e, n] = pieces.bbox;
      let span = e - w;
      if (span < 0) span += 360;
      return { lon: w + span / 2, lat: (s + n) / 2, zoom: view.fitZoom(pieces.bbox) };
    }
    if (city) {
      const pts = [city.lonlat, ...city.decoys];
      const lons = pts.map((p) => p[0]);
      const lats = pts.map((p) => p[1]);
      const bbox: [number, number, number, number] = [
        Math.min(...lons),
        Math.min(...lats),
        Math.max(...lons),
        Math.max(...lats),
      ];
      return { lon: (bbox[0] + bbox[2]) / 2, lat: (bbox[1] + bbox[3]) / 2, zoom: view.fitZoom(bbox, 0.7) };
    }
    return null;
  }, [mode, pieces, city]);

  // Initial, seeded "neutral" view: the lit area is on screen but not centred, so step 1–2 need a look around.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !round || !targetId) return;
    const center = mode === 'countries' ? pieces?.center : city?.lonlat;
    if (!center) return;
    const key = `${round.seed}:${round.index}`;
    if (focusedStepRef.current.startsWith(key)) return;
    focusedStepRef.current = `${key}:init`;
    if (round.step >= CAMERA_FOCUS_STEP || round.revealed) {
      const f = focusOf();
      if (f) view.setView(f.lon, f.lat, f.zoom);
      focusedStepRef.current = `${key}:focus`;
      return;
    }
    const rng = rngFrom(`${key}:camera`);
    const dLon = (rng() < 0.5 ? -1 : 1) * (22 + rng() * 22);
    const lat = Math.max(-55, Math.min(60, center[1] * 0.55 + (rng() - 0.5) * 24));
    view.flyTo(center[0] + dLon, lat, view.projection === 'globe' ? 1 : 1.3, 900);
  }, [viewReady, pieces, city, round?.index, round?.seed]);

  // Glide to the lit area in step 3 (not earlier), and on reveal.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !round) return;
    const key = `${round.seed}:${round.index}`;
    if ((step >= CAMERA_FOCUS_STEP || revealed) && focusedStepRef.current !== `${key}:focus`) {
      const f = focusOf();
      if (!f) return;
      focusedStepRef.current = `${key}:focus`;
      view.flyTo(f.lon, f.lat, f.zoom, 1500);
    }
    if (revealed && city) view.flyTo(city.lonlat[0], city.lonlat[1], Math.max(view.getView().zoom, 3.2), 1400);
  }, [step, revealed, focusOf]);

  // ── Accessibility: describe the lit area ──
  const mapLabel = useMemo(() => {
    if (!country) return 'Map';
    const cont = country.continents[0];
    if (mode === 'countries' && pieces) {
      const lit = order.slice(0, revealed ? order.length : litCount);
      if (!lit.length) return 'Dark map';
      const lon = lit.reduce((a, i) => a + pieces.centroids[i][0], 0) / lit.length;
      const lat = lit.reduce((a, i) => a + pieces.centroids[i][1], 0) / lit.length;
      return `Map. ${lit.length} of ${order.length} pieces are lit, in ${describeLocation(lon, lat, cont)}.`;
    }
    if (city) {
      return `Map. ${city.decoys.length + 1} points of light in ${describeLocation(city.lonlat[0], city.lonlat[1], cont)}${step > 1 ? '; one of them glows brighter' : ''}.`;
    }
    return 'Map';
  }, [country, pieces, order, litCount, revealed, city, step, mode]);

  // Announce new clues.
  useEffect(() => {
    if (!round || revealed || !clues.length) return;
    const c = clues[step - 1];
    setAnnounce(`Step ${step} of ${STEPS}. ${c.label}: ${c.text}.`);
  }, [step, round?.index, clues, revealed]);

  // ── Actions ──
  const finishEffects = (next: RoundState) => {
    const r = next.results[next.results.length - 1];
    const cont = countryOfTarget(mode, r.id)?.continents[0] ?? 'Unknown';
    recordQuestion(mode, r, cont, next.streak);
    const name = targetName(mode, r.id);
    if (r.solvedAt) {
      sfx.correct(r.multiplier);
      vibrate(35);
      const rect = inputRef.current?.getBoundingClientRect();
      burst(rect ? rect.left + rect.width / 2 : innerWidth / 2, rect ? rect.top : innerHeight / 2, [
        cssVar('--accent'),
        cssVar('--gold'),
        cssVar('--correct'),
        '#ffffff',
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
    const m = matchGuess(nameIndex(mode), text);
    if (m.status === 'empty') return;
    if (m.status === 'unknown') {
      setFeedback({
        text: mode === 'countries' ? 'No country by that name. Try again.' : 'No city by that name. Try again.',
        tone: 'warn',
      });
      setShake((n) => n + 1);
      return;
    }
    const correct = m.ids.includes(targetId);
    const label = correct ? targetName(mode, targetId) : m.ids.length === 1 ? targetName(mode, m.ids[0]) : text.trim();
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
      setFeedback({ text: `Not ${label}. More of the map lights up…`, tone: 'bad' });
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
      if (next.kind === 'daily') navigate(`/results/${mode}`, true);
      else setFinished(next);
      return;
    }
    setRound(next);
    setFeedback(null);
    sfx.light(1);
    setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 80);
  }, [round, mode]);

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
          mode={mode}
          kind={finished.kind}
          results={finished.results}
          dateKey={finished.dateKey}
          continent={finished.continent}
        />
      </div>
    );
  }

  if (!round || !targetId || !country) return <div class="game" aria-busy="true" />;

  const golden = isGolden(round);
  const multiplier = comboMultiplier(round.streak + 1);
  const title =
    kind === 'daily'
      ? `${modeLabel(mode)} · Daily #${dailyNumber(round.dateKey)}`
      : kind === 'bonus'
        ? `${modeLabel(mode)} · Bonus round`
        : `${modeLabel(mode)} · ${round.continent}`;

  const segClass = (i: number) => {
    const r = round.results[i];
    let c = 'seg';
    if (r)
      c += ` s-${resultSquare(r.solvedAt) === '🟩' ? 'green' : resultSquare(r.solvedAt) === '🟨' ? 'yellow' : 'red'}`;
    else if (i === round.index) c += ' current';
    if (i === round.golden) c += ' golden';
    return c;
  };

  const currentClue = clues[step - 1];
  const pastClues = clues.slice(0, revealed ? STEPS : step - 1);

  const panelProps: HTMLAttributes<HTMLElement> = {
    onPointerDown: () => revealed && setAutoOn(false),
  };

  return (
    <div class={`game${kbOpen && focused ? ' kb-open' : ''}`}>
      <header class="game-top">
        <button class="icon-btn" aria-label="Back to start" onClick={() => navigate('/')}>
          <IconBack />
        </button>
        <div class="game-title">
          <div class="gt-mode">{title}</div>
          <div class="segments" role="img" aria-label={`Question ${round.index + 1} of ${QUESTIONS_PER_ROUND}`}>
            {Array.from({ length: QUESTIONS_PER_ROUND }, (_, i) => (
              <span key={i} class={segClass(i)} />
            ))}
          </div>
        </div>
        <span
          key={comboBump}
          class={`combo-badge${multiplier > 1 || round.streak >= 2 ? ' hot' : ''}${comboBump ? ' bump' : ''}`}
          title={`Combo: ${round.streak} in a row`}
          aria-label={`Combo multiplier ×${comboMultiplier(round.streak)}, ${round.streak} correct in a row`}
        >
          <IconFire class="icon" style={{ width: '14px', height: '14px' }} />×{comboMultiplier(round.streak)}
        </span>
      </header>

      <div class="map-wrap">
        <MapCanvas
          class="map"
          label={mapLabel}
          onReady={(v) => {
            viewRef.current = v;
            setViewReady(true);
          }}
        />
        <div class="map-overlay-top">
          <div class="stepbar" role="img" aria-label={`Step ${step} of ${STEPS}`}>
            <span class="lbl">STEP {revealed ? STEPS : step}/6</span>
            {Array.from({ length: STEPS }, (_, i) => (
              <span
                key={i}
                class={`dot${i < step || revealed ? ' on' : ''}${i === step - 1 && !revealed ? ' now' : ''}`}
              />
            ))}
          </div>
          {golden && !revealed && (
            <span class="golden-banner">
              <IconStar class="icon" style={{ width: '15px', height: '15px' }} /> Golden question · 2× XP
            </span>
          )}
        </div>
        <div class="map-controls">
          <button
            class="icon-btn"
            aria-label={settings.projection === 'globe' ? 'Switch to flat map' : 'Switch to 3D globe'}
            title={settings.projection === 'globe' ? 'Flat map' : '3D globe'}
            onClick={() => updateSettings({ projection: settings.projection === 'globe' ? 'flat' : 'globe' })}
          >
            {settings.projection === 'globe' ? <IconMap /> : <IconGlobe />}
          </button>
          <button
            class="icon-btn"
            aria-label="Center on the lit area"
            title="Center on the lit area"
            onClick={() => {
              const view = viewRef.current;
              if (!view) return;
              if (mode === 'countries' && pieces) {
                const lit = order.slice(0, revealed ? order.length : litCount);
                const lon = lit.reduce((a, i) => a + pieces.centroids[i][0], 0) / Math.max(1, lit.length);
                const lat = lit.reduce((a, i) => a + pieces.centroids[i][1], 0) / Math.max(1, lit.length);
                const f = focusOf();
                view.flyTo(lon, lat, Math.max(view.getView().zoom, step >= CAMERA_FOCUS_STEP && f ? f.zoom : 1), 900);
              } else if (city) {
                const f = focusOf();
                if (f)
                  view.flyTo(f.lon, f.lat, Math.max(view.getView().zoom, step >= CAMERA_FOCUS_STEP ? f.zoom : 1), 900);
              }
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
        {loadError && (
          <div class="map-loading" role="alert">
            Could not load this map. Check your connection and reload.
          </div>
        )}
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
                index={nameIndex(mode)}
                placeholder={mode === 'countries' ? 'Type a country…' : 'Type a city…'}
                suggestionsOn={settings.suggestions}
                shake={shake}
                onSubmit={onGuess}
                inputRef={inputRef}
                onFocusChange={setFocused}
                onType={() => feedback?.tone === 'warn' && setFeedback(null)}
              />
              <div class={`feedback${feedback?.tone ? ` ${feedback.tone}` : ''}`} role="status">
                {feedback?.text ?? (step === STEPS ? 'Last step: a wrong guess reveals the answer.' : '')}
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
                  <div class="reveal-name">{targetName(mode, targetId)}</div>
                  <div class="reveal-sub">
                    {mode === 'countries'
                      ? `Capital: ${country.capital}`
                      : `${city?.capital ? 'Capital of' : 'City in'} ${country.name}`}
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
              {(mode === 'countries' ? country.fact : city?.fact) && (
                <p class="fact">
                  <span class="fact-l">Did you know</span>
                  {mode === 'countries' ? country.fact : city?.fact}
                </p>
              )}
              <button
                ref={nextRef}
                class="btn btn-primary btn-lg next-btn"
                onClick={onNext}
                style={{ '--auto-dur': `${AUTO_ADVANCE_SECONDS}s` } as CSSProperties}
              >
                {round.index + 1 >= QUESTIONS_PER_ROUND ? 'See results' : 'Next question'}
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
