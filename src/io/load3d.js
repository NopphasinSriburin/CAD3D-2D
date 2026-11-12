import * as THREE from 'three';
import { INPUT_FORMATS, extOf } from '../core/formats.js';
import { readBRep } from './occt.js';
import { parseDXF, parseSVG } from './load2d.js';

const DEFAULT_COLOR = 0xb4c0d3;

export function defaultMaterial(color = DEFAULT_COLOR, vertexColors = false) {
  return new THREE.MeshStandardMaterial({ color: vertexColors ? 0xffffff : color, metalness: 0.15, roughness: 0.5, vertexColors, side: THREE.DoubleSide });
}

/** Maps companion files (MTL, BIN, textures) to blob URLs for three.js loaders. */
function createManager(files) {
  const urls = new Map();
  for (const f of files) urls.set(f.name.toLowerCase(), URL.createObjectURL(f));
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (/^(data|blob):/.test(url)) return url;
    let name = url;
    try {
      name = decodeURIComponent(url);
    } catch {
      /* keep raw */
    }
    name = name.split(/[\\/]/).pop().split('?')[0].toLowerCase();
    return urls.get(name) || url;
  });
  manager.dispose = () => urls.forEach((u) => URL.revokeObjectURL(u));
  return manager;
}

function geometryMesh(geometry, name) {
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const hasColors = !!geometry.attributes.color;
  const mesh = new THREE.Mesh(geometry, defaultMaterial(DEFAULT_COLOR, hasColors));
  mesh.name = name;
  return mesh;
}

// OpenCascade reports pure black when a file (typically IGES) carries no colour at all
const hasColor = (rgb) => Array.isArray(rgb) && Math.max(rgb[0], rgb[1], rgb[2]) > 0.02;

function occtToObject(result, name) {
  const makeMat = (rgb) => defaultMaterial(hasColor(rgb) ? new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace) : DEFAULT_COLOR);
  const meshes = result.meshes.map((m, i) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
    if (m.normal) g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
    if (m.index) g.setIndex(new THREE.BufferAttribute(m.index, 1));
    if (!m.normal) g.computeVertexNormals();
    let material = makeMat(m.color);
    const faces = m.brepFaces || [];
    if (faces.some((f) => hasColor(f.color))) {
      const mats = [material];
      const byKey = new Map();
      for (const f of faces) {
        let mi = 0;
        if (hasColor(f.color)) {
          const key = f.color.join(',');
          if (!byKey.has(key)) {
            byKey.set(key, mats.length);
            mats.push(makeMat(f.color));
          }
          mi = byKey.get(key);
        }
        g.addGroup(f.first * 3, (f.last - f.first + 1) * 3, mi);
      }
      material = mats;
    }
    const mesh = new THREE.Mesh(g, material);
    mesh.name = m.name || `Part ${i + 1}`;
    return mesh;
  });

  const root = new THREE.Group();
  root.name = name;
  const used = new Set();
  const build = (node, parent) => {
    const grp = new THREE.Group();
    grp.name = node.name || '';
    for (const mi of node.meshes || []) {
      const mesh = meshes[mi];
      if (!mesh) continue;
      grp.add(used.has(mi) ? mesh.clone() : mesh);
      used.add(mi);
    }
    for (const child of node.children || []) build(child, grp);
    parent.add(grp);
  };
  if (result.root) build(result.root, root);
  meshes.forEach((m, i) => {
    if (!used.has(i)) root.add(m);
  });
  return root;
}

