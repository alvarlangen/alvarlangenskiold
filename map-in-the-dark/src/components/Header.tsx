import { IconHelp, IconMute, IconSettings, IconSound, IconStats, Logo } from './Icons';
import { levelFromXp } from '../game/scoring';
import { saveStore, updateSettings } from '../lib/storage';
import { useStore } from '../lib/store';

export function Header() {
  const save = useStore(saveStore);
  const lvl = levelFromXp(save.xp);
  return (
    <header class="site-header">
      <a class="brand" href="#/" aria-label="Map in the Dark, home">
        <Logo />
        <span class="brand-name">Map in the Dark</span>
      </a>
      <div class="header-spacer" />
      <nav class="header-actions" aria-label="Main">
        <a class="level-pill" href="#/stats" aria-label={`Level ${lvl.level}. Open stats`}>
          <span class="lv">{lvl.level}</span>
          <span class="lv-text">Level {lvl.level}</span>
        </a>
        <a class="icon-btn" href="#/about" aria-label="How to play" title="How to play">
          <IconHelp />
        </a>
        <button
          class="icon-btn"
          aria-label={save.settings.sound ? 'Mute sound' : 'Turn sound on'}
          aria-pressed={save.settings.sound}
          onClick={() => updateSettings({ sound: !save.settings.sound })}
        >
          {save.settings.sound ? <IconSound /> : <IconMute />}
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
        <span>Map in the Dark · A daily capital cities geography game</span>
        <nav aria-label="Footer">
          <a href="#/about">How to play</a>
          <a href="#/stats">Stats</a>
          <a href="#/settings">Settings</a>
          <a href="#/privacy">Privacy</a>
          <a href="#/credits">Credits</a>
        </nav>
      </div>
    </footer>
  );
}
