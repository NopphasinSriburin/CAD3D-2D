import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { simplifyPolyline } from './drawing.js';

/** View directions (camera position relative to target) in display space (Y-up). */
export const VIEW_DEFS = {
  front: { dir: [0, 0, 1], up: [0, 1, 0], label: 'FRONT' },
  back: { dir: [0, 0, -1], up: [0, 1, 0], label: 'BACK' },
  top: { dir: [0, 1, 0], up: [0, 0, -1], label: 'TOP' },
  bottom: { dir: [0, -1, 0], up: [0, 0, 1], label: 'BOTTOM' },
  right: { dir: [1, 0, 0], up: [0, 1, 0], label: 'RIGHT' },
  left: { dir: [-1, 0, 0], up: [0, 1, 0], label: 'LEFT' },
  iso: { dir: [1, 1, 1], up: [0, 1, 0], label: 'ISOMETRIC' },
};

export function collectMeshes(root) {
  const out = [];
  root.updateMatrixWorld(true);
  root.traverseVisible((o) => {
    if (o.isMesh && !o.userData.overlay && o.geometry && o.geometry.attributes.position) out.push(o);
  });
  return out;
}

/**
 * Builds a welded triangle soup in world space plus an edge table with face adjacency.
 * Feature edges (creases, boundaries) are flagged; silhouettes are resolved per view.
 */
export function buildEdgeModel(meshes, creaseDeg = 30) {
  let triCount = 0;
  for (const m of meshes) {
    const g = m.geometry;
    triCount += Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
  }
  if (!triCount) throw new Error('NO_TRIANGLES');

  const pos = new Float32Array(triCount * 9);
  const v = new THREE.Vector3();
  let o = 0;
  for (const m of meshes) {
    const g = m.geometry;
    const p = g.attributes.position;
    const idx = g.index;
    const count = idx ? idx.count : p.count;
    const n = count - (count % 3);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(p, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld);
      pos[o++] = v.x;
      pos[o++] = v.y;
      pos[o++] = v.z;
    }
  }

  const soup = new THREE.BufferGeometry();
  soup.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  soup.computeBoundingBox();
  const box = soup.boundingBox.clone();
  const diag = box.getSize(new THREE.Vector3()).length() || 1;
  const welded = mergeVertices(soup, diag * 1e-6);
  soup.dispose();

  const P = welded.attributes.position.array;
  const I = welded.index.array;
  const V = P.length / 3;
  const T = I.length / 3;

  const faceN = new Float32Array(T * 3);
  const valid = new Uint8Array(T);
  for (let t = 0; t < T; t++) {
    const a = I[t * 3] * 3;
    const b = I[t * 3 + 1] * 3;
    const c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a];
    const uy = P[b + 1] - P[a + 1];
    const uz = P[b + 2] - P[a + 2];
    const wx = P[c] - P[a];
    const wy = P[c + 1] - P[a + 1];
    const wz = P[c + 2] - P[a + 2];
    let nx = uy * wz - uz * wy;
    let ny = uz * wx - ux * wz;
    let nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz);
    if (len > diag * diag * 1e-14) {
      nx /= len;
      ny /= len;
      nz /= len;
      valid[t] = 1;
    }
    faceN[t * 3] = nx;
    faceN[t * 3 + 1] = ny;
    faceN[t * 3 + 2] = nz;
  }

  const edgeMap = new Map();
  const eA = [];
  const eB = [];
  const eF1 = [];
  const eF2 = [];
  const eCount = [];
  for (let t = 0; t < T; t++) {
    if (!valid[t]) continue;
    for (let k = 0; k < 3; k++) {
      const a = I[t * 3 + k];
      const b = I[t * 3 + ((k + 1) % 3)];
      if (a === b) continue;
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      const key = lo * V + hi;
      let e = edgeMap.get(key);
      if (e === undefined) {
        e = eA.length;
        edgeMap.set(key, e);
        eA.push(lo);
        eB.push(hi);
        eF1.push(t);
        eF2.push(-1);
        eCount.push(1);
      } else {
        if (eCount[e] === 1) eF2[e] = t;
        eCount[e]++;
      }
    }
  }

  const E = eA.length;
  const cosCrease = Math.cos((creaseDeg * Math.PI) / 180);
  const feature = new Uint8Array(E);
  for (let e = 0; e < E; e++) {
    if (eCount[e] !== 2) {
      feature[e] = 1;
      continue;
    }
    const f1 = eF1[e] * 3;
    const f2 = eF2[e] * 3;
    const dot = faceN[f1] * faceN[f2] + faceN[f1 + 1] * faceN[f2 + 1] + faceN[f1 + 2] * faceN[f2 + 2];
    if (dot < cosCrease) feature[e] = 1;
  }

  welded.dispose();
  return {
    P,
    faceN,
    edges: { a: Uint32Array.from(eA), b: Uint32Array.from(eB), f1: Int32Array.from(eF1), f2: Int32Array.from(eF2), feature },
    box,
    diag,
    triangles: T,
  };
}

