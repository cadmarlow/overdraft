import * as THREE from 'three/webgpu';

// The protagonist uses standard skeletal skinning on both WebGL and WebGPU.
// Crowd animation buffers are kept separate from this single, persistent actor.
export class HeroModel {
  constructor(scene, person) {
    this.person = person;
    const source = person.crowd.meshes[0].geometry;
    const geometry = source.clone();
    const position = geometry.attributes.position;
    const skin = source.attributes.skin;
    const extra = source.attributes.extra;
    const female = source.attributes.femaleDelta;
    const hair = source.attributes.hairDelta;
    const indices = new Uint16Array(position.count * 4);
    const weights = new Float32Array(position.count * 4);
    const colors = new Float32Array(position.count * 3);
    const palette = [0x293b36, 0x26303d, 0xd4cfbf, 0x293b36, 0xb47b58, 0xb47b58, 0x201b17, 0x201b17].map(hex => new THREE.Color(hex));
    const shirt = new THREE.Color(0xc7c6bb);
    const sole = new THREE.Color(0x8f918b);
    for (let i = 0; i < position.count; i++) {
      const part = Math.round(skin.getW(i));
      const hairAmount = part === 7 ? Math.max(0, person.rig.pose[123] * 2 - 1) : Math.min(1, person.rig.pose[123] * 2);
      position.setXYZ(i,
        position.getX(i) + extra.getX(i) * (person.rig.girth - 1) + female.getX(i) * person.rig.female + hair.getX(i) * hairAmount,
        position.getY(i) + female.getY(i) * person.rig.female + hair.getY(i) * hairAmount,
        position.getZ(i) + extra.getY(i) * (person.rig.girth - 1) + female.getZ(i) * person.rig.female + hair.getZ(i) * hairAmount);
      indices[i * 4] = skin.getX(i); indices[i * 4 + 1] = skin.getY(i);
      weights[i * 4] = 1 - skin.getZ(i); weights[i * 4 + 1] = skin.getZ(i);
      let color = palette[part] || palette[0];
      if (part === 0 && position.getY(i) < 0.98) color = palette[1];
      if (part === 0 && position.getY(i) > 1.33 && Math.abs(position.getX(i)) < 0.075 && position.getZ(i) > 0) color = shirt;
      if (part === 2 && position.getY(i) < 0.055) color = sole;
      color.toArray(colors, i * 3);
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
    this.mesh = new THREE.SkinnedMesh(geometry, material);
    this.mesh.name = 'Protagonist';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.bones = Array.from({ length: 15 }, (_, i) => { const bone = new THREE.Bone(); bone.name = `HeroBone${i}`; this.mesh.add(bone); return bone; });
    this.skeleton = new THREE.Skeleton(this.bones, this.bones.map(() => new THREE.Matrix4()));
    this.mesh.bind(this.skeleton, new THREE.Matrix4());
    scene.add(this.mesh);
    // The head geometry already contains the nose, ears, jaw and hair silhouette.
    const eyes = new THREE.MeshStandardNodeMaterial({ color: 0x24201a, roughness: 0.5 });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), eyes);
      eye.position.set(side * 0.043, 1.645, 0.111);
      this.bones[2].add(eye);
    }
  }

  update() {
    const person = this.person;
    for (const mesh of person.crowd.meshes) mesh.visible = false;
    this.mesh.visible = !person.inVehicle;
    if (!this.mesh.visible) return;
    const pose = person.rig.pose;
    for (let i = 0; i < this.bones.length; i++) {
      const bone = this.bones[i], offset = i * 8;
      bone.quaternion.set(pose[offset], pose[offset + 1], pose[offset + 2], pose[offset + 3]);
      bone.position.set(pose[offset + 4], pose[offset + 5], pose[offset + 6]);
      bone.scale.setScalar(pose[offset + 7]);
    }
    this.mesh.updateMatrixWorld(true);
    this.skeleton.update();
  }
}
