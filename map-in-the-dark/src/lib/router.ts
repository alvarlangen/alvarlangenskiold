/** Hash router: works on any static host (GitHub Pages, Netlify, Vercel) and offline. */
import { useEffect, useState } from 'preact/hooks';

export const currentPath = () => {
  const h = location.hash.replace(/^#/, '');
  return h.startsWith('/') ? h : '/';
};

export function navigate(path: string, replace = false) {
  const url = `#${path}`;
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRoute(): string {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const on = () => setPath(currentPath());
    window.addEventListener('hashchange', on);
    window.addEventListener('popstate', on);
    return () => {
      window.removeEventListener('hashchange', on);
      window.removeEventListener('popstate', on);
    };
  }, []);
  return path;
}