function parseOFF(text) {
  const tokens = text.replace(/#.*$/gm, '').split(/\s+/).filter(Boolean);
  let i = 0;
  if (/^[A-Z]*OFF$/.test(tokens[0])) i++;
  const nv = parseInt(tokens[i++], 10);
  const nf = parseInt(tokens[i++], 10);
  i++; // edges
  const pos = new Float32Array(nv * 3);
  for (let v = 0; v < nv * 3; v++) pos[v] = parseFloat(tokens[i++]);
  const idx = [];
  for (let f = 0; f < nf; f++) {
    const n = parseInt(tokens[i++], 10);
    const verts = [];
    for (let k = 0; k < n; k++) verts.push(parseInt(tokens[i++], 10));
    for (let k = 1; k < n - 1; k++) idx.push(verts[0], verts[k], verts[k + 1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function prepareObject(object) {
  let meshes = 0;
  object.traverse((o) => {
    if (o.isMesh) {
      meshes++;
      const g = o.geometry;
      if (g && !g.attributes.normal && g.attributes.position) g.computeVertexNormals();
      if (!o.material) o.material = defaultMaterial();
    }
  });
  return meshes;
}

/**
 * Loads any supported file. 3D → { kind: '3d', object, up, unit, format }, 2D → { kind: '2d', drawing, format }.
 */
export async function loadFile(file, allFiles = [file], { quality = 'normal', onStatus } = {}) {
  const ext = extOf(file.name);
  const fmt = INPUT_FORMATS[ext];
  if (!fmt) throw new Error('UNSUPPORTED_FORMAT');
  const status = (msg) => onStatus && onStatus(msg);

  if (fmt.kind === '2d') {
    status(`กำลังอ่านไฟล์ ${fmt.label}…`);
    const text = await file.text();
    const drawing = ext === 'dxf' ? parseDXF(text) : parseSVG(text);
    return { kind: '2d', drawing, format: fmt.label };
  }

  const manager = createManager(allFiles);
  let object;
  try {
    if (fmt.engine === 'occt') {
      status(`กำลังแปลงพื้นผิว ${fmt.label} เป็น mesh ด้วย OpenCascade…`);
      const result = await readBRep(fmt.occt, await file.arrayBuffer(), quality);
      object = occtToObject(result, file.name);
    } else if (fmt.engine === 'sldprt') {
      status('กำลังอ่าน mesh จากไฟล์ SolidWorks…');
      const { readSolidWorksMesh } = await import('./sldprt.js');
      const sw = readSolidWorksMesh(await file.arrayBuffer());
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(sw.positions, 3));
      if (sw.normals) g.setAttribute('normal', new THREE.BufferAttribute(sw.normals, 3));
      object = new THREE.Group();
      object.add(geometryMesh(g, file.name.replace(/\.[^.]+$/, '')));
      prepareObject(object);
      return {
        kind: '3d', object, up: fmt.up, unit: sw.unit, format: fmt.label, quality: false,
        notice: `อ่าน mesh แสดงผลที่ SolidWorks ฝังไว้ (${sw.faceCount.toLocaleString('en-US')} ผิว · ${sw.triangleCount.toLocaleString('en-US')} สามเหลี่ยม) — ความละเอียดเท่าที่บันทึกไว้ในไฟล์ หากต้องการพื้นผิวจริงให้ Save As STEP จาก SolidWorks`,
      };
    } else {
      status(`กำลังอ่านไฟล์ ${fmt.label}…`);
      object = await loadWithThree(ext, file, allFiles, manager);
    }
  } finally {
    // Keep blob URLs alive briefly so textures referenced lazily can still resolve
    setTimeout(() => manager.dispose(), 15_000);
  }

  object.name = object.name || file.name;
  const meshCount = prepareObject(object);
  let points = 0;
  object.traverse((o) => {
    if (o.isPoints) points++;
  });
  if (!meshCount && !points) throw new Error('NO_GEOMETRY');
  return { kind: '3d', object, up: fmt.up, unit: fmt.unit, format: fmt.label, quality: fmt.engine === 'occt' };
}

async function loadWithThree(ext, file, allFiles, manager) {
  switch (ext) {
    case 'stl': {
      const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
      const geometry = new STLLoader(manager).parse(await file.arrayBuffer());
      const group = new THREE.Group();
      group.add(geometryMesh(geometry, file.name.replace(/\.[^.]+$/, '')));
      return group;
    }
    case 'obj': {
      const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
      const text = await file.text();
      const loader = new OBJLoader(manager);
      const mtlName = (/^mtllib\s+(.+)$/m.exec(text) || [])[1];
      const mtlFile = allFiles.find((f) => extOf(f.name) === 'mtl' && (!mtlName || f.name.toLowerCase() === mtlName.trim().split(/[\\/]/).pop().toLowerCase())) ||
        allFiles.find((f) => extOf(f.name) === 'mtl');
      if (mtlFile) {
        const { MTLLoader } = await import('three/examples/jsm/loaders/MTLLoader.js');
        const materials = new MTLLoader(manager).parse(await mtlFile.text(), '');
        materials.preload();
        loader.setMaterials(materials);
      }
      const obj = loader.parse(text);
      if (!mtlFile) {
        obj.traverse((o) => {
          if (o.isMesh) o.material = defaultMaterial();
        });
      }
      return obj;
    }
    case 'ply': {
      const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
      const geometry = new PLYLoader(manager).parse(await file.arrayBuffer());
      const group = new THREE.Group();
      if (!geometry.index) {
        geometry.computeBoundingSphere();
        const size = (geometry.boundingSphere?.radius || 1) / 300;
        const pts = new THREE.Points(geometry, new THREE.PointsMaterial({ size, vertexColors: !!geometry.attributes.color, color: geometry.attributes.color ? 0xffffff : DEFAULT_COLOR }));
        pts.name = 'Point cloud';
        group.add(pts);
      } else {
        group.add(geometryMesh(geometry, file.name.replace(/\.[^.]+$/, '')));
      }
      return group;
    }
    case 'glb':
    case 'gltf': {
      const [{ GLTFLoader }, { DRACOLoader }, { MeshoptDecoder }] = await Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/loaders/DRACOLoader.js'),
        import('three/examples/jsm/libs/meshopt_decoder.module.js'),
      ]);
      const draco = new DRACOLoader().setDecoderPath(new URL('vendor/draco/', document.baseURI).href);
      const loader = new GLTFLoader(manager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
      const data = ext === 'glb' ? await file.arrayBuffer() : await file.text();
      const gltf = await loader.parseAsync(data, '');
      draco.dispose();
      return gltf.scene;
    }
    case 'fbx': {
      const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
      return new FBXLoader(manager).parse(await file.arrayBuffer(), '');
    }
    case 'dae': {
      const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
      const collada = new ColladaLoader(manager).parse(await file.text(), '');
      return collada.scene;
    }
    case '3mf': {
      const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js');
      return new ThreeMFLoader(manager).parse(await file.arrayBuffer());
    }
    case 'amf': {
      const { AMFLoader } = await import('three/examples/jsm/loaders/AMFLoader.js');
      return new AMFLoader(manager).parse(await file.arrayBuffer());
    }
    case '3ds': {
      const { TDSLoader } = await import('three/examples/jsm/loaders/TDSLoader.js');
      return new TDSLoader(manager).parse(await file.arrayBuffer(), '');
    }
    case 'wrl':
    case 'vrml': {
      const { VRMLLoader } = await import('three/examples/jsm/loaders/VRMLLoader.js');
      return new VRMLLoader(manager).parse(await file.text(), '');
    }
    case 'off': {
      const group = new THREE.Group();
      group.add(geometryMesh(parseOFF(await file.text()), file.name.replace(/\.[^.]+$/, '')));
      return group;
    }
    default:
      throw new Error('UNSUPPORTED_FORMAT');
  }
}
