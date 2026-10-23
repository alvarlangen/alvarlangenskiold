/** Applies theme and motion preferences to <html> and notifies the map renderer. */
import { saveStore, type Settings } from './storage';

const mql = (q: string) => {
  try {
    return window.matchMedia(q);
  } catch {
    return null;
  }
};
const darkQuery = mql('(prefers-color-scheme: dark)');
const motionQuery = mql('(prefers-reduced-motion: reduce)');

export function resolvedTheme(s: Settings = saveStore.get().settings): 'dark' | 'light' {
  if (s.theme === 'system') return darkQuery && !darkQuery.matches ? 'light' : 'dark';
  return s.theme;
}

export function reducedMotion(s: Settings = saveStore.get().settings): boolean {
  if (s.motion === 'system') return !!motionQuery?.matches;
  return s.motion === 'reduce';
}

let last = '';
function apply() {
  const s = saveStore.get().settings;
  const theme = resolvedTheme(s);
  const motion = reducedMotion(s) ? 'reduce' : 'full';
  const key = theme + motion;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.motion = motion;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', theme === 'light' ? '#eef3f9' : '#050a14');
  if (key !== last) {
    last = key;
    window.dispatchEvent(new CustomEvent('mitd:theme'));
  }
}

export function initTheme() {
  apply();
  saveStore.subscribe(apply);
  darkQuery?.addEventListener?.('change', apply);
  motionQuery?.addEventListener?.('change', apply);
}
