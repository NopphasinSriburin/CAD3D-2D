import DxfParser from 'dxf-parser';
import ACI from 'dxf-parser/dist/AutoCadColorIndex.js';
import { Color } from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { unitFromDxfCode } from '../core/units.js';
import { addEntity, arcPoints, bulgeToPoints, createDrawing, drawingBounds, ensureLayer, normSweep } from '../cad/drawing.js';

/* ------------------------------------------------------------------ DXF */

function aciToHex(index) {
  if (index == null || index <= 0 || index >= 256 || index === 7) return null; // 7 = white/black → foreground
  const rgb = ACI[index];
  if (rgb == null) return null;
  return '#' + rgb.toString(16).padStart(6, '0');
}

const IDENTITY = [1, 0, 0, 1, 0, 0];

function mul(m, n) {
  // m ∘ n — apply n first, then m. Matrices are [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

const tx = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const isIdentity = (m) => m === IDENTITY;
const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
const isUniform = (m) => Math.abs(Math.hypot(m[0], m[1]) - Math.hypot(m[2], m[3])) < 1e-9 * Math.max(1, Math.hypot(m[0], m[1])) && m[0] * m[3] - m[1] * m[2] > 0;
const rotationOf = (m) => Math.atan2(m[1], m[0]);

export function cleanCadText(s) {
  return String(s ?? '')
    .replace(/\\U\+([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\P/gi, '\n')
    .replace(/\\S([^;]*);/g, (_, x) => x.replace(/[#^]/, '/'))
    .replace(/\\[ACcFfHhQqTtWwp][^;]*;/g, '')
    .replace(/\\[LlOoKk]/g, '')
    .replace(/\\~/g, ' ')
    .replace(/\\\\/g, '\\')
    .replace(/[{}]/g, '')
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%%/g, '%');
}

function evalBSpline(degree, knots, ctrl, samples) {
  const n = ctrl.length;
  const p = Math.min(degree, n - 1);
  const lo = knots[p];
  const hi = knots[n];
  const out = [];
  for (let s = 0; s <= samples; s++) {
    const t = lo + ((hi - lo) * s) / samples;
    let k = p;
    while (k < n - 1 && t >= knots[k + 1]) k++;
    const d = [];
    for (let j = 0; j <= p; j++) {
      const c = ctrl[k - p + j];
      d.push([c.x, c.y]);
    }
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const i = k - p + j;
        const denom = knots[i + p - r + 1] - knots[i];
        const a = denom === 0 ? 0 : (t - knots[i]) / denom;
        d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1]];
      }
    }
    out.push(d[p]);
  }
  return out;
}

export function parseDXF(text) {
  const parser = new DxfParser();
  const dxf = parser.parseSync(text);
  if (!dxf) throw new Error('DXF_PARSE_FAILED');

  const insUnits = dxf.header && dxf.header.$INSUNITS;
  const drawing = createDrawing(unitFromDxfCode(insUnits) || 'mm');
  drawing.meta.unitsFromFile = !!unitFromDxfCode(insUnits);

  const layerTable = (dxf.tables && dxf.tables.layer && dxf.tables.layer.layers) || {};
  // dxf-parser doesn't expose layer linetypes, so dashed layers are recognised by name
  for (const [name, L] of Object.entries(layerTable)) {
    ensureLayer(drawing, name, {
      color: aciToHex(L.colorIndex),
      visible: L.visible !== false && !L.frozen,
      lineType: /hidden|dash/i.test(name) ? 'dashed' : 'continuous',
    });
  }

  const blocks = dxf.blocks || {};

  // Rough extent for adaptive tessellation
  let extent = 0;
  const ext0 = dxf.header && dxf.header.$EXTMIN;
  const ext1 = dxf.header && dxf.header.$EXTMAX;
  if (ext0 && ext1 && Number.isFinite(ext1.x - ext0.x)) extent = Math.max(ext1.x - ext0.x, ext1.y - ext0.y);
  if (!(extent > 0 && extent < 1e12)) extent = 0;

  function emitPolyline(points, closed, m, props, fill = false) {
    if (points.length < 2) return;
    const pts = isIdentity(m) ? points : points.map(([x, y]) => tx(m, x, y));
    addEntity(drawing, { type: 'polyline', points: pts, closed, fill, ...props });
  }

  function emitArc(cx, cy, r, a0, a1, m, props) {
    if (isIdentity(m) || isUniform(m)) {
      const [x, y] = tx(m, cx, cy);
      const rot = isIdentity(m) ? 0 : rotationOf(m);
      const rr = isIdentity(m) ? r : r * scaleOf(m);
      if (a1 === undefined) addEntity(drawing, { type: 'circle', c: [x, y], r: rr, ...props });
      else addEntity(drawing, { type: 'arc', c: [x, y], r: rr, a0: a0 + rot, a1: a1 + rot, ...props });
      return;
    }
    // Non-uniform or mirrored transform → tessellate
    const full = a1 === undefined;
    const pts = arcPoints([cx, cy], r, full ? 0 : a0, full ? Math.PI * 2 : a1, extent);
    if (full) pts.pop();
    emitPolyline(pts, full, m, props);
  }

  function convert(ent, m, parentLayer, parentColor, depth) {
    if (ent.visible === false || ent.inPaperSpace) return;
    const layer = ent.layer && !(ent.layer === '0' && parentLayer) ? ent.layer : parentLayer || ent.layer || '0';
    let color = null;
    if (ent.colorIndex === 0) color = parentColor;
    else if (ent.colorIndex != null && ent.colorIndex !== 256) color = aciToHex(Math.abs(ent.colorIndex));
    else if (parentLayer && ent.layer === '0') color = parentColor;
    const props = { layer, color };
    if (ent.lineType && /dash|hidden|center|phantom|dot/i.test(ent.lineType)) props.lineType = 'dashed';

    // OCS mirrored about Y (extrusion 0,0,-1) — common for arcs/polylines from some exporters
    const flipZ = (ent.extrusionDirectionZ != null && ent.extrusionDirectionZ < 0) || (ent.extrusionDirection && ent.extrusionDirection.z < 0);
    const ocs = flipZ ? mul(m, [-1, 0, 0, 1, 0, 0]) : m;

    switch (ent.type) {
      case 'LINE':
        if (ent.vertices && ent.vertices.length >= 2) {
          emitPolyline(ent.vertices.slice(0, 2).map((v) => [v.x, v.y]), false, m, props);
        }
        break;
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const verts = (ent.vertices || []).filter((v) => v && Number.isFinite(v.x) && v.faceA === undefined);
        if (verts.length < 2) break;
        const closed = !!(ent.shape || ent.is3dPolygonMeshClosed);
        emitPolyline(bulgeToPoints(verts, closed, extent), closed, ocs, props);
        break;
      }
      case 'CIRCLE':
        emitArc(ent.center.x, ent.center.y, ent.radius, 0, undefined, ocs, props);
        break;
      case 'ARC':
        emitArc(ent.center.x, ent.center.y, ent.radius, ent.startAngle, ent.endAngle, ocs, props);
        break;
      case 'ELLIPSE': {
        const c = ent.center;
        const M = ent.majorAxisEndPoint;
        const ratio = ent.axisRatio || 1;
        let t0 = ent.startAngle ?? 0;
        let t1 = ent.endAngle ?? Math.PI * 2;
        const full = Math.abs(normSweep(t0, t1) - Math.PI * 2) < 1e-6 || Math.abs(t1 - t0) < 1e-9;
        const sweep = full ? Math.PI * 2 : normSweep(t0, t1);
        const majorLen = Math.hypot(M.x, M.y);
        const steps = Math.max(24, Math.ceil((sweep / (Math.PI * 2)) * 96));
        const pts = [];
        for (let i = 0; i <= steps; i++) {
          const t = t0 + (sweep * i) / steps;
          const ct = Math.cos(t);
          const st = Math.sin(t);
          pts.push([c.x + M.x * ct - M.y * ratio * st, c.y + M.y * ct + M.x * ratio * st]);
        }
        if (full) pts.pop();
        if (majorLen > 0) emitPolyline(pts, full, ocs, props);
        break;
      }
      case 'SPLINE': {
        const ctrl = ent.controlPoints || [];
        const knots = ent.knotValues || [];
        const degree = ent.degreeOfSplineCurve || 3;
        let pts = null;
        if (ctrl.length >= 2 && knots.length >= ctrl.length + Math.min(degree, ctrl.length - 1) + 1) {
          pts = evalBSpline(degree, knots, ctrl, Math.min(800, Math.max(32, ctrl.length * 12)));
        } else if (ent.fitPoints && ent.fitPoints.length >= 2) {
          pts = ent.fitPoints.map((p) => [p.x, p.y]);
        } else if (ctrl.length >= 2) {
          pts = ctrl.map((p) => [p.x, p.y]);
        }
        if (pts) emitPolyline(pts, !!ent.closed, m, props);
        break;
      }
      case 'SOLID':
      case 'TRACE': {
        const p = ent.points || [];
        if (p.length >= 3) {
          const order = p.length >= 4 ? [p[0], p[1], p[3], p[2]] : p;
          emitPolyline(order.map((v) => [v.x, v.y]), true, m, props, true);
        }
        break;
      }
      case '3DFACE': {
        const v = (ent.vertices || []).filter(Boolean);
        if (v.length >= 3) emitPolyline(v.map((q) => [q.x, q.y]), true, m, props);
        break;
      }
      case 'TEXT':
      case 'MTEXT':
      case 'ATTRIB': {
        const isM = ent.type === 'MTEXT';
        const text = cleanCadText(ent.text);
        if (!text.trim()) break;
        const h = (isM ? ent.height : ent.textHeight) || 2.5;
        let p = isM ? ent.position : ent.startPoint;
        let align = 'left';
        let valign = 'baseline';
        let rot = 0;
        if (isM) {
          rot = ent.directionVector ? Math.atan2(ent.directionVector.y, ent.directionVector.x) : ((ent.rotation || 0) * Math.PI) / 180;
          const ap = ent.attachmentPoint || 1;
          align = ['left', 'center', 'right'][(ap - 1) % 3];
          valign = ['top', 'middle', 'baseline'][Math.floor((ap - 1) / 3)];
        } else {
          rot = ((ent.rotation || 0) * Math.PI) / 180;
          const ha = ent.halign || 0;
          const va = ent.valign || 0;
          if ((ha || va) && ent.endPoint) p = ent.endPoint;
          align = ha === 1 || ha === 4 ? 'center' : ha === 2 ? 'right' : 'left';
          valign = va === 2 || ha === 4 ? 'middle' : va === 3 ? 'top' : 'baseline';
        }
        if (!p) break;
        const [x, y] = tx(m, p.x, p.y);
        const s = isIdentity(m) ? 1 : scaleOf(m);
        addEntity(drawing, { type: 'text', p: [x, y], h: h * s, text, rot: rot + (isIdentity(m) ? 0 : rotationOf(m)), align, valign, ...props });
        break;
      }
      case 'INSERT': {
        const block = blocks[ent.name];
        if (!block || !block.entities || depth > 8) break;
        const base = block.position || { x: 0, y: 0 };
        const sx = ent.xScale ?? 1;
        const sy = ent.yScale ?? 1;
        const rot = ((ent.rotation || 0) * Math.PI) / 180;
        const cols = Math.max(1, ent.columnCount || 1);
        const rows = Math.max(1, ent.rowCount || 1);
        const cr = Math.cos(rot);
        const sr = Math.sin(rot);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const ox = c * (ent.columnSpacing || 0);
            const oy = r * (ent.rowSpacing || 0);
            const px = ent.position.x + ox * cr - oy * sr;
            const py = ent.position.y + ox * sr + oy * cr;
            let local = [cr * sx, sr * sx, -sr * sy, cr * sy, px, py];
            local = mul(local, [1, 0, 0, 1, -base.x, -base.y]);
            if (flipZ) local = mul([-1, 0, 0, 1, 0, 0], local);
            const full = mul(m, local);
            for (const child of block.entities) convert(child, full, layer, color, depth + 1);
          }
        }
        break;
      }
      case 'DIMENSION': {
        const block = blocks[ent.block];
        if (block && block.entities && depth <= 8) {
          for (const child of block.entities) convert(child, m, layer, color, depth + 1);
        }
        break;
      }
      default:
        break;
    }
  }

  for (const ent of dxf.entities || []) convert(ent, IDENTITY, null, null, 0);

  ensureLayer(drawing, '0');
  if (!drawing.entities.length) throw new Error('DXF_EMPTY');
  drawing.meta.bounds = drawingBounds(drawing, { onlyVisible: false });
  return drawing;
}

