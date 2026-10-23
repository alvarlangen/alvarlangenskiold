/** Applies the motion preference to <html> and notifies the map renderer. (Single light theme.) */
import { saveStore, type Settings } from './storage';

const motionQuery = (() => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)');
  } catch {
    return null;
  }
})();

export function reducedMotion(s: Settings = saveStore.get().settings): boolean {
  if (s.motion === 'system') return !!motionQuery?.matches;
  return s.motion === 'reduce';
}

let last = '';
function apply() {
  const motion = reducedMotion() ? 'reduce' : 'full';
  document.documentElement.dataset.motion = motion;
  if (motion !== last) {
    last = motion;
    window.dispatchEvent(new CustomEvent('mitd:motion'));
  }
}

export function initTheme() {
  apply();
  saveStore.subscribe(apply);
  motionQuery?.addEventListener?.('change', apply);
}
