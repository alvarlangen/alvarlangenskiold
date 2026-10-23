/**
 * Text alternative for the map: where in its continent the lit area is
 * ("The lit pieces are in southern Africa"). Uses rough continent bounding boxes.
 */
const BOXES: Record<string, [number, number, number, number]> = {
  // [west, south, east, north]
  Africa: [-18, -35, 52, 37],
  Asia: [26, -11, 180, 78],
  Europe: [-25, 34, 45, 71],
  'North America': [-170, 7, -52, 83],
  'South America': [-82, -56, -34, 13],
  Oceania: [110, -48, 180, 20],
};

export function describeLocation(lon: number, lat: number, continent: string): string {
  const box = BOXES[continent];
  if (!box) return continent;
  const [w, s, e, n] = box;
  let x = (lon - w) / (e - w);
  if (continent === 'Oceania' && lon < 0) x = 1;
  const y = (lat - s) / (n - s);
  const ns = y > 0.62 ? 'northern' : y < 0.38 ? 'southern' : '';
  const ew = x > 0.62 ? 'eastern' : x < 0.38 ? 'western' : '';
  // "north-eastern", "southern", "central", …
  const where = ns && ew ? `${ns.slice(0, 5)}-${ew}` : ns || ew || 'central';
  return `${where} ${continent}`;
}
