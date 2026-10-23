import { useEffect, useRef, useState } from 'preact/hooks';
import { MapView, type MapViewOptions } from '../map/MapView';
import { loadWorld } from '../map/geodata';
import { saveStore } from '../lib/storage';
import { reducedMotion } from '../lib/theme';

interface Props extends MapViewOptions {
  class?: string;
  label: string;
  onReady?: (view: MapView) => void;
}

/** Canvas host for MapView. Loads the world lazily, follows theme, motion and projection settings. */
export function MapCanvas({ class: cls, label, onReady, ...opts }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<MapView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const canvas = ref.current!;
    let view: MapView;
    try {
      view = new MapView(canvas, { ...opts, reducedMotion: reducedMotion() });
    } catch {
      setError('Your browser cannot draw the map.');
      return;
    }
    viewRef.current = view;
    view.setProjection(saveStore.get().settings.projection);
    onReady?.(view);
    let alive = true;
    loadWorld()
      .then((w) => alive && (view.setWorld(w), setLoading(false)))
      .catch(
        () => alive && (setError('Map data could not be loaded. Check your connection and reload.'), setLoading(false)),
      );
    const onTheme = () => {
      view.refreshColors();
      view.setReducedMotion(reducedMotion());
    };
    window.addEventListener('mitd:theme', onTheme);
    const unsub = saveStore.subscribe((s) => view.setProjection(s.settings.projection));
    const onVis = () => {
      if (!document.hidden) view.invalidate();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      window.removeEventListener('mitd:theme', onTheme);
      document.removeEventListener('visibilitychange', onVis);
      unsub();
      view.destroy();
    };
  }, []);

  return (
    <>
      <canvas ref={ref} class={cls} role="img" aria-label={label} tabIndex={opts.interactive === false ? -1 : 0} />
      {(loading || error) && (
        <div class="map-loading" aria-hidden={!error}>
          {error ?? 'Loading map…'}
        </div>
      )}
    </>
  );
}
