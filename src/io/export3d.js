import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { strToU8, zipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { UNITS } from '../core/units.js';

const num = (v) => String(Math.round(v * 1e6) / 1e6);

function safeName(s, fallback = 'object') {
  const clean = String(s || '').replace(/[^\p{L}\p{N}_.-]+/gu, '_').replace(/^_+|_+$/g, '');
  return clean || fallback;
}

function xmlEscape(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function materialsOf(mesh) {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function trianglesWithMaterial(mesh) {
  const g = mesh.geometry;
  const count = g.index ? g.index.count : g.attributes.position.count;
  const groups = Array.isArray(mesh.material) && g.groups.length ? g.groups : [{ start: 0, count, materialIndex: 0 }];
  return groups;
}

function srgbHex(color) {
  const c = new THREE.Color();
  color.getRGB(c, THREE.SRGBColorSpace);
  const to = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `${to(c.r)}${to(c.g)}${to(c.b)}`.toUpperCase();
}

/* ------------------------------------------------------------------ OBJ (+MTL) */

function writeOBJ(root, { name, mtl }) {
  root.updateMatrixWorld(true);
  const out = ['# MorphCAD OBJ export'];
  if (mtl) out.push(`mtllib ${name}.mtl`);
  const matNames = new Map();
  const mtlOut = ['# MorphCAD MTL export'];
  const matName = (m) => {
    if (!matNames.has(m)) {
      const nm = safeName(m.name, `material_${matNames.size + 1}`) + (matNames.size ? `_${matNames.size}` : '');
      matNames.set(m, nm);
      const c = new THREE.Color();
      (m.color || new THREE.Color(0xcccccc)).getRGB(c, THREE.SRGBColorSpace);
      mtlOut.push(`newmtl ${nm}`, `Kd ${num(c.r)} ${num(c.g)} ${num(c.b)}`, 'Ka 0 0 0', 'Ks 0.2 0.2 0.2', 'Ns 50', `d ${num(m.opacity ?? 1)}`, 'illum 2', '');
    }
    return matNames.get(m);
  };

  let vOff = 1;
  let nOff = 1;
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const idx = g.index;
    const flip = o.matrixWorld.determinant() < 0;
    nm.getNormalMatrix(o.matrixWorld);
    out.push(`o ${safeName(o.name, 'mesh')}`);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      out.push(`v ${num(v.x)} ${num(v.y)} ${num(v.z)}`);
    }
    if (nor) {
      for (let i = 0; i < nor.count; i++) {
        v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        out.push(`vn ${num(v.x)} ${num(v.y)} ${num(v.z)}`);
      }
    }
    const mats = materialsOf(o);
    for (const grp of trianglesWithMaterial(o)) {
      if (mtl) out.push(`usemtl ${matName(mats[grp.materialIndex] || mats[0])}`);
      const limit = Math.min(grp.start + grp.count, idx ? idx.count : pos.count);
      for (let k = grp.start; k + 2 < limit; k += 3) {
        let a = idx ? idx.getX(k) : k;
        let b = idx ? idx.getX(k + 1) : k + 1;
        let c = idx ? idx.getX(k + 2) : k + 2;
        if (flip) [b, c] = [c, b];
        out.push(nor
          ? `f ${a + vOff}//${a + nOff} ${b + vOff}//${b + nOff} ${c + vOff}//${c + nOff}`
          : `f ${a + vOff} ${b + vOff} ${c + vOff}`);
      }
    }
    vOff += pos.count;
    if (nor) nOff += nor.count;
  });
  return { obj: out.join('\n') + '\n', mtl: mtlOut.join('\n') + '\n' };
}

/* ------------------------------------------------------------------ 3MF */

