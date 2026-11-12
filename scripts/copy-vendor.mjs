// Copies runtime assets that must be served as plain files (WASM + decoders) into public/vendor.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');

const copies = [
  ['occt-import-js/dist/occt-import-js.js', 'public/vendor/occt/occt-import-js.js'],
  ['occt-import-js/dist/occt-import-js.wasm', 'public/vendor/occt/occt-import-js.wasm'],
  ['three/examples/jsm/libs/draco/gltf', 'public/vendor/draco'],
];

for (const [from, to] of copies) {
  const src = join(nm, from);
  const dst = join(root, to);
  if (!existsSync(src)) {
    console.warn(`[copy-vendor] missing ${from} — skipped`);
    continue;
  }
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true });
}

console.log('[copy-vendor] vendor assets ready in public/vendor');
