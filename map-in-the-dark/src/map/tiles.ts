/**
 * Lazy-loaded map tiles (10° × 10°, Natural Earth 1:10m + GeoNames towns) from /public/data/tiles.
 * Coordinates are decoded once into projected Mercator units (x = lon in radians, y = Mercator y),
 * so drawing only needs a scale and an offset per frame.
 */
import TILE_INDEX from '../data/tiles.json';

export const TILE_DEG = 10;
const SCALE = 1000;
const RAD = Math.PI / 180;

/** Mercator y for a latitude in degrees. */
export const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * RAD) / 2));
export const unMercY = (y: number) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / RAD;

/** A shape as a flat array [x0, y0, x1, y1, …] in projected units. */
export type Path = Float64Array;

export interface Tile {
  key: string;
  /** Western edge in radians (tiles are positioned relative to the camera, so wrapping is easy). */
  x0: number;
  land: Path[][];
  lake: Path[][];
  urban: Path[][];
  river: Path[];
  road: Path[];
  major: Path[];
  rail: Path[];
  border: Path[];
  admin1: Path[];
  /** [x, y, sizeClass] triples. */
  town: Float64Array;
}

const existing = new Set<string>(TILE_INDEX as string[]);
const cache = new Map<string, Promise<Tile | null>>();

function decode(flat: number[], ox: number, oy: number): Path {
  const out = new Float64Array(flat.length);
  let x = 0;
  let y = 0;
  for (let i = 0; i < flat.length; i += 2) {
    x += flat[i];
    y += flat[i + 1];
    out[i] = (ox + x / SCALE) * RAD;
    out[i + 1] = mercY(oy + y / SCALE);
  }
  return out;
}

type Raw = Partial<Record<'land' | 'lake' | 'urban', number[][][]>> &
  Partial<Record<'river' | 'road' | 'major' | 'rail' | 'border' | 'admin1', number[][]>> & { town?: number[] };

export function tileKey(tx: number, ty: number) {
  const wx = ((((tx + 18) % 36) + 36) % 36) - 18;
  return `${wx}_${ty}`;
}

export function loadTile(tx: number, ty: number): Promise<Tile | null> {
  const key = tileKey(tx, ty);
  if (!existing.has(key)) return Promise.resolve(null);
  let p = cache.get(key);
  if (!p) {
    const [wx, wy] = key.split('_').map(Number);
    const ox = wx * TILE_DEG;
    const oy = wy * TILE_DEG;
    p = fetch(`data/tiles/${key}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`tile ${key}: ${r.status}`);
        return r.json() as Promise<Raw>;
      })
      .then((raw) => {
        const polys = (l?: number[][][]) => (l ?? []).map((rings) => rings.map((r) => decode(r, ox, oy)));
        const lines = (l?: number[][]) => (l ?? []).map((r) => decode(r, ox, oy));
        const t = raw.town ?? [];
        const town = new Float64Array(t.length);
        for (let i = 0; i < t.length; i += 3) {
          town[i] = (ox + t[i] / SCALE) * RAD;
          town[i + 1] = mercY(oy + t[i + 1] / SCALE);
          town[i + 2] = t[i + 2];
        }
        return {
          key,
          x0: ox * RAD,
          land: polys(raw.land),
          lake: polys(raw.lake),
          urban: polys(raw.urban),
          river: lines(raw.river),
          road: lines(raw.road),
          major: lines(raw.major),
          rail: lines(raw.rail),
          border: lines(raw.border),
          admin1: lines(raw.admin1),
          town,
        } satisfies Tile;
      })
      .catch(() => {
        cache.delete(key);
        return null;
      });
    cache.set(key, p);
  }
  return p;
}
