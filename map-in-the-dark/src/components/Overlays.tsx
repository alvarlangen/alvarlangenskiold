import { useEffect, useRef } from 'preact/hooks';
import { levelUpStore, toastStore } from '../lib/ui';
import { useStore } from '../lib/store';
import { sfx } from '../lib/sound';
import { burst, cssVar, vibrate } from '../lib/fx';
import { xpToNext } from '../game/scoring';

export function Toasts() {
  const toasts = useStore(toastStore);
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} class={`toast${t.tone === 'gold' ? ' gold' : ''}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function LevelUpModal() {
  const level = useStore(levelUpStore);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (level == null) return;
    sfx.levelUp();
    vibrate([60, 40, 60, 40, 120]);
    burst(innerWidth / 2, innerHeight / 2.4, [cssVar('--gold'), cssVar('--accent'), '#ffffff'], 110);
    btn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && levelUpStore.set(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [level]);
  if (level == null) return null;
  return (
    <div class="modal-backdrop" onClick={() => levelUpStore.set(null)}>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="lvl-h" onClick={(e) => e.stopPropagation()}>
        <div class="lv-ring mono">{level}</div>
        <div class="eyebrow" style={{ color: 'var(--gold)' }}>
          Level up
        </div>
        <h2 id="lvl-h">You reached level {level}</h2>
        <p>Next level in {xpToNext(level)} XP. Keep the combo going.</p>
        <button ref={btn} class="btn btn-gold btn-lg" style={{ width: '100%' }} onClick={() => levelUpStore.set(null)}>
          Continue
        </button>
      </div>
    </div>
  );
}
