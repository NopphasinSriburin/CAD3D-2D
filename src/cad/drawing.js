/**
 * Normalised 2D drawing model shared by every 2D importer/exporter.
 * Coordinates are Y-up (CAD convention). Angles are radians, arcs run CCW from a0 to a1.
 *
 * Entities:
 *   { type: 'polyline', points: [[x, y], ...], closed, fill? }
 *   { type: 'circle', c: [x, y], r }
 *   { type: 'arc', c: [x, y], r, a0, a1 }
 *   { type: 'text', p: [x, y], h, text, rot, align: 'left'|'center'|'right', valign: 'baseline'|'middle'|'top' }
 * Every entity also carries `layer` and optional `color` ('#rrggbb', null = foreground).
 */

export function createDrawing(units = 'mm') {
  return { entities: [], layers: new Map(), units, meta: {} };
}

export function ensureLayer(drawing, name, props = {}) {
  let layer = drawing.layers.get(name);
  if (!layer) {
    layer = { name, color: null, visible: true, lineType: 'continuous', weight: null, ...props };
    drawing.layers.set(name, layer);
  }
  return layer;
}

export function addEntity(drawing, entity) {
  const layer = entity.layer || '0';
  ensureLayer(drawing, layer);
  entity.layer = layer;
  drawing.entities.push(entity);
  return entity;
}

export function isLayerVisible(drawing, name) {
  const layer = drawing.layers.get(name);
  return !layer || layer.visible !== false;
}

export function visibleEntities(drawing) {
  return drawing.entities.filter((e) => isLayerVisible(drawing, e.layer));
}

export function resolveColor(drawing, entity) {
  if (entity.color) return entity.color;
  const layer = drawing.layers.get(entity.layer);
  return (layer && layer.color) || null;
}

export function resolveLineType(drawing, entity) {
  if (entity.lineType) return entity.lineType;
  const layer = drawing.layers.get(entity.layer);
  return (layer && layer.lineType) || 'continuous';
}

export function resolveWeight(drawing, entity) {
  const layer = drawing.layers.get(entity.layer);
  return (layer && layer.weight) || 0.25;
}

export function emptyBounds() {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function boundsValid(b) {
  return b && Number.isFinite(b.minX) && b.maxX >= b.minX && b.maxY >= b.minY;
}

function extend(b, x, y) {
  if (x < b.minX) b.minX = x;
  if (y < b.minY) b.minY = y;
  if (x > b.maxX) b.maxX = x;
  if (y > b.maxY) b.maxY = y;
}

function angleInSweep(a, a0, a1) {
  const TAU = Math.PI * 2;
  const sweep = normSweep(a0, a1);
  const d = (((a - a0) % TAU) + TAU) % TAU;
  return d <= sweep;
}

export function normSweep(a0, a1) {
  const TAU = Math.PI * 2;
  let s = (a1 - a0) % TAU;
  if (s <= 0) s += TAU;
  return s;
}

export function entityBounds(e, b = emptyBounds()) {
  switch (e.type) {
    case 'polyline':
      for (const p of e.points) extend(b, p[0], p[1]);
      break;
    case 'circle':
      extend(b, e.c[0] - e.r, e.c[1] - e.r);
      extend(b, e.c[0] + e.r, e.c[1] + e.r);
      break;
    case 'arc': {
      extend(b, e.c[0] + e.r * Math.cos(e.a0), e.c[1] + e.r * Math.sin(e.a0));
      extend(b, e.c[0] + e.r * Math.cos(e.a1), e.c[1] + e.r * Math.sin(e.a1));
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        if (angleInSweep(a, e.a0, e.a1)) extend(b, e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a));
      }
      break;
    }
    case 'text': {
      const lines = String(e.text).split('\n');
      const w = Math.max(...lines.map((l) => l.length)) * e.h * 0.62;
      const h = e.h * (1 + (lines.length - 1) * 1.6);
      let x0 = e.p[0];
      if (e.align === 'center') x0 -= w / 2;
      else if (e.align === 'right') x0 -= w;
      let y0 = e.p[1];
      if (e.valign === 'middle') y0 -= e.h / 2;
      else if (e.valign === 'top') y0 -= e.h;
      const c = Math.cos(e.rot || 0);
      const s = Math.sin(e.rot || 0);
      const corners = [[x0, y0 - h + e.h], [x0 + w, y0 - h + e.h], [x0, y0 + e.h], [x0 + w, y0 + e.h]];
      for (const [x, y] of corners) {
        const dx = x - e.p[0];
        const dy = y - e.p[1];
        extend(b, e.p[0] + dx * c - dy * s, e.p[1] + dx * s + dy * c);
      }
      break;
    }
    default:
      break;
  }
  return b;
}

