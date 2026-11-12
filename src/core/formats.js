/** Input formats keyed by file extension. `up` = typical up axis, `unit` = typical unit. */
export const INPUT_FORMATS = {
  step: { kind: '3d', label: 'STEP', engine: 'occt', occt: 'step', up: 'z', unit: 'mm' },
  stp: { kind: '3d', label: 'STEP', engine: 'occt', occt: 'step', up: 'z', unit: 'mm' },
  iges: { kind: '3d', label: 'IGES', engine: 'occt', occt: 'iges', up: 'z', unit: 'mm' },
  igs: { kind: '3d', label: 'IGES', engine: 'occt', occt: 'iges', up: 'z', unit: 'mm' },
  brep: { kind: '3d', label: 'BREP', engine: 'occt', occt: 'brep', up: 'z', unit: 'mm' },
  brp: { kind: '3d', label: 'BREP', engine: 'occt', occt: 'brep', up: 'z', unit: 'mm' },
  stl: { kind: '3d', label: 'STL', up: 'z', unit: 'mm' },
  obj: { kind: '3d', label: 'OBJ', up: 'y', unit: 'mm' },
  ply: { kind: '3d', label: 'PLY', up: 'z', unit: 'mm' },
  glb: { kind: '3d', label: 'GLB', up: 'y', unit: 'm' },
  gltf: { kind: '3d', label: 'glTF', up: 'y', unit: 'm' },
  fbx: { kind: '3d', label: 'FBX', up: 'y', unit: 'cm' },
  '3mf': { kind: '3d', label: '3MF', up: 'z', unit: 'mm' },
  dae: { kind: '3d', label: 'DAE', up: 'y', unit: 'm' },
  amf: { kind: '3d', label: 'AMF', up: 'z', unit: 'mm' },
  '3ds': { kind: '3d', label: '3DS', up: 'z', unit: 'mm' },
  wrl: { kind: '3d', label: 'VRML', up: 'y', unit: 'm' },
  vrml: { kind: '3d', label: 'VRML', up: 'y', unit: 'm' },
  off: { kind: '3d', label: 'OFF', up: 'z', unit: 'mm' },
  // SolidWorks works Y-up; only the embedded display mesh is readable
  sldprt: { kind: '3d', label: 'SLDPRT', engine: 'sldprt', up: 'y', unit: 'mm' },
  dxf: { kind: '2d', label: 'DXF' },
  svg: { kind: '2d', label: 'SVG' },
};

/** Companion files that may be dropped together with a main model. */
export const AUX_EXTS = new Set(['mtl', 'bin', 'png', 'jpg', 'jpeg', 'webp', 'tga', 'bmp', 'gif', 'ktx2', 'dds', 'tif', 'tiff']);

export const UNSUPPORTED_HINTS = {
  dwg: 'DWG เป็นรูปแบบปิดของ Autodesk — โปรดบันทึกเป็น DXF ก่อน (AutoCAD: Save As → DXF)',
  sldasm: 'ไฟล์ SolidWorks Assembly ยังไม่รองรับ — โปรดส่งออกเป็น STEP (.step) หรือเปิดไฟล์ชิ้นส่วน .SLDPRT ทีละชิ้น',
  ipt: 'ไฟล์ Inventor — โปรดส่งออกเป็น STEP (.step) ก่อน',
  iam: 'ไฟล์ Inventor — โปรดส่งออกเป็น STEP (.step) ก่อน',
  f3d: 'ไฟล์ Fusion 360 — โปรดส่งออกเป็น STEP (.step) ก่อน',
  catpart: 'ไฟล์ CATIA — โปรดส่งออกเป็น STEP (.step) ก่อน',
  prt: 'ไฟล์ NX/Creo — โปรดส่งออกเป็น STEP (.step) ก่อน',
  skp: 'ไฟล์ SketchUp — โปรดส่งออกเป็น OBJ, STL หรือ DAE ก่อน',
  blend: 'ไฟล์ Blender — โปรดส่งออกเป็น GLB หรือ OBJ ก่อน',
  x_t: 'ไฟล์ Parasolid — โปรดส่งออกเป็น STEP (.step) ก่อน',
};

