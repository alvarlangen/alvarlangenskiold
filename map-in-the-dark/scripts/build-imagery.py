#!/usr/bin/env python3
"""
Satellite imagery bundled with the game, cut into Web Mercator XYZ tiles around every city.

Source: ESA WorldCover Sentinel-2 RGBNIR yearly median composite 2021 (10 m, cloud-free), CC BY 4.0,
read straight from the public AWS bucket (Cloud-Optimized GeoTIFFs in 1° x 1° cells, with overviews).

Only the area each city's map can show is produced: for every step the map's area around the city
at the zoom a typical phone uses for it (the reveal uses step 2's area). Elsewhere the game falls back
to lower zooms and to the bundled vector map.

Output: public/imagery/{z}/{x}/{y}.webp and public/imagery/index.json (which tiles exist).
Existing tiles are kept, so the script can be re-run to resume.

Requires: pip install rasterio numpy pillow

    python3 scripts/build-imagery.py                 build everything
    python3 scripts/build-imagery.py --dry           only count tiles
    python3 scripts/build-imagery.py --only paris-fr,oslo-no
"""
import argparse
import json
import math
import os
import time
import urllib.parse
import urllib.request
from multiprocessing import Pool

import numpy as np
import rasterio
from PIL import Image, ImageFilter
from rasterio.enums import Resampling
from rasterio.windows import Window

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'public', 'imagery')
CACHE = os.path.join(ROOT, 'scripts', '.cache')
BUCKET = 'https://esa-worldcover-s2.s3.eu-central-1.amazonaws.com'
PREFIX = 'rgbnir/2021'
CELL_PX = 12000  # pixels per degree at full resolution

# Mirrors VIEW_KM_BY_STEP in src/game/config.ts: the map's shorter side in km (REVEAL_VIEW_KM = step 2).
VIEW_KM_BY_STEP = [8, 25, 120, 400, 900, 2200]
# Area covered per step, as a radius around the city in units of half the view: the view's centre is
# up to 0.3 half-views from the city (reveal.ts) and the longer side of the map shows a bit more.
COVER = 1.35
# The close-up steps (1 and 2) are built for a large screen and cover a little less (corners use the next zoom).
CLOSE_STEPS = 2
COVER_CLOSE = 1.2
MIN_Z, MAX_Z = 3, 14
# From this zoom on, tiles are at or near the source's 10 m resolution: read it at full resolution,
# resample bicubically, sharpen lightly and encode with higher quality.
DETAIL_Z = 12
EARTH_KM = 6371
DEMO = {'id': 'demo-trondheim', 'lonlat': [10.395, 63.43]}  # landing page demo

ap = argparse.ArgumentParser()
ap.add_argument('--dry', action='store_true')
ap.add_argument('--only')
ap.add_argument('--px', type=float, default=800, help='device pixels across the shorter side of the map')
ap.add_argument('--px-close', type=float, default=1600, help='the same for the close-up steps (large screens)')
ap.add_argument('--quality', type=int, default=60)
ap.add_argument('--quality-detail', type=int, default=72)
ap.add_argument('--prune', action='store_true', help='delete tiles that are no longer needed')
ap.add_argument('--out', help='write tiles to another folder (for comparisons)')
ap.add_argument('--jobs', type=int, default=8, help='parallel workers (each needs up to ~1 GB)')
args = ap.parse_args()
if args.out:
    OUT = os.path.abspath(args.out)


# ── Which tiles ─────────────────────────────────────────────────────

def zoom_for(lat, view_km, px):
    """Zoom AtlasView.drawImagery picks when the shorter side of the map (px device pixels) shows view_km."""
    k = px * EARTH_KM * math.cos(math.radians(lat)) / view_km
    return min(MAX_Z, max(MIN_Z, round(math.log2(2 * math.pi * k / 256))))


def lon2x(lon, z):
    return (lon + 180) / 360 * 2 ** z


def lat2y(lat, z):
    return (1 - math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) / math.pi) / 2 * 2 ** z


def x2lon(x, z):
    return x / 2 ** z * 360 - 180


def y2lat(y, z):
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / 2 ** z))))


