import { UNITS, fmtPlain } from '../core/units.js';
import { addEntity, createDrawing, ensureLayer } from './drawing.js';
import { PAPERS } from '../io/export2d.js';

export const SCALES = [
  [20, 1], [10, 1], [5, 1], [2, 1], [1, 1], [1, 2], [1, 5], [1, 10], [1, 20], [1, 50], [1, 100], [1, 200], [1, 500],
  [1, 1000], [1, 2000], [1, 5000], [1, 10000],
];

const MARGIN = 10; // paper mm between sheet edge and frame
const TB_W = 180;
const TB_H = 32;

function asciiSafe(s) {
  return String(s).replace(/[^\x20-\x7E฀-๿]/g, '_');
}

/** Places views relative to the front view; all offsets are in model units. */
function layoutViews(proj, opts, k) {
  const third = opts.projection !== 'first';
  const side = third ? proj.right : proj.left;
  const G = (opts.dims ? 26 : 18) / k;
  const labelPad = 9 / k;
  const dimPad = opts.dims ? 14 / k : 0;

  const views = [];
  const place = (p, dx, dy, pads) => {
    if (!p) return null;
    const v = { p, dx, dy, pads };
    views.push(v);
    return v;
  };
  const bounds = (v) => ({
    minX: v.p.bounds.minX + v.dx,
    maxX: v.p.bounds.maxX + v.dx,
    minY: v.p.bounds.minY + v.dy,
    maxY: v.p.bounds.maxY + v.dy,
  });

  const F = proj.front.bounds;
  const fPads = third
    ? { top: 0, bottom: labelPad + dimPad, left: dimPad, right: 0 }
    : { top: dimPad, bottom: labelPad, left: dimPad, right: 0 };
  const front = place(proj.front, 0, 0, fPads);
  front.dims = opts.dims ? { width: third ? 'below' : 'above', height: 'left' } : null;

  let sideV = null;
  if (side) {
    const S = side.bounds;
    const pads = third ? { top: 0, bottom: labelPad + dimPad, left: 0, right: 0 } : { top: dimPad, bottom: labelPad, left: 0, right: 0 };
    sideV = place(side, F.maxX + fPads.right + G + pads.left - S.minX, 0, pads);
    sideV.dims = opts.dims ? { width: third ? 'below' : 'above' } : null;
  }

  let topV = null;
  if (proj.top) {
    const T = proj.top.bounds;
    const pads = { top: 0, bottom: labelPad, left: 0, right: 0 };
    const dy = third ? F.maxY + fPads.top + G + pads.bottom - T.minY : F.minY - fPads.bottom - G - pads.top - T.maxY;
    topV = place(proj.top, 0, dy, pads);
  }

  if (proj.iso) {
    const I = proj.iso.bounds;
    const pads = { top: 0, bottom: labelPad, left: 0, right: 0 };
    const colLeft = sideV ? bounds(sideV).minX - sideV.pads.left : F.maxX + fPads.right + G;
    const dx = colLeft + pads.left - I.minX;
    const dy = third
      ? F.maxY + fPads.top + G + pads.bottom - I.minY
      : F.minY - fPads.bottom - G - pads.top - I.maxY;
    place(proj.iso, dx, dy, pads);
  }

  const all = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const v of views) {
    const b = bounds(v);
    all.minX = Math.min(all.minX, b.minX - v.pads.left);
    all.maxX = Math.max(all.maxX, b.maxX + v.pads.right);
    all.minY = Math.min(all.minY, b.minY - v.pads.bottom);
    all.maxY = Math.max(all.maxY, b.maxY + v.pads.top);
  }
  return { views, bounds: all, bounds0: bounds };
}

