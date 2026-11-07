import * as THREE from 'three/webgpu';
import { Fn, If, texture, uniform, float, vec3, vec4, mix, clamp, smoothstep, positionWorld, normalWorldGeometry, abs, max, step } from 'three/tsl';
import { decodeLightField, LIGHT_HEIGHTS } from './urban-light-field.js';

// The sky above the actual buildings, not a constant darkening for every street. RGBA stores the cosine-weighted
// visible sky at 2, 16, 48 and 144 m. One texture lookup, interpolated with altitude; roofs open back to the whole sky.
const map = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
map.name = 'Manhattan sky visibility';
map.magFilter = map.minFilter = THREE.LinearFilter;
map.generateMipmaps = false;
map.needsUpdate = true;
const frame = uniform(new THREE.Vector4(0, 0, 1, 1));
const strength = uniform(1);
const heights = new THREE.DataTexture(new Uint8Array(4), 1, 1);
heights.name = 'Manhattan reflection heights';
heights.magFilter = heights.minFilter = THREE.NearestFilter;
heights.generateMipmaps = false;
heights.needsUpdate = true;

async function readField(name) {
  const response = await fetch(new URL(`../assets/world/${name}.bin.gz`, import.meta.url));
  if (!response.ok) throw new Error(`Urban light field request failed: ${response.status}`);
  let bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = new Uint8Array(await new Response(new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  return decodeLightField(bytes);
}

async function loadUrbanLight({ reflections = false } = {}) {
  const [field, reflection] = await Promise.all([readField('urban-light'), reflections ? readField('urban-reflection') : null]);
  if (field.heights.some((v, i) => v !== LIGHT_HEIGHTS[i])) throw new Error('Urban light field height mismatch.');
  if (reflection && ['width', 'height', 'minX', 'minZ', 'cell'].some(k => field[k] !== reflection[k])) throw new Error('Urban reflection field mismatch.');
  map.image = { data: field.data, width: field.width, height: field.height };
  map.needsUpdate = true;
  frame.value.set(field.minX, field.minZ, field.width * field.cell, field.height * field.cell);
  if (reflection) {
    heights.image = { data: reflection.data, width: reflection.width, height: reflection.height };
    heights.needsUpdate = true;
  }
}

const roofAt = Fn(([point]) => {
  const uv = point.xz.sub(frame.xy).div(frame.zw);
  const sample = texture(heights, uv).level(0);
  return sample.r.mul(255).add(sample.g.mul(65280));
});

// Screen-independent reflections: trace the surveyed building volumes, including the buildings behind the player.
// Facade radiance is shaded by car-assets.js at the hit; this is a coarse static-city reflection, not an SSR or a
// reflection of traffic. Six bisections resolve the nearest wall after the inexpensive expanding search.
const traceUrbanReflection = Fn(([direction]) => {
  const origin = positionWorld;
  const hit = float(0).toVar(), near = float(0).toVar(), far = float(330).toVar();
  for (const distance of [2, 4, 7, 10, 14, 19, 25, 33, 43, 55, 70, 90, 115, 145, 180, 220, 270, 330]) {
    If(hit.lessThan(0.5), () => {
      const p = origin.add(direction.mul(distance));
      If(p.y.greaterThan(0).and(p.y.lessThan(roofAt(p))), () => {
        hit.assign(1); far.assign(distance);
      }).Else(() => { near.assign(distance); });
    });
  }
  const axis = float(0).toVar();
  If(hit.greaterThan(0.5), () => {
    for (let i = 0; i < 6; i++) {
      const middle = near.add(far).mul(0.5);
      const p = origin.add(direction.mul(middle));
      If(p.y.lessThan(roofAt(p)), () => { far.assign(middle); }).Else(() => { near.assign(middle); });
    }
    const p = origin.add(direction.mul(far));
    const xEdge = abs(roofAt(p.add(vec3(4, 0, 0))).sub(roofAt(p.sub(vec3(4, 0, 0)))));
    const zEdge = abs(roofAt(p.add(vec3(0, 0, 4))).sub(roofAt(p.sub(vec3(0, 0, 4)))));
    axis.assign(step(zEdge, max(xEdge, 0.001)));
  });
  return vec4(far, origin.y.add(direction.y.mul(far)), axis, hit);
});

const urbanSkyVisibility = Fn(() => {
  // Sample just outside walls so a bilinear lookup never mistakes their solid interior for the street.
  const p = positionWorld.add(normalWorldGeometry.mul(2.4));
  const q = p.xz.sub(frame.xy).div(frame.zw);
  const sky = texture(map, q);
  const y = positionWorld.y;
  const a = mix(sky.r, sky.g, clamp(y.sub(2).div(14), 0, 1));
  const b = mix(a, sky.b, clamp(y.sub(16).div(32), 0, 1));
  const c = mix(b, sky.a, clamp(y.sub(48).div(96), 0, 1));
  const open = mix(c, float(1), smoothstep(144, 360, y));
  // Diffuse interreflection keeps an enclosed canyon from becoming pitch black. This is ambient visibility, not
  // baked sunlight: the dynamic sun, local lamps, and all their shadows remain live.
  return mix(float(1), open.mul(0.70).add(0.30), strength);
});

export { loadUrbanLight, urbanSkyVisibility, traceUrbanReflection, strength as urbanLightStrength };
