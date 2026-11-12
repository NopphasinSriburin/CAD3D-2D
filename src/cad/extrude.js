import * as THREE from 'three';
import { boundsValid, drawingBounds, entityToChains, isLayerVisible, pointInPolygon, polygonArea } from './drawing.js';

/** Joins open chains whose endpoints touch into closed loops. */
function joinChains(chains, tol) {
  const cell = tol * 2;
  const grid = new Map();
  const keyOf = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  chains.forEach((c, i) => {
    for (const end of [0, 1]) {
      const p = end === 0 ? c[0] : c[c.length - 1];
      const key = keyOf(p[0], p[1]);
      let list = grid.get(key);
      if (!list) grid.set(key, (list = []));
      list.push({ i, end });
    }
  });
  const used = new Uint8Array(chains.length);
  const near = (p, q) => Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol;

  const findMatch = (p) => {
    const cx = Math.floor(p[0] / cell);
    const cy = Math.floor(p[1] / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = grid.get(`${cx + dx},${cy + dy}`);
        if (!list) continue;
        for (const cand of list) {
          if (used[cand.i]) continue;
          const c = chains[cand.i];
          const q = cand.end === 0 ? c[0] : c[c.length - 1];
          if (near(p, q)) return cand;
        }
      }
    }
    return null;
  };

  const loops = [];
  let open = 0;
  for (let i = 0; i < chains.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let pts = chains[i].slice();
    for (let guard = 0; guard < chains.length; guard++) {
      const m = findMatch(pts[pts.length - 1]);
      if (!m) break;
      used[m.i] = 1;
      const c = m.end === 0 ? chains[m.i] : chains[m.i].slice().reverse();
      pts = pts.concat(c.slice(1));
    }
    for (let guard = 0; guard < chains.length; guard++) {
      const m = findMatch(pts[0]);
      if (!m) break;
      used[m.i] = 1;
      const c = m.end === 1 ? chains[m.i] : chains[m.i].slice().reverse();
      pts = c.slice(0, -1).concat(pts);
    }
    if (pts.length >= 3 && near(pts[0], pts[pts.length - 1])) {
      pts.pop();
      loops.push(pts);
    } else {
      open++;
    }
  }
  return { loops, open };
}

/**
 * Extrudes closed profiles of a drawing along +Z. Nested loops alternate solid / hole.
 * Returns a Group in drawing units (Z-up).
 */
export function extrudeDrawing(drawing, { depth = 5 } = {}) {
  const b = drawingBounds(drawing);
  if (!boundsValid(b)) throw new Error('DRAWING_EMPTY');
  const extent = Math.max(b.maxX - b.minX, b.maxY - b.minY) || 1;
  const tol = extent * 1e-5;

  const closed = [];
  const open = [];
  for (const e of drawing.entities) {
    if (!isLayerVisible(drawing, e.layer) || e.type === 'text') continue;
    for (const ch of entityToChains(e, extent)) {
      if (ch.closed) closed.push(ch.points);
      else open.push(ch.points);
    }
  }
  const joined = joinChains(open, tol);
  const loops = closed.concat(joined.loops).filter((l) => l.length >= 3 && Math.abs(polygonArea(l)) > extent * extent * 1e-10);
  if (!loops.length) {
    const err = new Error('NO_CLOSED_PROFILES');
    err.openCount = joined.open;
    throw err;
  }

  // Nesting: each loop's parent is the smallest loop that contains it
  const info = loops.map((pts) => ({ pts, area: Math.abs(polygonArea(pts)), parent: -1, depth: 0 }));
  const order = info.map((_, i) => i).sort((i, j) => info[j].area - info[i].area);
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi];
    const probe = info[i].pts[0];
    for (let oj = oi - 1; oj >= 0; oj--) {
      const j = order[oj];
      if (info[j].area > info[i].area && pointInPolygon(probe, info[j].pts)) {
        if (info[i].parent < 0 || info[j].area < info[info[i].parent].area) info[i].parent = j;
      }
    }
  }
  for (const i of order) info[i].depth = info[i].parent < 0 ? 0 : info[info[i].parent].depth + 1;

  const shapes = new Map();
  let holes = 0;
  for (const i of order) {
    const L = info[i];
    const v2 = L.pts.map(([x, y]) => new THREE.Vector2(x, y));
    if (L.depth % 2 === 0) {
      shapes.set(i, new THREE.Shape(v2));
    } else {
      const s = shapes.get(L.parent);
      if (s) {
        s.holes.push(new THREE.Path(v2));
        holes++;
      }
    }
  }

  const geometry = new THREE.ExtrudeGeometry([...shapes.values()], { depth, bevelEnabled: false, curveSegments: 1 });
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: 0x9fb4cf, metalness: 0.15, roughness: 0.5 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Extruded profile';
  const group = new THREE.Group();
  group.name = 'Extrusion';
  group.add(mesh);
  return { object: group, stats: { profiles: shapes.size, holes, openSkipped: joined.open } };
}
