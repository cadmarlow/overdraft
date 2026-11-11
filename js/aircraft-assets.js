import * as THREE from 'three/webgpu';
import { abs, atan, attribute, cos, dot, faceDirection, float, length, max, min, mix, mod, normalView, positionLocal, positionViewDirection, sin, smoothstep, texture, transformNormalToView, userData, vec2, vec3 } from 'three/tsl';
import { sealEffect } from './effect-outputs.js';

// The aircraft as objects: real models prepared offline (tools/aircraft) into assets/aircraft. One file per aircraft
// holds its geometry cut into the parts that move, the bone each part hangs on (a pivot and an axis, measured on the
// model), and the points the flight model stands on. Everything of one material is drawn at once: the moving parts
// are skinned to their bones, so a whole airframe with its control surfaces, wheels, doors and nozzle petals is two
// or three draw calls.
//
// Frame: metres, +X the pilot's left, +Y up, +Z the nose; the origin is the centre of gravity flight.js uses.
//
//   loadAircraftModels()       fetches and parses everything once
//   buildAircraftModel(kind)   → { root, pose(a, dt), ready, points }: the root at once, filled when the data arrives

const KINDS = ['classic', 'jet'];
const base = new URL('../assets/aircraft/', import.meta.url);
const kinds = new Map(); // kind → what every aircraft of that kind shares: header, geometries, materials
let loading = null;

const RAD = Math.PI / 180;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---- The file -----------------------------------------------------------------------------------------------------------
// What tools/aircraft/import.mjs wrote: a JSON header, then positions (16 bits over the model's box), normals (8 bits),
// one or two UV sets (16 bits over their range) and one run of indices per material.
function parseAircraft(buffer) {
  const headLength = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headLength)));
  const align = (n) => (n + 3) & ~3;
  const at = {};
  let o = align(4 + headLength);
  header.attributes.forEach((name, i) => { at[name] = o; o = align(o + header.sections[i]); });
  const n = header.vertices, lo = header.bounds.min, hi = header.bounds.max;
  const packed = new Uint16Array(buffer, at.position, n * 3), position = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) { const c = i % 3; position[i] = lo[c] + packed[i] / 65535 * (hi[c] - lo[c]); }
  const bytes = new Int8Array(buffer, at.normal, n * 3), normal = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i += 3) {
    const x = bytes[i], y = bytes[i + 1], z = bytes[i + 2], l = Math.hypot(x, y, z) || 1;
    normal[i] = x / l; normal[i + 1] = y / l; normal[i + 2] = z / l;
  }
  const unpackUv = (offset, range) => {
    const q = new Uint16Array(buffer, offset, n * 2), out = new Float32Array(n * 2);
    for (let i = 0; i < n * 2; i++) { const c = i % 2; out[i] = range[c] + q[i] / 65535 * (range[c + 2] - range[c]); }
    return out;
  };
  const uv = unpackUv(at.uv, header.uvRange), uv1 = at.uv1 !== undefined ? unpackUv(at.uv1, header.uv1Range) : null;
  const indices = header.materials.map((m) => new (m.index.size === 4 ? Uint32Array : Uint16Array)(buffer, at.index + m.index.offset, m.index.count));
  return { header, position, normal, uv, uv1, indices };
}

const loader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'none', premultiplyAlpha: 'none' });
const maps = new Map(); // one texture per file: materials of a model may share an image
function loadMap(map, colorSpace) {
  if (!map) return null;
  if (!maps.has(map.file)) {
    maps.set(map.file, loader.loadAsync(new URL(map.file, base).href).then((image) => {
      const t = new THREE.Texture(image);
      t.flipY = false;
      t.colorSpace = colorSpace;
      t.channel = map.uv || 0;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.needsUpdate = true;
      return t;
    }, () => { console.warn(`[aircraft] ${map.file} is missing`); return null; }));
  }
  return maps.get(map.file);
}

