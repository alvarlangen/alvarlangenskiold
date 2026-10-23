import { IconMoon, IconMute, IconSettings, IconSound, IconStats, IconSun, Logo } from './Icons';
import { levelFromXp } from '../game/scoring';
import { saveStore, updateSettings } from '../lib/storage';
import { useStore } from '../lib/store';
import { resolvedTheme } from '../lib/theme';

export function Header() {
  const save = useStore(saveStore);
  const lvl = levelFromXp(save.xp);
  const theme = resolvedTheme(save.settings);
  return (
    <header class="site-header">
      <a class="brand" href="#/" aria-label="Map in the Dark — home">
        <Logo />
        <span class="brand-name">Map in the Dark</span>
      </a>
      <div class="header-spacer" />
      <nav class="header-actions" aria-label="Main">
        <a class="level-pill" href="#/stats" aria-label={`Level ${lvl.level}. Open stats`}>
          <span class="lv">{lvl.level}</span>
          <span class="lv-text">Level {lvl.level}</span>
        </a>
        <button
          class="icon-btn"
          aria-label={save.settings.sound ? 'Mute sound' : 'Turn sound on'}
          aria-pressed={save.settings.sound}
          onClick={() => updateSettings({ sound: !save.settings.sound })}
        >
          {save.settings.sound ? <IconSound /> : <IconMute />}
        </button>
        <button
          class="icon-btn"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={() => updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' })}
        >
          {theme === 'dark' ? <IconSun /> : <IconMoon />}
        </button>
        <a class="icon-btn" href="#/stats" aria-label="Stats" title="Stats">
          <IconStats />
        </a>
        <a class="icon-btn" href="#/settings" aria-label="Settings" title="Settings">
          <IconSettings />
        </a>
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer class="site-footer">
      <div class="inner">
        <span>© {new Date().getUTCFullYear()} Map in the Dark · A daily geography game</span>
        <nav aria-label="Footer">
          <a href="#/about">About</a>
          <a href="#/stats">Stats</a>
          <a href="#/settings">Settings</a>
          <a href="#/privacy">Privacy</a>
          <a href="#/credits">Credits</a>
        </nav>
      </div>
    </footer>
  );
}
