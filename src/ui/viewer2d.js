import { boundsValid, drawingBounds, normSweep, resolveColor, resolveLineType, resolveWeight } from '../cad/drawing.js';

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function weightClass(w) {
  if (w >= 0.45) return 'w-thick';
  if (w >= 0.3) return 'w-mid';
  if (w >= 0.2) return 'w-thin';
  return 'w-fine';
}

/** Pan/zoom SVG viewer for normalised drawings. Line widths stay constant on screen. */
export class Viewer2D {
  constructor(container, { onCursor } = {}) {
    this.container = container;
    this.onCursor = onCursor;
    this.svg = el('svg', { class: 'v2d-svg', preserveAspectRatio: 'none' });
    this.world = el('g', { transform: 'scale(1,-1)' });
    this.svg.appendChild(this.world);
    container.prepend(this.svg);
    this.view = { cx: 0, cy: 0, s: 1 };
    this.drawing = null;
    this.frame = null;
    this.layerGroups = new Map();
    this.pointers = new Map();

    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
      this.zoomAt(f, e.clientX, e.clientY);
    }, { passive: false });

    this.svg.addEventListener('pointerdown', (e) => {
      this.svg.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.svg.classList.add('is-panning');
    });
    this.svg.addEventListener('pointermove', (e) => {
      this.reportCursor(e);
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      if (this.pointers.size === 1) {
        this.view.cx -= (e.clientX - prev.x) / this.view.s;
        this.view.cy += (e.clientY - prev.y) / this.view.s;
        this.update();
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.entries()];
        const other = a[0] === e.pointerId ? b[1] : a[1];
        const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
        const d1 = Math.hypot(e.clientX - other.x, e.clientY - other.y);
        if (d0 > 0) this.zoomAt(d1 / d0, (e.clientX + other.x) / 2, (e.clientY + other.y) / 2);
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    const end = (e) => {
      this.pointers.delete(e.pointerId);
      if (!this.pointers.size) this.svg.classList.remove('is-panning');
    };
    this.svg.addEventListener('pointerup', end);
    this.svg.addEventListener('pointercancel', end);
    this.svg.addEventListener('dblclick', () => this.fit());
    this.svg.addEventListener('pointerleave', () => this.onCursor && this.onCursor(null));

    this._resize = new ResizeObserver(() => {
      if (this.pendingFit) this.fit();
      else this.update();
    });
    this._resize.observe(container);
  }

  setDrawing(drawing, { frame = null, key = null } = {}) {
    this.drawing = drawing;
    this.frame = frame;
    this.key = key;
    this.build();
    this.fit();
  }

  build() {
    const d = this.drawing;
    this.world.replaceChildren();
    this.layerGroups.clear();
    if (!d) return;
    const b = this.frame || drawingBounds(d, { onlyVisible: false });
    if (!boundsValid(b)) return;
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-9);
    const dec = Math.min(9, Math.max(2, 6 - Math.floor(Math.log10(span))));
    const f = 10 ** dec;
    const n = (v) => Math.round(v * f) / f;

    if (this.frame) {
      this.world.appendChild(el('rect', {
        class: 'v2d-paper',
        x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY,
      }));
    }

    const groups = new Map();
    const texts = [];
    for (const e of d.entities) {
      if (e.type === 'text') {
        texts.push(e);
        continue;
      }
      const color = resolveColor(d, e);
      const dashed = resolveLineType(d, e) === 'dashed';
      const wc = weightClass(resolveWeight(d, e));
      const fill = !!(e.type === 'polyline' && e.fill);
      const key = `${e.layer}|${color}|${dashed}|${wc}|${fill}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { layer: e.layer, color, dashed, wc, fill, parts: [] }));
      if (e.type === 'polyline') {
        const p = e.points;
        let s = `M${n(p[0][0])} ${n(p[0][1])}`;
        for (let i = 1; i < p.length; i++) s += `L${n(p[i][0])} ${n(p[i][1])}`;
        if (e.closed) s += 'Z';
        g.parts.push(s);
      } else if (e.type === 'circle') {
        const [cx, cy] = e.c;
        const r = n(e.r);
        g.parts.push(`M${n(cx + e.r)} ${n(cy)}A${r} ${r} 0 1 1 ${n(cx - e.r)} ${n(cy)}A${r} ${r} 0 1 1 ${n(cx + e.r)} ${n(cy)}Z`);
      } else if (e.type === 'arc') {
        const sweep = normSweep(e.a0, e.a1);
        const [cx, cy] = e.c;
        const r = n(e.r);
        const x0 = cx + e.r * Math.cos(e.a0);
        const y0 = cy + e.r * Math.sin(e.a0);
        const x1 = cx + e.r * Math.cos(e.a0 + sweep);
        const y1 = cy + e.r * Math.sin(e.a0 + sweep);
        g.parts.push(`M${n(x0)} ${n(y0)}A${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${n(x1)} ${n(y1)}`);
      }
    }

    const layerGroup = (name) => {
      let g = this.layerGroups.get(name);
      if (!g) {
        g = el('g', { 'data-layer': name });
        const layer = d.layers.get(name);
        if (layer && layer.visible === false) g.style.display = 'none';
        this.layerGroups.set(name, g);
        this.world.appendChild(g);
      }
      return g;
    };
    // Hidden/dashed lines first so solid lines draw on top
    const ordered = [...groups.values()].sort((a, b) => Number(b.dashed) - Number(a.dashed));
    for (const g of ordered) {
      const path = el('path', { d: g.parts.join(''), class: `v2d-line ${g.wc}${g.dashed ? ' is-dashed' : ''}${g.fill ? ' is-filled' : ''}` });
      if (g.color) path.style.setProperty('--c', g.color);
      layerGroup(g.layer).appendChild(path);
    }
    for (const e of texts) {
      const color = resolveColor(d, e);
      const lines = String(e.text).split('\n');
      const shift = e.valign === 'middle' ? e.h / 2 : e.valign === 'top' ? e.h : 0;
      const t = el('text', {
        class: 'v2d-text',
        transform: `translate(${n(e.p[0])} ${n(e.p[1])}) scale(1,-1) rotate(${n(-((e.rot || 0) * 180) / Math.PI)})`,
        'font-size': n(e.h * 1.4),
        'text-anchor': e.align === 'center' ? 'middle' : e.align === 'right' ? 'end' : 'start',
      });
      if (color) t.style.setProperty('--c', color);
      lines.forEach((line, i) => {
        const span = el('tspan', { x: 0, y: n(i * e.h * 1.6 + shift) });
        span.textContent = line;
        t.appendChild(span);
      });
      layerGroup(e.layer).appendChild(t);
    }
  }

  setLayerVisible(name, visible) {
    const g = this.layerGroups.get(name);
    if (g) g.style.display = visible ? '' : 'none';
  }

  bounds() {
    if (this.frame) return this.frame;
    return this.drawing ? drawingBounds(this.drawing) : null;
  }

  fit() {
    const b = this.bounds();
    const W = this.container.clientWidth;
    const H = this.container.clientHeight;
    if (!W || !H || !boundsValid(b)) {
      this.pendingFit = true;
      return;
    }
    this.pendingFit = false;
    const bw = Math.max(b.maxX - b.minX, 1e-9);
    const bh = Math.max(b.maxY - b.minY, 1e-9);
    this.view.s = Math.min(W / bw, H / bh) * (this.frame ? 0.94 : 0.86);
    this.view.cx = (b.minX + b.maxX) / 2;
    this.view.cy = (b.minY + b.maxY) / 2;
    this.update();
  }

  zoomAt(factor, clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;
    const s0 = this.view.s;
    const s1 = Math.min(Math.max(s0 * factor, 1e-6), 1e7);
    const px = clientX - rect.left - W / 2;
    const py = clientY - rect.top - H / 2;
    // Keep the world point under the cursor fixed
    this.view.cx += px / s0 - px / s1;
    this.view.cy -= py / s0 - py / s1;
    this.view.s = s1;
    this.update();
  }

  zoomBy(factor) {
    const rect = this.svg.getBoundingClientRect();
    this.zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  update() {
    const W = this.container.clientWidth || 1;
    const H = this.container.clientHeight || 1;
    const { cx, cy, s } = this.view;
    const w = W / s;
    const h = H / s;
    this.svg.setAttribute('viewBox', `${cx - w / 2} ${-cy - h / 2} ${w} ${h}`);
    this.svg.style.setProperty('--px', `${1 / s}px`);
  }

  reportCursor(e) {
    if (!this.onCursor) return;
    const rect = this.svg.getBoundingClientRect();
    const x = this.view.cx + (e.clientX - rect.left - rect.width / 2) / this.view.s;
    const y = this.view.cy - (e.clientY - rect.top - rect.height / 2) / this.view.s;
    this.onCursor({ x, y });
  }
}