/* ------------------------------------------------------------------ SVG */

function cssToHex(value) {
  if (!value || value === 'none' || value.startsWith('url(')) return null;
  try {
    const c = new Color().setStyle(value);
    const hex = '#' + c.getHexString();
    // Pure black / white become foreground so they stay visible in both themes
    return hex === '#000000' || hex === '#ffffff' ? null : hex;
  } catch {
    return null;
  }
}

function layerNameFor(node) {
  let n = node && node.parentNode;
  while (n && n.nodeType === 1) {
    if (n.nodeName.toLowerCase() === 'g') {
      const label = n.getAttribute('inkscape:label') || n.getAttribute('id');
      if (label) return label;
    }
    n = n.parentNode;
  }
  return '0';
}

export function parseSVG(text) {
  const loader = new SVGLoader();
  loader.defaultUnit = 'mm';
  loader.defaultDPI = 96;
  const data = loader.parse(text);
  const drawing = createDrawing('mm');
  ensureLayer(drawing, '0');

  for (const path of data.paths) {
    const style = (path.userData && path.userData.style) || {};
    const strokeHex = style.stroke && style.stroke !== 'none' ? cssToHex(style.stroke) : undefined;
    const fillHex = style.fill && style.fill !== 'none' ? cssToHex(style.fill) : undefined;
    const color = strokeHex !== undefined ? strokeHex : fillHex !== undefined ? fillHex : null;
    const layer = layerNameFor(path.userData && path.userData.node);
    for (const sub of path.subPaths) {
      const raw = sub.getPoints(32);
      const pts = [];
      for (const v of raw) {
        const p = [v.x, -v.y];
        const last = pts[pts.length - 1];
        if (!last || Math.abs(last[0] - p[0]) > 1e-9 || Math.abs(last[1] - p[1]) > 1e-9) pts.push(p);
      }
      if (pts.length < 2) continue;
      const first = pts[0];
      const last = pts[pts.length - 1];
      let closed = !!sub.autoClose;
      if (Math.hypot(last[0] - first[0], last[1] - first[1]) < 1e-5 && pts.length > 2) {
        pts.pop();
        closed = true;
      }
      addEntity(drawing, { type: 'polyline', points: pts, closed, layer, color });
    }
  }

  if (!drawing.entities.length) throw new Error('SVG_EMPTY');
  drawing.meta.bounds = drawingBounds(drawing, { onlyVisible: false });
  return drawing;
}