def distance_km(a, b):
    (lon1, lat1), (lon2, lat2) = a, b
    h = (math.sin(math.radians(lat2 - lat1) / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * EARTH_KM * math.asin(min(1, math.sqrt(h)))


def tiles_in_circle(center, r_km, z, into):
    lon, lat = center
    d_lat = r_km / 111.2
    d_lon = r_km / (111.2 * max(0.05, math.cos(math.radians(lat))))
    n = 2 ** z
    for x in range(math.floor(lon2x(lon - d_lon, z)), math.floor(lon2x(lon + d_lon, z)) + 1):
        for y in range(max(0, math.floor(lat2y(min(85, lat + d_lat), z))),
                       min(n - 1, math.floor(lat2y(max(-85, lat - d_lat), z))) + 1):
            lon0, lon1 = x2lon(x, z), x2lon(x + 1, z)
            lat1, lat0 = y2lat(y, z), y2lat(y + 1, z)
            nearest = (min(lon1, max(lon0, lon)), min(lat1, max(lat0, lat)))
            if distance_km(center, nearest) <= r_km:
                into.add((z, x % n, y))


def wanted_tiles():
    with open(os.path.join(ROOT, 'src', 'data', 'cities.json')) as f:
        places = [{'id': c['id'], 'lonlat': c['lonlat']} for c in json.load(f)] + [DEMO]
    if args.only:
        only = set(args.only.split(','))
        places = [p for p in places if p['id'] in only]
    wanted = set()
    for p in places:
        lat = p['lonlat'][1]
        for i, view in enumerate(VIEW_KM_BY_STEP):
            close = i < CLOSE_STEPS
            px = args.px_close if close else args.px
            tiles_in_circle(p['lonlat'], view / 2 * (COVER_CLOSE if close else COVER), zoom_for(lat, view, px), wanted)
    return places, wanted


# ── Source cells ────────────────────────────────────────────────────

def list_cells():
    path = os.path.join(CACHE, 'worldcover-s2-cells.json')
    if os.path.exists(path):
        with open(path) as f:
            return set(json.load(f))
    import re
    cells = set()
    for lat in range(-60, 84):
        folder = f"{'S' if lat < 0 else 'N'}{abs(lat):02d}"
        token = ''
        while True:
            q = f'list-type=2&prefix={PREFIX}/{folder}/'
            if token:
                q += '&continuation-token=' + urllib.parse.quote(token)
            xml = urllib.request.urlopen(f'{BUCKET}/?{q}').read().decode()
            cells.update(re.findall(r'_([NS]\d\d[EW]\d\d\d)_S2RGBNIR\.tif</Key>', xml))
            m = re.search(r'<NextContinuationToken>([^<]+)<', xml)
            if not m:
                break
            token = m.group(1)
    os.makedirs(CACHE, exist_ok=True)
    with open(path, 'w') as f:
        json.dump(sorted(cells), f)
    return cells


def cell_name(lat, lon):
    return f"{'S' if lat < 0 else 'N'}{abs(lat):02d}{'W' if lon < 0 else 'E'}{abs(lon):03d}"


def cell_url(name):
    return f'/vsicurl/{BUCKET}/{PREFIX}/{name[:3]}/ESA_WorldCover_10m_2021_v200_{name}_S2RGBNIR.tif'


# ── Colour ──────────────────────────────────────────────────────────

def make_lut():
    """Reflectance (0–10000) → display value: gamma, then a soft shoulder so deserts and snow keep texture."""
    v = np.arange(10001, dtype=np.float64)
    t = (v / 2600) ** (1 / 1.75)
    hi = t > 0.78
    t[hi] = 0.78 + 0.22 * (1 - np.exp(-(t[hi] - 0.78) / 0.22))
    return np.round(np.clip(t, 0, 1) * 255).astype(np.float32)


LUT = make_lut()
WATER = np.array([27, 49, 74], dtype=np.float32)  # display colour of water
SATURATION = 1.12
# Reflectance used where there is no data (open sea): reads as water below.
NODATA_FILL = np.array([150, 300, 450, 0], dtype=np.float32)


def colourise(r, g, b, nir):
    R, G, B = LUT[np.clip(r, 0, 10000).astype(np.int32)], LUT[np.clip(g, 0, 10000).astype(np.int32)], \
        LUT[np.clip(b, 0, 10000).astype(np.int32)]
    lum = 0.3 * R + 0.59 * G + 0.11 * B
    # Water: green brighter than near-infrared (NDWI > 0); snow and cloud are excluded by brightness.
    ndwi = (g - nir) / (g + nir + 1)
    w = np.clip(ndwi / 0.2, 0, 1) * (g <= 2200)
    out = np.empty(r.shape + (3,), dtype=np.float32)
    for i, c in enumerate((R, G, B)):
        sat = lum + (c - lum) * SATURATION
        out[..., i] = sat * (1 - w) + WATER[i] * w
    return np.clip(np.round(out), 0, 255).astype(np.uint8)


# ── Building ────────────────────────────────────────────────────────

def interp_weights(f, n, cubic):
    """Source indices and weights for sampling positions f (in pixels) along an axis of length n."""
    i0 = np.floor(f).astype(int)
    t = (f - i0)[:, None]
    if not cubic:
        idx = np.stack([i0, i0 + 1], axis=1)
        w = np.concatenate([1 - t, t], axis=1)
    else:
        # Catmull-Rom.
        idx = np.stack([i0 - 1, i0, i0 + 1, i0 + 2], axis=1)
        t2, t3 = t * t, t * t * t
        w = np.concatenate([
            -0.5 * t3 + t2 - 0.5 * t,
            1.5 * t3 - 2.5 * t2 + 1,
            -1.5 * t3 + 2 * t2 + 0.5 * t,
            0.5 * t3 - 0.5 * t2,
        ], axis=1)
    return np.clip(idx, 0, n - 1), w.astype(np.float32)


_datasets = {}
CELLS = set()


def dataset(name):
    ds = _datasets.get(name)
    if ds is None:
        if len(_datasets) > 12:
            old = next(iter(_datasets))
            _datasets.pop(old).close()
        for attempt in range(5):
            try:
                ds = rasterio.open(cell_url(name))
                break
            except Exception:
                if attempt == 4:
                    raise
                time.sleep(2 ** attempt)
        _datasets[name] = ds
    return ds


def build_tile(job):
    z, x, y = job
    cells = CELLS
    west, east = x2lon(x, z), x2lon(x + 1, z)
    north, south = y2lat(y, z), y2lat(y + 1, z)
    # Source grid (plain lon/lat) a bit finer than the output at the tile's high-latitude edge, but never
    # finer than the source itself: detail tiles read the source at full resolution, without resampling.
    res = 256 * 2 ** z / 360 * 1.15 / math.cos(math.radians(max(abs(north), abs(south))))
    detail = z >= DETAIL_Z
    if detail or res > CELL_PX:
        res = CELL_PX
    pad = 3 / res
    w0, e0, n0, s0 = west - pad, east + pad, north + pad, south - pad
    W = max(2, math.ceil((e0 - w0) * res))
    H = max(2, math.ceil((n0 - s0) * res))
    mosaic = np.zeros((4, H, W), dtype=np.float32)
    filled = np.zeros((H, W), dtype=bool)
    for la in range(math.floor(s0), math.ceil(n0)):
        for lo in range(math.floor(w0), math.ceil(e0)):
            name = cell_name(la, ((lo + 180) % 360) - 180)
            if name not in cells:
                continue
            ix0, ix1 = max(w0, lo), min(e0, lo + 1)
            iy1, iy0 = min(n0, la + 1), max(s0, la)
            c0, c1 = round((ix0 - w0) * res), round((ix1 - w0) * res)
            r0, r1 = round((n0 - iy1) * res), round((n0 - iy0) * res)
            if c1 <= c0 or r1 <= r0:
                continue
            win = Window((ix0 - lo) * CELL_PX, (la + 1 - iy1) * CELL_PX, (ix1 - ix0) * CELL_PX, (iy1 - iy0) * CELL_PX)
            for attempt in range(5):
                try:
                    data = dataset(name).read(
                        [1, 2, 3, 4], window=win, out_shape=(4, r1 - r0, c1 - c0),
                        resampling=Resampling.nearest if res == CELL_PX else Resampling.average,
                        boundless=False)
                    break
                except Exception:
                    if attempt == 4:
                        raise
                    _datasets.pop(name, None)
                    time.sleep(2 ** attempt)
            valid = data[:3].sum(axis=0) > 0
            mosaic[:, r0:r1, c0:c1][:, valid] = data[:, valid]
            filled[r0:r1, c0:c1] |= valid
    mosaic[:, ~filled] = NODATA_FILL[:, None]

    # Resample to Web Mercator. Rows depend only on latitude and columns only on longitude, so the
    # interpolation is separable: bicubic for detail tiles, bilinear otherwise.
    j = np.arange(256) + 0.5
    lats = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (y + j / 256) / 2 ** z))))
    lons = (x + j / 256) / 2 ** z * 360 - 180
    iy, wy = interp_weights((n0 - lats) * res - 0.5, H, detail)
    ix, wx = interp_weights((lons - w0) * res - 0.5, W, detail)
    bands = []
    for band in mosaic:
        cols = (band[:, ix] * wx[None]).sum(axis=2)  # (H, 256)
        bands.append((cols[iy] * wy[..., None]).sum(axis=1))  # (256, 256)
    rgb = colourise(*bands)
    img = Image.fromarray(rgb, 'RGB')
    if z >= DETAIL_Z - 1:
        img = img.filter(ImageFilter.UnsharpMask(radius=1.0, percent=70, threshold=2))
    path = os.path.join(OUT, str(z), str(x), f'{y}.webp')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, 'WEBP', quality=args.quality_detail if detail else args.quality, method=5)
    return os.path.getsize(path)


