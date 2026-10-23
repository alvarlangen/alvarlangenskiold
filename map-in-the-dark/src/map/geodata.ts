/**
 * Lazy-loaded geometry: the background world and per-country pieces (static JSON in /public/data).
 * Both are cached in memory and, via the service worker, offline.
 */
import { feature, merge, mesh } from 'topojson-client';
import { geoCentroid } from 'd3-geo';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Feature, MultiLineString, MultiPolygon } from 'geojson';

export interface WorldGeo {
  land: MultiPolygon;
  borders: MultiLineString;
  countries: Map<string, Feature>;
}

export interface CountryPieces {
  pieces: MultiPolygon[];
  areas: number[];
  neighbors: number[][];
  centroids: [number, number][];
  center: [number, number];
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
}

let worldPromise: Promise<WorldGeo> | null = null;

export function loadWorld(): Promise<WorldGeo> {
  worldPromise ??= fetch('data/world.json')
    .then((r) => {
      if (!r.ok) throw new Error(`world.json ${r.status}`);
      return r.json() as Promise<Topology>;
    })
    .then((topo) => {
      const obj = topo.objects.countries as GeometryCollection;
      const fc = feature(topo, obj);
      const countries = new Map<string, Feature>();
      for (const f of (fc as unknown as { features: Feature[] }).features)
        if (f.id != null) countries.set(String(f.id), f);
      return {
        land: merge(topo, obj.geometries as never) as MultiPolygon,
        borders: mesh(topo, obj, (a, b) => a !== b) as MultiLineString,
        countries,
      };
    })
    .catch((e) => {
      worldPromise = null;
      throw e;
    });
  return worldPromise;
}

interface RawPieces {
  s: number;
  p: number[][][][]; // piece → polygon → ring → flat delta-encoded ints
  a: number[];
  n: number[][];
  c: [number, number];
  b: [number, number, number, number];
}

function decodeRing(flat: number[], scale: number): [number, number][] {
  const ring: [number, number][] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < flat.length; i += 2) {
    x += flat[i];
    y += flat[i + 1];
    ring.push([x / scale, y / scale]);
  }
  if (ring.length) ring.push(ring[0]);
  return ring;
}

const pieceCache = new Map<string, Promise<CountryPieces>>();

export function loadPieces(id: string): Promise<CountryPieces> {
  let p = pieceCache.get(id);
  if (!p) {
    p = fetch(`data/pieces/${id}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`pieces ${id} ${r.status}`);
        return r.json() as Promise<RawPieces>;
      })
      .then((raw) => {
        const pieces: MultiPolygon[] = raw.p.map((polys) => ({
          type: 'MultiPolygon',
          coordinates: polys.map((rings) => rings.map((r) => decodeRing(r, raw.s))),
        }));
        return {
          pieces,
          areas: raw.a,
          neighbors: raw.n,
          centroids: pieces.map((g) => geoCentroid(g) as [number, number]),
          center: raw.c,
          bbox: raw.b,
        };
      })
      .catch((e) => {
        pieceCache.delete(id);
        throw e;
      });
    pieceCache.set(id, p);
  }
  return p;
}
