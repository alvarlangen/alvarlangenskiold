/**
 * Canvas map renderer built on d3-geo.
 *
 *  - "globe": orthographic projection (a 3D globe without WebGL — runs everywhere, light on the GPU)
 *  - "flat":  Mercator projection, pannable and zoomable
 *
 * The renderer only redraws when something changes (interaction, camera flights, fades, pulses);
 * otherwise the canvas is idle. It knows nothing about game rules: the UI tells it what is lit.
 */
import {
  geoDistance,
  geoGraticule10,
  geoInterpolate,
  geoMercator,
  geoOrthographic,
  geoPath,
  type GeoProjection,
} from 'd3-geo';
import type { Geometry, MultiPolygon } from 'geojson';
import type { WorldGeo } from './geodata';

export type Projection = 'globe' | 'flat';

export interface CountryScene {
  kind: 'country';
  pieces: MultiPolygon[];
  /** Indices of lit pieces in lighting order. */
  lit: number[];
  reveal: boolean;
  /** Natural Earth id of the target (to outline it on reveal). */
  outlineId?: string;
}

export interface CityScene {
  kind: 'city';
  target: [number, number];
  decoys: [number, number][];
  step: number;
  reveal: boolean;
}

export interface Ambient {
  kind: 'ambient';
  /** Decorative city lights for the landing page. */
  lights: [number, number][];
}

export type Scene = CountryScene | CityScene | Ambient | null;

interface Camera {
  lon: number;
  lat: number;
  zoom: number;
}

interface Colors {
  oceanCore: string;
  oceanEdge: string;
  atmosphere: string;
  grid: string;
  land: string;
  coast: string;
  border: string;
  lit: string;
  litEdge: string;
  glow: string;
  target: string;
  decoy: string;
  flash: string;
  blend: GlobalCompositeOperation;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const MAX_LAT = 80;

export interface MapViewOptions {
  interactive?: boolean;
  autoRotate?: boolean;
  reducedMotion?: boolean;
  /** Called when the user drags/zooms (e.g. to stop auto-rotation hints). */
  onInteract?: () => void;
}

export class MapView {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private world: WorldGeo | null = null;
  private scene: Scene = null;
  private projectionKind: Projection = 'globe';
  private cam: Camera = { lon: 10, lat: 20, zoom: 1 };
  private flight: { from: Camera; to: Camera; start: number; dur: number } | null = null;
  private litTimes = new Map<number, number>();
  private revealTime = 0;
  private sceneTime = 0;
  private raf = 0;
  private dirty = true;
  private colors!: Colors;
  private grid = geoGraticule10();
  private opts: Required<Omit<MapViewOptions, 'onInteract'>> & { onInteract?: () => void };
  private pointers = new Map<number, { x: number; y: number }>();
  private velocity = { x: 0, y: 0 };
  private lastMove = 0;
  private interacting = false;
  private resizeObs: ResizeObserver;
  private destroyed = false;
  private ringVisible = false;

  constructor(
    private canvas: HTMLCanvasElement,
    options: MapViewOptions = {},
  ) {
    this.loop = this.loop.bind(this);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not supported');
    this.ctx = ctx;
    this.opts = {
      interactive: options.interactive ?? true,
      autoRotate: options.autoRotate ?? false,
      reducedMotion: options.reducedMotion ?? false,
      onInteract: options.onInteract,
    };
    this.readColors();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas);
    this.resize();
    if (this.opts.interactive) this.bindInput();
    this.request();
  }

  // ── Public API ──────────────────────────────────────────────────────

  setWorld(world: WorldGeo) {
    this.world = world;
    this.invalidate();
  }

  setProjection(p: Projection) {
    if (p === this.projectionKind) return;
    this.projectionKind = p;
    this.cam.zoom = clamp(this.cam.zoom, this.minZoom(), this.maxZoom());
    this.invalidate();
  }

  get projection(): Projection {
    return this.projectionKind;
  }

  setReducedMotion(v: boolean) {
    this.opts.reducedMotion = v;
    this.invalidate();
  }