def try_build_tile(job):
    """A failed tile (e.g. a truncated download) is skipped and reported; re-run the script to retry it."""
    try:
        return build_tile(job)
    except Exception as e:
        print(f'failed {job}: {e}', flush=True)
        _datasets.clear()
        return -1


def worker_init(cells=None):
    if cells is not None:
        CELLS.update(cells)
    os.environ.update({
        'GDAL_DISABLE_READDIR_ON_OPEN': 'EMPTY_DIR',
        'CPL_VSIL_CURL_ALLOWED_EXTENSIONS': '.tif',
        'VSI_CACHE': 'TRUE',
        'VSI_CACHE_SIZE': str(128 * 1024 * 1024),
        'GDAL_CACHEMAX': '256',
        'GDAL_HTTP_MULTIRANGE': 'YES',
        'GDAL_HTTP_MERGE_CONSECUTIVE_RANGES': 'YES',
        'GDAL_HTTP_MAX_RETRY': '5',
        'GDAL_HTTP_RETRY_DELAY': '2',
        'GDAL_HTTP_TIMEOUT': '60',
        'GDAL_HTTP_CONNECTTIMEOUT': '20',
    })


def write_index():
    index = {}
    total = 0
    for z in sorted(os.listdir(OUT)):
        if not z.isdigit():
            continue
        ids = []
        for x in os.listdir(os.path.join(OUT, z)):
            for f in os.listdir(os.path.join(OUT, z, x)):
                ids.append(int(x) * 2 ** int(z) + int(f[:-5]))
        ids.sort()
        index[z] = [v - (ids[i - 1] if i else 0) for i, v in enumerate(ids)]
        total += len(ids)
    with open(os.path.join(OUT, 'index.json'), 'w') as f:
        json.dump({'v': 1, 'maxZoom': MAX_Z, 'tiles': index}, f, separators=(',', ':'))
    print(f'index: {total} tiles')


