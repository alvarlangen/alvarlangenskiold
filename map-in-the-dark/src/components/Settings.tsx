import { useState } from 'preact/hooks';
import { resetAll, saveStore, updateSettings, type Settings as S } from '../lib/storage';
import { useStore } from '../lib/store';
import { toast } from '../lib/ui';
import { sfx } from '../lib/sound';

function Toggle({
  label,
  desc,
  on,
  onChange,
}: {
  label: string;
  desc: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = label.replace(/\W+/g, '-').toLowerCase();
  return (
    <div class="setting">
      <div>
        <div class="s-l" id={id}>
          {label}
        </div>
        <div class="s-d">{desc}</div>
      </div>
      <button class="switch" role="switch" aria-checked={on} aria-labelledby={id} onClick={() => onChange(!on)} />
    </div>
  );
}

function Choice<T extends string>({
  label,
  desc,
  value,
  options,
  onChange,
}: {
  label: string;
  desc: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  const id = label.replace(/\W+/g, '-').toLowerCase();
  return (
    <div class="setting wrap">
      <div>
        <div class="s-l" id={id}>
          {label}
        </div>
        <div class="s-d">{desc}</div>
      </div>
      <div class="seg-ctl" role="radiogroup" aria-labelledby={id}>
        {options.map(([v, l]) => (
          <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Settings() {
  const { settings } = useStore(saveStore);
  const [confirm, setConfirm] = useState(false);
  const set = (p: Partial<S>) => updateSettings(p);
  return (
    <div class="page page-narrow">
      <h1>Settings</h1>
      <section class="glass card">
        <Toggle
          label="Sound"
          desc="Small synthesized sound effects."
          on={settings.sound}
          onChange={(v) => {
            set({ sound: v });
            if (v) setTimeout(() => sfx.tap(), 30);
          }}
        />
        <Toggle
          label="Haptics"
          desc="Vibration feedback on supported phones."
          on={settings.haptics}
          onChange={(v) => {
            set({ haptics: v });
            if (v) navigator.vibrate?.(20);
          }}
        />
        <Toggle
          label="Suggestion list"
          desc="Show matching names after two letters while you type."
          on={settings.suggestions}
          onChange={(v) => set({ suggestions: v })}
        />
        <Choice
          label="Map"
          desc="3D globe or flat 2D map. You can also switch during play."
          value={settings.projection}
          options={[
            ['globe', '3D globe'],
            ['flat', '2D map'],
          ]}
          onChange={(v) => set({ projection: v })}
        />
        <Choice
          label="Theme"
          desc="Dark, light, or follow your device."
          value={settings.theme}
          options={[
            ['system', 'Auto'],
            ['dark', 'Dark'],
            ['light', 'Light'],
          ]}
          onChange={(v) => set({ theme: v })}
        />
        <Choice
          label="Motion"
          desc="Reduce animations, camera flights and particle effects."
          value={settings.motion}
          options={[
            ['system', 'Auto'],
            ['reduce', 'Reduced'],
            ['full', 'Full'],
          ]}
          onChange={(v) => set({ motion: v })}
        />
      </section>

      <section class="glass card" style={{ marginTop: '18px' }}>
        <div class="setting wrap">
          <div>
            <div class="s-l">Reset saved data</div>
            <div class="s-d">Deletes your XP, streaks, stats and history from this device. Settings are kept.</div>
          </div>
          {confirm ? (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                class="btn btn-sm"
                style={{ '--b-bg': 'var(--wrong)', '--b-fg': '#fff', '--b-line': 'transparent' }}
                onClick={() => {
                  resetAll();
                  setConfirm(false);
                  toast('All progress has been reset');
                }}
              >
                Yes, reset
              </button>
              <button class="btn btn-sm btn-ghost" onClick={() => setConfirm(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button class="btn btn-sm btn-ghost" onClick={() => setConfirm(true)}>
              Reset…
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