  setAutoRotate(v: boolean) {
    this.opts.autoRotate = v;
    this.invalidate();
  }

  /** Replace the scene. Pieces lit since the previous scene fade in. */
  setScene(scene: Scene) {
    const now = performance.now();
    const prev = this.scene;
    const sameCountry = prev?.kind === 'country' && scene?.kind === 'country' && prev.pieces === scene.pieces;
    if (!sameCountry) {
      this.litTimes.clear();
      this.sceneTime = now;
    }
    if (scene?.kind === 'country') {
      // Newly lit pieces light up one after another, so the region visibly grows.
      let k = 0;
      for (const i of scene.lit) {
        if (!this.litTimes.has(i)) this.litTimes.set(i, now + (this.opts.reducedMotion ? 0 : k++ * 70));
      }
    }
    const wasRevealed = (prev?.kind === 'country' || prev?.kind === 'city') && prev.reveal;
    const isRevealed = (scene?.kind === 'country' || scene?.kind === 'city') && scene.reveal;
    if (isRevealed && (!wasRevealed || !sameCountry)) this.revealTime = now;
    this.scene = scene;
    this.invalidate();
  }

  setView(lon: number, lat: number, zoom = this.cam.zoom) {
    this.flight = null;
    this.cam = { lon, lat: clamp(lat, -MAX_LAT, MAX_LAT), zoom: clamp(zoom, this.minZoom(), this.maxZoom()) };
    this.invalidate();
  }

  getView(): Camera {
    return { ...this.cam };
  }

  /** Smoothly glide to a point and zoom. */
  flyTo(lon: number, lat: number, zoom: number, dur = 1400) {
    const to = { lon, lat: clamp(lat, -MAX_LAT, MAX_LAT), zoom: clamp(zoom, this.minZoom(), this.maxZoom()) };
    if (this.opts.reducedMotion) {
      this.setView(to.lon, to.lat, to.zoom);
      return;
    }
    this.flight = { from: { ...this.cam }, to, start: performance.now(), dur };
    this.invalidate();
  }

  /** Zoom level that fits a lon/lat bounding box comfortably. */
  fitZoom(bbox: [number, number, number, number], fill = 0.55): number {
    const [w0, s, e0, n] = bbox;
    let lonSpan = e0 - w0;
    if (lonSpan < 0) lonSpan += 360;
    const lat = (s + n) / 2;
    const spanDeg = Math.max(lonSpan * Math.cos((lat * Math.PI) / 180), n - s, 0.02);
    const rad = (spanDeg * Math.PI) / 180;
    const base = this.baseScale();
    const k = this.projectionKind === 'flat' ? 1 / Math.cos((clamp(lat, -75, 75) * Math.PI) / 180) : 1;
    return clamp((fill * Math.min(this.w, this.h)) / (base * rad * k), this.minZoom(), 80);
  }

  zoomBy(f: number) {
    this.setView(this.cam.lon, this.cam.lat, this.cam.zoom * f);
    this.opts.onInteract?.();
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.unbind?.();
  }

  refreshColors() {
    this.readColors();
    this.invalidate();
  }

  // ── Internals ───────────────────────────────────────────────────────