export function drawingBounds(drawing, { onlyVisible = true } = {}) {
  const b = emptyBounds();
  for (const e of drawing.entities) {
    if (onlyVisible && !isLayerVisible(drawing, e.layer)) continue;
    entityBounds(e, b);
  }
  return b;
}

export function arcSegments(r, sweep, extent) {
  const rel = extent > 0 ? r / extent : 0.1;
  const perTurn = Math.min(160, Math.max(24, Math.round(48 + rel * 240)));
  return Math.max(2, Math.ceil((sweep / (Math.PI * 2)) * perTurn));
}

export function arcPoints(c, r, a0, a1, extent = 0) {
  const sweep = normSweep(a0, a1);
  const n = arcSegments(r, sweep, extent);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return pts;
}

/** Converts an entity into point chains: [{ points, closed }] (texts return nothing). */
export function entityToChains(e, extent = 0) {
  switch (e.type) {
    case 'polyline':
      return e.points.length >= 2 ? [{ points: e.points, closed: !!e.closed }] : [];
    case 'circle': {
      const pts = arcPoints(e.c, e.r, 0, Math.PI * 2, extent);
      pts.pop();
      return [{ points: pts, closed: true }];
    }
    case 'arc':
      return [{ points: arcPoints(e.c, e.r, e.a0, e.a1, extent), closed: false }];
    default:
      return [];
  }
}

/** Expands a polyline vertex list with DXF bulges into points. */
export function bulgeToPoints(vertices, closed, extent = 0) {
  const n = vertices.length;
  const segCount = closed ? n : n - 1;
  const result = [];
  for (let i = 0; i < segCount; i++) {
    const v0 = vertices[i];
    const v1 = vertices[(i + 1) % n];
    result.push([v0.x, v0.y]);
    const bulge = v0.bulge || 0;
    if (Math.abs(bulge) > 1e-9) {
      const theta = 4 * Math.atan(bulge);
      const dx = v1.x - v0.x;
      const dy = v1.y - v0.y;
      const chord = Math.hypot(dx, dy);
      if (chord > 0) {
        const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
        const mx = (v0.x + v1.x) / 2;
        const my = (v0.y + v1.y) / 2;
        const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
        const sign = (bulge > 0 ? 1 : -1) * (Math.abs(theta) > Math.PI ? -1 : 1);
        const cx = mx - (sign * h * dy) / chord;
        const cy = my + (sign * h * dx) / chord;
        const a0 = Math.atan2(v0.y - cy, v0.x - cx);
        const steps = arcSegments(r, Math.abs(theta), extent);
        for (let k = 1; k < steps; k++) {
          const a = a0 + (theta * k) / steps;
          result.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
      }
    }
  }
  if (!closed && n > 0) result.push([vertices[n - 1].x, vertices[n - 1].y]);
  return result;
}

export function polygonArea(points) {
  let a = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    const p = points[i];
    const q = points[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function pointInPolygon(pt, poly) {
  let inside = false;
  const [x, y] = pt;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Ramer–Douglas–Peucker simplification for an open polyline. */
export function simplifyPolyline(points, eps) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const eps2 = eps * eps;
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const [ax, ay] = points[i0];
    const [bx, by] = points[i1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let idx = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const [px, py] = points[i];
      let d2;
      if (len2 === 0) d2 = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d2 = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      }
      if (d2 > maxD) {
        maxD = d2;
        idx = i;
      }
    }
    if (maxD > eps2) {
      keep[idx] = 1;
      stack.push([i0, idx], [idx, i1]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

export function countByType(drawing) {
  const counts = {};
  for (const e of drawing.entities) counts[e.type] = (counts[e.type] || 0) + 1;
  return counts;
}
