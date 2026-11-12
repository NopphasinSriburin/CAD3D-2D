import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createSamplePart } from '../cad/samples.js';

/** Slowly turning sample part with accent edges for the landing page. */
export class HeroScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.8;
    pmrem.dispose();
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(120, 260, 160);
    this.scene.add(key, new THREE.HemisphereLight(0xffffff, 0x667085, 0.5));

    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 5000);
    this.camera.position.set(250, 190, 250);
    this.camera.lookAt(0, 8, 0);

    const part = createSamplePart();
    part.rotation.x = -Math.PI / 2;
    const box = new THREE.Box3().setFromObject(part);
    const center = box.getCenter(new THREE.Vector3());
    part.position.sub(center);

    this.edgeMat = new THREE.LineBasicMaterial({ color: 0xff7a33, transparent: true, opacity: 0.95 });
    part.traverse((o) => {
      if (!o.isMesh) return;
      o.material = new THREE.MeshStandardMaterial({
        color: o.name === 'Boss' ? 0xff8a4c : 0xc6ceda,
        metalness: 0.25,
        roughness: 0.45,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      o.add(new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 25), this.edgeMat));
    });

    this.pivot = new THREE.Group();
    this.pivot.add(part);
    this.scene.add(this.pivot);

    this.pointer = { x: 0, y: 0 };
    this.tilt = { x: 0, y: 0 };
    window.addEventListener('pointermove', (e) => {
      this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });

    this.running = false;
    this.visible = true;
    this._tick = this._tick.bind(this);
    this._resize = new ResizeObserver(() => this.resize());
    this._resize.observe(canvas);
    this._io = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
    });
    this._io.observe(canvas);
    this.resize();
  }

  setTheme(theme) {
    this.edgeMat.color.set(theme === 'light' ? 0xe25412 : 0xff7a33);
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
  }

  _tick(now) {
    if (!this.running) return;
    requestAnimationFrame(this._tick);
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    if (!this.visible || document.hidden) return;
    this.pivot.rotation.y += dt * 0.35;
    this.tilt.x += (this.pointer.y * 0.12 - this.tilt.x) * 0.05;
    this.tilt.y += (this.pointer.x * 0.2 - this.tilt.y) * 0.05;
    this.scene.rotation.x = this.tilt.x;
    this.scene.rotation.z = -this.tilt.y * 0.3;
    this.renderer.render(this.scene, this.camera);
  }
}
