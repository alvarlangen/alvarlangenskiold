/**
 * Flat atlas map on a 2D canvas (Mercator), drawn from Natural Earth tiles:
 * water, land, built-up areas, lakes, rivers, railways, roads, borders and towns.
 *
 * Game overlays:
 *  - window: everything outside a circle is hidden under a light fog; the circle grows per step
 *  - search: a green circle that contains the target city and shrinks per step
 *  - pin:    the answer, with its name, after the reveal
 *
 * Only redraws while something changes. No WebGL, no external requests.
 */
import { loadTile, mercY, TILE_DEG, unMercY, type Path, type Tile } from './tiles';

const RAD = Math.PI / 180;
const EARTH_KM = 6371;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
/** "#rrggbb" + alpha → "rgba(…)". */
function withAlpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(255,255,255,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export interface Circle {
  center: [number, number];
  radiusKm: number;
}

export interface AtlasScene {
  window: Circle | null;
  search: Circle | null;
  pin: { at: [number, number]; label: string } | null;
}

interface Camera {
  lon: number;
  lat: number;
  /** Pixels per radian of longitude. */
  k: number;
}

interface Palette {
  water: string;
  land: string;
  urban: string;
  river: string;
  road: string;
  major: string;
  rail: string;
  border: string;
  admin1: string;
  town: string;
  townHalo: string;
  fog: string;
  windowLine: string;
  accent: string;
  accentFill: string;
  ink: string;
  paper: string;
  font: string;
}

export interface AtlasOptions {
  interactive?: boolean;
  reducedMotion?: boolean;
  onInteract?: () => void;
}

interface Tween {
  from: number;
  to: number;
  start: number;
  dur: number;
}

export class AtlasView {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private w = 1;
  private h = 1;
  private cam: Camera = { lon: 0, lat: 20, k: 300 };
  private flight: { from: Camera; to: Camera; start: number; dur: number } | null = null;
  private scene: AtlasScene = { window: null, search: null, pin: null };
  private winR: Tween | null = null;
  private searchR: Tween | null = null;
  private fogAlpha: Tween = { from: 1, to: 1, start: 0, dur: 1 };
  private pinTime = 0;
  private tiles = new Map<string, Tile>();
  private pending = new Set<string>();
  private raf = 0;
  private destroyed = false;
  private pal!: Palette;
  private opts: Required<Omit<AtlasOptions, 'onInteract'>> & { onInteract?: () => void };
  private resizeObs: ResizeObserver;
  private unbind?: () => void;
  /** Circle the camera is framing, re-fitted on resize until the user moves the map. */
  private fit: Circle | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    options: AtlasOptions = {},
  ) {
    this.frame = this.frame.bind(this);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not supported');
    this.ctx = ctx;
    this.opts = {
      interactive: options.interactive ?? true,
      reducedMotion: options.reducedMotion ?? false,
      onInteract: options.onInteract,
    };
    this.readPalette();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas);
    this.resize();
    if (this.opts.interactive) this.bindInput();
  }

  // ── Public API ──────────────────────────────────────────────────────

  /** Pixels per radian that make a circle of `radiusKm` fill `fill` of the shorter side. */
  fitK(lat: number, radiusKm: number, fill = 0.84): number {
    return (fill * Math.min(this.w, this.h) * 0.5 * EARTH_KM * Math.cos(lat * RAD)) / radiusKm;
  }

  setView(lon: number, lat: number, k = this.cam.k) {
    this.flight = null;
    this.cam = { lon, lat: clamp(lat, -80, 80), k: clamp(k, this.minK(), this.maxK()) };
    this.invalidate();
  }

  /** Glide to a point and scale. */
  flyTo(lon: number, lat: number, k: number, dur = 1100) {
    const to = { lon, lat: clamp(lat, -80, 80), k: clamp(k, this.minK(), this.maxK()) };
    if (this.opts.reducedMotion) return this.setView(to.lon, to.lat, to.k);
    this.flight = { from: { ...this.cam }, to, start: performance.now(), dur };
    this.invalidate();
  }

  /** Glide to frame a circle on the ground. The framing is kept if the canvas is resized. */
  frameCircle(c: Circle, dur = 1100) {
    this.flyTo(c.center[0], c.center[1], this.fitK(c.center[1], c.radiusKm), dur);
    this.fit = c;
  }

  /** Frame a circle immediately. */
  fitCircle(c: Circle) {
    this.setView(c.center[0], c.center[1], this.fitK(c.center[1], c.radiusKm));
    this.fit = c;
  }

  setScene(next: AtlasScene) {
    const now = performance.now();
    const prev = this.scene;
    const dur = this.opts.reducedMotion ? 1 : 900;
    const cur = (t: Tween | null, fallback: number) => (t ? this.tweenValue(t, now) : fallback);
    if (next.window) {
      const from = prev.window ? cur(this.winR, prev.window.radiusKm) : next.window.radiusKm * 0.6;
      this.winR = { from, to: next.window.radiusKm, start: now, dur };
    }
    if (next.search) {
      const from = prev.search ? cur(this.searchR, prev.search.radiusKm) : next.search.radiusKm;
      this.searchR = { from, to: next.search.radiusKm, start: now, dur };
    }
    const fogNow = this.tweenValue(this.fogAlpha, now);
    this.fogAlpha = { from: fogNow, to: next.window ? 1 : 0, start: now, dur: this.opts.reducedMotion ? 1 : 1200 };
    if (next.pin && !prev.pin) this.pinTime = now;
    this.scene = next;
    this.invalidate();
  }

  zoomBy(f: number) {
    this.flight = null;
    this.fit = null;
    this.cam.k = clamp(this.cam.k * f, this.minK(), this.maxK());
    this.opts.onInteract?.();
    this.invalidate();
  }

  getView(): Camera {
    return { ...this.cam };
  }

  setReducedMotion(v: boolean) {
    this.opts.reducedMotion = v;
  }

  refreshPalette() {
    this.readPalette();
    this.invalidate();
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.unbind?.();
  }

  invalidate() {
    if (!this.raf && !this.destroyed) this.raf = requestAnimationFrame(this.frame);
  }

  // ── Internals ───────────────────────────────────────────────────────

  private readPalette() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
    this.pal = {
      water: v('--map-water', '#d3e5e8'),
      land: v('--map-land', '#f8f7f2'),
      urban: v('--map-urban', '#ebe3d3'),
      river: v('--map-river', '#9cc3cf'),
      road: v('--map-road', '#dccfb6'),
      major: v('--map-major', '#e2ad5e'),
      rail: v('--map-rail', '#b9b3a6'),
      border: v('--map-border', '#8f8b7e'),
      admin1: v('--map-admin1', '#c8c3b6'),
      town: v('--map-town', '#4b5148'),
      townHalo: v('--map-town-halo', '#ffffff'),
      fog: v('--map-fog', '#eef2ec'),
      windowLine: v('--map-window', '#1f7a45'),
      accent: v('--accent', '#1f7a45'),
      accentFill: v('--map-search', 'rgba(31,122,69,0.12)'),
      ink: v('--text', '#14201a'),
      paper: v('--surface-solid', '#ffffff'),
      font: v('--font-body', 'system-ui, sans-serif'),
    };
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    if (this.fit) {
      const k = this.fitK(this.fit.center[1], this.fit.radiusKm);
      if (this.flight) this.flight.to.k = k;
      else this.cam.k = k;
    }
    this.invalidate();
  }

  private minK() {
    return this.fitK(this.cam.lat, 2500, 1);
  }

  private maxK() {
    return this.fitK(this.cam.lat, 4, 1);
  }

  private tweenValue(t: Tween, now: number) {
    const p = clamp((now - t.start) / t.dur, 0, 1);
    return t.from + (t.to - t.from) * ease(p);
  }

  private animating(now: number) {
    if (this.flight) return true;
    const live = (t: Tween | null) => !!t && now - t.start < t.dur;
    if (live(this.winR) || live(this.searchR) || live(this.fogAlpha)) return true;
    if (this.scene.pin && now - this.pinTime < 700) return true;
    return false;
  }

  private frame(now: number) {
    this.raf = 0;
    if (this.destroyed) return;
    if (this.flight) {
      const { from, to, start, dur } = this.flight;
      const p = clamp((now - start) / dur, 0, 1);
      const e = ease(p);
      let dl = to.lon - from.lon;
      if (dl > 180) dl -= 360;
      if (dl < -180) dl += 360;
      this.cam.lon = from.lon + dl * e;
      this.cam.lat = from.lat + (to.lat - from.lat) * e;
      this.cam.k = Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * e);
      if (p >= 1) this.flight = null;
    }
    this.draw(now);
    if (this.animating(now)) this.invalidate();
  }

  /** Request the tiles covering the current view. */
  private ensureTiles() {
    const { lon, lat, k } = this.cam;
    const halfW = this.w / 2 / k / RAD;
    const y0 = mercY(lat);
    const north = unMercY(y0 + this.h / 2 / k);
    const south = unMercY(y0 - this.h / 2 / k);
    const keys: [number, number][] = [];
    for (let ty = Math.floor(south / TILE_DEG); ty <= Math.floor(north / TILE_DEG); ty++) {
      for (let tx = Math.floor((lon - halfW) / TILE_DEG); tx <= Math.floor((lon + halfW) / TILE_DEG); tx++) {
        if (ty < -9 || ty > 8) continue;
        keys.push([tx, ty]);
      }
      if (keys.length > 40) break;
    }
    const visible: { tile: Tile; dx: number }[] = [];
    for (const [tx, ty] of keys) {
      const wx = ((((tx + 18) % 36) + 36) % 36) - 18;
      const key = `${wx}_${ty}`;
      const t = this.tiles.get(key);
      // Offset (radians) so a tile across the antimeridian is drawn next to the camera.
      const dx = (tx - wx) * TILE_DEG * RAD;
      if (t) visible.push({ tile: t, dx });
      else if (!this.pending.has(key)) {
        this.pending.add(key);
        loadTile(tx, ty).then((tile) => {
          if (tile) this.tiles.set(key, tile);
          else this.pending.delete(key);
          this.invalidate();
        });
      }
    }
    return visible;
  }

  private draw(now: number) {
    const { ctx, dpr, pal, w, h } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const k = this.cam.k;
    const cx = w / 2;
    const cy = h / 2;
    const x0 = this.cam.lon * RAD;
    const y0 = mercY(this.cam.lat);
    const visible = this.ensureTiles();

    ctx.fillStyle = pal.water;
    ctx.fillRect(0, 0, w, h);

    const polyPath = (list: Path[][], dx: number) => {
      for (const rings of list) {
        for (const r of rings) {
          ctx.moveTo(cx + k * (r[0] + dx - x0), cy - k * (r[1] - y0));
          for (let i = 2; i < r.length; i += 2) ctx.lineTo(cx + k * (r[i] + dx - x0), cy - k * (r[i + 1] - y0));
          ctx.closePath();
        }
      }
    };
    const linePath = (list: Path[], dx: number) => {
      for (const r of list) {
        ctx.moveTo(cx + k * (r[0] + dx - x0), cy - k * (r[1] - y0));
        for (let i = 2; i < r.length; i += 2) ctx.lineTo(cx + k * (r[i] + dx - x0), cy - k * (r[i + 1] - y0));
      }
    };
    const fillLayer = (name: 'land' | 'urban' | 'lake', color: string) => {
      ctx.beginPath();
      for (const { tile, dx } of visible) polyPath(tile[name], dx);
      ctx.fillStyle = color;
      ctx.fill('evenodd');
    };
    const strokeLayer = (
      name: 'river' | 'road' | 'major' | 'rail' | 'border' | 'admin1',
      color: string,
      width: number,
      dash?: number[],
    ) => {
      ctx.beginPath();
      for (const { tile, dx } of visible) linePath(tile[name], dx);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash ?? []);
      ctx.stroke();
    };

    // Detail grows with zoom: km per pixel decides line weights.
    const kmPerPx = (EARTH_KM * Math.cos(this.cam.lat * RAD)) / k;
    const zoomed = clamp(1.6 - Math.log10(kmPerPx) * 0.5, 0.8, 2);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    fillLayer('land', pal.land);
    fillLayer('urban', pal.urban);
    fillLayer('lake', pal.water);
    strokeLayer('river', pal.river, 1.1 * zoomed);
    strokeLayer('admin1', pal.admin1, 0.8, [3, 3]);
    strokeLayer('rail', pal.rail, 0.7 * zoomed, [4, 2]);
    strokeLayer('road', pal.road, 0.9 * zoomed);
    strokeLayer('major', pal.major, 1.5 * zoomed);
    strokeLayer('border', pal.border, 1.3, [7, 3, 2, 3]);
    ctx.setLineDash([]);

    // Towns: unlabeled dots sized by population class.
    const sizes = [1.5, 2.1, 2.9, 3.7];
    const minClass = kmPerPx > 2.5 ? 2 : kmPerPx > 0.9 ? 1 : 0;
    ctx.fillStyle = pal.town;
    ctx.strokeStyle = pal.townHalo;
    ctx.lineWidth = 1.2;
    for (const { tile, dx } of visible) {
      const t = tile.town;
      for (let i = 0; i < t.length; i += 3) {
        if (t[i + 2] < minClass) continue;
        const px = cx + k * (t[i] + dx - x0);
        const py = cy - k * (t[i + 1] - y0);
        if (px < -10 || py < -10 || px > w + 10 || py > h + 10) continue;
        ctx.beginPath();
        ctx.arc(px, py, sizes[t[i + 2]], 0, Math.PI * 2);
        ctx.stroke();
        ctx.fill();
      }
    }

    const toPx = (lon: number, lat: number): [number, number] => {
      let d = lon * RAD - x0;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      return [cx + k * d, cy - k * (mercY(lat) - y0)];
    };
    const kmToPx = (lat: number) => k / (EARTH_KM * Math.cos(lat * RAD));

    // Search area (always contains the target).
    const s = this.scene.search;
    if (s && this.searchR) {
      const r = this.tweenValue(this.searchR, now) * kmToPx(s.center[1]);
      const [sx, sy] = toPx(...s.center);
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(r, 6), 0, Math.PI * 2);
      ctx.fillStyle = pal.accentFill;
      ctx.fill();
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Fog outside the window, with a soft edge.
    const fog = this.tweenValue(this.fogAlpha, now);
    const win = this.scene.window ?? null;
    if (fog > 0.01) {
      const center = win?.center ?? [this.cam.lon, this.cam.lat];
      const rKm = this.winR ? this.tweenValue(this.winR, now) : 1e5;
      const r = rKm * kmToPx(center[1]) * (win ? 1 : 1 + (1 - fog) * 4);
      const [fx, fy] = toPx(center[0], center[1]);
      ctx.save();
      ctx.globalAlpha = fog;
      const g = ctx.createRadialGradient(fx, fy, r * 0.9, fx, fy, r);
      // Fade from the fog colour at zero alpha (not transparent black, which would leave a grey halo).
      g.addColorStop(0, withAlpha(pal.fog, 0));
      g.addColorStop(1, pal.fog);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      if (win) {
        ctx.beginPath();
        ctx.arc(fx, fy, r * 0.97, 0, Math.PI * 2);
        ctx.setLineDash([2, 5]);
        ctx.strokeStyle = pal.windowLine;
        ctx.globalAlpha = fog * 0.55;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // Answer pin.
    const pin = this.scene.pin;
    if (pin) {
      const t = this.opts.reducedMotion ? 1 : clamp((now - this.pinTime) / 600, 0, 1);
      const [px, py0] = toPx(...pin.at);
      const py = py0 - (1 - ease(t)) * 30;
      ctx.save();
      ctx.globalAlpha = t;
      ctx.beginPath();
      ctx.arc(px, py0, 5, 0, Math.PI * 2);
      ctx.fillStyle = pal.accent;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(px, py - 4);
      ctx.bezierCurveTo(px - 14, py - 20, px - 11, py - 38, px, py - 38);
      ctx.bezierCurveTo(px + 11, py - 38, px + 14, py - 20, px, py - 4);
      ctx.fillStyle = pal.accent;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, py - 27, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = pal.paper;
      ctx.fill();
      ctx.font = `600 15px ${pal.font}`;
      ctx.textAlign = 'center';
      const tw = ctx.measureText(pin.label).width;
      const lx = clamp(px, tw / 2 + 10, w - tw / 2 - 10);
      const ly = py - 50;
      ctx.fillStyle = pal.paper;
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(lx - tw / 2 - 10, ly - 17, tw + 20, 26, 13);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = pal.ink;
      ctx.fillText(pin.label, lx, ly + 1);
      ctx.restore();
    }

    this.drawScaleBar(kmPerPx);
  }

  private drawScaleBar(kmPerPx: number) {
    const { ctx, pal, h, w } = this;
    const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
    const km = nice.find((n) => n / kmPerPx >= 70) ?? 2000;
    const len = km / kmPerPx;
    const x = 14;
    const y = h - 16;
    ctx.save();
    ctx.font = `600 11px ${pal.font}`;
    ctx.fillStyle = pal.paper;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x - 6, y - 21, Math.max(len, ctx.measureText(`${km} km`).width) + 12, 28);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.lineTo(x + len, y - 5);
    ctx.stroke();
    ctx.fillStyle = pal.ink;
    ctx.textAlign = 'left';
    ctx.fillText(`${km} km`, x, y - 8);
    ctx.font = `10px ${pal.font}`;
    ctx.textAlign = 'right';
    ctx.globalAlpha = 0.7;
    ctx.fillText('Natural Earth · GeoNames', w - 10, h - 8);
    ctx.restore();
  }

  // ── Input: drag, pinch, wheel, double-click, keyboard ──────────────

  private bindInput() {
    const el = this.canvas;
    el.style.touchAction = 'none';
    const pts = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    let kStart = 0;
    const pan = (dx: number, dy: number) => {
      const k = this.cam.k;
      this.cam.lon -= dx / k / RAD;
      if (this.cam.lon > 180) this.cam.lon -= 360;
      if (this.cam.lon < -180) this.cam.lon += 360;
      this.cam.lat = clamp(unMercY(mercY(this.cam.lat) + dy / k), -80, 80);
    };
    const down = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.flight = null;
      this.fit = null;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
        kStart = this.cam.k;
      }
      this.opts.onInteract?.();
    };
    const move = (e: PointerEvent) => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pts.set(e.pointerId, cur);
      if (pts.size === 2 && pinch > 0) {
        const [a, b] = [...pts.values()];
        this.cam.k = clamp((kStart * Math.hypot(a.x - b.x, a.y - b.y)) / pinch, this.minK(), this.maxK());
      } else if (pts.size === 1) pan(cur.x - prev.x, cur.y - prev.y);
      this.invalidate();
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = 0;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.flight = null;
      this.fit = null;
      this.cam.k = clamp(this.cam.k * Math.exp(-e.deltaY * 0.0015), this.minK(), this.maxK());
      this.opts.onInteract?.();
      this.invalidate();
    };
    const dbl = () => this.zoomBy(2);
    const key = (e: KeyboardEvent) => {
      const map: Record<string, () => void> = {
        ArrowLeft: () => pan(40, 0),
        ArrowRight: () => pan(-40, 0),
        ArrowUp: () => pan(0, 40),
        ArrowDown: () => pan(0, -40),
        '+': () => this.zoomBy(1.4),
        '=': () => this.zoomBy(1.4),
        '-': () => this.zoomBy(1 / 1.4),
      };
      const fn = map[e.key];
      if (fn) {
        e.preventDefault();
        this.flight = null;
        fn();
        this.opts.onInteract?.();
        this.invalidate();
      }
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('dblclick', dbl);
    el.addEventListener('keydown', key);
    this.unbind = () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('dblclick', dbl);
      el.removeEventListener('keydown', key);
    };
  }
}
