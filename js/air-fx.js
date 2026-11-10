import * as THREE from 'three/webgpu';
import { attribute } from 'three/tsl';
import { sealEffect } from './effect-outputs.js';

// What speed through the air looks like (0.9.1). Streaks: specks of air that the body flies through, drawn as lines
// stretched along the motion, thicker the faster it goes. Smoke: the two smoke trails a wingsuit pilot wears on the
// ankles, a ribbon that widens and fades behind them.

const STREAKS = 90;
const TRAIL = 70; // points per smoke trail

const _d = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Vector3();

class AirFx {
  constructor(scene) {
    // ---- streaks
    const pos = new Float32Array(STREAKS * 2 * 3), alpha = new Float32Array(STREAKS * 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('airAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = sealEffect(new THREE.LineBasicNodeMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    mat.opacityNode = attribute('airAlpha', 'float');
    this.streaks = new THREE.LineSegments(geo, mat);
    this.streaks.frustumCulled = false;
    this.streaks.matrixAutoUpdate = false;
    this.streaks.renderOrder = 990;
    scene.add(this.streaks);
    this.points = Array.from({ length: STREAKS }, () => ({ x: 0, y: -1e4, z: 0, seed: Math.random() }));

    // ---- smoke trails: two ribbons, each TRAIL points x 2 vertices across
    // two smoke trails from the ankles, then two wingtip vortices from the wrists: thin, quick to fade, only at speed
    const STYLES = [
      { life: 2.6, width: 0.03, grow: 0.22, max: 0.4, alpha: 0.2, color: 0xdfe3d6 },
      { life: 2.6, width: 0.03, grow: 0.22, max: 0.4, alpha: 0.2, color: 0xdfe3d6 },
      { life: 0.55, width: 0.012, grow: 0.08, max: 0.05, alpha: 0.42, color: 0xffffff },
      { life: 0.55, width: 0.012, grow: 0.08, max: 0.05, alpha: 0.42, color: 0xffffff }
    ];
    this.trails = STYLES.map((style) => {
      const n = TRAIL * 2;
      const g = new THREE.BufferGeometry();
      const p = new Float32Array(n * 3), a = new Float32Array(n);
      g.setAttribute('position', new THREE.BufferAttribute(p, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('smokeAlpha', new THREE.BufferAttribute(a, 1).setUsage(THREE.DynamicDrawUsage));
      const index = [];
      for (let i = 0; i < TRAIL - 1; i++) { const k = i * 2; index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      g.setIndex(index);
      const m = sealEffect(new THREE.MeshBasicNodeMaterial({ color: style.color, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      m.opacityNode = attribute('smokeAlpha', 'float');
      const mesh = new THREE.Mesh(g, m);
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
      return { mesh, history: [], on: 0, style };
    });
    this.warm = 0;
  }

  /**
   * Every frame. cam: the camera's position; vel: the body's velocity; intensity 0..1 (streaks); feet: [left, right]
   * ankle positions or null when no smoke; dt.
   */
  update(cam, vel, intensity, feet, dt, tips = null) {
    const warm = this.warm++ < 5; // drawn once behind the loading screen so the shaders compile
    const speed = vel.length();
    this.streaks.visible = intensity > 0.01 || warm;
    if (this.streaks.visible) {
      const pos = this.streaks.geometry.attributes.position.array, alpha = this.streaks.geometry.attributes.airAlpha.array;
      const dir = speed > 0.5 ? _d.copy(vel).multiplyScalar(1 / speed) : _d.set(0, 0, 1);
      // two directions square to the motion, to scatter the specks round the line of flight
      const side = _s.set(-dir.z, 0, dir.x);
      if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
      side.normalize();
      const up = _c.crossVectors(side, dir).normalize();
      const length = Math.min(7, speed * 0.07);
      this.points.forEach((p, i) => {
        const rel = (p.x - cam.x) * dir.x + (p.y - cam.y) * dir.y + (p.z - cam.z) * dir.z;
        const off = Math.hypot(p.x - cam.x - dir.x * rel, p.y - cam.y - dir.y * rel, p.z - cam.z - dir.z * rel);
        if (rel < -3 || rel > 70 || off > 16) {
          // a new speck ahead, somewhere round the line of flight, not right on it
          // fast, more of them pass close: they whip by at the edges of the frame
          const ahead = 18 + Math.random() * 50, a = Math.random() * Math.PI * 2, r = (intensity > 0.5 && Math.random() < 0.6 ? 1.2 : 2.5) + Math.random() * 10;
          p.x = cam.x + dir.x * ahead + (side.x * Math.cos(a) + up.x * Math.sin(a)) * r;
          p.y = cam.y + dir.y * ahead + (side.y * Math.cos(a) + up.y * Math.sin(a)) * r;
          p.z = cam.z + dir.z * ahead + (side.z * Math.cos(a) + up.z * Math.sin(a)) * r;
        }
        const o = i * 6;
        pos[o] = p.x; pos[o + 1] = p.y; pos[o + 2] = p.z;
        pos[o + 3] = p.x - dir.x * length; pos[o + 4] = p.y - dir.y * length; pos[o + 5] = p.z - dir.z * length;
        const near = Math.min(1, Math.max(0, (rel + 3) / 10)) * Math.min(1, (70 - rel) / 30);
        alpha[i * 2] = 0.55 * intensity * near * (0.5 + p.seed * 0.5);
        alpha[i * 2 + 1] = 0;
      });
      this.streaks.geometry.attributes.position.needsUpdate = true;
      this.streaks.geometry.attributes.airAlpha.needsUpdate = true;
      this.streaks.updateMatrixWorld();
    }
    // smoke
    this.trails.forEach((trail, k) => {
      const st = trail.style;
      const foot = k < 2 ? feet?.[k] : tips?.[k - 2];
      trail.on += ((foot ? 1 : 0) - trail.on) * (1 - Math.exp(-dt * 3));
      const h = trail.history;
      if (foot && dt > 0) {
        h.unshift({ x: foot.x, y: foot.y, z: foot.z, age: 0 });
        if (h.length > TRAIL) h.length = TRAIL;
      }
      for (const p of h) p.age += dt;
      while (h.length && h[h.length - 1].age > st.life) h.pop();
      trail.mesh.visible = (h.length > 2 && trail.on > 0.02) || warm;
      if (!trail.mesh.visible) { if (!foot) h.length = 0; return; }
      const pos = trail.mesh.geometry.attributes.position.array, alpha = trail.mesh.geometry.attributes.smokeAlpha.array;
      for (let i = 0; i < TRAIL; i++) {
        const p = h[Math.min(i, h.length - 1)] ?? { x: cam.x, y: cam.y - 100, z: cam.z, age: 9 };
        const q = h[Math.min(i + 1, h.length - 1)] ?? p;
        // across the ribbon: square to its run and to the view
        _d.set(p.x - q.x, p.y - q.y, p.z - q.z);
        _c.set(cam.x - p.x, cam.y - p.y, cam.z - p.z);
        _s.crossVectors(_d, _c);
        if (_s.lengthSq() < 1e-8) _s.set(0, 1, 0);
        _s.normalize();
        const width = st.width + Math.min(st.max, p.age * st.grow);
        const o = i * 6;
        pos[o] = p.x + _s.x * width; pos[o + 1] = p.y + _s.y * width; pos[o + 2] = p.z + _s.z * width;
        pos[o + 3] = p.x - _s.x * width; pos[o + 4] = p.y - _s.y * width; pos[o + 5] = p.z - _s.z * width;
        // thin near the body, gone near the camera (a chase camera sits right in the plume)
        const near = Math.min(1, Math.max(0, (Math.hypot(cam.x - p.x, cam.y - p.y, cam.z - p.z) - 2.5) / 6));
        const fade = i >= h.length ? 0 : Math.max(0, 1 - p.age / st.life) ** 1.5 * Math.min(1, i / 3) * st.alpha * trail.on * near * (k < 2 ? 1 : intensity);
        alpha[i * 2] = alpha[i * 2 + 1] = fade;
      }
      trail.mesh.geometry.attributes.position.needsUpdate = true;
      trail.mesh.geometry.attributes.smokeAlpha.needsUpdate = true;
      trail.mesh.updateMatrixWorld();
    });
  }

  hide() {
    this.streaks.visible = false;
    for (const t of this.trails) { t.mesh.visible = false; t.history.length = 0; t.on = 0; }
  }
}

export { AirFx };
