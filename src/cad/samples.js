import * as THREE from 'three';
import { addEntity, createDrawing, ensureLayer } from './drawing.js';
import { drawingToDXF } from '../io/export2d.js';

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

function circlePath(cx, cy, r, ccw = true) {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, !ccw);
  return p;
}

function steel(color) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.42 });
}

/** A flanged bearing bracket, in millimetres, Z-up. */
export function createSamplePart() {
  const group = new THREE.Group();
  group.name = 'Bracket assembly';

  const plate = roundedRect(140, 90, 10);
  for (const [x, y] of [[-55, -32.5], [55, -32.5], [-55, 32.5], [55, 32.5]]) plate.holes.push(circlePath(x, y, 5));
  plate.holes.push(circlePath(0, 0, 12));
  const plateGeo = new THREE.ExtrudeGeometry(plate, { depth: 12, bevelEnabled: false, curveSegments: 40 });
  const base = new THREE.Mesh(plateGeo, steel(0x8fa3bf));
  base.name = 'Base plate';
  group.add(base);

  const ring = new THREE.Shape();
  ring.absarc(0, 0, 25, 0, Math.PI * 2, false);
  ring.holes.push(circlePath(0, 0, 12));
  const bossGeo = new THREE.ExtrudeGeometry(ring, { depth: 30, bevelEnabled: false, curveSegments: 56 });
  bossGeo.translate(0, 0, 12);
  const boss = new THREE.Mesh(bossGeo, steel(0xd9822b));
  boss.name = 'Boss';
  group.add(boss);

  const ribShape = new THREE.Shape();
  ribShape.moveTo(24, 12);
  ribShape.lineTo(58, 12);
  ribShape.lineTo(24, 36);
  ribShape.closePath();
  for (const side of [1, -1]) {
    const g = new THREE.ExtrudeGeometry(ribShape, { depth: 8, bevelEnabled: false });
    g.rotateX(Math.PI / 2);
    g.translate(0, 4, 0);
    if (side < 0) g.rotateZ(Math.PI);
    const rib = new THREE.Mesh(g, steel(0x8fa3bf));
    rib.name = side > 0 ? 'Rib right' : 'Rib left';
    group.add(rib);
  }

  group.traverse((o) => {
    if (o.isMesh) o.geometry.computeVertexNormals();
  });
  return group;
}

/** A laser-cut mounting plate as a DXF string (lines + arcs + circles + text). */
export function createSampleDXF() {
  const d = createDrawing('mm');
  ensureLayer(d, 'OUTLINE', { color: null });
  ensureLayer(d, 'HOLES', { color: '#ff7a1a' });
  ensureLayer(d, 'NOTES', { color: '#3fa9f5' });

  const W = 160;
  const H = 100;
  const R = 12;
  const seg = (a, b) => addEntity(d, { type: 'polyline', layer: 'OUTLINE', points: [a, b], closed: false });
  const arc = (c, r, a0, a1, layer = 'OUTLINE') => addEntity(d, { type: 'arc', layer, c, r, a0, a1 });

  // Outer outline from separate LINE + ARC entities (exercises loop chaining)
  seg([R, 0], [W - R, 0]);
  arc([W - R, R], R, -Math.PI / 2, 0);
  seg([W, R], [W, H - R]);
  arc([W - R, H - R], R, 0, Math.PI / 2);
  seg([W - R, H], [100, H]);
  arc([80, H], 20, Math.PI, Math.PI * 2); // notch
  seg([60, H], [R, H]);
  arc([R, H - R], R, Math.PI / 2, Math.PI);
  seg([0, H - R], [0, R]);
  arc([R, R], R, Math.PI, Math.PI * 1.5);

  for (const [x, y] of [[16, 16], [W - 16, 16], [16, H - 16], [W - 16, H - 16]]) {
    addEntity(d, { type: 'circle', layer: 'HOLES', c: [x, y], r: 4.5 });
  }
  addEntity(d, { type: 'circle', layer: 'HOLES', c: [80, 46], r: 18 });

  // Slot
  const sy = 46;
  addEntity(d, { type: 'polyline', layer: 'HOLES', points: [[118, sy - 5], [136, sy - 5]], closed: false });
  addEntity(d, { type: 'arc', layer: 'HOLES', c: [136, sy], r: 5, a0: -Math.PI / 2, a1: Math.PI / 2 });
  addEntity(d, { type: 'polyline', layer: 'HOLES', points: [[136, sy + 5], [118, sy + 5]], closed: false });
  addEntity(d, { type: 'arc', layer: 'HOLES', c: [118, sy], r: 5, a0: Math.PI / 2, a1: Math.PI * 1.5 });

  // Hexagon pocket
  const hex = [];
  for (let i = 0; i < 6; i++) hex.push([32 + 10 * Math.cos((i * Math.PI) / 3), 46 + 10 * Math.sin((i * Math.PI) / 3)]);
  addEntity(d, { type: 'polyline', layer: 'HOLES', points: hex, closed: true });

  addEntity(d, { type: 'text', layer: 'NOTES', p: [W / 2, -12], h: 5, text: 'MORPHCAD SAMPLE PLATE  t = 3 mm', rot: 0, align: 'center', valign: 'baseline' });
  return drawingToDXF(d);
}