def main():
    places, wanted = wanted_tiles()
    by_zoom = {}
    for z, _, _ in wanted:
        by_zoom[z] = by_zoom.get(z, 0) + 1
    print(f'{len(places)} places -> {len(wanted)} tiles', ' '.join(f'z{z}:{n}' for z, n in sorted(by_zoom.items())))
    if args.prune:
        removed = 0
        for z in [d for d in os.listdir(OUT) if d.isdigit()]:
            for x in os.listdir(os.path.join(OUT, z)):
                for f in os.listdir(os.path.join(OUT, z, x)):
                    if (int(z), int(x), int(f[:-5])) not in wanted:
                        os.remove(os.path.join(OUT, z, x, f))
                        removed += 1
                if not os.listdir(os.path.join(OUT, z, x)):
                    os.rmdir(os.path.join(OUT, z, x))
            if not os.listdir(os.path.join(OUT, z)):
                os.rmdir(os.path.join(OUT, z))
        print(f'pruned {removed} tiles')
    if args.dry:
        return
    cells = list_cells()
    print(f'{len(cells)} source cells')
    todo = sorted(t for t in wanted if not os.path.exists(os.path.join(OUT, str(t[0]), str(t[1]), f'{t[2]}.webp')))
    # Neighbouring tiles go to the same worker (shared GDAL caches): order by zoom, then by 8 x 8 block.
    todo.sort(key=lambda t: (t[0], t[1] >> 3, t[2] >> 3, t[1], t[2]))
    print(f'{len(todo)} tiles to build')
    t0, done, size, failed = time.time(), 0, 0, 0
    # Workers are recycled now and then to keep GDAL's memory in check (a worker killed for memory
    # would hang the pool).
    with Pool(args.jobs, initializer=worker_init, initargs=(cells,), maxtasksperchild=100) as pool:
        for n in pool.imap_unordered(try_build_tile, todo, chunksize=16):
            done += 1
            if n < 0:
                failed += 1
                continue
            size += n
            if done % 500 == 0 or done == len(todo):
                print(f'{done}/{len(todo)} tiles, {size / 1e6:.1f} MB, {time.time() - t0:.0f} s', flush=True)
    if failed:
        print(f'{failed} tiles failed: run the script again to retry them')
    write_index()


if __name__ == '__main__':
    worker_init()
    main()
