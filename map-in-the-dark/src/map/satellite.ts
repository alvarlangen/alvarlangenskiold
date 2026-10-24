/**
 * Satellite imagery from a commercial map provider (XYZ raster tiles in Web Mercator).
 *
 * Configured at build time with environment variables (see .env.example and README):
 *   VITE_MAP_PROVIDER     esri | maptiler | mapbox | custom
 *   VITE_MAP_KEY          the provider's API key / access token
 *   VITE_MAP_URL          custom only: URL template with {z} {x} {y} (and optionally {key})
 *   VITE_MAP_ATTRIBUTION  custom only: attribution text required by the provider
 *
 * Without a provider and key the game falls back to the bundled Natural Earth map.
 * Restrict the key to your site's domain in the provider's dashboard: it is visible to browsers.
 */

export interface RasterSource {
  id: string;
  /** Tile URL for zoom z and tile column x / row y. */
  url: (z: number, x: number, y: number) => string;
  attribution: string;
  maxZoom: number;
}

interface Preset {
  template: string;
  attribution: string;
  maxZoom: number;
}

/** Imagery without labels, so city names never appear on the map. */
const PRESETS: Record<string, Preset> = {
  // ArcGIS Location Platform (basemap styles service) — World Imagery.
  esri: {
    template:
      'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token={key}',
    attribution: 'Powered by Esri · Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
  // MapTiler Cloud — Satellite.
  maptiler: {
    template: 'https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key={key}',
    attribution: '© MapTiler · © Maxar and contributors',
    maxZoom: 20,
  },
  // Mapbox — Satellite raster tiles.
  mapbox: {
    template: 'https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg90?access_token={key}',
    attribution: '© Mapbox · © Maxar',
    maxZoom: 19,
  },
};

export function makeSource(provider?: string, key?: string, url?: string, attribution?: string): RasterSource | null {
  const p = (provider ?? '').trim().toLowerCase();
  const k = (key ?? '').trim();
  let preset: Preset | undefined;
  if (p === 'custom' && url) preset = { template: url, attribution: attribution || 'Imagery provider', maxZoom: 19 };
  else preset = PRESETS[p];
  if (!preset || (!k && preset.template.includes('{key}'))) return null;
  const t = preset.template.replace('{key}', encodeURIComponent(k));
  return {
    id: p,
    url: (z, x, y) => t.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)),
    attribution: preset.attribution,
    maxZoom: preset.maxZoom,
  };
}

/** The source configured for this build, or null (use the bundled map). */
export const SATELLITE: RasterSource | null = makeSource(
  import.meta.env.VITE_MAP_PROVIDER,
  import.meta.env.VITE_MAP_KEY,
  import.meta.env.VITE_MAP_URL,
  import.meta.env.VITE_MAP_ATTRIBUTION,
);

/** Small LRU cache of decoded tile images. */
export class TileImages {
  private images = new Map<string, HTMLImageElement>();
  private failed = new Set<string>();
  ok = 0;
  errors = 0;

  constructor(
    private source: RasterSource,
    private onLoad: () => void,
    private max = 400,
  ) {}

  /** The image if loaded; otherwise starts loading it and returns null. */
  get(z: number, x: number, y: number): HTMLImageElement | null {
    const key = `${z}/${x}/${y}`;
    const img = this.images.get(key);
    if (img) {
      // Refresh LRU position.
      this.images.delete(key);
      this.images.set(key, img);
      return img.complete && img.naturalWidth > 0 ? img : null;
    }
    if (this.failed.has(key)) return null;
    const el = new Image();
    el.decoding = 'async';
    el.referrerPolicy = 'strict-origin-when-cross-origin';
    el.onload = () => {
      this.ok++;
      this.onLoad();
    };
    el.onerror = () => {
      this.errors++;
      this.failed.add(key);
      this.images.delete(key);
      this.onLoad();
    };
    el.src = this.source.url(z, x, y);
    this.images.set(key, el);
    if (this.images.size > this.max) {
      const oldest = this.images.keys().next().value as string;
      this.images.delete(oldest);
    }
    return null;
  }

  /** A cached image without starting a download (used for low-resolution placeholders). */
  peek(z: number, x: number, y: number): HTMLImageElement | null {
    const img = this.images.get(`${z}/${x}/${y}`);
    return img && img.complete && img.naturalWidth > 0 ? img : null;
  }

  /** True when the provider clearly refuses us (wrong key, blocked domain): fall back to the bundled map. */
  get broken(): boolean {
    return this.ok === 0 && this.errors >= 8;
  }
}
