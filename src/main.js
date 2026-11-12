// Fonts are bundled (not loaded from Google) so the app works offline and on intranets
import '@fontsource/ibm-plex-sans-thai/400.css';
import '@fontsource/ibm-plex-sans-thai/500.css';
import '@fontsource/ibm-plex-sans-thai/600.css';
import '@fontsource/ibm-plex-sans-thai/700.css';
import '@fontsource/prompt/500.css';
import '@fontsource/prompt/600.css';
import '@fontsource/prompt/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';
import './styles/main.css';
import { hydrateIcons, icon } from './ui/icons.js';
import { downloadBlob, toast } from './ui/toast.js';
import { TARGETS, TARGET_GROUPS, UNSUPPORTED_HINTS, baseName, extOf, pickMainFile } from './core/formats.js';
import { UNITS, fmtBytes, fmtInt, fmtNum, unitScale } from './core/units.js';
import { MESH_QUALITY } from './io/occt.js';
import { loadFile } from './io/load3d.js';
import { boundsValid, countByType, drawingBounds } from './cad/drawing.js';
import { createSampleDXF, createSamplePart } from './cad/samples.js';
import { MATERIALS } from './cad/bom.js';
import { Viewer2D } from './ui/viewer2d.js';
import { Viewer3D } from './three/viewer3d.js';
import { HeroScene } from './three/hero.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const TONES = { orange: 'var(--orange)', cyan: 'var(--cyan)', violet: 'var(--violet)', green: 'var(--green)' };
const VIEW_TH = { front: 'ด้านหน้า', top: 'ด้านบน', right: 'ด้านขวา', left: 'ด้านซ้าย', iso: 'ไอโซเมตริก' };

const FORMAT_ROWS = [
  ['STEP', '.step .stp', 'CAD แบบ B-Rep มาตรฐานอุตสาหกรรม (AP203 / AP214 / AP242)', true, false, 'orange'],
  ['IGES', '.iges .igs', 'พื้นผิว CAD รุ่นเก่า งานแม่พิมพ์และงานผิวโค้ง', true, false, 'orange'],
  ['BREP', '.brep', 'B-Rep ของ OpenCascade', true, false, 'orange'],
  ['SolidWorks', '.sldprt', 'ชิ้นงาน SolidWorks 2015 ขึ้นไป — อ่าน mesh แสดงผลที่ฝังในไฟล์', true, false, 'orange'],
  ['STL', '.stl', 'งานพิมพ์ 3D และ CAM — ทั้ง ASCII และ Binary', true, true, 'orange'],
  ['3MF', '.3mf', 'งานพิมพ์ 3D สมัยใหม่ เก็บสีและหน่วยในไฟล์', true, true, 'orange'],
  ['OBJ', '.obj .mtl', 'กราฟิก 3D ทั่วไป พร้อมวัสดุ (MTL)', true, true, 'orange'],
  ['glTF / GLB', '.gltf .glb', 'เว็บ เกม และ AR — รองรับ Draco และ Meshopt', true, true, 'orange'],
  ['PLY', '.ply', 'งานสแกน 3D และ point cloud', true, true, 'orange'],
  ['USDZ', '.usdz', 'AR Quick Look บน iPhone และ iPad', false, true, 'orange'],
  ['FBX', '.fbx', 'งานแอนิเมชันและเกม', true, false, 'orange'],
  ['DAE · 3DS · AMF · VRML · OFF', '', 'รูปแบบ 3D อื่นๆ', true, false, 'orange'],
  ['DXF', '.dxf', 'แบบ 2D ของ AutoCAD — ส่งออกเป็น R12 เปิดได้ทุกโปรแกรม', true, true, 'cyan'],
  ['SVG', '.svg', 'เวกเตอร์ 2D สำหรับเลเซอร์คัตและเว็บ สเกลจริงเป็น mm', true, true, 'cyan'],
  ['PDF', '.pdf', 'แบบงานพร้อมพิมพ์ตามมาตราส่วน', false, true, 'violet'],
  ['PNG', '.png', 'ภาพแบบงานหรือภาพเรนเดอร์ 3D ความละเอียดสูง', false, true, 'violet'],
  ['BOM · Excel', '.xlsx', 'รายการชิ้นส่วนพร้อมจำนวน ขนาด พื้นที่ น้ำหนัก และชีต CBD สำหรับคิดต้นทุน', false, true, 'green'],
];

const state = {
  source: null,
  units: 'mm',
  up: 'z',
  quality: 'normal',
  drawing: null,
  tab: '3d',
  target: 'stl',
  opts: {
    targetUnit: 'mm',
    upAxis: 'z',
    binary: true,
    mtl: true,
    depth: 5,
    views: { top: true, side: true, iso: true },
    projection: 'third',
    hidden: true,
    dims: true,
    titleBlock: true,
    crease: 30,
    paper: 'A3',
    scale: 'auto',
    pngWidth: 3000,
    pngBg: 'white',
    pdfPaper: 'fit',
    renderScale: 2,
    renderBg: 'transparent',
    bomMaterial: '',
    bomDensity: null,
    bomThickness: 3,
    bomPrice: null,
  },
  bom: null,
  bomKey: '',
  sheet: null,
  sheetKey: '',
  edgeModel: null,
  edgeKey: '',
  projCache: new Map(),
  extruded: null,
  extrudeKey: '',
  history: [],
  busy: false,
};

let viewer3d = null;
let viewer2d = null;
let hero = null;

/* ======================================================================== theme */

function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('morphcad-theme', theme);
  } catch {
    /* storage unavailable */
  }
  $('meta[name="theme-color"]').setAttribute('content', theme === 'light' ? '#f4f5f8' : '#07080b');
  if (viewer3d) viewer3d.setTheme(theme);
  if (hero) hero.setTheme(theme);
}

/* ======================================================================== overlay & busy */

function showOverlay(text) {
  $('#overlay-text').textContent = text;
  $('#stage-overlay').hidden = false;
}

function hideOverlay() {
  $('#stage-overlay').hidden = true;
}

function setBusy(busy) {
  state.busy = busy;
  const btn = $('#btn-convert');
  btn.classList.toggle('is-busy', busy);
  btn.disabled = busy;
  $('#convert-label').textContent = busy ? 'กำลังแปลงไฟล์…' : 'แปลงและดาวน์โหลด';
}

function errorMessage(err) {
  const msg = String((err && err.message) || err);
  const map = {
    UNSUPPORTED_FORMAT: 'ยังไม่รองรับรูปแบบไฟล์นี้',
    OCCT_READ_FAILED: 'OpenCascade อ่านไฟล์นี้ไม่ได้ — ไฟล์อาจเสียหาย หรือไม่มีรูปทรงที่แปลงเป็น mesh ได้',
    NO_GEOMETRY: 'ไม่พบรูปทรง 3D ในไฟล์นี้',
    DXF_EMPTY: 'ไม่พบเส้นที่รองรับในไฟล์ DXF (อาจเป็น DXF แบบ binary หรือมีข้อมูลเฉพาะใน paper space)',
    DXF_PARSE_FAILED: 'อ่านไฟล์ DXF ไม่ได้',
    SVG_EMPTY: 'ไม่พบเส้นหรือรูปทรงในไฟล์ SVG',
    NO_CLOSED_PROFILES: 'ไม่พบรูปปิดสำหรับขึ้นรูป 3D — เส้นต้องต่อกันเป็นวงปิด เช่น polyline ปิดหรือวงกลม',
    NO_TRIANGLES: 'ไม่มีชิ้นส่วนที่มองเห็นสำหรับสร้างแบบงาน',
    NO_MESHES: 'ไม่มีชิ้นส่วนที่มองเห็นสำหรับส่งออก',
    NO_MODEL: 'ยังไม่มีโมเดลให้ส่งออก',
    DRAWING_EMPTY: 'แบบว่างเปล่า — อาจซ่อนเลเยอร์ไว้ทั้งหมด',
    OCCT_WORKER_ERROR: 'โหลดตัวอ่าน STEP/IGES ไม่สำเร็จ — ลองรีเฟรชหน้าเว็บ',
    SW_LEGACY_FORMAT: 'ไฟล์ SolidWorks รุ่นก่อน 2015 ยังไม่รองรับ — โปรดเปิดใน SolidWorks แล้ว Save As เป็น STEP',
    SW_NOT_SOLIDWORKS: 'ไม่พบโครงสร้างไฟล์ SolidWorks ที่อ่านได้ — ไฟล์อาจเสียหาย หรือโปรด Save As เป็น STEP',
    SW_NO_TESSELLATION: 'ไฟล์นี้ไม่มี mesh แสดงผลบันทึกไว้ — โปรดเปิดใน SolidWorks แล้ว Save As เป็น STEP',
  };
  if (map[msg]) return map[msg];
  if (/out of memory|allocation/i.test(msg)) return 'หน่วยความจำไม่พอสำหรับไฟล์นี้ — ลองความละเอียด mesh แบบหยาบ';
  return msg;
}