/* --------------------------------------------------------- segment utilities */

function chainSegments(segs, tol) {
  const nodes = new Map();
  const keyOf = (x, y) => `${Math.round(x / tol)},${Math.round(y / tol)}`;
  const nSeg = segs.length / 4;
  const ends = new Array(nSeg * 2);
  for (let s = 0; s < nSeg; s++) {
    for (let e = 0; e < 2; e++) {
      const key = keyOf(segs[s * 4 + e * 2], segs[s * 4 + e * 2 + 1]);
      let list = nodes.get(key);
      if (!list) nodes.set(key, (list = []));
      list.push(s * 2 + e);
      ends[s * 2 + e] = key;
    }
  }
  const used = new Uint8Array(nSeg);
  const polylines = [];
  const pt = (s, e) => [segs[s * 4 + e * 2], segs[s * 4 + e * 2 + 1]];

  const nextFrom = (key) => {
    const list = nodes.get(key);
    if (!list || list.length !== 2) return -1;
    for (const id of list) if (!used[id >> 1]) return id;
    return -1;
  };

  for (let s = 0; s < nSeg; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const fwd = [pt(s, 0), pt(s, 1)];
    let key = ends[s * 2 + 1];
    for (let id = nextFrom(key); id >= 0; id = nextFrom(key)) {
      const seg = id >> 1;
      const other = (id & 1) ^ 1;
      used[seg] = 1;
      fwd.push(pt(seg, other));
      key = ends[seg * 2 + other];
    }
    const back = [];
    key = ends[s * 2];
    for (let id = nextFrom(key); id >= 0; id = nextFrom(key)) {
      const seg = id >> 1;
      const other = (id & 1) ^ 1;
      used[seg] = 1;
      back.push(pt(seg, other));
      key = ends[seg * 2 + other];
    }
    polylines.push(back.reverse().concat(fwd));
  }
  return polylines;
}

