import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { defineConfig, type Plugin } from 'vitest/config';
import preact from '@preact/preset-vite';

/**
 * Generates dist/sw.js after the build. The service worker precaches the app shell and fonts on
 * install, then caches every map tile and flag in the background, so the whole game works offline
 * after the first visit.
 */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'mitd-service-worker',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const root = path.resolve(outDir);
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const f of fs.readdirSync(dir)) {
          const p = path.join(dir, f);
          if (fs.statSync(p).isDirectory()) walk(p);
          else files.push(path.relative(root, p).split(path.sep).join('/'));
        }
      };
      walk(root);
      // Satellite tiles are cached on demand by the service worker (index.json is precached and versioned).
      const isImageryTile = (f: string) => f.startsWith('imagery/') && f.endsWith('.webp');
      const all = files.filter((f) => !['sw.js', '404.html'].includes(f) && !f.endsWith('.map') && !isImageryTile(f));
      const isExtra = (f: string) => f.startsWith('data/tiles/') || f.startsWith('flags/') || f === 'og-image.png';
      // Fonts: only the woff2 Latin subsets are precached; other subsets load on demand (unicode-range).
      const isLazyFont = (f: string) => /\.(woff2?)$/.test(f) && !/-latin-(?!ext)[\w-]*\.woff2$/.test(f);
      const core = ['./', ...all.filter((f) => !isExtra(f) && !isLazyFont(f))];
      const extra = all.filter(isExtra);
      const hash = crypto.createHash('sha256');
      for (const f of all) hash.update(f).update(fs.readFileSync(path.join(root, f)));
      const version = hash.digest('hex').slice(0, 12);
      const template = fs.readFileSync(path.resolve('src/sw-template.js'), 'utf8');
      fs.writeFileSync(
        path.join(root, 'sw.js'),
        template
          .replace('__VERSION__', version)
          .replace('__CORE__', JSON.stringify(core))
          .replace('__EXTRA__', JSON.stringify(extra)),
      );
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [preact(), serviceWorker()],
  build: { target: 'es2020', chunkSizeWarningLimit: 600, assetsInlineLimit: 0 },
  test: { include: ['tests/**/*.test.ts'] },
});
