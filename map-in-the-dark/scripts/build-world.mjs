#!/usr/bin/env node
/**
 * Build public/data/world.json: the background world (land + borders) drawn behind the game.
 * Natural Earth 1:50m from world-atlas, simplified with topojson-simplify to keep the file small.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { presimplify, simplify, quantile } from 'topojson-simplify';
import { quantize } from 'topojson-client';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const topo = structuredClone(require('world-atlas/countries-50m.json'));

const pre = presimplify(topo);
const out = simplify(pre, quantile(pre, 0.25));
// Strip names (not needed; keeps the file small) but keep ids.
for (const g of out.objects.countries.geometries) delete g.properties;
// presimplify decodes arcs to absolute coordinates with weights; drop weights and re-quantise
// (delta-encoded integers) for a compact file.
out.arcs = out.arcs.map((arc) => arc.map((p) => [p[0], p[1]]));
delete out.transform;
const final = quantize(out, 1e5);

const file = path.join(ROOT, 'public/data/world.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(final));
console.log(`world.json ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