function write3MF(root, { unit, name }) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const tol = Math.max(box.getSize(new THREE.Vector3()).length() * 1e-7, 1e-9);
  const colors = [];
  const colorIndex = new Map();
  const colorOf = (m) => {
    const hex = srgbHex((m && m.color) || new THREE.Color(0xb4c0d3));
    if (!colorIndex.has(hex)) {
      colorIndex.set(hex, colors.length);
      colors.push(hex);
    }
    return colorIndex.get(hex);
  };

  const objects = [];
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const src = o.geometry;
    const pos = src.attributes.position;
    const idx = src.index;
    const count = idx ? idx.count : pos.count;
    const triCount = Math.floor(count / 3);
    if (!triCount) return;
    const arr = new Float32Array(triCount * 9);
    for (let i = 0; i < triCount * 3; i++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld);
      arr[i * 3] = v.x;
      arr[i * 3 + 1] = v.y;
      arr[i * 3 + 2] = v.z;
    }
    const triMat = new Uint32Array(triCount);
    const mats = materialsOf(o);
    for (const grp of trianglesWithMaterial(o)) {
      const ci = colorOf(mats[grp.materialIndex] || mats[0]);
      for (let t = Math.floor(grp.start / 3); t < Math.min(triCount, Math.floor((grp.start + grp.count) / 3)); t++) triMat[t] = ci;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const merged = mergeVertices(g, tol);
    objects.push({ name: o.name, geometry: merged, triMat, flip: o.matrixWorld.determinant() < 0, baseColor: triMat[0] });
    g.dispose();
  });
  if (!objects.length) throw new Error('NO_MESHES');

  const xml = [];
  xml.push('<?xml version="1.0" encoding="UTF-8"?>');
  xml.push(`<model unit="${UNITS[unit]?.threeMF || 'millimeter'}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">`);
  xml.push(`<metadata name="Title">${xmlEscape(name)}</metadata>`);
  xml.push('<metadata name="Application">MorphCAD</metadata>');
  xml.push('<resources>');
  xml.push('<basematerials id="1">');
  colors.forEach((hex, i) => xml.push(`<base name="color_${i}" displaycolor="#${hex}FF"/>`));
  xml.push('</basematerials>');
  objects.forEach((ob, oi) => {
    const id = oi + 2;
    const p = ob.geometry.attributes.position.array;
    const index = ob.geometry.index.array;
    xml.push(`<object id="${id}" type="model" name="${xmlEscape(ob.name || `object_${oi + 1}`)}" pid="1" pindex="${ob.baseColor}"><mesh><vertices>`);
    const vparts = [];
    for (let i = 0; i < p.length; i += 3) vparts.push(`<vertex x="${num(p[i])}" y="${num(p[i + 1])}" z="${num(p[i + 2])}"/>`);
    xml.push(vparts.join(''));
    xml.push('</vertices><triangles>');
    const tparts = [];
    for (let t = 0; t < index.length / 3; t++) {
      const a = index[t * 3];
      let b = index[t * 3 + 1];
      let c = index[t * 3 + 2];
      if (a === b || b === c || a === c) continue;
      if (ob.flip) [b, c] = [c, b];
      const mat = ob.triMat[t];
      tparts.push(mat === ob.baseColor ? `<triangle v1="${a}" v2="${b}" v3="${c}"/>` : `<triangle v1="${a}" v2="${b}" v3="${c}" pid="1" p1="${mat}"/>`);
    }
    xml.push(tparts.join(''));
    xml.push('</triangles></mesh></object>');
    ob.geometry.dispose();
  });
  xml.push('</resources><build>');
  objects.forEach((_, oi) => xml.push(`<item objectid="${oi + 2}"/>`));
  xml.push('</build></model>');

  const contentTypes = '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(xml.join('\n')),
  });
}

/* ------------------------------------------------------------------ entry */

/**
 * Exports a clean (overlay-free) clone of the model.
 * sourceUp: up axis of the source data; targetUp: up axis wanted in the file.
 */
export async function export3D(clone, { format, name, sourceUp = 'y', targetUp = 'y', scale = 1, binary = true, mtl = true, unit = 'mm' }) {
  const qDisplay = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), sourceUp === 'z' ? -Math.PI / 2 : 0);
  const qTarget = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), targetUp === 'z' ? Math.PI / 2 : 0);
  const wrapper = new THREE.Group();
  wrapper.name = name;
  wrapper.quaternion.multiplyQuaternions(qTarget, qDisplay);
  wrapper.scale.setScalar(scale);
  wrapper.add(clone);
  wrapper.updateMatrixWorld(true);

  const base = safeName(name, 'model');
  switch (format) {
    case 'stl': {
      const { STLExporter } = await import('three/examples/jsm/exporters/STLExporter.js');
      const data = new STLExporter().parse(wrapper, { binary });
      return { blob: new Blob([data], { type: binary ? 'application/octet-stream' : 'model/stl' }), filename: `${base}.stl` };
    }
    case 'obj': {
      const { obj, mtl: mtlText } = writeOBJ(wrapper, { name: base, mtl });
      if (!mtl) return { blob: new Blob([obj], { type: 'model/obj' }), filename: `${base}.obj` };
      const zip = zipSync({ [`${base}.obj`]: strToU8(obj), [`${base}.mtl`]: strToU8(mtlText) });
      return { blob: new Blob([zip], { type: 'application/zip' }), filename: `${base}_obj.zip` };
    }
    case 'ply': {
      const { PLYExporter } = await import('three/examples/jsm/exporters/PLYExporter.js');
      const data = await new Promise((resolve) => new PLYExporter().parse(wrapper, resolve, { binary, littleEndian: true }));
      if (data == null) throw new Error('NO_MESHES');
      return { blob: new Blob([data], { type: 'application/octet-stream' }), filename: `${base}.ply` };
    }
    case 'glb':
    case 'gltf': {
      const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
      const isBinary = format === 'glb';
      const data = await new GLTFExporter().parseAsync(wrapper, { binary: isBinary, onlyVisible: true, maxTextureSize: 4096 });
      return isBinary
        ? { blob: new Blob([data], { type: 'model/gltf-binary' }), filename: `${base}.glb` }
        : { blob: new Blob([JSON.stringify(data)], { type: 'model/gltf+json' }), filename: `${base}.gltf` };
    }
    case '3mf': {
      const data = write3MF(wrapper, { unit, name: base });
      return { blob: new Blob([data], { type: 'model/3mf' }), filename: `${base}.3mf` };
    }
    case 'usdz': {
      const { USDZExporter } = await import('three/examples/jsm/exporters/USDZExporter.js');
      wrapper.traverse((o) => {
        if (!o.isMesh) return;
        const conv = (m) => (m && m.isMeshStandardMaterial ? m : new THREE.MeshStandardMaterial({ color: m && m.color ? m.color : 0xcccccc, map: (m && m.map) || null, opacity: m ? m.opacity : 1, transparent: !!(m && m.transparent), roughness: 0.5, metalness: 0.1 }));
        o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
        if (Array.isArray(o.material)) o.material = o.material[0];
      });
      const data = await new USDZExporter().parseAsync(wrapper);
      return { blob: new Blob([data], { type: 'model/vnd.usdz+zip' }), filename: `${base}.usdz` };
    }
    default:
      throw new Error('UNSUPPORTED_TARGET');
  }
}