  private readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
    this.colors = {
      oceanCore: v('--map-ocean-core', '#0b1a33'),
      oceanEdge: v('--map-ocean-edge', '#040a16'),
      atmosphere: v('--map-atmosphere', 'rgba(80,220,255,0.35)'),
      grid: v('--map-grid', 'rgba(120,200,255,0.10)'),
      land: v('--map-land', 'rgba(110,190,255,0.06)'),
      coast: v('--map-coast', 'rgba(140,210,255,0.16)'),
      border: v('--map-border', 'rgba(140,210,255,0.28)'),
      lit: v('--map-lit', '#36e4ff'),
      litEdge: v('--map-lit-edge', 'rgba(220,250,255,0.55)'),
      glow: v('--map-glow', 'rgba(54,228,255,0.85)'),
      target: v('--map-target', '#ffd166'),
      decoy: v('--map-decoy', '#9fe8ff'),
      flash: v('--map-flash', '#ffffff'),
      blend: v('--map-blend', 'lighter') as GlobalCompositeOperation,
    };
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.invalidate();
  }

  private baseScale() {
    return this.projectionKind === 'globe'
      ? Math.min(this.w, this.h) * 0.42
      : Math.max(this.w, this.h * 1.2) / (2 * Math.PI);
  }

  private minZoom() {
    return this.projectionKind === 'globe' ? 0.7 : 1;
  }

  private maxZoom() {
    return 400;
  }

  private makeProjection(): GeoProjection {
    const s = this.baseScale() * this.cam.zoom;
    if (this.projectionKind === 'globe') {
      return geoOrthographic()
        .rotate([-this.cam.lon, -this.cam.lat])
        .scale(s)
        .translate([this.w / 2, this.h / 2])
        .clipAngle(90)
        .precision(0.4);
    }
    const phi = (this.cam.lat * Math.PI) / 180;
    const ty = this.h / 2 + s * Math.log(Math.tan(Math.PI / 4 + phi / 2));
    return geoMercator()
      .rotate([-this.cam.lon, 0])
      .scale(s)
      .translate([this.w / 2, ty])
      .precision(0.4);
  }

  invalidate() {
    this.dirty = true;
    this.request();
  }

  private request() {
    if (!this.raf && !this.destroyed) this.raf = requestAnimationFrame(this.loop);
  }

  private needsAnimation(now: number): boolean {
    if (this.flight) return true;
    if (this.opts.autoRotate && !this.interacting && !this.opts.reducedMotion) return true;
    if (Math.abs(this.velocity.x) + Math.abs(this.velocity.y) > 0.01) return true;
    if (this.opts.reducedMotion) return false;
    for (const t of this.litTimes.values()) if (now - t < 900) return true;
    if (now - this.revealTime < 1600) return true;
    if (now - this.sceneTime < 1200) return true;
    // Pulsing rings, twinkling city lights and the ambient landing lights animate continuously.
    if (this.ringVisible || this.scene?.kind === 'city' || this.scene?.kind === 'ambient') return true;
    return false;
  }

  private loop(now: number) {
    this.raf = 0;
    if (this.destroyed) return;
    this.step(now);
    if (this.dirty) {
      this.draw(now);
      this.dirty = false;
    }
    if (this.needsAnimation(now)) {
      this.dirty = true;
      this.request();
    }
  }

  private step(now: number) {
    if (this.flight) {
      const { from, to, start, dur } = this.flight;
      const t = clamp((now - start) / dur, 0, 1);
      const e = easeInOut(t);
      if (this.projectionKind === 'globe') {
        const [lon, lat] = geoInterpolate([from.lon, from.lat], [to.lon, to.lat])(e);
        this.cam.lon = lon;
        this.cam.lat = lat;
      } else {
        let dl = to.lon - from.lon;
        if (dl > 180) dl -= 360;
        if (dl < -180) dl += 360;
        this.cam.lon = from.lon + dl * e;
        this.cam.lat = from.lat + (to.lat - from.lat) * e;
      }
      // Zoom out slightly mid-flight for long hops, then in.
      const dist = geoDistance([from.lon, from.lat], [to.lon, to.lat]);
      const hop = Math.min(1, dist / 1.2) * 0.35;
      const z = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * e);
      this.cam.zoom = z * (1 - hop * Math.sin(Math.PI * e));
      if (t >= 1) this.flight = null;
    } else if (!this.interacting) {
      if (Math.abs(this.velocity.x) + Math.abs(this.velocity.y) > 0.01) {
        this.panBy(this.velocity.x, this.velocity.y);
        this.velocity.x *= 0.92;
        this.velocity.y *= 0.92;
      } else if (this.opts.autoRotate && !this.opts.reducedMotion) {
        this.cam.lon = (this.cam.lon + 0.06) % 360;
      }
    }
  }

  private panBy(dx: number, dy: number) {
    // Degrees per pixel at the current scale, so a drag follows the finger at any zoom.
    const degPerPx = 180 / Math.PI / (this.baseScale() * this.cam.zoom);
    this.cam.lon -= dx * degPerPx;
    this.cam.lat = clamp(this.cam.lat + dy * degPerPx, -MAX_LAT, MAX_LAT);
  }

  // ── Drawing ─────────────────────────────────────────────────────────

  private draw(now: number) {
    const { ctx, dpr, colors } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const proj = this.makeProjection();
    const path = geoPath(proj, ctx);
    const globe = this.projectionKind === 'globe';
    const r = proj.scale();
    const [cx, cy] = proj.translate();

    // Ocean / sphere
    if (globe) {
      const atm = ctx.createRadialGradient(cx, cy, r * 0.98, cx, cy, r * 1.16);
      atm.addColorStop(0, colors.atmosphere);
      atm.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = atm;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.16, 0, Math.PI * 2);
      ctx.fill();
      const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
      g.addColorStop(0, colors.oceanCore);
      g.addColorStop(1, colors.oceanEdge);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, this.h);
      g.addColorStop(0, colors.oceanEdge);
      g.addColorStop(0.5, colors.oceanCore);
      g.addColorStop(1, colors.oceanEdge);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.w, this.h);
    }

    // Graticule
    ctx.beginPath();
    path(this.grid);
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 0.6;
    ctx.stroke();

    const scene = this.scene;
    const revealed = (scene?.kind === 'country' || scene?.kind === 'city') && scene.reveal;
    const revealT = revealed ? clamp((now - this.revealTime) / 900, 0, 1) : 0;

    // Land (no internal borders while playing, so the silhouette is not given away)
    if (this.world) {
      ctx.beginPath();
      path(this.world.land);
      ctx.fillStyle = colors.land;
      ctx.fill();
      ctx.strokeStyle = colors.coast;
      ctx.lineWidth = 0.6;
      ctx.stroke();
      if (scene?.kind === 'ambient' || revealed) {
        ctx.globalAlpha = scene?.kind === 'ambient' ? 0.7 : revealT;
        ctx.beginPath();
        path(this.world.borders);
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 0.6;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    if (scene?.kind !== 'country') this.ringVisible = false;
    if (scene?.kind === 'country') this.drawCountry(scene, path, now, revealT);
    else if (scene?.kind === 'city') this.drawCity(scene, proj, path, now, revealT);
    else if (scene?.kind === 'ambient') this.drawAmbient(scene, proj, now);

    // Globe rim highlight
    if (globe) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  private drawCountry(scene: CountryScene, path: ReturnType<typeof geoPath>, now: number, revealT: number) {
    const { ctx, colors } = this;
    const lit = scene.reveal ? scene.pieces.map((_, i) => i) : scene.lit;
    if (scene.reveal) {
      lit.forEach((i) => {
        if (!this.litTimes.has(i)) this.litTimes.set(i, now);
      });
    }
    const motion = !this.opts.reducedMotion;
    const settled: number[] = [];
    const fresh: { i: number; t: number }[] = [];
    for (const i of lit) {
      const t0 = this.litTimes.get(i) ?? 0;
      const t = motion ? clamp((now - t0) / 700, 0, 1) : 1;
      if (now < t0 && motion) continue;
      if (t >= 1) settled.push(i);
      else fresh.push({ i, t });
    }

    // Glow pass for settled pieces (one path → one blur, cheap).
    const drawSet = (ids: number[]) => {
      ctx.beginPath();
      for (const i of ids) path(scene.pieces[i]);
    };
    if (settled.length) {
      ctx.save();
      ctx.shadowColor = colors.glow;
      ctx.shadowBlur = 18;
      drawSet(settled);
      ctx.fillStyle = colors.lit;
      ctx.globalAlpha = 0.82;
      ctx.fill();
      ctx.restore();
      drawSet(settled);
      ctx.strokeStyle = colors.litEdge;
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    for (const item of fresh) {
      const e = easeInOut(item.t);
      ctx.save();
      ctx.shadowColor = colors.glow;
      ctx.shadowBlur = 30 * (1 - e) + 18;
      ctx.beginPath();
      path(scene.pieces[item.i]);
      ctx.globalAlpha = 0.82 * e;
      ctx.fillStyle = colors.lit;
      ctx.fill();
      ctx.globalAlpha = 1 - e;
      ctx.strokeStyle = colors.flash;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    // Outline of the whole country after the reveal.
    if (scene.reveal) {
      ctx.save();
      ctx.globalAlpha = revealT;
      ctx.beginPath();
      for (const g of scene.pieces) path(g);
      ctx.shadowColor = colors.glow;
      ctx.shadowBlur = 12;
      ctx.strokeStyle = colors.flash;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }

    // Small targets get a pulsing ring so they are always visible.
    this.ringVisible = false;
    if (lit.length) {
      const geom: Geometry = {
        type: 'GeometryCollection',
        geometries: lit.map((i) => scene.pieces[i]),
      };
      const [[x0, y0], [x1, y1]] = path.bounds(geom);
      const size = Math.max(x1 - x0, y1 - y0);
      if (Number.isFinite(size) && size < 18) {
        const [px, py] = path.centroid(geom);
        if (Number.isFinite(px)) {
          this.ringVisible = true;
          const phase = motion ? ((now - this.sceneTime) / 1600) % 1 : 0.4;
          ctx.save();
          for (const k of [0, 0.5]) {
            const p = (phase + k) % 1;
            ctx.beginPath();
            ctx.arc(px, py, 10 + p * 22, 0, Math.PI * 2);
            ctx.strokeStyle = colors.lit;
            ctx.globalAlpha = (1 - p) * 0.9;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(px, py, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = colors.flash;
          ctx.shadowColor = colors.glow;
          ctx.shadowBlur = 12;
          ctx.fill();
          ctx.restore();
        }
      }
    }
  }

  private visible(proj: GeoProjection, p: [number, number]): [number, number] | null {
    if (this.projectionKind === 'globe') {
      const r = proj.rotate();
      if (geoDistance(p, [-r[0], -r[1]]) > Math.PI / 2 - 0.02) return null;
    }
    const xy = proj(p);
    if (!xy) return null;
    if (xy[0] < -40 || xy[1] < -40 || xy[0] > this.w + 40 || xy[1] > this.h + 40) return null;
    return xy as [number, number];
  }

  private glowDot(x: number, y: number, radius: number, color: string, alpha: number, core = 1.6, halo = 0.55) {
    const { ctx } = this;
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, color);
    g.addColorStop(0.25, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = Math.min(1, alpha * halo);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.colors.flash;
    ctx.beginPath();
    ctx.arc(x, y, core, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawCity(
    scene: CityScene,
    proj: GeoProjection,
    path: ReturnType<typeof geoPath>,
    now: number,
    revealT: number,
  ) {
    const { ctx, colors } = this;
    const step = scene.reveal ? 6 : scene.step;
    const motion = !this.opts.reducedMotion;
    const appear = motion ? clamp((now - this.sceneTime) / 900, 0, 1) : 1;
    const twinkle = (i: number) => (motion ? 0.85 + 0.15 * Math.sin(now / 700 + i * 1.7) : 1);

    // Soft pool of light over the land around the cluster (centred on the cluster, not the target).
    const all = [scene.target, ...scene.decoys];
    const mean: [number, number] = [
      all.reduce((a, p) => a + p[0], 0) / all.length,
      all.reduce((a, p) => a + p[1], 0) / all.length,
    ];
    const m = this.visible(proj, mean);
    if (m && this.world) {
      const spread = Math.max(
        30,
        ...all.map((p) => {
          const xy = proj(p);
          return xy ? Math.hypot(xy[0] - m[0], xy[1] - m[1]) : 0;
        }),
      );
      const rad = spread * (1.2 + step * 0.12);
      ctx.save();
      ctx.beginPath();
      path(this.world.land);
      ctx.clip();
      const g = ctx.createRadialGradient(m[0], m[1], 0, m[0], m[1], rad);
      g.addColorStop(0, colors.lit);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.12 * appear;
      ctx.fillStyle = g;
      ctx.fillRect(m[0] - rad, m[1] - rad, rad * 2, rad * 2);
      ctx.restore();
    }

    // Brightness by step: identical in step 1, the target grows while decoys fade.
    const decoyAlpha = [1, 0.8, 0.6, 0.45, 0.32, 0.22][step - 1];
    const targetRadius = [9, 13, 18, 24, 30, 38][step - 1];
    ctx.save();
    ctx.globalCompositeOperation = colors.blend;
    scene.decoys.forEach((p, i) => {
      const xy = this.visible(proj, p);
      if (xy)
        this.glowDot(
          xy[0],
          xy[1],
          9,
          colors.decoy,
          decoyAlpha * appear * twinkle(i) * (scene.reveal ? 1 - revealT * 0.6 : 1),
        );
    });
    const t = this.visible(proj, scene.target);
    if (t) {
      const pulse = motion ? 1 + 0.06 * Math.sin(now / 420) : 1;
      const color = scene.reveal ? colors.target : step === 1 ? colors.decoy : colors.lit;
      this.glowDot(
        t[0],
        t[1],
        targetRadius * pulse,
        color,
        appear * twinkle(99),
        1.6 + step * 0.35,
        step === 1 ? 0.55 : 0.75 + step * 0.05,
      );
    }
    ctx.restore();

    if (scene.reveal && t) {
      ctx.save();
      const p = motion ? ((now - this.revealTime) / 1800) % 1 : 0.3;
      ctx.globalAlpha = revealT;
      ctx.strokeStyle = colors.target;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(t[0], t[1], 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = revealT * (1 - p);
      ctx.beginPath();
      ctx.arc(t[0], t[1], 14 + p * 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawAmbient(scene: Ambient, proj: GeoProjection, now: number) {
    const { ctx, colors } = this;
    const motion = !this.opts.reducedMotion;
    ctx.save();
    ctx.globalCompositeOperation = colors.blend;
    scene.lights.forEach((p, i) => {
      const xy = this.visible(proj, p);
      if (!xy) return;
      const tw = motion ? 0.55 + 0.45 * Math.sin(now / 900 + i * 2.3) : 0.8;
      this.glowDot(xy[0], xy[1], 7, colors.decoy, 0.35 + 0.5 * tw, 1.1);
    });
    ctx.restore();
  }

  // ── Input ───────────────────────────────────────────────────────────

  private unbind?: () => void;

  private bindInput() {
    const el = this.canvas;
    el.style.touchAction = 'none';
    let pinchStart = 0;
    let zoomStart = 1;
    const down = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.interacting = true;
      this.flight = null;
      this.velocity = { x: 0, y: 0 };
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
        zoomStart = this.cam.zoom;
      }
      this.opts.onInteract?.();
    };
    const move = (e: PointerEvent) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      this.pointers.set(e.pointerId, cur);
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchStart > 0) {
          this.cam.zoom = clamp((zoomStart * d) / pinchStart, this.minZoom(), this.maxZoom());
        }
      } else {
        const dx = cur.x - prev.x;
        const dy = cur.y - prev.y;
        this.panBy(dx, dy);
        const t = performance.now();
        const dt = Math.max(1, t - this.lastMove);
        this.lastMove = t;
        this.velocity = { x: (dx * 16) / dt, y: (dy * 16) / dt };
      }
      this.invalidate();
    };
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) pinchStart = 0;
      if (this.pointers.size === 0) {
        this.interacting = false;
        if (performance.now() - this.lastMove > 80 || this.opts.reducedMotion) this.velocity = { x: 0, y: 0 };
        this.invalidate();
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.flight = null;
      this.cam.zoom = clamp(this.cam.zoom * Math.exp(-e.deltaY * 0.0015), this.minZoom(), this.maxZoom());
      this.opts.onInteract?.();
      this.invalidate();
    };
    const dbl = () => this.zoomBy(2);
    const key = (e: KeyboardEvent) => {
      const step = 30;
      const map: Record<string, () => void> = {
        ArrowLeft: () => this.panBy(step, 0),
        ArrowRight: () => this.panBy(-step, 0),
        ArrowUp: () => this.panBy(0, step),
        ArrowDown: () => this.panBy(0, -step),
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