// ---- Materials ----------------------------------------------------------------------------------------------------------
// Glass: lit, tinted, see-through. It shows more of the sky and less of the cockpit as it turns away from the eye, like
// the real thing. (A surface: it is NOT sealed out of the reflection outputs.)
function glassMaterial(name, tint, clear, edge) {
  const m = new THREE.MeshPhysicalNodeMaterial({ color: tint, roughness: 0.04, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const facing = abs(dot(normalView, positionViewDirection));
  m.opacityNode = mix(float(edge), float(clear), smoothstep(0.05, 0.75, facing));
  m.name = name;
  return m;
}

// The biplane's doped fabric and enamel: the texture says what is paint (yellow, blue, white: glossy, under a clear
// coat) and what is not (tyres, leather, bare fittings: dull)
function paintMaterial(name, color, normals, occlusion) {
  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide, metalness: 0 });
  const c = color ? texture(color).rgb : vec3(0.85, 0.75, 0.1); // (a missing file must not break the shader)
  const hi = max(c.r, max(c.g, c.b)), lo = min(c.r, min(c.g, c.b)), sat = hi.sub(lo).div(hi.max(0.02));
  const coat = smoothstep(0.34, 0.58, sat).mul(smoothstep(0.03, 0.09, hi)).max(smoothstep(0.42, 0.62, lo));
  // the source's yellow is as bright as paper, and washes out under the game's sun: an enamel is deeper and warmer
  const yellow = smoothstep(0.25, 0.6, min(c.r, c.g).sub(c.b).div(hi.max(0.02)));
  // (seen in the game: under its sun a 0.6 yellow still read as cream; a trainer's chrome yellow is this deep)
  m.colorNode = c.mul(mix(vec3(0.74), mix(vec3(0.62), vec3(0.5, 0.34, 0.12), yellow), coat));
  m.roughnessNode = mix(mix(float(0.86), float(0.62), smoothstep(0.02, 0.12, hi)), float(0.42), coat);
  m.clearcoatNode = coat.mul(0.45);
  m.clearcoatRoughnessNode = float(0.16);
  if (normals) m.normalMap = normals; // the fabric between the ribs: drawn by the importer
  if (occlusion) { m.aoMap = occlusion; m.aoMapIntensity = 0.85; }
  m.name = name;
  return m;
}

// The propeller at speed: not an object any more but what the eye keeps of two blades sweeping past, a smear of each
// blade over the arc it crossed while the shutter was open. Each point of the disc is covered for the share of that
// time a blade was over it (its chord against the arc swept at that radius), wears the blade's colour there (wood,
// painted tips) and takes the light as the twisted blade would. At idle the smears are short and can be seen going
// round; at full power they fill the disc and nothing is left to turn.
// userData.prop of the mesh: x the blades' angle, y the arc swept during one exposure (radians), z how much shows.
function discMaterial(name, propeller) {
  const { radius, blades } = propeller, n = propeller.chords.length;
  const data = new Uint8Array(n * 4);
  const chordMax = Math.max(...propeller.chords);
  for (let i = 0; i < n; i++) { data[i * 4] = Math.round(propeller.chords[i] / chordMax * 255); data[i * 4 + 1] = Math.round(propeller.pitches[i] / (Math.PI / 2) * 255); data[i * 4 + 3] = 255; }
  const lut = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
  lut.minFilter = lut.magFilter = THREE.LinearFilter;
  lut.needsUpdate = true;
  const state = userData('prop', 'vec4');
  const p = positionLocal.xy, r = length(p), s = r.div(radius);
  const along = texture(lut, vec2(s.mul((n - 1) / n).add(0.5 / n), 0.5));
  const chord = along.r.mul(chordMax), pitch = along.g.mul(Math.PI / 2);
  const half = chord.div(r.max(0.03).mul(2)); // half the blade's width seen from the hub, radians
  const phi = atan(p.y, p.x), arc = state.y.max(0.02);
  let cover = float(0);
  for (let k = 0; k < blades; k++) {
    // this blade has just swept from (angle - arc) to angle; the point sees it for the part of that sweep spent over it
    const d = mod(phi.sub(state.x).sub(Math.PI / 2 + k * Math.PI * 2 / blades).add(Math.PI), Math.PI * 2).sub(Math.PI);
    cover = cover.add(min(d.add(half), 0).sub(max(d.sub(half), arc.negate())).max(0).div(arc));
  }
  const inDisc = smoothstep(propeller.root * 0.9, propeller.root * 1.5, r).mul(smoothstep(1.0, 0.985, s));
  const m = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, metalness: 0 });
  const wood = vec3(0.17, 0.075, 0.03), tip = vec3(0.78, 0.5, 0.03);
  m.colorNode = mix(wood, tip, smoothstep(0.893, 0.903, s));
  m.roughnessNode = float(0.46);
  // the blade's own surface where it passes: leaning by its pitch against the way it turns
  const out = p.div(r.max(1e-4));
  m.normalNode = transformNormalToView(vec3(sin(pitch).mul(out.y), sin(pitch).mul(out.x).negate(), cos(pitch))).mul(faceDirection);
  // the eye makes more of a blur than the time the blade spends there: without this the disc would be a ghost
  m.opacityNode = cover.mul(2.4).min(0.92).mul(inDisc).mul(state.z);
  m.name = name;
  return sealEffect(m);
}

