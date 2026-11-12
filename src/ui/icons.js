import {
  ArrowRight, Axis3d, Box, Boxes, Camera, Check, ChevronDown, CircleCheck, Clock, CloudOff, Crosshair, Cuboid,
  Cylinder, Download, DraftingCompass, Eye, EyeOff, File, FileBox, FileText, FolderOpen, Focus, Frame, Gauge,
  Globe, Grid3x3, History, Image, Info, Layers, LoaderCircle, Lock, Maximize, Monitor, Moon, Move3d, Orbit,
  Package, PenTool, Plus, Printer, Rotate3d, RotateCcw, Ruler, ScanEye, Scissors, Shapes, ShieldCheck, Slice,
  SlidersHorizontal, Sparkles, Sun, Trash2, TriangleAlert, Upload, View, WandSparkles, X, Zap, ZoomIn, ZoomOut,
  Minus, Shield, Settings2, Cpu, Hand, ScanLine, Grid2x2, Component,
} from 'lucide';

const REGISTRY = {
  'arrow-right': ArrowRight, 'axis-3d': Axis3d, box: Box, boxes: Boxes, camera: Camera, check: Check,
  'chevron-down': ChevronDown, 'circle-check': CircleCheck, clock: Clock, 'cloud-off': CloudOff, crosshair: Crosshair,
  cuboid: Cuboid, cylinder: Cylinder, download: Download, 'drafting-compass': DraftingCompass, eye: Eye, 'eye-off': EyeOff,
  file: File, 'file-box': FileBox, 'file-text': FileText, 'folder-open': FolderOpen, focus: Focus, frame: Frame, gauge: Gauge,
  globe: Globe, 'grid-3x3': Grid3x3, history: History, image: Image, info: Info, layers: Layers, 'loader-circle': LoaderCircle,
  lock: Lock, maximize: Maximize, monitor: Monitor, moon: Moon, 'move-3d': Move3d, orbit: Orbit, package: Package,
  'pen-tool': PenTool, plus: Plus, printer: Printer, 'rotate-3d': Rotate3d, 'rotate-ccw': RotateCcw, ruler: Ruler,
  'scan-eye': ScanEye, scissors: Scissors, shapes: Shapes, 'shield-check': ShieldCheck, slice: Slice,
  'sliders-horizontal': SlidersHorizontal, sparkles: Sparkles, sun: Sun, 'trash-2': Trash2, 'triangle-alert': TriangleAlert,
  upload: Upload, view: View, 'wand-sparkles': WandSparkles, x: X, zap: Zap, 'zoom-in': ZoomIn, 'zoom-out': ZoomOut,
  minus: Minus, shield: Shield, 'settings-2': Settings2, cpu: Cpu, hand: Hand, 'scan-line': ScanLine,
  'grid-2x2': Grid2x2, component: Component,
};

function attrs(obj) {
  return Object.entries(obj).map(([k, v]) => `${k}="${v}"`).join(' ');
}

/** Returns an inline SVG string for a lucide icon. */
export function icon(name, { size = 18, cls = '', stroke = 2 } = {}) {
  const node = REGISTRY[name];
  if (!node) return '';
  const inner = node.map(([tag, a]) => `<${tag} ${attrs(a)}/>`).join('');
  return `<svg class="ico ${cls}" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

/** Replaces every `<i data-icon="name">` inside root with the inline SVG. */
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon, { size: Number(el.dataset.size) || 18, stroke: Number(el.dataset.stroke) || 2 });
    el.removeAttribute('data-icon');
    el.classList.add('i');
  });
}
