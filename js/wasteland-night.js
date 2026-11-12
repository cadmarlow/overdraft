import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, cos, cross, float, instanceIndex, int, length, max, normalize, positionLocal, sin, smoothstep, time, uniformArray, uv, varying, vec3 } from 'three/tsl';
import { sealEffect } from './effect-outputs.js';
import { cityUniforms } from './tsl-materials.js';

// The Wasteland after dark: the fires of the camps and the gates, seen as sparks from across the bed and as real
// flames close by, and the searchlights of the Wall and the quays sweeping the dry river.

const MOST = 64, NEAR = 75;

export class SaltNight {
  constructor(scene, { fires = [], lamps = [] }) {
    this.fires = fires.slice(0, MOST).map(([x, y, z, size]) => ({ x, y, z, size }));
    this.fx = null; // the game's flames and smoke (js/fx.js), given by main.js once the game exists
    const group = new THREE.Group(); group.name = 'Nuit du Wasteland';
    const night = cityUniforms.uNight;

    // ---- Fires from afar: one glowing card each, turned to the camera, flickering --------------------------------------
    const far = new THREE.Vector4(0, -9000, 0, 0);
    const uFires = uniformArray(Array.from({ length: MOST }, (_, i) => (this.fires[i] ? new THREE.Vector4(this.fires[i].x, this.fires[i].y, this.fires[i].z, this.fires[i].size) : far.clone())));
    {
      const fire = uFires.element(int(instanceIndex)), centre = fire.xyz.add(vec3(0, 0.45, 0));
      const away = cameraPosition.sub(centre), d = length(away);
      const right = normalize(cross(vec3(0, 1, 0), away));
      const phase = float(instanceIndex).mul(1.7);
      const flicker = sin(time.mul(9.0).add(phase)).mul(0.12).add(sin(time.mul(23.0).add(phase.mul(2.3))).mul(0.07)).add(0.86);
      const size = fire.w.mul(max(2.4, d.mul(0.0075))).mul(flicker);
      const material = sealEffect(new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      material.positionNode = centre.add(right.mul(positionLocal.x.mul(size))).add(vec3(0, 1, 0).mul(positionLocal.y.mul(size).mul(1.25)));
      const core = smoothstep(0.5, 0.0, length(uv().sub(0.5)));
      material.colorNode = vec3(1.0, 0.46, 0.13).mul(core.mul(core)).mul(night.mul(0.75).add(0.25)).mul(1.9);
      material.opacityNode = core.mul(smoothstep(10.0, 45.0, d)); // close up, the real flames take over
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      mesh.name = 'Feux lointains'; mesh.frustumCulled = false; mesh.renderOrder = 985; mesh.count = Math.max(1, this.fires.length);
      group.add(mesh);
    }

    // ---- Searchlights: a cone of lit dust from every lamp, sweeping --------------------------------------------------
    const beams = lamps.slice(0, MOST);
    if (beams.length) {
      const REACH = 190;
      const uLamps = uniformArray(Array.from({ length: MOST }, (_, i) => (beams[i] ? new THREE.Vector4(...beams[i]) : far.clone())));
      const cone = new THREE.CylinderGeometry(0.5, 15, REACH, 18, 1, true).translate(0, -REACH / 2, 0).rotateX(-Math.PI / 2); // apex at the lamp, opening along +z
      const lamp = uLamps.element(int(instanceIndex)), id = float(instanceIndex);
      const p = positionLocal, dip = float(0.13).add(sin(time.mul(0.11).add(id)).mul(0.035));
      const y1 = p.y.mul(cos(dip)).sub(p.z.mul(sin(dip))), z1 = p.y.mul(sin(dip)).add(p.z.mul(cos(dip)));
      const yaw = lamp.w.add(sin(time.mul(0.17).add(id.mul(2.1))).mul(0.85));
      const material = sealEffect(new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      material.positionNode = lamp.xyz.add(vec3(p.x.mul(cos(yaw)).add(z1.mul(sin(yaw))), y1, z1.mul(cos(yaw)).sub(p.x.mul(sin(yaw)))));
      const along = varying(attribute('position', 'vec3')).z.div(REACH);
      material.colorNode = vec3(0.72, 0.84, 1.0).mul(night);
      material.opacityNode = night.mul(0.05).mul(smoothstep(0.0, 0.04, along)).mul(float(1).sub(along).pow(1.4));
      const mesh = new THREE.Mesh(cone, material);
      mesh.name = 'Projecteurs du Mur'; mesh.frustumCulled = false; mesh.renderOrder = 984; mesh.count = beams.length;
      group.add(mesh);
      this.beams = mesh;
    }

    scene.add(group);
    group.updateMatrixWorld(true);
    this.group = group;
    this.near = [];
  }

  update(dt, camera) {
    const night = cityUniforms.uNight.value;
    if (this.beams) this.beams.visible = night > 0.03;
    const near = this.near;
    near.length = 0;
    for (const fire of this.fires) {
      const d = Math.hypot(fire.x - camera.x, fire.y - camera.y, fire.z - camera.z);
      if (d < NEAR) { fire.d = d; near.push(fire); }
    }
    near.sort((a, b) => a.d - b.d);
    // Firelight on what stands round the nearest fire. The scene already holds more lamps than the renderer lights at
    // once (359 for 256): a lamp of ours would never be lit, so the fire borrows the flash lamps of the effects.
    this.flicker = (this.flicker ?? 0) - dt;
    if (this.fx && dt > 0 && near[0] && near[0].d < 55 && this.flicker <= 0) {
      this.flicker = 0.1;
      this.fx.flash(near[0].x, near[0].y + 0.9, near[0].z, 0xff8436, (70 + 190 * night) * near[0].size * (0.8 + 0.4 * Math.random()), 0.17, 24);
    }
    // real flames and smoke on the three nearest
    if (this.fx && dt > 0) for (let i = 0; i < Math.min(3, near.length); i++) if (near[i].d < 60) this.fx.fire(near[i].x, near[i].y, near[i].z, dt, near[i].size * 0.55);
  }
}
