import * as THREE from 'three';

/*
 * Bill of materials from a loaded model: one row per distinct part geometry, with quantity,
 * bounding box, surface area, projected areas and (for closed meshes) volume — the geometry
 * drivers a cost breakdown (CBD) needs. All values are in millimetre-based units.
 */

const NAME_SUFFIX = /(?:[ _.-]\d+|\s*\(\d+\)|<\d+>)$/;

function cleanName(name) {
  let n = (name || '').trim();
  while (NAME_SUFFIX.test(n) && n.replace(NAME_SUFFIX, '').trim()) n = n.replace(NAME_SUFFIX, '').trim();
  return n || 'Part';
}

/** Triangles of a mesh in source-file coordinates, scaled to millimetres. */
function triangles(mesh, toSource, mm) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const idx = g.index;
  const count = idx ? idx.count : pos.count;
  const n = Math.floor(count / 3);
  const m = new THREE.Matrix4().multiplyMatrices(toSource, mesh.matrixWorld);
  const out = new Float64Array(n * 9);
  const v = new THREE.Vector3();
  for (let i = 0; i < n * 3; i++) {
    v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m);
    out[i * 3] = v.x * mm;
    out[i * 3 + 1] = v.y * mm;
    out[i * 3 + 2] = v.z * mm;
  }
  return out;
}

function basicMetrics(T) {
  let area = 0;
  let vol = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < T.length; i += 9) {
    const ax = T[i], ay = T[i + 1], az = T[i + 2];
    const bx = T[i + 3], by = T[i + 4], bz = T[i + 5];
    const cx = T[i + 6], cy = T[i + 7], cz = T[i + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const wx = cx - ax, wy = cy - ay, wz = cz - az;
    area += 0.5 * Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    for (let k = 0; k < 9; k += 3) {
      for (let a = 0; a < 3; a++) {
        const x = T[i + k + a];
        if (x < min[a]) min[a] = x;
        if (x > max[a]) max[a] = x;
      }
    }
  }
  return { area, signedVolume: vol, dims: [max[0] - min[0], max[1] - min[1], max[2] - min[2]], min, max };
}

/** True when every edge is shared by exactly two triangles (watertight). */
function isClosed(T, tol) {
  const ids = new Map();
  const vid = (i) => {
    const key = `${Math.round(T[i] / tol)},${Math.round(T[i + 1] / tol)},${Math.round(T[i + 2] / tol)}`;
    let id = ids.get(key);
    if (id === undefined) ids.set(key, (id = ids.size));
    return id;
  };
  const edges = new Map();
  for (let i = 0; i < T.length; i += 9) {
    const a = vid(i);
    const b = vid(i + 3);
    const c = vid(i + 6);
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      if (p === q) continue;
      const key = p < q ? p * 4294967296 + q : q * 4294967296 + p;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  if (!edges.size) return false;
  for (const n of edges.values()) if (n !== 2) return false;
  return true;
}

/** Silhouette area seen along an axis (0 = X, 1 = Y, 2 = Z), by rasterising triangles onto a grid. */
function projectedArea(T, axis, min, max, res = 2048) {
  const u = (axis + 1) % 3;
  const w = (axis + 2) % 3;
  const spanU = max[u] - min[u];
  const spanW = max[w] - min[w];
  const span = Math.max(spanU, spanW);
  if (!(span > 0)) return 0;
  const cell = span / res;
  const W = Math.max(1, Math.ceil(spanU / cell) + 1);
  const H = Math.max(1, Math.ceil(spanW / cell) + 1);
  const grid = new Uint8Array(W * H);
  for (let i = 0; i < T.length; i += 9) {
    const x0 = (T[i + u] - min[u]) / cell, y0 = (T[i + w] - min[w]) / cell;
    const x1 = (T[i + 3 + u] - min[u]) / cell, y1 = (T[i + 3 + w] - min[w]) / cell;
    const x2 = (T[i + 6 + u] - min[u]) / cell, y2 = (T[i + 6 + w] - min[w]) / cell;
    const d = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(d) < 1e-12) continue;
    const s = d > 0 ? 1 : -1;
    const ix0 = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const ix1 = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
    const iy0 = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const iy1 = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let y = iy0; y <= iy1; y++) {
      const py = y + 0.5;
      for (let x = ix0; x <= ix1; x++) {
        const px = x + 0.5;
        const e0 = ((x1 - x0) * (py - y0) - (y1 - y0) * (px - x0)) * s;
        const e1 = ((x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)) * s;
        const e2 = ((x0 - x2) * (py - y2) - (y0 - y2) * (px - x2)) * s;
        if (e0 >= 0 && e1 >= 0 && e2 >= 0) grid[y * W + x] = 1;
      }
    }
  }
  let filled = 0;
  for (let i = 0; i < grid.length; i++) filled += grid[i];
  return filled * cell * cell;
}

const sig = (x) => (x ? Number(x.toPrecision(5)) : 0);

/**
 * meshes: visible meshes of the model; root: the display root (its inverse maps back to file axes);
 * mm: factor from file units to millimetres.
 * Returns parts with dims (mm), area / projected (cm²), volume (cm³, closed parts only).
 */
export function computeBOM(meshes, root, mm) {
  root.updateMatrixWorld(true);
  const toSource = root.matrixWorld.clone().invert();
  const groups = new Map();
  for (const mesh of meshes) {
    const T = triangles(mesh, toSource, mm);
    if (!T.length) continue;
    const b = basicMetrics(T);
    const key = [T.length / 9, sig(b.area), ...b.dims.map(sig).sort((x, y) => x - y)].join('|');
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { names: [], qty: 0, T, b }));
    g.names.push(mesh.name);
    g.qty++;
  }

  const parts = [];
  for (const g of groups.values()) {
    const { T, b } = g;
    const diag = Math.hypot(...b.dims) || 1;
    const closed = isClosed(T, diag * 1e-6);
    parts.push({
      name: g.qty > 1 ? cleanName(g.names[0]) : g.names[0] || 'Part',
      qty: g.qty,
      closed,
      triangles: T.length / 9,
      dims: { x: b.dims[0], y: b.dims[1], z: b.dims[2] },
      area: b.area / 100,
      projected: { x: projectedArea(T, 0, b.min, b.max) / 100, y: projectedArea(T, 1, b.min, b.max) / 100, z: projectedArea(T, 2, b.min, b.max) / 100 },
      volume: closed ? Math.abs(b.signedVolume) / 1000 : null,
    });
  }
  return parts;
}

/** Common moulding / machining materials with densities in g/cm³. */
export const MATERIALS = [
  { id: '', label: 'ไม่ระบุ', density: null },
  { id: 'PP', label: 'PP', density: 0.9 },
  { id: 'PP+EPDM-T20', label: 'PP+EPDM-T20 (กันชนรถยนต์)', density: 1.04 },
  { id: 'ABS', label: 'ABS', density: 1.05 },
  { id: 'PC/ABS', label: 'PC/ABS', density: 1.15 },
  { id: 'PA66-GF30', label: 'PA66-GF30', density: 1.36 },
  { id: 'Steel', label: 'เหล็ก (Steel)', density: 7.85 },
  { id: 'SUS304', label: 'สเตนเลส SUS304', density: 7.93 },
  { id: 'Al6061', label: 'อะลูมิเนียม 6061', density: 2.7 },
];
