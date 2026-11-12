import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { defineConfig } from 'vite';

/** Fills dist/sw.js with the list of built files and a content version, so the app can run offline. */
function serviceWorkerPrecache() {
  let outDir = 'dist';
  return {
    name: 'morphcad-sw-precache',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files = [];
      const walk = (dir) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else files.push(relative(outDir, full).split('\\').join('/'));
        }
      };
      walk(outDir);
      const precache = files.filter((f) => f !== 'sw.js' && f !== 'index.html').sort();
      const hash = createHash('sha256');
      for (const f of precache.concat('index.html')) hash.update(f).update(readFileSync(join(outDir, f)));
      const swPath = join(outDir, 'sw.js');
      const sw = readFileSync(swPath, 'utf8')
        .replace('__MORPHCAD_VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__MORPHCAD_FILES__', JSON.stringify(precache));
      writeFileSync(swPath, sw);
    },
  };
}

export default defineConfig({
  // Relative base so the built site works from any sub-path (GitHub Pages, a NAS folder, etc.)
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  plugins: [serviceWorkerPrecache()],
});
