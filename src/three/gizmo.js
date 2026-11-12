import * as THREE from 'three';

const AXIS_COLORS = { X: '#ff5c6c', Y: '#4fd27f', Z: '#4c9bff' };

/** Small 2D-canvas axis gizmo labelled in the source file's CAD axes. Click a bubble to look along it. */
export class AxisGizmo {
  constructor(parent, { onPick } = {}) {
    this.size = 96;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'v3d-gizmo';
    this.canvas.setAttribute('aria-label', 'แกนอ้างอิง — คลิกเพื่อหมุนไปมุมมองนั้น');
    parent.appendChild(this.canvas);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.size * this.dpr;
    this.canvas.height = this.size * this.dpr;
    this.canvas.style.width = `${this.size}px`;
    this.canvas.style.height = `${this.size}px`;
    this.ctx = this.canvas.getContext('2d');
    this.up = 'z';
    this.items = [];
    this.hover = -1;
    this.onPick = onPick;
    this.q = new THREE.Quaternion();
    this.v = new THREE.Vector3();
    this.textColor = '#0b0d12';

    this.canvas.addEventListener('pointermove', (e) => {
      const i = this.hit(e);
      if (i !== this.hover) {
        this.hover = i;
        this.canvas.style.cursor = i >= 0 ? 'pointer' : 'default';
        this.draw();
      }
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.hover = -1;
      this.draw();
    });
    this.canvas.addEventListener('click', (e) => {
      const i = this.hit(e);
      if (i >= 0 && this.onPick) this.onPick(new THREE.Vector3(...this.items[i].dir));
    });
  }

  setUp(up) {
    this.up = up;
  }

  axes() {
    const zUp = this.up === 'z';
    return [
      { label: 'X', dir: [1, 0, 0] },
      { label: 'Y', dir: zUp ? [0, 0, -1] : [0, 1, 0] },
      { label: 'Z', dir: zUp ? [0, 1, 0] : [0, 0, 1] },
    ];
  }

  update(camera) {
    this.q.copy(camera.quaternion).invert();
    const c = this.size / 2;
    const r = this.size / 2 - 14;
    const items = [];
    for (const axis of this.axes()) {
      for (const sign of [1, -1]) {
        const dir = axis.dir.map((d) => d * sign);
        this.v.set(dir[0], dir[1], dir[2]).applyQuaternion(this.q);
        items.push({ label: axis.label, positive: sign > 0, dir, x: c + this.v.x * r, y: c - this.v.y * r, z: this.v.z });
      }
    }
    items.sort((a, b) => a.z - b.z);
    this.items = items;
    this.draw();
  }

  hit(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (Math.hypot(it.x - x, it.y - y) <= (it.positive ? 10 : 8)) return i;
    }
    return -1;
  }

  draw() {
    const { ctx, dpr, size } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const c = size / 2;
    if (this.hover >= 0) {
      ctx.fillStyle = 'rgba(127,127,127,0.12)';
      ctx.beginPath();
      ctx.arc(c, c, c - 2, 0, Math.PI * 2);
      ctx.fill();
    }
    this.items.forEach((it, i) => {
      const color = AXIS_COLORS[it.label];
      const hovered = i === this.hover;
      ctx.globalAlpha = it.positive ? 1 : 0.55;
      if (it.positive) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.lineTo(it.x, it.y);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(it.x, it.y, it.positive ? 9 : 7, 0, Math.PI * 2);
      if (it.positive) {
        ctx.fillStyle = color;
        ctx.fill();
      } else {
        ctx.fillStyle = hovered ? color : 'rgba(0,0,0,0)';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (hovered) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (it.positive || hovered) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = it.positive ? '#0b0d12' : '#ffffff';
        ctx.font = '700 10px "JetBrains Mono", ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(it.positive ? it.label : `-${it.label}`, it.x, it.y + 0.5);
      }
    });
    ctx.globalAlpha = 1;
  }
}