/* ======================================================================== landing / workspace */

function ensureViewers() {
  if (!viewer3d) {
    viewer3d = new Viewer3D($('#viewport-3d'));
    viewer3d.setTheme(currentTheme());
    syncToolbar();
  }
  if (!viewer2d) {
    viewer2d = new Viewer2D($('#viewport-2d'), {
      onCursor: (p) => {
        const u = UNITS[state.units]?.short || '';
        $('#coords-2d').innerHTML = p ? `<span><b>X</b>${fmtNum(p.x, 3)}</span><span><b>Y</b>${fmtNum(p.y, 3)}</span><span>${u}</span>` : '';
      },
    });
  }
}

function enterWorkspace() {
  document.body.classList.add('is-workspace');
  $('#landing').hidden = true;
  $('#workspace').hidden = false;
  window.scrollTo(0, 0);
  if (hero) hero.stop();
  ensureViewers();
}

function leaveWorkspace() {
  document.body.classList.remove('is-workspace');
  $('#workspace').hidden = true;
  $('#landing').hidden = false;
  if (hero) {
    hero.resize();
    hero.start();
  }
}

/* ======================================================================== open files */

async function openFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const main = pickMainFile(files);
  if (!main) {
    const ext = extOf(files[0].name);
    toast(UNSUPPORTED_HINTS[ext] || `ยังไม่รองรับไฟล์ .${ext || '?'} — ลอง STEP, STL, OBJ, GLB, DXF หรือ SVG`, { type: 'error', title: 'เปิดไฟล์ไม่ได้' });
    return;
  }
  await openSource({ file: main, files });
}

async function openSource({ file, files = [file], preset = null, keepTarget = false }) {
  enterWorkspace();
  showOverlay('กำลังเปิดไฟล์…');
  await nextFrame();
  try {
    const result = preset || (await loadFile(file, files, { quality: state.quality, onStatus: showOverlay }));
    await nextFrame();
    applySource(file, files, result, keepTarget);
    if (result.notice) toast(result.notice, { type: 'info', title: `เปิด ${result.format} แล้ว`, timeout: 9000 });
  } catch (err) {
    console.error(err);
    toast(errorMessage(err), { type: 'error', title: `เปิด ${file.name} ไม่สำเร็จ` });
    if (!state.source) leaveWorkspace();
  } finally {
    hideOverlay();
  }
}

function countTriangles(object) {
  let n = 0;
  object.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry.attributes.position) {
      n += Math.floor((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3);
    }
  });
  return n;
}

function applySource(file, files, result, keepTarget) {
  const prevTarget = state.target;
  state.source = { file, files, name: file.name, ext: extOf(file.name), size: file.size, kind: result.kind, format: result.format, occt: !!result.quality, sample: !!result.sample };
  state.sheet = null;
  state.sheetKey = '';
  state.edgeModel = null;
  state.edgeKey = '';
  state.projCache.clear();
  state.extruded = null;
  state.extrudeKey = '';
  state.bom = null;
  state.bomKey = '';

  if (result.kind === '3d') {
    state.units = result.unit || 'mm';
    state.up = result.up || 'z';
    state.drawing = null;
    const tris = countTriangles(result.object);
    viewer3d.setModel(result.object, { up: state.up, edges: tris < 1_500_000 });
    viewer3d.setMode('original');
    state.tab = '3d';
    const fallback = state.source.ext === 'stl' ? '3mf' : 'stl';
    state.target = keepTarget && TARGETS[prevTarget] && ['mesh', 'sheet', 'render'].includes(TARGETS[prevTarget].kind) ? prevTarget : fallback;
  } else {
    state.drawing = result.drawing;
    state.units = result.drawing.units || 'mm';
    viewer3d.clear();
    viewer2d.setDrawing(result.drawing, { key: 'flat' });
    state.tab = '2d';
    state.target = state.source.ext === 'dxf' ? 'flat-svg' : 'flat-dxf';
  }
  applyTargetDefaults();
  $('#crumb-file').textContent = file.name;
  renderLeftPanel();
  renderTargets();
  renderOptions();
  renderTabs();
  showTab(TARGETS[state.target].kind === 'sheet' ? '2d' : state.tab, { syncTarget: false });
  syncToolbar();
}

/* ======================================================================== tabs */

function tabDefs() {
  if (!state.source) return [];
  return state.source.kind === '3d'
    ? [{ id: '3d', label: 'โมเดล 3D', icon: 'box' }, { id: '2d', label: 'แบบงาน 2D', icon: 'drafting-compass' }]
    : [{ id: '2d', label: 'แบบ 2D', icon: 'pen-tool' }, { id: '3d', label: 'ขึ้นรูป 3D', icon: 'cuboid' }];
}

function renderTabs() {
  $('#stage-tabs').innerHTML = tabDefs()
    .map((t) => `<button role="tab" data-tab="${t.id}" class="${t.id === state.tab ? 'is-active' : ''}">${icon(t.icon, { size: 15 })}${t.label}</button>`)
    .join('');
}

/** Which tab a target is previewed in. */
function tabForTarget(id) {
  const kind = TARGETS[id].kind;
  return kind === 'sheet' || kind === 'flat' ? '2d' : '3d';
}

async function showTab(id, { syncTarget = true } = {}) {
  state.tab = id;
  $$('#stage-tabs button').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === id));
  $('#viewport-3d').hidden = id !== '3d';
  $('#viewport-2d').hidden = id !== '2d';

  if (syncTarget && tabForTarget(state.target) !== id) {
    const group = TARGET_GROUPS[state.source.kind].find((g) => tabForTarget(g.ids[0]) === id);
    if (group) selectTarget(group.ids[0], { switchTab: false });
  }

  if (state.source.kind === '3d' && id === '2d') await ensureSheet();
  if (state.source.kind === '2d' && id === '3d') await ensureExtrude();
  if (state.source.kind === '2d' && id === '2d' && viewer2d.key !== 'flat') viewer2d.setDrawing(state.drawing, { key: 'flat' });
  if (id === '3d' && viewer3d) viewer3d.resize();
  updateInfo();
}

/* ======================================================================== left panel */

function fileCard() {
  const s = state.source;
  const is2d = s.kind === '2d';
  const size = s.sample ? 'ตัวอย่าง' : fmtBytes(s.size);
  const extras = s.files.length > 1 ? `<span class="pill">+${s.files.length - 1} ไฟล์ประกอบ</span>` : '';
  return `
    <div class="panel__section">
      <div class="file-card">
        <div class="file-card__icon ${is2d ? 'is-2d' : ''}">${icon(is2d ? 'pen-tool' : 'box', { size: 22 })}</div>
        <div style="min-width:0">
          <div class="file-card__name">${esc(s.name)}</div>
          <div class="file-card__meta"><span class="pill pill--accent">${esc(s.format)}</span><span class="pill">${size}</span>${extras}</div>
        </div>
      </div>
    </div>`;
}

