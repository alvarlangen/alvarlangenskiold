/**
 * Satellite imagery for the map (XYZ raster tiles in Web Mercator).
 *
 * By default the game uses its own bundled imagery (public/imagery, built by scripts/build-imagery.py
 * from the ESA WorldCover Sentinel-2 composite), which covers the area around every city. An online
 * provider can be configured instead at build time (see .env.example and README):
 *   VITE_MAP_PROVIDER     local (default) | esri | maptiler | mapbox | custom | none
 *   VITE_MAP_KEY          the provider's API key / access token
 *   VITE_MAP_URL          custom only: URL template with {z} {x} {y} (and optionally {key})
 *   VITE_MAP_ATTRIBUTION  custom only: attribution text required by the provider
 *
 * `none` (or a provider without its key) uses only the bundled Natural Earth map.
 * Restrict an online provider's key to your site's domain in its dashboard: it is visible to browsers.
 */

export interface RasterSource {
  id: string;
  /** Tile URL for zoom z and tile column x / row y. */
  url: (z: number, x: number, y: number) => string;
  attribution: string;
  maxZoom: number;
  /** URL of an index of the tiles that exist (bundled imagery covers only the cities' surroundings). */
  index?: string;
  /** True when the source is served by a third party (shown on the Privacy page). */
  external: boolean;
}

interface Preset {
  template: string;
  attribution: string;
  maxZoom: number;
  index?: string;
}

/** Imagery without labels, so city names never appear on the map. */
const PRESETS: Record<string, Preset> = {
  // Bundled with the game: ESA WorldCover Sentinel-2 composite 2021 (scripts/build-imagery.py).
  local: {
    template: './imagery/{z}/{x}/{y}.webp',
    attribution: 'Sentinel-2 composite © ESA WorldCover project · contains modified Copernicus Sentinel data (2021)',
    maxZoom: 14,
    index: './imagery/index.json',
  },
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
  const p = (provider ?? '').trim().toLowerCase() || 'local';
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
    index: preset.index,
    external: p !== 'local',
  };
}

/** The source configured for this build, or null (use the bundled map). */
export const SATELLITE: RasterSource | null = makeSource(
  import.meta.env.VITE_MAP_PROVIDER,
  import.meta.env.VITE_MAP_KEY,
  import.meta.env.VITE_MAP_URL,
  import.meta.env.VITE_MAP_ATTRIBUTION,
);

/** Used if an online provider fails (wrong key or domain, outage): the bundled imagery. */
export const FALLBACK: RasterSource | null = SATELLITE?.external ? makeSource('local') : null;

/** Tile ids (x · 2^z + y) per zoom, from an index file written by scripts/build-imagery.py. */
type TileIndex = Map<number, Set<number>>;
const indexes = new Map<string, Promise<TileIndex | null>>();

function loadIndex(url: string): Promise<TileIndex | null> {
  let p = indexes.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { tiles: Record<string, number[]> } | null) => {
        if (!json) return null;
        const index: TileIndex = new Map();
        for (const [z, deltas] of Object.entries(json.tiles)) {
          const set = new Set<number>();
          let id = 0;
          for (const d of deltas) set.add((id += d));
          index.set(Number(z), set);
        }
        return index;
      })
      .catch(() => null);
    indexes.set(url, p);
  }
  return p;
}

/** Small LRU cache of decoded tile images. */
export class TileImages {
  private images = new Map<string, HTMLImageElement>();
  private failed = new Set<string>();
  private index: TileIndex | null = null;
  /** False while the tile index is loading (nothing is drawn yet) or when it failed to load. */
  ready = true;
  ok = 0;
  errors = 0;

  constructor(
    private source: RasterSource,
    private onLoad: () => void,
    private max = 400,
  ) {
    if (source.index) {
      this.ready = false;
      loadIndex(source.index).then((index) => {
        this.index = index;
        this.ready = true;
        // Without an index the bundled imagery is missing from this build: use the vector map.
        if (!index) this.errors = Infinity;
        this.onLoad();
      });
    }
  }

  /** Whether the source has this tile (always true for online providers). */
  has(z: number, x: number, y: number): boolean {
    if (!this.source.index) return true;
    return !!this.index?.get(z)?.has(x * 2 ** z + y);
  }

  /** The image if loaded; otherwise starts loading it and returns null. */
  get(z: number, x: number, y: number): HTMLImageElement | null {
    if (!this.has(z, x, y)) return null;
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
