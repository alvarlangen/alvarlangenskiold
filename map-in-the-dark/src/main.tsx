import { render } from 'preact';
import '@fontsource-variable/figtree';
import '@fontsource/ibm-plex-mono/500.css';
import './styles/tokens.css';
import './styles/app.css';
import { App } from './components/App';
import { initTheme } from './lib/theme';

initTheme();
render(<App />, document.getElementById('app')!);

// Offline support: register the service worker in production builds.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support unavailable */
    });
  });
}