function unitOptions(selected) {
  return Object.entries(UNITS).map(([k, u]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${u.label}</option>`).join('');
}

function segHtml(name, value, items, attr = 'data-seg') {
  return `<div class="seg" ${attr}="${name}">${items
    .map(([v, label]) => `<button type="button" data-value="${v}" class="${String(v) === String(value) ? 'is-active' : ''}">${label}</button>`)
    .join('')}</div>`;
}

function renderLeftPanel() {
  const s = state.source;
  const panel = $('#panel-left');
  if (!s) {
    panel.innerHTML = '';
    return;
  }
  let html = fileCard();
  const unit = UNITS[state.units]?.short || state.units;

  if (s.kind === '3d') {
    const st = viewer3d.stats();
    html += `
      <div class="panel__section">
        <h3 class="panel__title">${icon('gauge', { size: 16 })}ข้อมูลโมเดล</h3>
        <div class="stat-grid">
          <div class="mini-stat"><span>สามเหลี่ยม</span><b>${fmtInt(st.triangles)}</b></div>
          <div class="mini-stat"><span>จุดยอด</span><b>${fmtInt(st.vertices)}</b></div>
          <div class="mini-stat"><span>ชิ้นส่วน</span><b>${fmtInt(st.meshes)}</b></div>
          <div class="mini-stat"><span>วัสดุ</span><b>${fmtInt(st.materials)}</b></div>
        </div>
        <div class="dims">
          <div class="dim dim--x"><i>X</i><span>${fmtNum(st.dims.x)}</span></div>
          <div class="dim dim--y"><i>Y</i><span>${fmtNum(st.dims.y)}</span></div>
          <div class="dim dim--z"><i>Z</i><span>${fmtNum(st.dims.z)}</span></div>
        </div>
        <div class="dims-unit">ขนาดกรอบโมเดล (bounding box) หน่วย ${unit}</div>
      </div>
      <div class="panel__section">
        <h3 class="panel__title">${icon('ruler', { size: 16 })}ตั้งค่าไฟล์ต้นฉบับ</h3>
        <div class="field">
          <div class="field__label">หน่วยของไฟล์</div>
          <select class="select" data-src="units">${unitOptions(state.units)}</select>
        </div>
        <div class="field">
          <div class="field__label">แกนตั้งขึ้นของไฟล์</div>
          ${segHtml('up', state.up, [['z', 'Z ขึ้น · CAD'], ['y', 'Y ขึ้น · เว็บ/เกม']], 'data-src-seg')}
        </div>
        ${s.occt ? `
        <div class="field">
          <div class="field__label">ความละเอียด mesh</div>
          ${segHtml('quality', state.quality, Object.entries(MESH_QUALITY).map(([k, q]) => [k, q.label]), 'data-src-seg')}
          <div class="field__hint">ใช้แปลงพื้นผิว ${esc(s.format)} เป็นสามเหลี่ยม — ยิ่งละเอียด ไฟล์ปลายทางยิ่งใหญ่</div>
        </div>` : ''}
      </div>`;

    const meshes = viewer3d.meshes();
    if (meshes.length > 1) {
      const shown = meshes.slice(0, 300);
      html += `
        <div class="panel__section">
          <h3 class="panel__title">${icon('layers', { size: 16 })}ชิ้นส่วน<span class="count">${fmtInt(meshes.length)}</span></h3>
          <ul class="list">${shown
            .map((m, i) => {
              const tri = Math.floor((m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3);
              return `<li class="list__item ${m.visible ? '' : 'is-off'}" data-part="${i}">
                <button class="list__eye" data-part-eye="${i}" aria-label="ซ่อน/แสดง">${icon(m.visible ? 'eye' : 'eye-off', { size: 15 })}</button>
                <button class="list__name" data-part-focus="${i}" title="${esc(m.name || `Part ${i + 1}`)}">${esc(m.name || `Part ${i + 1}`)}</button>
                <span class="list__meta">${tri >= 1000 ? `${fmtNum(tri / 1000, 1)}k` : tri}</span>
              </li>`;
            })
            .join('')}</ul>
          ${meshes.length > shown.length ? `<div class="field__hint" style="margin-top:6px">แสดง ${shown.length} จาก ${fmtInt(meshes.length)} ชิ้น</div>` : ''}
          <div class="list-actions"><button class="link-btn" data-parts="all">แสดงทั้งหมด</button><span style="color:var(--text-3)">·</span><button class="link-btn" data-parts="none">ซ่อนทั้งหมด</button></div>
        </div>`;
    }
  } else {
    const d = state.drawing;
    const b = drawingBounds(d, { onlyVisible: false });
    const counts = countByType(d);
    const w = boundsValid(b) ? b.maxX - b.minX : 0;
    const h = boundsValid(b) ? b.maxY - b.minY : 0;
    html += `
      <div class="panel__section">
        <h3 class="panel__title">${icon('gauge', { size: 16 })}ข้อมูลแบบ</h3>
        <div class="stat-grid">
          <div class="mini-stat"><span>เอนทิตี</span><b>${fmtInt(d.entities.length)}</b></div>
          <div class="mini-stat"><span>เลเยอร์</span><b>${fmtInt(d.layers.size)}</b></div>
          <div class="mini-stat"><span>เส้น/โพลีไลน์</span><b>${fmtInt(counts.polyline || 0)}</b></div>
          <div class="mini-stat"><span>วงกลม/ส่วนโค้ง</span><b>${fmtInt((counts.circle || 0) + (counts.arc || 0))}</b></div>
        </div>
        <div class="dims" style="grid-template-columns:1fr 1fr">
          <div class="dim dim--x"><i>W</i><span>${fmtNum(w)}</span></div>
          <div class="dim dim--y"><i>H</i><span>${fmtNum(h)}</span></div>
        </div>
        <div class="dims-unit">ขนาดรวมของแบบ หน่วย ${unit}${counts.text ? ` · ข้อความ ${fmtInt(counts.text)}` : ''}</div>
      </div>
      <div class="panel__section">
        <h3 class="panel__title">${icon('ruler', { size: 16 })}ตั้งค่าไฟล์ต้นฉบับ</h3>
        <div class="field">
          <div class="field__label">หน่วยของแบบ</div>
          <select class="select" data-src="units">${unitOptions(state.units)}</select>
          ${s.ext === 'svg' ? '<div class="field__hint">SVG ถูกแปลงเป็นมิลลิเมตรตามขนาด width/height ของไฟล์ (96 DPI)</div>' : d.meta.unitsFromFile ? '<div class="field__hint">อ่านหน่วยจาก $INSUNITS ในไฟล์</div>' : '<div class="field__hint">ไฟล์ไม่ได้ระบุหน่วย — ค่าเริ่มต้นเป็นมิลลิเมตร</div>'}
        </div>
      </div>`;

    const layers = [...d.layers.values()].filter((L) => d.entities.some((e) => e.layer === L.name));
    html += `
      <div class="panel__section">
        <h3 class="panel__title">${icon('layers', { size: 16 })}เลเยอร์<span class="count">${layers.length}</span></h3>
        <ul class="list">${layers
          .map((L) => {
            const n = d.entities.reduce((acc, e) => acc + (e.layer === L.name ? 1 : 0), 0);
            return `<li class="list__item ${L.visible === false ? 'is-off' : ''}">
              <button class="list__eye" data-layer-eye="${esc(L.name)}" aria-label="ซ่อน/แสดงเลเยอร์">${icon(L.visible === false ? 'eye-off' : 'eye', { size: 15 })}</button>
              <span class="swatch" style="${L.color ? `--c:${L.color}` : ''}"></span>
              <span class="list__name" title="${esc(L.name)}">${esc(L.name)}</span>
              <span class="list__meta">${fmtInt(n)}</span>
            </li>`;
          })
          .join('')}</ul>
        ${layers.length > 1 ? '<div class="list-actions"><button class="link-btn" data-layers="all">แสดงทั้งหมด</button><span style="color:var(--text-3)">·</span><button class="link-btn" data-layers="none">ซ่อนทั้งหมด</button></div>' : ''}
        <div class="field__hint" style="margin-top:8px">การส่งออกจะใช้เฉพาะเลเยอร์ที่เปิดอยู่</div>
      </div>`;
  }
  panel.innerHTML = html;
}

/* ======================================================================== targets & options */

function applyTargetDefaults() {
  const t = TARGETS[state.target];
  if (t.up) state.opts.upAxis = t.up;
  if (t.kind === 'mesh' || t.kind === 'extrude') state.opts.targetUnit = t.unit || state.units;
}

function renderTargets() {
  const groups = TARGET_GROUPS[state.source.kind];
  $('#targets').innerHTML = groups
    .map((g) => `
      <div class="target-group" style="--tone:${TONES[g.tone]}">
        <div class="target-group__title">${icon(g.icon, { size: 14 })}${g.title}</div>
        <div class="targets">${g.ids
          .map((id) => {
            const t = TARGETS[id];
            return `<button class="target ${id === state.target ? 'is-active' : ''}" data-target="${id}" aria-pressed="${id === state.target}"><b>${t.label}</b><small>${t.desc}</small></button>`;
          })
          .join('')}</div>
      </div>`)
    .join('');
}

function toneOf(id) {
  const g = TARGET_GROUPS[state.source.kind].find((gr) => gr.ids.includes(id));
  return TONES[g ? g.tone : 'orange'];
}

function selectTarget(id, { switchTab = true } = {}) {
  if (!TARGETS[id]) return;
  state.target = id;
  applyTargetDefaults();
  renderTargets();
  renderOptions();
  if (switchTab) {
    const tab = tabForTarget(id);
    if (tab !== state.tab) showTab(tab, { syncTarget: false });
  }
  updateInfo();
}

const field = (label, control, hint = '') =>
  `<div class="field"><div class="field__label">${label}</div>${control}${hint ? `<div class="field__hint">${hint}</div>` : ''}</div>`;
const optSeg = (name, value, items) => segHtml(name, value, items, 'data-opt-seg');
const optToggle = (name, checked, label) =>
  `<label class="toggle"><span>${label}</span><input type="checkbox" data-opt="${name}" ${checked ? 'checked' : ''} /></label>`;
const optSelect = (name, value, items) =>
  `<select class="select" data-opt="${name}">${items.map(([v, l]) => `<option value="${v}" ${String(v) === String(value) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
const note = (text, warn = false) => `<div class="note ${warn ? 'note--warn' : ''}">${icon(warn ? 'triangle-alert' : 'info', { size: 15 })}<span>${text}</span></div>`;

function meshOptionsHtml(t) {
  const o = state.opts;
  let html = '';
  if (t.kind === 'extrude') {
    html += field(
      'ความหนาที่ขึ้นรูป (Extrude)',
      `<div class="input-unit"><input class="input" type="number" min="0.001" step="any" value="${o.depth}" data-opt="depth" data-num /><span>${UNITS[state.units].short}</span></div>`,
      'ขึ้นรูปเฉพาะรูปปิด · รูปซ้อนด้านในจะกลายเป็นรู',
    );
  }
  const factor = unitScale(state.units, o.targetUnit);
  html += field(
    'หน่วยในไฟล์ปลายทาง',
    `<select class="select" data-opt="targetUnit">${unitOptions(o.targetUnit)}</select>`,
    factor !== 1 ? `ขนาดจะถูกคูณ ×${fmtNum(factor, 4)} (${UNITS[state.units].short} → ${UNITS[o.targetUnit].short})` : 'คงขนาดเดิม ไม่มีการปรับสเกล',
  );
  html += field('แกนตั้งขึ้นในไฟล์ปลายทาง', optSeg('upAxis', o.upAxis, [['z', 'Z ขึ้น · CAD/พิมพ์ 3D'], ['y', 'Y ขึ้น · เว็บ/เกม']]));
  if (t.fmt === 'stl' || t.fmt === 'ply') html += field('รูปแบบการเข้ารหัส', optSeg('binary', o.binary, [[true, 'Binary · เล็กกว่า'], [false, 'ASCII · อ่านได้']]));
  if (t.fmt === 'obj') html += `<div class="field">${optToggle('mtl', o.mtl, 'รวมไฟล์วัสดุ .mtl (บีบอัดเป็น ZIP)')}</div>`;
  if (['glb', 'gltf', 'usdz'].includes(t.fmt) && o.targetUnit !== 'm') html += note('glTF และ USDZ ใช้หน่วย <b>เมตร</b> เป็นมาตรฐาน — เลือกหน่วยเมตรหากจะนำไปใช้กับ AR หรือเว็บ');
  if (t.fmt === '3mf') html += note('3MF บันทึกหน่วยและสีของชิ้นส่วนไว้ในไฟล์ เหมาะกับ Bambu Studio, PrusaSlicer, Cura');
  if (t.kind === 'mesh') {
    const hiddenParts = viewer3d.meshes().filter((m) => !m.visible).length;
    if (hiddenParts) html += note(`ส่งออกเฉพาะชิ้นส่วนที่แสดงอยู่ (ซ่อนไว้ ${hiddenParts} ชิ้น)`, true);
  }
  return html;
}

function sheetOptionsHtml(t) {
  const o = state.opts;
  const side = o.projection === 'first' ? 'ด้านซ้าย' : 'ด้านขวา';
  let html = field(
    'มุมมองในแบบ',
    `<div class="check-row">
      <label class="check-chip"><input type="checkbox" checked disabled /><span>ด้านหน้า</span></label>
      <label class="check-chip"><input type="checkbox" data-view-opt="top" ${o.views.top ? 'checked' : ''} /><span>ด้านบน</span></label>
      <label class="check-chip"><input type="checkbox" data-view-opt="side" ${o.views.side ? 'checked' : ''} /><span>${side}</span></label>
      <label class="check-chip"><input type="checkbox" data-view-opt="iso" ${o.views.iso ? 'checked' : ''} /><span>ไอโซเมตริก</span></label>
    </div>`,
  );
  html += field('ระบบการฉายภาพ', optSeg('projection', o.projection, [['third', 'มุมที่ 3 · ISO-A'], ['first', 'มุมที่ 1 · ISO-E']]));
  html += `<div class="field" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div class="field" style="margin:0"><div class="field__label">กระดาษ</div>${optSelect('paper', o.paper, ['A4', 'A3', 'A2', 'A1', 'A0'].map((p) => [p, `${p} แนวนอน`]))}</div>
      <div class="field" style="margin:0"><div class="field__label">มาตราส่วน</div>${optSelect('scale', o.scale, [['auto', 'อัตโนมัติ'], ...['10:1', '5:1', '2:1', '1:1', '1:2', '1:5', '1:10', '1:20', '1:50', '1:100'].map((s) => [s, s])])}</div>
    </div>`;
  html += `<div class="field">
      ${optToggle('hidden', o.hidden, 'เส้นซ่อน (เส้นประ)')}
      ${optToggle('dims', o.dims, 'ขนาดรวม (dimension)')}
      ${optToggle('titleBlock', o.titleBlock, 'กรอบชื่อแบบ (title block)')}
    </div>`;
  html += field(
    `มุมขอบขั้นต่ำ <span class="val">${o.crease}°</span>`,
    `<input type="range" min="5" max="80" step="1" value="${o.crease}" data-opt="crease" data-num data-live style="--fill:${((o.crease - 5) / 75) * 100}%" />`,
    'ขอบที่ผิวหักมุมมากกว่าค่านี้จะถูกวาดเป็นเส้น — เพิ่มค่าหากเห็นเส้นบนผิวโค้งมากเกินไป',
  );
  if (t.fmt === 'png') html += pngOptionsHtml();
  if (t.fmt === 'dxf') html += note(`DXF เป็นสเกล 1:1 ในหน่วย ${UNITS[state.units].short} แยกเลเยอร์ VISIBLE, HIDDEN, DIM และ TITLE`);
  if (t.fmt === 'pdf' || t.fmt === 'svg') html += note(`พิมพ์ที่ขนาดจริง 100% จะได้มาตราส่วนตามที่ระบุในกรอบชื่อแบบ`);
  return html;
}

function pngOptionsHtml() {
  const o = state.opts;
  return (
    field('ความกว้างภาพ', optSelect('pngWidth', o.pngWidth, [[2000, '2000 px'], [3000, '3000 px'], [4000, '4000 px'], [6000, '6000 px']])) +
    field('พื้นหลัง', optSeg('pngBg', o.pngBg, [['white', 'สีขาว'], ['transparent', 'โปร่งใส']]))
  );
}

function renderOptions() {
  const t = TARGETS[state.target];
  const o = state.opts;
  $('#target-badge').textContent = `${t.label}`;
  let html = '';
  switch (t.kind) {
    case 'mesh':
    case 'extrude':
      html = meshOptionsHtml(t);
      break;
    case 'sheet':
      html = sheetOptionsHtml(t);
      break;
    case 'bom':
      html = bomOptionsHtml();
      break;
    case 'render':
      html =
        field('ความละเอียด', optSeg('renderScale', o.renderScale, [[1, '1×'], [2, '2×'], [4, '4×']])) +
        field('พื้นหลัง', optSeg('renderBg', o.renderBg, [['transparent', 'โปร่งใส'], ['#ffffff', 'สีขาว'], ['#0b0d12', 'สีเข้ม']])) +
        note('ภาพใช้มุมกล้องและโหมดแสดงผลปัจจุบันในแท็บโมเดล 3D');
      break;
    case 'flat':
      if (t.fmt === 'png') html = pngOptionsHtml();
      else if (t.fmt === 'pdf') {
        html = field('ขนาดกระดาษ', optSelect('pdfPaper', o.pdfPaper, [['fit', 'พอดีกับแบบ · สเกล 1:1'], ...['A4', 'A3', 'A2', 'A1', 'A0'].map((p) => [p, `${p} · ย่อ/ขยายให้พอดี`])]));
      } else {
        html = note(`ส่งออกที่สเกล 1:1 หน่วย ${UNITS[state.units].short}${t.fmt === 'dxf' ? ' เป็น DXF R12 ซึ่งเปิดได้ใน AutoCAD, LibreCAD, Fusion 360 และเครื่องตัดเลเซอร์ทั่วไป' : ' — ขนาด width/height เป็นมิลลิเมตรจริง เหมาะกับเลเซอร์คัต'}`);
      }
      break;
    default:
      break;
  }
  $('#options').innerHTML = html;
  if (t.kind === 'bom') refreshBomPreview();
  updateConvertNote();
}

/* ======================================================================== BOM */

const numInput = (name, value, unit, placeholder = '') =>
  `<div class="input-unit"><input class="input" type="number" min="0" step="any" value="${value ?? ''}" placeholder="${placeholder}" data-opt="${name}" data-num data-optional /><span>${unit}</span></div>`;

function bomOptionsHtml() {
  const o = state.opts;
  const mats = MATERIALS.map((m) => [m.id, m.density ? `${m.label} · ${m.density} g/cm³` : m.label]);
  return (
    field('วัสดุ', optSelect('bomMaterial', o.bomMaterial, mats)) +
    `<div class="field" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div class="field" style="margin:0"><div class="field__label">ความหนาแน่น</div>${numInput('bomDensity', o.bomDensity, 'g/cm³', '—')}</div>
      <div class="field" style="margin:0"><div class="field__label">ราคาวัสดุ</div>${numInput('bomPrice', o.bomPrice, '฿/kg', 'ไม่บังคับ')}</div>
    </div>` +
    field('ความหนาของชิ้นงานผิวบาง', numInput('bomThickness', o.bomThickness, 'mm'), 'ใช้กับชิ้นที่เป็นผิวไม่มีความหนาในโมเดล เช่น กันชนที่ขึ้นรูปแบบ surface') +
    `<div class="field"><div class="field__label">ตัวอย่างรายการ</div><div id="bom-preview" class="bom-preview"><div class="bom-preview__empty">กำลังวัดชิ้นส่วน…</div></div></div>` +
    note('ไฟล์ Excel มี 2 ชีต: <b>BOM</b> (ขนาด พื้นที่ผิว พื้นที่ฉาย น้ำหนัก ค่าวัสดุ) และ <b>CBD</b> (สรุปต้นทุนต่อชุด) — ช่องสีเหลืองแก้ได้ใน Excel สูตรคำนวณใหม่อัตโนมัติ')
  );
}

async function ensureBom() {
  const meshes = viewer3d.meshes().filter((m) => m.visible);
  const key = `${state.units}|${state.up}|${viewer3d.meshes().map((m) => (m.visible ? 1 : 0)).join('')}`;
  if (state.bom && state.bomKey === key) return state.bom;
  const { computeBOM } = await import('./cad/bom.js');
  state.bom = computeBOM(meshes, viewer3d.root, UNITS[state.units].toMM);
  state.bomKey = key;
  return state.bom;
}

function bomWeight(p) {
  const o = state.opts;
  if (!(o.bomDensity > 0)) return null;
  const volume = p.closed ? p.volume : o.bomThickness > 0 ? (p.area * o.bomThickness) / 10 : null;
  return volume == null ? null : volume * o.bomDensity;
}

async function refreshBomPreview() {
  const box = $('#bom-preview');
  if (!box) return;
  await nextFrame();
  const parts = await ensureBom();
  if (!$('#bom-preview')) return;
  if (!parts.length) {
    box.innerHTML = '<div class="bom-preview__empty">ไม่มีชิ้นส่วนที่มองเห็น</div>';
    return;
  }
  const shown = parts.slice(0, 8);
  let total = 0;
  let totalKnown = true;
  for (const p of parts) {
    const w = bomWeight(p);
    if (w == null) totalKnown = false;
    else total += w * p.qty;
  }
  const qty = parts.reduce((s, p) => s + p.qty, 0);
  box.innerHTML = `
    ${shown
      .map((p) => {
        const w = bomWeight(p);
        return `<div class="bom-preview__row">
          <span class="bom-preview__name" title="${esc(p.name)}">${esc(p.name)}</span>
          <span class="bom-tag ${p.closed ? '' : 'is-surface'}">${p.closed ? 'ทึบ' : 'ผิวบาง'}</span>
          <span class="bom-preview__qty">×${p.qty}</span>
          <span class="bom-preview__w">${w == null ? '—' : w >= 1000 ? `${fmtNum(w / 1000, 2)} kg` : `${fmtNum(w, 1)} g`}</span>
        </div>`;
      })
      .join('')}
    ${parts.length > shown.length ? `<div class="bom-preview__more">และอีก ${parts.length - shown.length} รายการ</div>` : ''}
    <div class="bom-preview__foot"><span>${parts.length} รายการ · ${qty} ชิ้น</span><b>${totalKnown ? `≈ ${total >= 1000 ? `${fmtNum(total / 1000, 2)} kg` : `${fmtNum(total, 1)} g`}` : 'ระบุความหนาแน่นเพื่อดูน้ำหนัก'}</b></div>`;
}

async function exportBom(base) {
  const parts = await ensureBom();
  if (!parts.length) throw new Error('NO_MESHES');
  const { buildBomWorkbook } = await import('./io/exportBom.js');
  const o = state.opts;
  const mat = MATERIALS.find((m) => m.id === o.bomMaterial);
  const bytes = buildBomWorkbook(parts, {
    title: base,
    sourceName: state.source.name,
    date: new Date().toISOString().slice(0, 10),
    material: mat && mat.id ? mat.id : '',
    density: o.bomDensity > 0 ? o.bomDensity : null,
    thickness: o.bomThickness > 0 ? o.bomThickness : null,
    price: o.bomPrice > 0 ? o.bomPrice : null,
    meshNote: state.source.ext === 'sldprt'
      ? 'ค่าที่วัดมาจาก mesh แสดงผลที่ SolidWorks ฝังไว้ในไฟล์ จึงอาจคลาดเคลื่อนเล็กน้อยจากพื้นผิวจริง'
      : null,
  });
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function updateConvertNote() {
  const t = TARGETS[state.target];
  const base = baseName(state.source.name);
  let name = `${base}.${t.ext}`;
  if (t.kind === 'sheet') name = `${base}_drawing.${t.ext}`;
  if (t.kind === 'render') name = `${base}_render.png`;
  if (t.kind === 'bom') name = `${base}_BOM.xlsx`;
  if (t.fmt === 'obj' && state.opts.mtl) name = `${base}_obj.zip`;
  $('#convert-note').textContent = `จะได้ไฟล์ ${name}`;
  const unit = (t.kind === 'mesh' || t.kind === 'extrude') ? UNITS[state.opts.targetUnit].short : UNITS[state.units].short;
  const extra = t.up ? ` · ${state.opts.upAxis.toUpperCase()} ขึ้น` : '';
  $('#stage-hint').innerHTML = `${icon('arrow-right', { size: 14 })}ปลายทาง <b style="color:var(--text);font-family:var(--font-mono)">${t.label}</b> · ${unit}${extra}`;
}

function onOptionChanged(name) {
  const t = TARGETS[state.target];
  const sheetOpts = ['hidden', 'dims', 'titleBlock', 'crease', 'paper', 'scale', 'projection', 'views'];
  if (t.kind === 'sheet' && sheetOpts.includes(name)) scheduleSheet();
  if (t.kind === 'extrude' && name === 'depth') scheduleExtrude();
  if (name === 'bomMaterial') {
    const mat = MATERIALS.find((m) => m.id === state.opts.bomMaterial);
    state.opts.bomDensity = mat ? mat.density : null;
    renderOptions();
  } else if (name.startsWith('bom')) {
    refreshBomPreview();
  }
  if (['targetUnit', 'projection', 'mtl', 'upAxis'].includes(name)) renderOptions();
  updateConvertNote();
}

/* ======================================================================== 3D → 2D sheet */

let sheetTimer = 0;
let sheetChain = Promise.resolve();

function scheduleSheet() {
  clearTimeout(sheetTimer);
  sheetTimer = setTimeout(() => {
    if (state.tab === '2d' && state.source && state.source.kind === '3d') ensureSheet();
  }, 220);
}

function ensureSheet() {
  sheetChain = sheetChain.then(buildSheetIfNeeded, buildSheetIfNeeded);
  return sheetChain;
}

async function buildSheetIfNeeded() {
  if (!state.source || state.source.kind !== '3d') return null;
  const o = state.opts;
  const sideView = o.projection === 'first' ? 'left' : 'right';
  const views = ['front', o.views.top && 'top', o.views.side && sideView, o.views.iso && 'iso'].filter(Boolean);
  const visSig = viewer3d.meshes().map((m) => (m.visible ? 1 : 0)).join('');
  const edgeKey = `${o.crease}|${state.up}|${visSig}`;
  const sheetKey = JSON.stringify([edgeKey, views, o.hidden, o.dims, o.titleBlock, o.paper, o.scale, o.projection, state.units, state.source.name]);
  if (state.sheet && state.sheetKey === sheetKey) {
    if (viewer2d.key !== sheetKey) viewer2d.setDrawing(state.sheet.drawing, { frame: state.sheet.frame, key: sheetKey });
    return state.sheet;
  }
  try {
    showOverlay('กำลังเตรียมสร้างแบบงาน 2D…');
    await nextFrame();
    const [{ buildEdgeModel, collectMeshes, projectView }, { buildSheet }] = await Promise.all([import('./cad/projection.js'), import('./cad/sheet.js')]);
    if (!state.edgeModel || state.edgeKey !== edgeKey) {
      showOverlay('กำลังวิเคราะห์ขอบของโมเดล…');
      await nextFrame();
      state.edgeModel = buildEdgeModel(collectMeshes(viewer3d.model), o.crease);
      state.edgeKey = edgeKey;
      state.projCache.clear();
    }
    const proj = {};
    for (const v of views) {
      if (!state.projCache.has(v)) {
        showOverlay(`กำลังฉายภาพ${VIEW_TH[v]}และคำนวณเส้นซ่อน…`);
        await nextFrame();
        state.projCache.set(v, projectView(state.edgeModel, v, viewer3d.renderDepth.bind(viewer3d), { hidden: true, resolution: 2048 }));
      }
      const p = state.projCache.get(v);
      proj[v] = v === 'iso' ? { ...p, hidden: [] } : p;
    }
    const sheet = buildSheet(proj, {
      projection: o.projection,
      paper: o.paper,
      scale: o.scale,
      dims: o.dims,
      titleBlock: o.titleBlock,
      hidden: o.hidden,
      title: baseName(state.source.name),
      units: state.units,
      date: new Date().toISOString().slice(0, 10),
    });
    state.sheet = sheet;
    state.sheetKey = sheetKey;
    viewer2d.setDrawing(sheet.drawing, { frame: sheet.frame, key: sheetKey });
    if (!sheet.fits) toast('แบบมีขนาดใหญ่เกินกระดาษที่มาตราส่วนนี้ — ลองเลือกมาตราส่วน "อัตโนมัติ" หรือกระดาษใหญ่ขึ้น', { type: 'info', title: 'แบบล้นกระดาษ' });
    updateInfo();
    return sheet;
  } catch (err) {
    console.error(err);
    toast(errorMessage(err), { type: 'error', title: 'สร้างแบบงานไม่สำเร็จ' });
    return null;
  } finally {
    hideOverlay();
  }
}

/* ======================================================================== 2D → 3D extrude */

let extrudeTimer = 0;

function scheduleExtrude() {
  clearTimeout(extrudeTimer);
  extrudeTimer = setTimeout(() => {
    if (state.tab === '3d' && state.source && state.source.kind === '2d') ensureExtrude();
  }, 250);
}

async function ensureExtrude() {
  if (!state.source || state.source.kind !== '2d') return null;
  const d = state.drawing;
  const layerSig = [...d.layers.values()].map((L) => (L.visible === false ? 0 : 1)).join('');
  const key = `${state.opts.depth}|${layerSig}`;
  if (state.extruded && state.extrudeKey === key) return state.extruded;
  showOverlay('กำลังขึ้นรูป 3D จากรูปปิดในแบบ…');
  await nextFrame();
  try {
    const { extrudeDrawing } = await import('./cad/extrude.js');
    const res = extrudeDrawing(d, { depth: Math.max(1e-6, Number(state.opts.depth) || 1) });
    const first = !state.extruded;
    state.extruded = res;
    state.extrudeKey = key;
    const cam = first ? null : { pos: viewer3d.camera.position.clone(), target: viewer3d.controls.target.clone() };
    viewer3d.setModel(res.object, { up: 'z', edges: true });
    if (cam) {
      viewer3d.camera.position.copy(cam.pos);
      viewer3d.controls.target.copy(cam.target);
      viewer3d.controls.update();
    }
    updateInfo();
    if (res.stats.openSkipped) toast(`ข้ามเส้นเปิด ${res.stats.openSkipped} ชุดที่ไม่ประกอบเป็นรูปปิด`, { type: 'info', title: 'ขึ้นรูปบางส่วน' });
    return res;
  } catch (err) {
    console.error(err);
    state.extruded = null;
    viewer3d.clear();
    updateInfo();
    toast(errorMessage(err), { type: 'error', title: 'ขึ้นรูป 3D ไม่ได้' });
    return null;
  } finally {
    hideOverlay();
  }
}

/* ======================================================================== info chips */

function updateInfo() {
  if (!state.source) return;
  const unit = UNITS[state.units]?.short || '';
  let info3d = '';
  if (state.source.kind === '3d') {
    const st = viewer3d.stats();
    info3d = `<span class="vp-chip">${icon('box', { size: 13 })}<b>${fmtInt(st.triangles)}</b> สามเหลี่ยม</span>
      <span class="vp-chip"><b>${fmtNum(st.dims.x)} × ${fmtNum(st.dims.y)} × ${fmtNum(st.dims.z)}</b> ${unit}</span>`;
  } else if (state.extruded) {
    const s = state.extruded.stats;
    info3d = `<span class="vp-chip">${icon('cuboid', { size: 13 })}<b>${s.profiles}</b> รูปปิด · <b>${s.holes}</b> รู</span>
      <span class="vp-chip">หนา <b>${fmtNum(Number(state.opts.depth))}</b> ${unit}</span>`;
  }
  $('#info-3d').innerHTML = info3d;

  let info2d = '';
  if (state.source.kind === '3d' && state.sheet) {
    const s = state.sheet;
    info2d = `<span class="vp-chip">${icon('file-text', { size: 13 })}<b>${s.paper}</b> · มาตราส่วน <b>${s.scaleLabel}</b></span>
      <span class="vp-chip">ฉายภาพ<b>${state.opts.projection === 'first' ? 'มุมที่ 1' : 'มุมที่ 3'}</b></span>`;
  } else if (state.source.kind === '2d') {
    const b = drawingBounds(state.drawing);
    if (boundsValid(b)) info2d = `<span class="vp-chip"><b>${fmtNum(b.maxX - b.minX)} × ${fmtNum(b.maxY - b.minY)}</b> ${unit}</span>`;
  }
  $('#info-2d').innerHTML = info2d;
}

/* ======================================================================== convert */

async function exportDrawing(drawing, fmt, sheet) {
  const m = await import('./io/export2d.js');
  const o = state.opts;
  if (fmt === 'svg') return new Blob([m.drawingToSVG(drawing, { sheet, background: sheet ? '#ffffff' : null })], { type: 'image/svg+xml' });
  if (fmt === 'dxf') return new Blob([m.drawingToDXF(drawing, { sheet })], { type: 'application/dxf' });
  if (fmt === 'pdf') return m.drawingToPDF(drawing, { sheet, paper: o.pdfPaper });
  if (fmt === 'png') return m.drawingToPNG(drawing, { sheet, width: Number(o.pngWidth), background: o.pngBg === 'transparent' ? 'transparent' : '#ffffff' });
  throw new Error('UNSUPPORTED_TARGET');
}

async function convert() {
  if (state.busy || !state.source) return;
  const t = TARGETS[state.target];
  const o = state.opts;
  const base = baseName(state.source.name);
  setBusy(true);
  await nextFrame();
  try {
    let blob;
    let filename;
    if (t.kind === 'mesh' || t.kind === 'extrude') {
      if (t.kind === 'extrude' && !(await ensureExtrude())) return;
      const { export3D } = await import('./io/export3d.js');
      const res = await export3D(viewer3d.createExportClone(), {
        format: t.fmt,
        name: base,
        sourceUp: t.kind === 'extrude' ? 'z' : state.up,
        targetUp: o.upAxis,
        scale: unitScale(state.units, o.targetUnit),
        binary: o.binary,
        mtl: o.mtl,
        unit: o.targetUnit,
      });
      blob = res.blob;
      filename = res.filename;
    } else if (t.kind === 'sheet') {
      const sheet = await ensureSheet();
      if (!sheet) return;
      blob = await exportDrawing(sheet.drawing, t.fmt, sheet);
      filename = `${base}_drawing.${t.ext}`;
    } else if (t.kind === 'flat') {
      blob = await exportDrawing(state.drawing, t.fmt, null);
      filename = `${base}.${t.ext}`;
    } else if (t.kind === 'bom') {
      blob = await exportBom(base);
      filename = `${base}_BOM.xlsx`;
    } else if (t.kind === 'render') {
      if (state.tab !== '3d') await showTab('3d', { syncTarget: false });
      blob = await viewer3d.captureImage({ scale: Number(o.renderScale), background: o.renderBg === 'transparent' ? null : o.renderBg });
      filename = `${base}_render.png`;
    }
    downloadBlob(blob, filename);
    addHistory({ filename, blob, label: t.label, tone: toneOf(state.target) });
    toast(`${filename} · ${fmtBytes(blob.size)}`, { type: 'success', title: 'แปลงไฟล์สำเร็จ' });
  } catch (err) {
    console.error(err);
    toast(errorMessage(err), { type: 'error', title: 'แปลงไฟล์ไม่สำเร็จ' });
  } finally {
    setBusy(false);
  }
}

function addHistory(item) {
  state.history.unshift({ ...item, time: new Date() });
  state.history = state.history.slice(0, 8);
  renderHistory();
}

function renderHistory() {
  $('#history-section').hidden = !state.history.length;
  $('#history').innerHTML = state.history
    .map((h, i) => `
      <li class="history__item">
        <span class="history__badge" style="--tone:${h.tone}">${esc(h.label)}</span>
        <div class="history__body">
          <div class="history__name" title="${esc(h.filename)}">${esc(h.filename)}</div>
          <div class="history__meta">${fmtBytes(h.blob.size)} · ${h.time.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
        <button class="icon-btn" data-history="${i}" aria-label="ดาวน์โหลดอีกครั้ง" data-tip="ดาวน์โหลดอีกครั้ง">${icon('download', { size: 16 })}</button>
      </li>`)
    .join('');
}

/* ======================================================================== toolbar */

function syncToolbar() {
  if (!viewer3d) return;
  const s = viewer3d.state;
  $$('#toolbar-3d [data-mode]').forEach((b) => b.classList.toggle('is-active', b.dataset.mode === s.mode));
  const toggles = { edges: s.edges, ortho: s.projection === 'ortho', section: s.section.enabled, rotate: s.autoRotate, grid: s.grid, shadows: s.shadows };
  $$('#toolbar-3d [data-toggle]').forEach((b) => b.classList.toggle('is-active', !!toggles[b.dataset.toggle]));
  $('#section-card').hidden = !s.section.enabled;
}

function bindToolbar() {
  $('#toolbar-3d').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !viewer3d) return;
    const s = viewer3d.state;
    if (b.dataset.view) viewer3d.setView(b.dataset.view);
    else if (b.dataset.action === 'fit') viewer3d.fit();
    else if (b.dataset.mode) viewer3d.setMode(b.dataset.mode);
    else if (b.dataset.toggle) {
      switch (b.dataset.toggle) {
        case 'edges':
          viewer3d.setEdges(!s.edges);
          break;
        case 'ortho':
          viewer3d.setProjection(s.projection === 'ortho' ? 'persp' : 'ortho');
          break;
        case 'section':
          viewer3d.setSection({ enabled: !s.section.enabled });
          break;
        case 'rotate':
          viewer3d.setAutoRotate(!s.autoRotate);
          break;
        case 'grid':
          viewer3d.setGrid(!s.grid);
          break;
        case 'shadows':
          viewer3d.setShadows(!s.shadows);
          break;
        default:
          break;
      }
    }
    syncToolbar();
  });

  $('#section-axis').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $$('#section-axis button').forEach((x) => x.classList.toggle('is-active', x === b));
    viewer3d.setSection({ axis: b.dataset.axis });
  });
  const range = $('#section-range');
  range.addEventListener('input', () => {
    range.style.setProperty('--fill', `${range.value * 100}%`);
    viewer3d.setSection({ t: Number(range.value) });
  });
  $('#section-flip').addEventListener('click', () => viewer3d.setSection({ flip: !viewer3d.state.section.flip }));

  $('#viewport-2d .vp-toolbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-2d]');
    if (!b || !viewer2d) return;
    if (b.dataset['2d'] === 'fit') viewer2d.fit();
    if (b.dataset['2d'] === 'in') viewer2d.zoomBy(1.4);
    if (b.dataset['2d'] === 'out') viewer2d.zoomBy(1 / 1.4);
  });

  window.addEventListener('keydown', (e) => {
    if (!document.body.classList.contains('is-workspace') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest('input, select, textarea')) return;
    if (state.tab === '3d' && viewer3d) {
      const views = { 0: 'iso', 1: 'front', 2: 'top', 3: 'right' };
      if (views[e.key]) viewer3d.setView(views[e.key]);
      else if (e.key === 'f' || e.key === 'F') viewer3d.fit();
    } else if (state.tab === '2d' && viewer2d && (e.key === 'f' || e.key === 'F')) {
      viewer2d.fit();
    }
  });
}

/* ======================================================================== panels: delegated events */

function bindPanels() {
  const left = $('#panel-left');
  left.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-src]');
    if (!sel) return;
    if (sel.dataset.src === 'units') {
      state.units = sel.value;
      if (state.drawing) state.drawing.units = sel.value;
      applyTargetDefaults();
      state.sheet = null;
      renderLeftPanel();
      renderOptions();
      updateInfo();
      if (state.tab === '2d' && state.source.kind === '3d') ensureSheet();
    }
  });
  left.addEventListener('click', (e) => {
    const segBtn = e.target.closest('[data-src-seg] button');
    if (segBtn) {
      const name = segBtn.parentElement.dataset.srcSeg;
      const value = segBtn.dataset.value;
      if (name === 'up' && value !== state.up) {
        state.up = value;
        viewer3d.setUp(value, { refit: true });
        renderLeftPanel();
        updateInfo();
        if (state.tab === '2d') ensureSheet();
      } else if (name === 'quality' && value !== state.quality) {
        state.quality = value;
        openSource({ file: state.source.file, files: state.source.files, keepTarget: true });
      }
      return;
    }
    const eye = e.target.closest('[data-part-eye]');
    if (eye) {
      const mesh = viewer3d.meshes()[Number(eye.dataset.partEye)];
      if (mesh) viewer3d.setPartVisible(mesh, !mesh.visible);
      renderLeftPanel();
      renderOptions();
      if (state.tab === '2d') scheduleSheet();
      return;
    }
    const focus = e.target.closest('[data-part-focus]');
    if (focus) {
      const mesh = viewer3d.meshes()[Number(focus.dataset.partFocus)];
      if (mesh) {
        if (state.tab !== '3d') showTab('3d');
        viewer3d.focusObject(mesh);
      }
      return;
    }
    const parts = e.target.closest('[data-parts]');
    if (parts) {
      const on = parts.dataset.parts === 'all';
      for (const m of viewer3d.meshes()) viewer3d.setPartVisible(m, on);
      renderLeftPanel();
      renderOptions();
      if (state.tab === '2d') scheduleSheet();
      return;
    }
    const layerEye = e.target.closest('[data-layer-eye]');
    const layersAll = e.target.closest('[data-layers]');
    if (layerEye || layersAll) {
      const d = state.drawing;
      if (layerEye) {
        const L = d.layers.get(layerEye.dataset.layerEye);
        if (L) L.visible = L.visible === false;
      } else {
        for (const L of d.layers.values()) L.visible = layersAll.dataset.layers === 'all';
      }
      for (const L of d.layers.values()) viewer2d.setLayerVisible(L.name, L.visible !== false);
      renderLeftPanel();
      updateInfo();
      if (state.tab === '3d') scheduleExtrude();
    }
  });

  $('#targets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-target]');
    if (b) selectTarget(b.dataset.target);
  });

  const options = $('#options');
  const readOpt = (input) => {
    const name = input.dataset.opt;
    let value = input.type === 'checkbox' ? input.checked : input.value;
    if (input.dataset.num !== undefined) value = Number(value);
    if (name === 'pngWidth') value = Number(value);
    return [name, value];
  };
  options.addEventListener('input', (e) => {
    const input = e.target.closest('[data-opt][data-live], input[type="number"][data-opt]');
    if (!input) return;
    const [name, raw] = readOpt(input);
    let value = raw;
    if (input.type === 'range') {
      input.style.setProperty('--fill', `${((value - input.min) / (input.max - input.min)) * 100}%`);
      const out = input.closest('.field').querySelector('.val');
      if (out) out.textContent = `${value}°`;
    }
    if (input.type === 'number' && !(value > 0)) {
      if (input.dataset.optional === undefined || input.value !== '') return;
      value = null;
    }
    state.opts[name] = value;
    onOptionChanged(name);
  });
  options.addEventListener('change', (e) => {
    const view = e.target.closest('[data-view-opt]');
    if (view) {
      state.opts.views[view.dataset.viewOpt] = view.checked;
      onOptionChanged('views');
      return;
    }
    const input = e.target.closest('[data-opt]');
    if (!input || input.dataset.live !== undefined || input.type === 'number') return;
    const [name, value] = readOpt(input);
    state.opts[name] = value;
    onOptionChanged(name);
  });
  options.addEventListener('click', (e) => {
    const b = e.target.closest('[data-opt-seg] button');
    if (!b) return;
    const name = b.parentElement.dataset.optSeg;
    let value = b.dataset.value;
    if (value === 'true' || value === 'false') value = value === 'true';
    else if (/^\d+(\.\d+)?$/.test(value)) value = Number(value);
    state.opts[name] = value;
    $$('button', b.parentElement).forEach((x) => x.classList.toggle('is-active', x === b));
    onOptionChanged(name);
  });

  $('#btn-convert').addEventListener('click', convert);
  $('#history').addEventListener('click', (e) => {
    const b = e.target.closest('[data-history]');
    if (!b) return;
    const h = state.history[Number(b.dataset.history)];
    if (h) downloadBlob(h.blob, h.filename);
  });
  $('#stage-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b && b.dataset.tab !== state.tab) showTab(b.dataset.tab);
  });
}

/* ======================================================================== landing bits */

function renderFormatTable() {
  const check = `<span class="yes">${icon('check', { size: 15, stroke: 2.5 })}</span>`;
  const none = `<span class="no">${icon('minus', { size: 15 })}</span>`;
  $('#format-rows').innerHTML = FORMAT_ROWS.map(([name, exts, desc, input, output, tone]) => `
    <div class="ft-row" role="row">
      <span role="cell"><span class="fmt-badge" style="--tone:${TONES[tone]}">${name}${exts ? ` <small>${exts}</small>` : ''}</span></span>
      <span role="cell" class="ft-desc">${desc}</span>
      <span role="cell">${input ? check : none}</span>
      <span role="cell">${output ? check : none}</span>
    </div>`).join('');
}

function bindFileInputs() {
  const input = $('#file-input');
  const pick = () => input.click();
  input.addEventListener('change', () => {
    if (input.files && input.files.length) openFiles(input.files);
    input.value = '';
  });
  $('#btn-open').addEventListener('click', pick);
  const dz = $('#dropzone');
  dz.addEventListener('click', pick);
  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick();
    }
  });

  // Global drag & drop
  const overlay = $('#drop-overlay');
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    overlay.hidden = false;
    dz.classList.add('is-over');
  });
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) {
      overlay.hidden = true;
      dz.classList.remove('is-over');
    }
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    dz.classList.remove('is-over');
    openFiles(e.dataTransfer.files);
  });

  $('#sample-3d').addEventListener('click', () => {
    const file = { name: 'bracket_assembly.step', size: 0 };
    openSource({ file, files: [file], preset: { kind: '3d', object: createSamplePart(), up: 'z', unit: 'mm', format: 'STEP', sample: true } });
  });
  $('#sample-2d').addEventListener('click', () => {
    const file = new File([createSampleDXF()], 'sample_plate.dxf', { type: 'application/dxf' });
    openSource({ file, files: [file] });
  });

  const goHome = (e) => {
    e.preventDefault();
    if (document.body.classList.contains('is-workspace')) leaveWorkspace();
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  $('#brand-home').addEventListener('click', goHome);
  $('#btn-home').addEventListener('click', goHome);
  $('#theme-toggle').addEventListener('click', () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
}

/* ======================================================================== installable app */

function setupInstallableApp() {
  // Desktop (.exe) build: files come from Explorer via the Electron preload; no service worker needed
  const desktop = window.morphcadDesktop;
  if (desktop) {
    desktop.onOpenFiles((files) => openFiles(files.map((f) => new File([f.data], f.name))));
    return;
  }

  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker not registered', err));
  }

  let deferredPrompt = null;
  const btn = $('#btn-install');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    btn.hidden = false;
  });
  btn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    btn.hidden = true;
  });
  window.addEventListener('appinstalled', () => {
    btn.hidden = true;
    toast('เปิด MorphCAD ได้จากไอคอนบนเดสก์ท็อปหรือเมนู Start ใช้งานได้แม้ไม่มีอินเทอร์เน็ต', { type: 'success', title: 'ติดตั้งแอปแล้ว' });
  });

  // Files opened from Explorer ("Open with MorphCAD") once the app is installed
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      if (!params.files || !params.files.length) return;
      const files = await Promise.all(params.files.map((h) => h.getFile()));
      openFiles(files);
    });
  }
}

/* ======================================================================== boot */

function boot() {
  hydrateIcons();
  renderFormatTable();
  bindFileInputs();
  bindToolbar();
  bindPanels();
  setupInstallableApp();
  try {
    hero = new HeroScene($('#hero-canvas'));
    hero.setTheme(currentTheme());
    hero.start();
  } catch (err) {
    console.warn('WebGL hero unavailable', err);
  }
  // Debug/automation hook
  window.__morphcad = { state, openFiles, get viewer3d() { return viewer3d; }, get viewer2d() { return viewer2d; } };
}

boot();