async function loadKind(kind) {
  const response = await fetch(new URL(`${kind}.bin`, base));
  if (!response.ok) throw new Error(`${kind}.bin: ${response.status}`);
  const data = parseAircraft(await response.arrayBuffer());
  const { header } = data;
  // which bone carries each vertex: the airframe (bone 0) unless its part hangs on one
  const boneNames = ['airframe', ...Object.keys(header.bones)];
  const skinIndex = new Uint16Array(header.vertices * 4), skinWeight = new Float32Array(header.vertices * 4);
  for (let i = 0; i < header.vertices; i++) skinWeight[i * 4] = 1;
  const skinned = header.materials.map(() => false);
  for (const part of header.parts) {
    if (!part.bone) continue;
    const from = header.materials[part.material].vertices[0], ix = data.indices[part.material], b = boneNames.indexOf(part.bone);
    for (let k = part.start; k < part.start + part.count; k++) skinIndex[(from + ix[k]) * 4] = b;
    skinned[part.material] = true;
  }
  const lo = new THREE.Vector3().fromArray(header.bounds.min), hi = new THREE.Vector3().fromArray(header.bounds.max);
  const sphere = new THREE.Box3(lo, hi).getBoundingSphere(new THREE.Sphere());
  sphere.radius *= 1.15; // a folding leg or an open door reaches a little past the box
  const geometries = header.materials.map((m, i) => {
    const [start, count] = m.vertices, g = new THREE.BufferGeometry();
    const slice = (array, size) => new THREE.BufferAttribute(array.subarray(start * size, (start + count) * size), size);
    g.setAttribute('position', slice(data.position, 3));
    g.setAttribute('normal', slice(data.normal, 3));
    g.setAttribute('uv', slice(data.uv, 2));
    if (data.uv1) g.setAttribute('uv1', slice(data.uv1, 2));
    if (skinned[i]) { g.setAttribute('skinIndex', slice(skinIndex, 4)); g.setAttribute('skinWeight', slice(skinWeight, 4)); }
    g.setIndex(new THREE.BufferAttribute(data.indices[i], 1));
    g.boundingSphere = sphere.clone();
    g.boundingBox = new THREE.Box3(lo.clone(), hi.clone());
    return g;
  });
  const images = await Promise.all(header.materials.map((m) => Promise.all([
    loadMap(m.maps.c, THREE.SRGBColorSpace), loadMap(m.maps.n, THREE.NoColorSpace), loadMap(m.maps.orm, THREE.NoColorSpace), loadMap(m.maps.ao, THREE.NoColorSpace)
  ])));
  const materials = header.materials.map((m, i) => {
    const [c, n, orm, ao] = images[i], name = `${header.name} ${m.id}`;
    if (m.id === 'glass') return kind === 'jet' ? glassMaterial(name, 0x06090c, 0.34, 0.9) : glassMaterial(name, 0x0b1114, 0.2, 0.82);
    if (m.id === 'paint') return paintMaterial(name, c, n, ao);
    if (m.id === 'blade') {
      // varnished wood, a brass sheath, painted tips: what each corner is made of rides on the second UV set
      const blade = new THREE.MeshStandardNodeMaterial({ map: c, transparent: true });
      const surface = attribute('uv1', 'vec2');
      blade.metalnessNode = surface.x; blade.roughnessNode = surface.y;
      blade.opacityNode = userData('fade', 'float');
      blade.name = name;
      return blade;
    }
    const material = new THREE.MeshStandardNodeMaterial({ map: c, normalMap: n, side: THREE.DoubleSide, metalness: m.metalness ?? (orm ? 1 : 0), roughness: m.roughness ?? (orm ? 1 : 0.78) });
    if (orm) { material.roughnessMap = orm; material.metalnessMap = orm; material.aoMap = orm; }
    if (ao) { material.aoMap = ao; material.aoMapIntensity = 0.85; }
    if (m.color) material.color.setRGB(m.color[0], m.color[1], m.color[2]);
    material.name = name;
    return material;
  });
  const shared = { header, boneNames, geometries, materials, skinned, sphere, disc: null };
  if (header.propeller) {
    shared.disc = { geometry: new THREE.CircleGeometry(header.propeller.radius * 1.01, 96), material: discMaterial(`${header.name} propeller disc`, header.propeller) };
    shared.disc.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), header.propeller.radius * 1.05);
  }
  kinds.set(kind, shared);
}

