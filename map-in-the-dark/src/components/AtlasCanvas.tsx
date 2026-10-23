import { useEffect, useRef, useState } from 'preact/hooks';
import { AtlasView, type AtlasOptions } from '../map/AtlasView';
import { reducedMotion } from '../lib/theme';

interface Props extends AtlasOptions {
  class?: string;
  label: string;
  onReady?: (view: AtlasView) => void;
}

/** Canvas host for AtlasView; follows the reduced-motion setting. */
export function AtlasCanvas({ class: cls, label, onReady, ...opts }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let view: AtlasView;
    try {
      view = new AtlasView(ref.current!, { ...opts, reducedMotion: reducedMotion() });
    } catch {
      setError('Your browser cannot draw the map.');
      return;
    }
    onReady?.(view);
    const onMotion = () => view.setReducedMotion(reducedMotion());
    const onFonts = () => view.refreshPalette();
    window.addEventListener('mitd:motion', onMotion);
    document.fonts?.ready.then(onFonts).catch(() => {});
    return () => {
      window.removeEventListener('mitd:motion', onMotion);
      view.destroy();
    };
  }, []);

  return (
    <>
      <canvas ref={ref} class={cls} role="img" aria-label={label} tabIndex={opts.interactive === false ? -1 : 0} />
      {error && (
        <div class="map-loading" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
