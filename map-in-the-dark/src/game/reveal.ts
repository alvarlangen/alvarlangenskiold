/**
 * Where the map window and the search area sit for each step of a city question (pure, seeded).
 *
 * The window (visible map) is centred slightly off the city and grows each step. The search area is a
 * circle that always contains the city, offset in a seeded direction, shrinking each step.
 */
import { SEARCH_KM_BY_STEP, STEPS, WINDOW_KM_BY_STEP } from './config';
import { rngFrom } from './rng';

export interface CircleKm {
  center: [number, number];
  radiusKm: number;
}

/** Move `km` kilometres from a point in direction `bearing` (radians, 0 = north). Small-distance approximation. */
export function offsetKm([lon, lat]: [number, number], km: number, bearing: number): [number, number] {
  const dLat = (km * Math.cos(bearing)) / 111.2;
  const dLon = (km * Math.sin(bearing)) / (111.2 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  let l = lon + dLon;
  if (l > 180) l -= 360;
  if (l < -180) l += 360;
  return [l, lat + dLat];
}

/** Great-circle distance in km. */
export function distanceKm([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function revealPlan(city: [number, number], seed: string): { window: CircleKm[]; search: CircleKm[] } {
  const rng = rngFrom(`${seed}:reveal`);
  const wBearing = rng() * Math.PI * 2;
  const wDist = (0.15 + rng() * 0.25) * WINDOW_KM_BY_STEP[0];
  const windowCenter = offsetKm(city, wDist, wBearing);
  const sBearing = rng() * Math.PI * 2;
  const sShare = 0.3 + rng() * 0.35;
  const window: CircleKm[] = [];
  const search: CircleKm[] = [];
  for (let s = 0; s < STEPS; s++) {
    window.push({ center: windowCenter, radiusKm: WINDOW_KM_BY_STEP[s] });
    const r = SEARCH_KM_BY_STEP[s];
    search.push({ center: offsetKm(city, r * sShare, sBearing), radiusKm: r });
  }
  return { window, search };
}