/** Output targets. `kind`: mesh | sheet | render | flat | extrude */
export const TARGETS = {
  stl: { kind: 'mesh', fmt: 'stl', ext: 'stl', label: 'STL', desc: 'พิมพ์ 3D · CAM', up: 'z' },
  obj: { kind: 'mesh', fmt: 'obj', ext: 'obj', label: 'OBJ', desc: 'กราฟิก · เรนเดอร์', up: 'y' },
  ply: { kind: 'mesh', fmt: 'ply', ext: 'ply', label: 'PLY', desc: 'สแกน · จุดสี', up: 'z' },
  // glTF and USDZ are metre-based by spec, so they default to metres
  glb: { kind: 'mesh', fmt: 'glb', ext: 'glb', label: 'GLB', desc: 'เว็บ · AR · เกม', up: 'y', unit: 'm' },
  gltf: { kind: 'mesh', fmt: 'gltf', ext: 'gltf', label: 'glTF', desc: 'glTF แบบ JSON', up: 'y', unit: 'm' },
  '3mf': { kind: 'mesh', fmt: '3mf', ext: '3mf', label: '3MF', desc: 'พิมพ์ 3D พร้อมสี', up: 'z' },
  usdz: { kind: 'mesh', fmt: 'usdz', ext: 'usdz', label: 'USDZ', desc: 'AR บน iOS', up: 'y', unit: 'm' },

  'sheet-dxf': { kind: 'sheet', fmt: 'dxf', ext: 'dxf', label: 'DXF', desc: 'แบบงาน AutoCAD' },
  'sheet-pdf': { kind: 'sheet', fmt: 'pdf', ext: 'pdf', label: 'PDF', desc: 'พิมพ์ · ส่งงาน' },
  'sheet-svg': { kind: 'sheet', fmt: 'svg', ext: 'svg', label: 'SVG', desc: 'เวกเตอร์สเกลจริง' },
  'sheet-png': { kind: 'sheet', fmt: 'png', ext: 'png', label: 'PNG', desc: 'ภาพแบบงาน' },

  render: { kind: 'render', fmt: 'png', ext: 'png', label: 'PNG', desc: 'ภาพเรนเดอร์ 3D' },

  bom: { kind: 'bom', fmt: 'xlsx', ext: 'xlsx', label: 'BOM', desc: 'Excel · ทำ CBD ต่อ' },

  'flat-dxf': { kind: 'flat', fmt: 'dxf', ext: 'dxf', label: 'DXF', desc: 'AutoCAD R12' },
  'flat-svg': { kind: 'flat', fmt: 'svg', ext: 'svg', label: 'SVG', desc: 'เลเซอร์ · เว็บ' },
  'flat-pdf': { kind: 'flat', fmt: 'pdf', ext: 'pdf', label: 'PDF', desc: 'พิมพ์ · ส่งงาน' },
  'flat-png': { kind: 'flat', fmt: 'png', ext: 'png', label: 'PNG', desc: 'ภาพความละเอียดสูง' },

  'ex-stl': { kind: 'extrude', fmt: 'stl', ext: 'stl', label: 'STL', desc: 'พิมพ์ 3D', up: 'z' },
  'ex-3mf': { kind: 'extrude', fmt: '3mf', ext: '3mf', label: '3MF', desc: 'พิมพ์ 3D', up: 'z' },
  'ex-obj': { kind: 'extrude', fmt: 'obj', ext: 'obj', label: 'OBJ', desc: 'กราฟิก', up: 'y' },
  'ex-glb': { kind: 'extrude', fmt: 'glb', ext: 'glb', label: 'GLB', desc: 'เว็บ · AR', up: 'y', unit: 'm' },
};

export const TARGET_GROUPS = {
  '3d': [
    { title: 'โมเดล 3D', icon: 'box', tone: 'orange', ids: ['stl', 'obj', 'glb', 'gltf', '3mf', 'ply', 'usdz'] },
    { title: 'แบบงาน 2D · ภาพฉาย', icon: 'drafting-compass', tone: 'cyan', ids: ['sheet-dxf', 'sheet-pdf', 'sheet-svg', 'sheet-png'] },
    { title: 'ภาพ', icon: 'image', tone: 'violet', ids: ['render'] },
    { title: 'รายการชิ้นส่วน · ต้นทุน', icon: 'file-text', tone: 'green', ids: ['bom'] },
  ],
  '2d': [
    { title: 'แบบ 2D', icon: 'pen-tool', tone: 'cyan', ids: ['flat-dxf', 'flat-svg', 'flat-pdf', 'flat-png'] },
    { title: 'ขึ้นรูป 3D · Extrude', icon: 'box', tone: 'orange', ids: ['ex-stl', 'ex-3mf', 'ex-obj', 'ex-glb'] },
  ],
};

export function extOf(name) {
  const m = /\.([^.\\/]+)$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

export function baseName(name) {
  return (name || 'model').replace(/\.[^.\\/]+$/, '');
}

const MAIN_PRIORITY = ['step', 'stp', 'iges', 'igs', 'brep', 'brp', 'sldprt', 'gltf', 'glb', 'fbx', 'obj', 'dae', '3mf', 'stl', 'ply', 'amf', '3ds', 'wrl', 'vrml', 'off', 'dxf', 'svg'];

/** Picks the main model file among dropped files (e.g. OBJ among OBJ+MTL+textures). */
export function pickMainFile(files) {
  let best = null;
  let bestRank = Infinity;
  for (const f of files) {
    const rank = MAIN_PRIORITY.indexOf(extOf(f.name));
    if (rank >= 0 && rank < bestRank) {
      best = f;
      bestRank = rank;
    }
  }
  return best;
}