function dedupeSegments(segs, tol, against = null) {
  const seen = against || new Set();
  const out = [];
  const q = (v) => Math.round(v / tol);
  for (let i = 0; i < segs.length; i += 4) {
    let ax = q(segs[i]);
    let ay = q(segs[i + 1]);
    let bx = q(segs[i + 2]);
    let by = q(segs[i + 3]);
    if (ax === bx && ay === by) continue;
    if (ax > bx || (ax === bx && ay > by)) [ax, ay, bx, by] = [bx, by, ax, ay];
    const key = `${ax},${ay},${bx},${by}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(segs[i], segs[i + 1], segs[i + 2], segs[i + 3]);
  }
  return { segs: out, keys: seen };
}

/* ------------------------------------------------------------- per-view projection */

/**
 * Projects the edge model for one view.
 * `renderDepth(camera, width, height, near, far)` must return RGBA bytes with 24-bit packed depth.
 */
export function projectView(model, viewName, renderDepth, { hidden = true, resolution = 2048 } = {}) {
  const def = VIEW_DEFS[viewName];
  const dir = new THREE.Vector3(...def.dir).normalize();
  const center = model.box.getCenter(new THREE.Vector3());
  const radius = model.diag / 2;

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  cam.position.copy(center).addScaledVector(dir, radius * 4);
  cam.up.set(...def.up);
  cam.lookAt(center);
  cam.updateMatrixWorld(true);
  const m = cam.matrixWorldInverse.elements;

  // Camera-space coordinates of every welded vertex
  const P = model.P;
  const V = P.length / 3;
  const CX = new Float64Array(V);
  const CY = new Float64Array(V);
  const CZ = new Float64Array(V);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < V; i++) {
    const x = P[i * 3];
    const y = P[i * 3 + 1];
    const z = P[i * 3 + 2];
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cz = m[2] * x + m[6] * y + m[10] * z + m[14];
    CX[i] = cx;
    CY[i] = cy;
    CZ[i] = cz;
    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;
    if (cz < minZ) minZ = cz;
    if (cz > maxZ) maxZ = cz;
  }

  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);
  const pad = Math.max(spanX, spanY) * 0.02;
  cam.left = minX - pad;
  cam.right = maxX + pad;
  cam.bottom = minY - pad;
  cam.top = maxY + pad;
  const near = -maxZ - pad;
  const far = -minZ + pad;
  cam.near = near;
  cam.far = far;
  cam.updateProjectionMatrix();

  const aspect = (cam.right - cam.left) / (cam.top - cam.bottom);
  const W = Math.max(64, Math.round(aspect >= 1 ? resolution : resolution * aspect));
  const H = Math.max(64, Math.round(aspect >= 1 ? resolution / aspect : resolution));
  const pixelWorld = (cam.right - cam.left) / W;

  // Depth is needed even without hidden lines: it decides which parts of each edge are visible.
  const rgba = renderDepth(cam, W, H, near, far);
  const depth = new Float32Array(W * H);
  for (let i = 0, j = 0; i < depth.length; i++, j += 4) depth[i] = (rgba[j] * 65536 + rgba[j + 1] * 256 + rgba[j + 2]) / 16777215;

  const range = far - near;
  const tol = (pixelWorld * 4 + model.diag * 1e-4) / range;
  const sx = W / (cam.right - cam.left);
  const sy = H / (cam.top - cam.bottom);

  const visibleAt = (px, py, d) => {
    const x = px | 0;
    const y = py | 0;
    let maxD = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = Math.min(H - 1, Math.max(0, y + dy));
      for (let dx = -1; dx <= 1; dx++) {
        const xx = Math.min(W - 1, Math.max(0, x + dx));
        const dd = depth[yy * W + xx];
        if (dd > maxD) maxD = dd;
      }
    }
    return d <= maxD + tol;
  };

  const { a: EA, b: EB, f1: F1, f2: F2, feature } = model.edges;
  const N = model.faceN;
  const vis = [];
  const hid = [];
  let flags = new Uint8Array(256);
  let raw = new Uint8Array(256);

  for (let e = 0; e < EA.length; e++) {
    let use = feature[e] === 1;
    if (!use && F2[e] >= 0) {
      const f1 = F1[e] * 3;
      const f2 = F2[e] * 3;
      const d1 = N[f1] * dir.x + N[f1 + 1] * dir.y + N[f1 + 2] * dir.z;
      const d2 = N[f2] * dir.x + N[f2 + 1] * dir.y + N[f2 + 2] * dir.z;
      use = d1 > 0 !== d2 > 0;
    }
    if (!use) continue;

    const a = EA[e];
    const b = EB[e];
    const ax = CX[a];
    const ay = CY[a];
    const bx = CX[b];
    const by = CY[b];
    const pax = (ax - cam.left) * sx;
    const pay = (ay - cam.bottom) * sy;
    const pbx = (bx - cam.left) * sx;
    const pby = (by - cam.bottom) * sy;
    const lenPx = Math.hypot(pbx - pax, pby - pay);
    if (lenPx < 0.25) continue;
    const da = (-CZ[a] - near) / range;
    const db = (-CZ[b] - near) / range;

    const n = Math.max(1, Math.ceil(lenPx / 1.5));
    if (raw.length < n + 1) {
      raw = new Uint8Array((n + 1) * 2);
      flags = new Uint8Array((n + 1) * 2);
    }
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      raw[k] = visibleAt(pax + (pbx - pax) * t, pay + (pby - pay) * t, da + (db - da) * t) ? 1 : 0;
      flags[k] = raw[k];
    }
    // Majority filter removes single-sample flicker
    for (let k = 1; k < n; k++) {
      if (raw[k - 1] === raw[k + 1] && raw[k] !== raw[k - 1]) flags[k] = raw[k - 1];
    }
    let state = flags[0];
    let t0 = 0;
    const emit = (isVisible, s0, s1) => {
      if (s1 - s0 <= 0) return;
      const target = isVisible ? vis : hid;
      target.push(ax + (bx - ax) * s0, ay + (by - ay) * s0, ax + (bx - ax) * s1, ay + (by - ay) * s1);
    };
    for (let k = 1; k <= n; k++) {
      if (flags[k] !== state) {
        const tm = (k - 0.5) / n;
        emit(state, t0, tm);
        state = flags[k];
        t0 = tm;
      }
    }
    emit(state, t0, 1);
  }

  const qTol = model.diag * 1e-7;
  const visD = dedupeSegments(vis, qTol);
  const hidD = hidden ? dedupeSegments(hid, qTol, new Set(visD.keys)) : { segs: [] };
  const simplifyEps = Math.max(spanX, spanY) * 1e-4;
  const visible = chainSegments(visD.segs, qTol).map((p) => simplifyPolyline(p, simplifyEps));
  const hiddenLines = hidden ? chainSegments(hidD.segs, qTol).map((p) => simplifyPolyline(p, simplifyEps)) : [];

  return {
    view: viewName,
    label: def.label,
    visible,
    hidden: hiddenLines,
    bounds: { minX, minY, maxX, maxY },
  };
}

/** Depth shader that packs linear orthographic depth into 24 bits of RGB. */
export function createDepthMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uNear: { value: 0 }, uFar: { value: 1 } },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uNear;
      uniform float uFar;
      varying float vDepth;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = (-mv.z - uNear) / (uFar - uNear);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vDepth;
      void main() {
        float d = floor(clamp(vDepth, 0.0, 1.0) * 16777215.0);
        float r = floor(d / 65536.0);
        float g = floor((d - r * 65536.0) / 256.0);
        float b = d - r * 65536.0 - g * 256.0;
        gl_FragColor = vec4(r / 255.0, g / 255.0, b / 255.0, 1.0);
      }`,
  });
}
