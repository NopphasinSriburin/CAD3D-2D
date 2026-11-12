import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createDepthMaterial } from '../cad/projection.js';
import { AxisGizmo } from './gizmo.js';

const VIEW_DIRS = {
  iso: [1, 0.85, 1],
  front: [0, 0, 1],
  back: [0, 0, -1],
  top: [0, 1, 0.0001],
  bottom: [0, -1, 0.0001],
  right: [1, 0, 0],
  left: [-1, 0, 0],
};

const THEMES = {
  dark: { grid: 0x2a2f3b, gridMajor: 0x454d60, clay: 0xc9cfd9, edge: 0x07080b, edgeOpacity: 0.6, shadow: 0.42 },
  light: { grid: 0xd4d9e2, gridMajor: 0xa6aec0, clay: 0xbcc4d0, edge: 0x14171d, edgeOpacity: 0.55, shadow: 0.2 },
};

const ACCENT = 0xff6b2c;

function materialsOf(m) {
  return Array.isArray(m) ? m : [m];
}

function niceStep(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class Viewer3D {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'v3d-canvas';
    container.prepend(this.canvas);

    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.localClippingEnabled = true;
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.7;
    pmrem.dispose();

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x7d8796, 0.6);
    this.key = new THREE.DirectionalLight(0xffffff, 1.7);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.fill = new THREE.DirectionalLight(0xdce6ff, 0.5);
    this.scene.add(this.hemi, this.key, this.key.target, this.fill);

    this.perspCam = new THREE.PerspectiveCamera(38, 1, 0.01, 1e5);
    this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1e4, 1e4);
    this.orthoHalf = 1;
    this.camera = this.perspCam;
    this.perspCam.position.set(3, 2.5, 3);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener('start', () => {
      this.tween = null;
    });

    this.root = new THREE.Group();
    this.root.name = '__display_root';
    this.scene.add(this.root);
    this.helpers = new THREE.Group();
    this.scene.add(this.helpers);

    this.model = null;
    this.box = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    this.sphere = new THREE.Sphere(new THREE.Vector3(), 1.7);
    this.state = {
      up: 'z', mode: 'original', edges: true, shadows: true, grid: true, projection: 'persp', autoRotate: false,
      section: { enabled: false, axis: 'z', t: 0.5, flip: false },
    };
    this.themeName = 'dark';
    this.origMaterials = new WeakMap();
    this.patched = new WeakSet();
    this.origSides = new WeakMap();
    this.clipPlanes = [];
    this.cutTint = { value: 0 };

    this.mats = {
      clay: new THREE.MeshStandardMaterial({ color: THEMES.dark.clay, metalness: 0.05, roughness: 0.62, side: THREE.DoubleSide }),
      wire: new THREE.MeshBasicMaterial({ color: ACCENT, wireframe: true, transparent: true, opacity: 0.55 }),
      xray: new THREE.MeshStandardMaterial({ color: 0x6fb8ff, metalness: 0, roughness: 0.4, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
      edge: new THREE.LineBasicMaterial({ color: THEMES.dark.edge, transparent: true, opacity: THEMES.dark.edgeOpacity }),
    };
    for (const m of [this.mats.clay, this.mats.wire, this.mats.xray, this.mats.edge]) this._patchMaterial(m);

    this._makeGrid();
    this.gizmo = new AxisGizmo(container, { onPick: (dir) => this.viewFrom(dir) });

    this.dirty = true;
    this._resize = new ResizeObserver(() => this.resize());
    this._resize.observe(container);
    this._tick = this._tick.bind(this);
    this._raf = requestAnimationFrame(this._tick);
    this.resize();
  }

  /* ------------------------------------------------------------ setup */

  _makeGrid() {
    const gridMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uStep: { value: 10 },
        uMajorStep: { value: 50 },
        uColor: { value: new THREE.Color(THEMES.dark.grid) },
        uMajor: { value: new THREE.Color(THEMES.dark.gridMajor) },
        uCenter: { value: new THREE.Vector3() },
        uFade: { value: 100 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uStep;
        uniform float uMajorStep;
        uniform vec3 uColor;
        uniform vec3 uMajor;
        uniform vec3 uCenter;
        uniform float uFade;
        varying vec3 vWorld;
        float lineMask(vec2 p, float stepSize, float width) {
          vec2 c = p / stepSize;
          vec2 d = fwidth(c);
          vec2 g = abs(fract(c - 0.5) - 0.5) / max(d, vec2(1e-6));
          return 1.0 - min(min(g.x, g.y) / width, 1.0);
        }
        void main() {
          vec2 p = vWorld.xz;
          float minor = lineMask(p, uStep, 1.0);
          float major = lineMask(p, uMajorStep, 1.3);
          float dist = length(vWorld.xz - uCenter.xz);
          float fade = 1.0 - smoothstep(uFade * 0.3, uFade, dist);
          float a = max(minor * 0.5, major) * fade;
          if (a < 0.004) discard;
          gl_FragColor = vec4(mix(uColor, uMajor, major), a);
          #include <colorspace_fragment>
        }`,
    });
    this.grid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), gridMat);
    this.grid.rotation.x = -Math.PI / 2;
    this.grid.renderOrder = -1;
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: THEMES.dark.shadow, transparent: true, depthWrite: false }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.helpers.add(this.ground, this.grid);
  }

  _patchMaterial(m) {
    if (!m || this.patched.has(m)) return;
    this.patched.add(m);
    if (!m.isLineBasicMaterial && !m.isPointsMaterial) {
      m.polygonOffset = true;
      m.polygonOffsetFactor = 1;
      m.polygonOffsetUnits = 1;
    }
    m.clippingPlanes = this.clipPlanes;
    if (m.isLineBasicMaterial || m.isPointsMaterial || m.isShaderMaterial) return;
    const tint = this.cutTint;
    const prev = m.onBeforeCompile;
    const prevKey = m.customProgramCacheKey;
    m.onBeforeCompile = (shader, renderer) => {
      if (prev) prev.call(m, shader, renderer);
      shader.uniforms.uCutTint = tint;
      let code = '#include <dithering_fragment>\n  if (!gl_FrontFacing && uCutTint > 0.5) gl_FragColor.rgb = vec3(1.0, 0.36, 0.12) * 0.85;';
      // While a section is active, push back faces slightly behind coincident front faces
      // (touching parts in assemblies would otherwise z-fight inside the cut).
      if (tint.value > 0.5) code += '\n  gl_FragDepth = gl_FrontFacing ? gl_FragCoord.z : min(1.0, gl_FragCoord.z + 4e-6);';
      shader.fragmentShader = 'uniform float uCutTint;\n' + shader.fragmentShader.replace('#include <dithering_fragment>', code);
    };
    m.customProgramCacheKey = () => `morph-cut-${tint.value > 0.5 ? 1 : 0}|${prevKey.call(m)}`;
  }

  /* ------------------------------------------------------------ model */

  clear() {
    if (!this.model) return;
    this.root.remove(this.model);
    const own = new Set(Object.values(this.mats));
    this.model.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = o.isMesh ? materialsOf(this.origMaterials.get(o) || o.material) : o.material ? materialsOf(o.material) : [];
      for (const m of mats) {
        if (!m || own.has(m)) continue;
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) if (m[key]) m[key].dispose();
        m.dispose();
      }
    });
    this.model = null;
  }

  setModel(object, { up = 'z', edges = true } = {}) {
    this.clear();
    this.model = object;
    this.root.add(object);
    object.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
        this.origMaterials.set(o, o.material);
        for (const m of materialsOf(o.material)) this._patchMaterial(m);
      } else if (o.isPoints) {
        this._patchMaterial(o.material);
      }
    });
    this.state.edges = edges;
    this.setUp(up, { refit: true });
    this.applyMode();
    this.applyEdges();
    this.setSection({ enabled: false });
  }

  meshes() {
    const out = [];
    if (this.model) this.model.traverse((o) => o.isMesh && !o.userData.overlay && out.push(o));
    return out;
  }

  setUp(up, { refit = true } = {}) {
    this.state.up = up;
    this.root.rotation.set(up === 'z' ? -Math.PI / 2 : 0, 0, 0);
    this.root.updateMatrixWorld(true);
    this.updateBounds();
    this.gizmo.setUp(up);
    if (this.state.section.enabled) this.setSection({});
    if (refit) this.setView('iso', false);
    this.requestRender();
  }

  updateBounds() {
    const box = new THREE.Box3();
    if (this.model) {
      this.root.updateMatrixWorld(true);
      this.model.traverseVisible((o) => {
        if ((o.isMesh || o.isPoints) && !o.userData.overlay) box.expandByObject(o);
      });
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    this.box = box;
    this.sphere = box.getBoundingSphere(new THREE.Sphere());
    if (!(this.sphere.radius > 0)) this.sphere.radius = 1;
    this._updateHelpers();
  }

  _updateHelpers() {
    const box = this.box;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const r = this.sphere.radius;
    const span = Math.max(size.x, size.z, r * 0.6);
    const step = niceStep(span / 8);
    const fade = Math.max(span * 1.6, r * 2.4);
    const u = this.grid.material.uniforms;
    u.uStep.value = step;
    u.uMajorStep.value = step * 5;
    u.uCenter.value.set(center.x, box.min.y, center.z);
    u.uFade.value = fade;
    const floorY = box.min.y - r * 0.0005;
    this.grid.position.set(center.x, floorY, center.z);
    this.grid.scale.set(fade * 2.2, fade * 2.2, 1);
    this.ground.position.set(center.x, floorY - r * 0.0005, center.z);
    this.ground.scale.set(fade * 2.2, fade * 2.2, 1);

    this.key.position.set(center.x + r * 1.4, center.y + r * 3, center.z + r * 1.9);
    this.key.target.position.copy(center);
    this.key.target.updateMatrixWorld();
    const sc = this.key.shadow.camera;
    sc.left = -r * 1.7;
    sc.right = r * 1.7;
    sc.top = r * 1.7;
    sc.bottom = -r * 1.7;
    sc.near = r * 0.1;
    sc.far = r * 8;
    sc.updateProjectionMatrix();
    this.key.shadow.normalBias = r * 0.003;
    this.fill.position.set(center.x - r * 2, center.y + r, center.z - r * 1.5);
    this.applyHelpersVisibility();
  }

  applyHelpersVisibility() {
    this.grid.visible = this.state.grid;
    this.ground.visible = this.state.shadows;
    this.key.castShadow = this.state.shadows;
    this.requestRender();
  }

  /* ------------------------------------------------------------ display */

  setMode(mode) {
    this.state.mode = mode;
    this.applyMode();
    this.applyEdges();
  }

  applyMode() {
    const mode = this.state.mode;
    for (const o of this.meshes()) {
      const orig = this.origMaterials.get(o) || o.material;
      o.material = mode === 'clay' ? this.mats.clay : mode === 'wire' ? this.mats.wire : mode === 'xray' ? this.mats.xray : orig;
    }
    this.mats.edge.color.set(mode === 'xray' ? 0x8fd0ff : THEMES[this.themeName].edge);
    this.mats.edge.opacity = mode === 'xray' ? 0.85 : THEMES[this.themeName].edgeOpacity;
    this.requestRender();
  }

  setEdges(on) {
    this.state.edges = on;
    this.applyEdges();
  }

  applyEdges() {
    const on = this.state.edges && this.state.mode !== 'wire';
    for (const o of this.meshes()) {
      let lines = o.children.find((c) => c.userData.overlay);
      if (on && !lines) {
        lines = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 28), this.mats.edge);
        lines.userData.overlay = true;
        lines.name = '__edges';
        lines.raycast = () => {};
        o.add(lines);
      }
      if (lines) lines.visible = on;
    }
    this.requestRender();
  }

  setGrid(on) {
    this.state.grid = on;
    this.applyHelpersVisibility();
  }

  setShadows(on) {
    this.state.shadows = on;
    this.applyHelpersVisibility();
  }

  setAutoRotate(on) {
    this.state.autoRotate = on;
    this.controls.autoRotate = on;
    this.controls.autoRotateSpeed = 1.6;
    this.requestRender();
  }

  setTheme(name) {
    this.themeName = THEMES[name] ? name : 'dark';
    const t = THEMES[this.themeName];
    this.grid.material.uniforms.uColor.value.set(t.grid);
    this.grid.material.uniforms.uMajor.value.set(t.gridMajor);
    this.ground.material.opacity = t.shadow;
    this.mats.clay.color.set(t.clay);
    this.applyMode();
  }

  axisVector(axis) {
    const zUp = this.state.up === 'z';
    if (axis === 'x') return new THREE.Vector3(1, 0, 0);
    if (axis === 'y') return zUp ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    return zUp ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  }

  setSection(patch) {
    const wasEnabled = this.state.section.enabled;
    const s = Object.assign(this.state.section, patch);
    this.clipPlanes.length = 0;
    if (s.enabled) {
      const n = this.axisVector(s.axis);
      let lo = Infinity;
      let hi = -Infinity;
      const b = this.box;
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
        const d = n.x * x + n.y * y + n.z * z;
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
      const c = lo + (hi - lo) * s.t;
      this.clipPlanes.push(s.flip ? new THREE.Plane(n.clone(), -c) : new THREE.Plane(n.clone().negate(), c));
    }
    this.cutTint.value = s.enabled ? 1 : 0;
    const all = new Set();
    for (const o of this.meshes()) for (const m of materialsOf(this.origMaterials.get(o) || o.material)) all.add(m);
    all.add(this.mats.clay);
    for (const m of all) {
      if (!m) continue;
      if (wasEnabled !== s.enabled) m.needsUpdate = true;
      if (s.enabled) {
        if (!this.origSides.has(m)) this.origSides.set(m, m.side);
        if (m.side !== THREE.DoubleSide) {
          m.side = THREE.DoubleSide;
          m.needsUpdate = true;
        }
      } else if (this.origSides.has(m)) {
        m.side = this.origSides.get(m);
        m.needsUpdate = true;
        this.origSides.delete(m);
      }
    }
    this.requestRender();
  }

  setPartVisible(mesh, visible) {
    mesh.visible = visible;
    this.requestRender();
  }

  /* ------------------------------------------------------------ camera */

  setProjection(mode) {
    if (mode === this.state.projection) return;
    const target = this.controls.target;
    const fov = THREE.MathUtils.degToRad(this.perspCam.fov);
    if (mode === 'ortho') {
      const dist = this.perspCam.position.distanceTo(target);
      this.orthoHalf = dist * Math.tan(fov / 2);
      this.orthoCam.zoom = 1;
      this.orthoCam.position.copy(this.perspCam.position);
      this.orthoCam.quaternion.copy(this.perspCam.quaternion);
      this.camera = this.orthoCam;
    } else {
      const half = this.orthoHalf / this.orthoCam.zoom;
      const dist = half / Math.tan(fov / 2);
      const dir = this.orthoCam.position.clone().sub(target).normalize();
      this.perspCam.position.copy(target).addScaledVector(dir, dist);
      this.perspCam.quaternion.copy(this.orthoCam.quaternion);
      this.camera = this.perspCam;
    }
    this.state.projection = mode;
    this.controls.object = this.camera;
    this._updateCameras();
    this.controls.update();
    this.requestRender();
  }

  _fitDistance(r) {
    const fov = THREE.MathUtils.degToRad(this.perspCam.fov);
    const aspect = this.perspCam.aspect || 1;
    const hfov = 2 * Math.atan(Math.tan(fov / 2) * aspect);
    return Math.max(r / Math.sin(fov / 2), r / Math.sin(hfov / 2)) * 1.12;
  }

  setView(name, animate = true) {
    this.viewFrom(new THREE.Vector3(...(VIEW_DIRS[name] || VIEW_DIRS.iso)), animate);
  }

  viewFrom(dir, animate = true, sphere = this.sphere) {
    const d = dir.clone().normalize();
    if (Math.abs(d.y) > 0.9999) d.z += 0.0001;
    d.normalize();
    const dist = this._fitDistance(sphere.radius);
    const pos = sphere.center.clone().addScaledVector(d, dist);
    const aspect = this.perspCam.aspect || 1;
    const half = (sphere.radius * 1.12) / Math.min(1, aspect);
    this._moveCamera(pos, sphere.center.clone(), half, animate);
  }

  fit(animate = true) {
    const dir = this.camera.position.clone().sub(this.controls.target);
    this.viewFrom(dir.lengthSq() > 0 ? dir : new THREE.Vector3(...VIEW_DIRS.iso), animate);
  }

  focusObject(obj) {
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    sphere.radius = Math.max(sphere.radius, this.sphere.radius * 0.05);
    this.viewFrom(this.camera.position.clone().sub(this.controls.target), true, sphere);
  }

  _moveCamera(pos, target, orthoHalf, animate) {
    const cam = this.camera;
    if (!animate) {
      this.tween = null;
      this.perspCam.position.copy(pos);
      this.orthoCam.position.copy(pos);
      this.controls.target.copy(target);
      this.orthoHalf = orthoHalf;
      this.orthoCam.zoom = 1;
      this._updateCameras();
      cam.lookAt(target);
      this.controls.update();
      this.requestRender();
      return;
    }
    const rel0 = cam.position.clone().sub(this.controls.target);
    const rel1 = pos.clone().sub(target);
    this.tween = {
      start: performance.now(),
      dur: 650,
      t0: this.controls.target.clone(),
      t1: target,
      dir0: rel0.clone().normalize(),
      q: new THREE.Quaternion().setFromUnitVectors(rel0.clone().normalize(), rel1.clone().normalize()),
      d0: rel0.length(),
      d1: rel1.length(),
      h0: this.orthoHalf / this.orthoCam.zoom,
      h1: orthoHalf,
    };
  }

  _stepTween(now) {
    const tw = this.tween;
    const k = Math.min(1, (now - tw.start) / tw.dur);
    const e = ease(k);
    const q = new THREE.Quaternion().slerp(tw.q, e);
    const dir = tw.dir0.clone().applyQuaternion(q);
    const target = tw.t0.clone().lerp(tw.t1, e);
    const dist = tw.d0 + (tw.d1 - tw.d0) * e;
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(dir, dist);
    if (this.camera === this.orthoCam) {
      this.orthoCam.zoom = 1;
      this.orthoHalf = tw.h0 + (tw.h1 - tw.h0) * e;
    }
    this._updateCameras();
    this.camera.lookAt(target);
    if (k >= 1) {
      this.tween = null;
      if (this.camera === this.perspCam) this.orthoHalf = tw.h1;
    }
  }

  _updateCameras() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const aspect = w / h;
    const r = this.sphere.radius;
    const dist = this.camera.position.distanceTo(this.controls.target);
    this.perspCam.aspect = aspect;
    this.perspCam.near = Math.max(dist * 0.01, r * 1e-4);
    this.perspCam.far = dist + r * 30;
    this.perspCam.updateProjectionMatrix();
    this.orthoCam.left = -this.orthoHalf * aspect;
    this.orthoCam.right = this.orthoHalf * aspect;
    this.orthoCam.top = this.orthoHalf;
    this.orthoCam.bottom = -this.orthoHalf;
    this.orthoCam.near = -r * 20;
    this.orthoCam.far = dist + r * 20;
    this.orthoCam.updateProjectionMatrix();
  }

  /* ------------------------------------------------------------ loop */

  requestRender() {
    this.dirty = true;
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this._updateCameras();
    this.requestRender();
  }

  _tick(now) {
    this._raf = requestAnimationFrame(this._tick);
    const dt = Math.min(0.1, (now - (this._last || now)) / 1000);
    this._last = now;
    if (!this.container.clientWidth) return;
    if (this.tween) {
      this._stepTween(now);
      this.dirty = true;
    }
    const moved = this.controls.update(dt);
    if (moved || this.dirty || this.state.autoRotate) {
      this.dirty = false;
      this._updateCameras();
      this.renderer.render(this.scene, this.camera);
      this.gizmo.update(this.camera);
    }
  }

  /* ------------------------------------------------------------ outputs */

  stats() {
    let triangles = 0;
    let vertices = 0;
    let meshes = 0;
    const materials = new Set();
    for (const o of this.meshes()) {
      meshes++;
      const g = o.geometry;
      vertices += g.attributes.position.count;
      triangles += Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
      for (const m of materialsOf(this.origMaterials.get(o) || o.material)) materials.add(m);
    }
    const s = this.box.getSize(new THREE.Vector3());
    const dims = this.state.up === 'z' ? { x: s.x, y: s.z, z: s.y } : { x: s.x, y: s.y, z: s.z };
    return { triangles, vertices, meshes, materials: materials.size, dims };
  }

  /** Clone of the model with original materials, no overlays and only visible parts. */
  createExportClone() {
    if (!this.model) throw new Error('NO_MODEL');
    const swaps = [];
    for (const o of this.meshes()) {
      swaps.push([o, o.material]);
      o.material = this.origMaterials.get(o) || o.material;
    }
    const clone = cloneSkinned(this.model);
    for (const [o, m] of swaps) o.material = m;
    const remove = [];
    clone.traverse((o) => {
      if (o.userData.overlay || o.visible === false) remove.push(o);
    });
    for (const o of remove) if (o.parent) o.parent.remove(o);
    return clone;
  }

  async captureImage({ scale = 2, background = null } = {}) {
    const renderer = this.renderer;
    const prevRatio = renderer.getPixelRatio();
    const prevGrid = this.grid.visible;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const ratio = Math.min(scale, 8192 / Math.max(w, h));
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    if (background) renderer.setClearColor(background, 1);
    if (!background) this.grid.visible = false;
    this._updateCameras();
    renderer.render(this.scene, this.camera);
    const blob = await new Promise((resolve) => this.canvas.toBlob(resolve, 'image/png'));
    renderer.setClearColor(0x000000, 0);
    this.grid.visible = prevGrid;
    renderer.setPixelRatio(prevRatio);
    renderer.setSize(w, h, false);
    this.requestRender();
    if (!blob) throw new Error('CAPTURE_FAILED');
    return blob;
  }

  /** Renders packed linear depth of the model only (used by the 3D → 2D projector). */
  renderDepth(camera, width, height, near, far) {
    const renderer = this.renderer;
    if (!this._depthMat) this._depthMat = createDepthMaterial();
    const mat = this._depthMat;
    mat.uniforms.uNear.value = near;
    mat.uniforms.uFar.value = far;
    const max = Math.min(renderer.capabilities.maxTextureSize, 8192);
    const W = Math.min(width, max);
    const H = Math.min(height, max);
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, depthBuffer: true });

    const hidden = [];
    this.scene.traverse((o) => {
      if (o.visible && (o.userData.overlay || o.isPoints || o.isLine)) {
        hidden.push(o);
        o.visible = false;
      }
    });
    const helpersVisible = this.helpers.visible;
    this.helpers.visible = false;
    const prevTarget = renderer.getRenderTarget();
    const prevColor = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevShadow = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = false;
    this.scene.overrideMaterial = mat;

    renderer.setRenderTarget(rt);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear(true, true, true);
    renderer.render(this.scene, camera);
    const buf = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);

    this.scene.overrideMaterial = null;
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
    renderer.shadowMap.enabled = prevShadow;
    this.helpers.visible = helpersVisible;
    for (const o of hidden) o.visible = true;
    rt.dispose();
    this.requestRender();

    if (W === width && H === height) return buf;
    // Requested size exceeded GPU limits: nearest-neighbour upscale to keep the caller's indexing simple
    const out = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const sy = Math.min(H - 1, Math.floor((y * H) / height));
      for (let x = 0; x < width; x++) {
        const sx = Math.min(W - 1, Math.floor((x * W) / width));
        out.set(buf.subarray((sy * W + sx) * 4, (sy * W + sx) * 4 + 4), (y * width + x) * 4);
      }
    }
    return out;
  }
}