/** Fetches and parses every aircraft once. Safe to call again: the same promise comes back. */
function loadAircraftModels() {
  loading ??= Promise.all(KINDS.map(loadKind)).then(() => undefined);
  return loading;
}

// ---- One aircraft --------------------------------------------------------------------------------------------------------
const IDENTITY = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

function fill(model, kind) {
  const shared = kinds.get(kind), { header, boneNames } = shared, root = model.root;
  // bones: each at its pivot, turning in the airframe's own axes
  const bones = boneNames.map((name) => { const b = new THREE.Bone(); b.name = name; return b; });
  const pivot = (name) => header.bones[name]?.pivot ?? [0, 0, 0];
  const rig = {};
  boneNames.forEach((name, i) => {
    const spec = header.bones[name], bone = bones[i];
    if (!i) { root.add(bone); return; }
    const parent = spec.parent ?? 'airframe', p = pivot(name), pp = pivot(parent);
    bones[boneNames.indexOf(parent)].add(bone);
    bone.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    rig[name] = { bone, axis: new THREE.Vector3().fromArray(spec.axis), spec, twistAxis: spec.twistAxis ? new THREE.Vector3().fromArray(spec.twistAxis) : null };
  });
  const skeleton = new THREE.Skeleton(bones, boneNames.map((name) => { const p = pivot(name); return new THREE.Matrix4().makeTranslation(-p[0], -p[1], -p[2]); }));
  const meshes = {};
  header.materials.forEach((m, i) => {
    let mesh;
    if (shared.skinned[i]) {
      mesh = new THREE.SkinnedMesh(shared.geometries[i], shared.materials[i]);
      mesh.bind(skeleton, IDENTITY);
      mesh.boundingSphere = shared.sphere.clone(); // set once: nothing of an aircraft leaves it
    } else mesh = new THREE.Mesh(shared.geometries[i], shared.materials[i]);
    mesh.name = `${header.name} ${m.id}`;
    const seeThrough = shared.materials[i].transparent;
    mesh.castShadow = !seeThrough || m.id === 'blade';
    mesh.receiveShadow = !seeThrough;
    if (m.id === 'glass') mesh.renderOrder = 2;
    root.add(mesh);
    meshes[m.id] = mesh;
  });
  let disc = null;
  if (shared.disc) {
    disc = new THREE.Mesh(shared.disc.geometry, shared.disc.material);
    disc.name = `${header.name} propeller disc`;
    const hub = header.points.propHub;
    disc.position.set(hub[0], hub[1], hub[2] + (header.propeller.forward ?? 0));
    disc.userData.prop = new THREE.Vector4(0, 0.02, 0, 0);
    disc.renderOrder = 3;
    disc.visible = false;
    root.add(disc);
    meshes.blade.userData.fade = 1;
  }
  Object.assign(model.points, header.points);
  const turn = (name, angle) => { const r = rig[name]; if (r) r.bone.quaternion.setFromAxisAngle(r.axis, angle); };
  const state = { stickPitch: 0, stickRoll: 0, stickYaw: 0, flaps: 0, brake: 0, rpm: 0, angle: 0, petal: 0 };
  const follow = (a, dt) => {
    // the controls arrive already wound by the flight model: a short lag only rounds off their steps
    const b = a.flight, k = 1 - Math.exp(-dt * 22);
    state.stickPitch += ((b.stickPitch || 0) - state.stickPitch) * k;
    state.stickRoll += ((b.stickRoll || 0) - state.stickRoll) * k;
    state.stickYaw += ((b.stickYaw || 0) - state.stickYaw) * k;
    state.flaps += ((b.flaps || 0) - state.flaps) * k;
    state.brake += ((b.brake || 0) - state.brake) * k;
  };
  // the flight model rolls its wheels as if they were 0.3 m in radius: the real ones turn by what they roll
  const spin = (name, wheel, steer = 0) => {
    const r = rig[name];
    if (!r) return;
    r.bone.quaternion.setFromAxisAngle(r.axis, (wheel?.spin || 0) * 0.3 / r.spec.radius);
    if (steer) r.bone.quaternion.premultiply(_q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, steer));
  };

  const poseClassic = (a, dt) => {
    const b = a.flight;
    follow(a, dt);
    turn('rudder', state.stickYaw * rig.rudder.spec.angle * RAD);
    turn('elevatorL', state.stickPitch * rig.elevatorL.spec.angle * RAD);
    turn('elevatorR', state.stickPitch * rig.elevatorR.spec.angle * RAD);
    for (const name of ['aileronLL', 'aileronUL', 'aileronLR', 'aileronUR']) turn(name, state.stickRoll * rig[name].spec.angle * RAD);
    spin('wheelL', b.wheels?.[0]); spin('wheelR', b.wheels?.[1]);
    if (rig.castor) { turn('castor', b.wheels?.[2]?.angle || 0); spin('wheelTail', b.wheels?.[2]); } else spin('wheelTail', b.wheels?.[2], b.wheels?.[2]?.angle || 0);
    // the engine runs while someone flies it or while it is still flying; it windmills when dead and stops when
    // the aircraft is wrecked or stands empty with the throttle shut
    const dead = (b.damage?.engine ?? 0) >= 1;
    const running = !a.crashed && !dead && (a.ridden !== false || !b.onGround || b.power > 0.03 || b.airspeed > 3);
    const want = a.crashed ? 0 : running ? 600 + 1700 * clamp01(b.power || 0) : dead && !b.onGround ? Math.min(700, (b.airspeed || 0) * 9) : 0;
    const rate = a.crashed ? 9000 : want > state.rpm ? 1100 : 520;
    state.rpm += Math.max(-rate * dt, Math.min(rate * dt, want - state.rpm));
    const omega = state.rpm * Math.PI / 30;
    // seen frame by frame, two blades stand still past a quarter turn a frame: the blades give way to the disc well
    // before that, and what the disc shows going round never steps further than this
    state.angle = (state.angle + Math.min(omega * dt, 0.62)) % (Math.PI * 2);
    turn('prop', state.angle);
    const solid = 1 - smooth(45, 120, state.rpm);
    meshes.blade.visible = solid > 0.01;
    meshes.blade.userData.fade = solid;
    disc.visible = state.rpm > 30;
    disc.userData.prop.set(state.angle, Math.min(Math.PI * 2 / header.propeller.blades, Math.max(0.02, omega / 60)), smooth(30, 110, state.rpm), 0);
    meshes.pilot.visible = a.ridden !== false;
  };

  const poseJet = (a, dt) => {
    const b = a.flight;
    follow(a, dt);
    turn('stabilator', state.stickPitch * rig.stabilator.spec.angle * RAD);
    turn('rudder', state.stickYaw * rig.rudder.spec.angle * RAD);
    for (const side of 'LR') {
      turn(`flap${side}`, state.flaps * rig[`flap${side}`].spec.angle * RAD);
      turn(`brake${side}`, state.brake * rig[`brake${side}`].spec.open * RAD);
    }
    // undercarriage: the forward doors drop, the legs fold forward into the fuselage as their wheels turn flat,
    // the doors hung on the legs close the slot behind them, the forward doors shut; the nose leg goes forward
    // between its two doors, which close under it. Folded away or torn off, the legs are not drawn.
    const up = 1 - clamp01(b.gear ?? 1), gone = up > 0.985 || (b.damage?.gear ?? 0) >= 1;
    const fold = smooth(0.14, 0.86, up), bay = smooth(0, 0.16, up) * (1 - smooth(0.84, 1, up));
    for (const side of 'LR') {
      const leg = rig[`gear${side}`], wheel = rig[`wheel${side}`];
      leg.bone.quaternion.setFromAxisAngle(leg.axis, fold * leg.spec.swing * RAD);
      leg.bone.scale.setScalar(gone ? 0 : 1);
      wheel.bone.quaternion.setFromAxisAngle(wheel.twistAxis, fold * wheel.spec.twist * RAD)
        .multiply(_q2.setFromAxisAngle(wheel.axis, (b.wheels?.[side === 'L' ? 0 : 1]?.spin || 0) * 0.3 / wheel.spec.radius));
      turn(`doorMain${side}`, fold * rig[`doorMain${side}`].spec.closed * RAD);
      turn(`doorFwd${side}`, bay * rig[`doorFwd${side}`].spec.open * RAD);
      turn(`doorNose${side}`, smooth(0.6, 1, up) * rig[`doorNose${side}`].spec.closed * RAD);
    }
    const nose = rig.gearNose;
    nose.bone.quaternion.setFromAxisAngle(nose.axis, fold * nose.spec.swing * RAD);
    if (gone) nose.bone.scale.setScalar(0); else nose.bone.scale.set(1, lerp(1, nose.spec.shrink ?? 1, fold), 1);
    spin('wheelNose', b.wheels?.[2]);
    // nozzle: wide at idle, closed down at full dry power, wide open again in reheat
    const power = clamp01(b.power || 0), wide = Math.max(1 - smooth(0.12, 0.85, power), clamp01(b.ab || 0));
    state.petal += (lerp(12, -3, wide) * RAD - state.petal) * (1 - Math.exp(-dt * 6));
    for (let i = 0; rig[`nozzle${i}`]; i++) turn(`nozzle${i}`, state.petal);
  };

  const pose = kind === 'classic' ? poseClassic : poseJet;
  model.pose = (a, dt) => { if (a?.flight) pose(a, dt > 0 ? Math.min(dt, 0.1) : 0); };
  model.meshes = meshes;
  model.bones = rig;
}

/**
 * An aircraft's model, at once: `root` is empty until the files have arrived (`ready`), and `pose` does nothing until
 * then. The game places the root (position: the centre of gravity, quaternion: the attitude), calls
 * `pose(a, dt)` with the aircraft entity (its `flight`, `crashed`, `ridden`), then `root.updateMatrixWorld(true)`.
 * `points` are the measured points of the header (tyres, tips, nose, tail, nozzle, eye...), filled when ready.
 * @param {'classic'|'jet'} kind
 */
function buildAircraftModel(kind) {
  const model = { root: new THREE.Group(), points: {}, pose() {}, ready: null };
  model.root.name = `Aircraft model ${kind}`;
  model.ready = loadAircraftModels().then(() => { fill(model, kind); return model; }, (error) => { console.warn(`[aircraft] ${kind}: ${error.message}`); return model; });
  return model;
}

export { KINDS as AIRCRAFT_KINDS, buildAircraftModel, loadAircraftModels, parseAircraft };