function rect(d, layer, x0, y0, x1, y1) {
  addEntity(d, { type: 'polyline', layer, closed: true, points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
}

function line(d, layer, x0, y0, x1, y1) {
  addEntity(d, { type: 'polyline', layer, closed: false, points: [[x0, y0], [x1, y1]] });
}

function text(d, layer, x, y, h, str, opts = {}) {
  addEntity(d, { type: 'text', layer, p: [x, y], h, text: str, rot: opts.rot || 0, align: opts.align || 'left', valign: opts.valign || 'baseline' });
}

function arrow(d, tipX, tipY, dirX, dirY, k) {
  const L = 3 / k;
  const Wd = 0.6 / k;
  const bx = tipX - dirX * L;
  const by = tipY - dirY * L;
  addEntity(d, {
    type: 'polyline',
    layer: 'DIM',
    closed: true,
    fill: true,
    points: [[tipX, tipY], [bx - dirY * Wd, by + dirX * Wd], [bx + dirY * Wd, by - dirX * Wd]],
  });
}

/** Linear dimension between two points along one axis. side: 'below' | 'above' | 'left' | 'right'. */
function dimension(d, k, p1, p2, side, refCoord, value) {
  const off = 10 / k;
  const gapObj = 1.5 / k;
  const ext = 2 / k;
  const th = 3.5 / k;
  const label = fmtPlain(value, 2);
  if (side === 'below' || side === 'above') {
    const s = side === 'below' ? -1 : 1;
    const y = refCoord + s * off;
    line(d, 'DIM', p1, refCoord + s * gapObj, p1, y + s * ext);
    line(d, 'DIM', p2, refCoord + s * gapObj, p2, y + s * ext);
    line(d, 'DIM', p1, y, p2, y);
    arrow(d, p1, y, -1, 0, k);
    arrow(d, p2, y, 1, 0, k);
    text(d, 'DIM', (p1 + p2) / 2, y + 1.2 / k, th, label, { align: 'center' });
  } else {
    const s = side === 'left' ? -1 : 1;
    const x = refCoord + s * off;
    line(d, 'DIM', refCoord + s * gapObj, p1, x + s * ext, p1);
    line(d, 'DIM', refCoord + s * gapObj, p2, x + s * ext, p2);
    line(d, 'DIM', x, p1, x, p2);
    arrow(d, x, p1, 0, -1, k);
    arrow(d, x, p2, 0, 1, k);
    text(d, 'DIM', x - 1.2 / k, (p1 + p2) / 2, th, label, { align: 'center', rot: Math.PI / 2 });
  }
}

function projectionSymbol(d, cx, cy, k, third) {
  const u = 1 / k;
  const trapX = third ? cx - 9 * u : cx + 1 * u;
  const circX = third ? cx + 6 * u : cx - 6 * u;
  addEntity(d, {
    type: 'polyline',
    layer: 'TITLE',
    closed: true,
    points: [[trapX, cy - 4 * u], [trapX + 9 * u, cy - 2 * u], [trapX + 9 * u, cy + 2 * u], [trapX, cy + 4 * u]],
  });
  addEntity(d, { type: 'circle', layer: 'TITLE', c: [circX, cy], r: 4 * u });
  addEntity(d, { type: 'circle', layer: 'TITLE', c: [circX, cy], r: 2 * u });
}

/**
 * Composes projected views into a drawing sheet with frame, dimensions and title block.
 * Everything is emitted in model units, so DXF stays 1:1 while SVG/PDF print at `scaleLabel`.
 */
export function buildSheet(proj, opts) {
  const paper = PAPERS[opts.paper] || PAPERS.A3;
  const unitToMM = UNITS[opts.units]?.toMM || 1;
  const tbH = opts.titleBlock ? TB_H : 0;
  const usableW = paper[0] - 2 * MARGIN - 10;
  const usableH = paper[1] - 2 * MARGIN - tbH - 10;

  const candidates = opts.scale && opts.scale !== 'auto' ? [opts.scale.split(':').map(Number)] : SCALES;
  let chosen = null;
  for (const [a, b] of candidates) {
    const k = (a / b) * unitToMM;
    const layout = layoutViews(proj, opts, k);
    const w = (layout.bounds.maxX - layout.bounds.minX) * k;
    const h = (layout.bounds.maxY - layout.bounds.minY) * k;
    chosen = { a, b, k, layout, fits: w <= usableW && h <= usableH };
    if (chosen.fits) break;
  }
  const { a, b, k, layout } = chosen;

  const d = createDrawing(opts.units);
  ensureLayer(d, 'VISIBLE', { weight: 0.5 });
  ensureLayer(d, 'HIDDEN', { weight: 0.25, lineType: 'dashed', color: '#8a909c' });
  ensureLayer(d, 'DIM', { weight: 0.18, color: '#1f8fe0' });
  ensureLayer(d, 'TEXT', { weight: 0.25 });
  ensureLayer(d, 'FRAME', { weight: 0.5 });
  ensureLayer(d, 'TITLE', { weight: 0.3 });
  d.meta.title = opts.title;

  const pw = paper[0] / k;
  const ph = paper[1] / k;
  const u = 1 / k;

  // Center the content in the usable area (above the title block)
  const usable = { x0: (MARGIN + 5) * u, x1: pw - (MARGIN + 5) * u, y0: (MARGIN + tbH + 5) * u, y1: ph - (MARGIN + 5) * u };
  const cb = layout.bounds;
  const ox = (usable.x0 + usable.x1) / 2 - (cb.minX + cb.maxX) / 2;
  const oy = (usable.y0 + usable.y1) / 2 - (cb.minY + cb.maxY) / 2;

  const th = 3.5 * u;
  for (const v of layout.views) {
    const dx = v.dx + ox;
    const dy = v.dy + oy;
    if (opts.hidden) {
      for (const pl of v.p.hidden) addEntity(d, { type: 'polyline', layer: 'HIDDEN', closed: false, points: pl.map(([x, y]) => [x + dx, y + dy]) });
    }
    for (const pl of v.p.visible) addEntity(d, { type: 'polyline', layer: 'VISIBLE', closed: false, points: pl.map(([x, y]) => [x + dx, y + dy]) });

    const vb = v.p.bounds;
    const x0 = vb.minX + dx;
    const x1 = vb.maxX + dx;
    const y0 = vb.minY + dy;
    const y1 = vb.maxY + dy;
    const below = v.dims && v.dims.width === 'below' ? 14 * u : 0;
    text(d, 'TEXT', (x0 + x1) / 2, y0 - below - 7 * u, th, v.p.label, { align: 'center' });

    if (v.dims) {
      if (v.dims.width) dimension(d, k, x0, x1, v.dims.width, v.dims.width === 'below' ? y0 : y1, x1 - x0);
      if (v.dims.height) dimension(d, k, y0, y1, 'left', x0, y1 - y0);
    }
  }

  // Frame with centring marks
  const fx0 = MARGIN * u;
  const fy0 = MARGIN * u;
  const fx1 = pw - MARGIN * u;
  const fy1 = ph - MARGIN * u;
  rect(d, 'FRAME', fx0, fy0, fx1, fy1);
  const mid = [(fx0 + fx1) / 2, (fy0 + fy1) / 2];
  line(d, 'FRAME', mid[0], fy0, mid[0], fy0 + 5 * u);
  line(d, 'FRAME', mid[0], fy1, mid[0], fy1 - 5 * u);
  line(d, 'FRAME', fx0, mid[1], fx0 + 5 * u, mid[1]);
  line(d, 'FRAME', fx1, mid[1], fx1 - 5 * u, mid[1]);

  if (opts.titleBlock) {
    const x1 = fx1;
    const x0 = x1 - TB_W * u;
    const y0 = fy0;
    const y1 = y0 + TB_H * u;
    const ym = y0 + 16 * u;
    rect(d, 'TITLE', x0, y0, x1, y1);
    line(d, 'TITLE', x0, ym, x1, ym);
    line(d, 'TITLE', x0 + 50 * u, ym, x0 + 50 * u, y1);
    text(d, 'TITLE', x0 + 4 * u, ym + 7 * u, 5 * u, 'MorphCAD');
    text(d, 'TITLE', x0 + 4 * u, ym + 3 * u, 2 * u, '3D TO 2D DRAWING');
    text(d, 'TITLE', x0 + 54 * u, y1 - 4 * u, 2 * u, 'TITLE');
    text(d, 'TITLE', x0 + 54 * u, ym + 3.5 * u, 5 * u, asciiSafe(opts.title || 'Untitled').slice(0, 40));

    const cells = [
      ['PROJECTION', 40, null],
      ['SCALE', 35, `${a}:${b}`],
      ['UNITS', 30, UNITS[opts.units]?.short || opts.units],
      ['SHEET', 30, opts.paper],
      ['DATE', 45, opts.date],
    ];
    let cx = x0;
    cells.forEach(([label, wmm, value], i) => {
      if (i > 0) line(d, 'TITLE', cx, y0, cx, ym);
      text(d, 'TITLE', cx + 2 * u, ym - 4 * u, 2 * u, label);
      if (value) text(d, 'TITLE', cx + 2 * u, y0 + 3.5 * u, 3.5 * u, value);
      else projectionSymbol(d, cx + (wmm / 2) * u, y0 + 6 * u, k, opts.projection !== 'first');
      cx += wmm * u;
    });
  }

  return {
    drawing: d,
    paper: opts.paper,
    paperSize: paper,
    k,
    scaleLabel: `${a}:${b}`,
    fits: chosen.fits,
    frame: { minX: 0, minY: 0, maxX: pw, maxY: ph },
  };
}
