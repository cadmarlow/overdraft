import * as THREE from 'three/webgpu';
import { clamp, float, mix, normalize, smoothstep, texture, vec2, vec3 } from 'three/tsl';
import { CITY_ROADS } from './city-config.js';
import { ground } from './ground-assets.js';
import { FRONTIER_BLEND_IN, FRONTIER_BLEND_OUT, FRONTIER_BOUNDS, FRONTIER_RANGE, FRONTIER_SITES, frontierDistance, frontierGrowth, frontierPoint } from './frontier-districts.js';
import { bumpNormal } from './tsl-materials.js';
import { SALT_ROUTES } from './wasteland-design.js';

// One world-space field serves the asphalt deck, lane meshes, and desert terrain.
// R signed distance, G the used roadway, B cover that can take root, A settlement tracks.
const { minX, minZ, maxX, maxZ } = FRONTIER_BOUNDS;
const STEP = 8, WIDTH = Math.ceil((maxX - minX) / STEP) + 1, HEIGHT = Math.ceil((maxZ - minZ) / STEP) + 1;
const clamp01 = value => Math.max(0, Math.min(1, value));
let field;

export function buildFrontierField() {
  const data = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let iz = 0; iz < HEIGHT; iz++) for (let ix = 0; ix < WIDTH; ix++) {
    const x = minX + ix * STEP, z = minZ + iz * STEP, i = (iz * WIDTH + ix) * 4;
    const distance = frontierDistance(x, z);
    data[i] = Math.round(clamp01(0.5 + distance / (2 * FRONTIER_RANGE)) * 255);
    data[i + 2] = Math.round(frontierGrowth(x, z, distance) * 255);
  }
  const stamp = (path, half, channel = 1) => {
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1], b = path[k], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
      if (!l2) continue;
      const reach = half + STEP * 1.5;
      const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach - minX) / STEP));
      const i1 = Math.min(WIDTH - 1, Math.ceil((Math.max(a.x, b.x) + reach - minX) / STEP));
      const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - reach - minZ) / STEP));
      const j1 = Math.min(HEIGHT - 1, Math.ceil((Math.max(a.z, b.z) + reach - minZ) / STEP));
      for (let iz = j0; iz <= j1; iz++) for (let ix = i0; ix <= i1; ix++) {
        const i = (iz * WIDTH + ix) * 4;
        if (data[i] < 16 || data[i] > 225) continue;
        const x = minX + ix * STEP - a.x, z = minZ + iz * STEP - a.z;
        const t = clamp01((x * dx + z * dz) / l2);
        const d = Math.hypot(x - dx * t, z - dz * t);
        data[i + channel] = Math.max(data[i + channel], Math.round(255 * clamp01(1 - (d - half + 2) / 11)));
      }
    }
  };
  for (const road of CITY_ROADS) stamp(road.pts, Math.min(12, road.w / 2));
  for (const route of SALT_ROUTES) if (route.gate) stamp(route.path, 8);
  for (const site of FRONTIER_SITES) {
    const frontage = site.depth / 2 + 11, verge = site.width / 2 + 3;
    const path = [[-10, 73], [-5, 46], [2, 29], [4, frontage + 3], [-verge, frontage]]
      .map(([x, z]) => frontierPoint(site, x, z));
    stamp(path, 3, 3);
  }
  const map = new THREE.DataTexture(data, WIDTH, HEIGHT, THREE.RGBAFormat, THREE.UnsignedByteType);
  map.name = 'Frontière · sols et chaussées';
  map.minFilter = map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  field = map;
}

// Photographed materials on both sides share the same world UV, lighting and blend around the seam.
export function applyFrontierGround(material, p) {
  if (!field) return material;
  const P = p.xz;
  const data = texture(field, P.sub(vec2(minX - STEP / 2, minZ - STEP / 2)).div(vec2(WIDTH * STEP, HEIGHT * STEP)));
  const d = data.r.sub(0.5).mul(FRONTIER_RANGE * 2);
  const weight = smoothstep(-FRONTIER_BLEND_IN, -51, d).mul(smoothstep(61, FRONTIER_BLEND_OUT, d).oneMinus());
  const coarse = texture(ground.masksA, P.div(146)).r.sub(0.5);
  const wear = texture(ground.masksA, P.div(31));
  const grain = texture(ground.masksA, P.div(5.7).add(0.37));
  const invasion = d.add(27).add(coarse.mul(123)).add(wear.r.sub(0.5).mul(46)).add(grain.r.sub(0.5).mul(9));
  const soil = smoothstep(-9, 47, invasion).mul(data.g.mul(smoothstep(14, 112, d).oneMinus()).mul(0.81).oneMinus());
  const gritUV = P.div(ground.chipseal.metres);
  const paved = texture(ground.chipseal.color, gritUV);
  const eroded = texture(ground.chipseal.color, gritUV.mul(0.65).add(0.47));
  const mean = vec3(...ground.chipseal.mean);
  const old = clamp(paved.rgb.div(mean), 0.46, 1.62);
  const grit = clamp(eroded.rgb.div(mean), 0.58, 1.46);
  const sand = mix(vec3(1), grit, 0.48).mul(grain.g.mul(0.28).add(0.86));
  const binder = mix(old.mul(vec3(0.078, 0.074, 0.067)), grit.mul(vec3(0.124, 0.108, 0.086)), smoothstep(0.25, 0.77, wear.a));
  const cracked = mix(binder, vec3(0.11, 0.073, 0.043).mul(grit), grain.a.mul(0.63));
  const rooted = smoothstep(0.28, 0.51, data.b.add(wear.a.sub(0.5).mul(0.32))).mul(data.g.oneMinus());
  const loam = mix(vec3(0.158, 0.106, 0.054), vec3(0.079, 0.087, 0.040), rooted);
  const drift = smoothstep(14, 98, invasion.add(wear.g.sub(0.5).mul(21)));
  const shoulder = mix(loam.mul(grit), sand.mul(vec3(0.29, 0.171, 0.076)), drift.mul(rooted.mul(0.79).oneMinus()));
  const track = smoothstep(0.13, 0.52, data.a).mul(grain.g.mul(0.42).add(0.58));
  const color = mix(mix(cracked, shoulder, soil), grit.mul(vec3(0.137, 0.099, 0.060)), track);
  material.colorNode = mix(material.colorNode, color, weight);
  material.aoNode = mix(material.aoNode ?? float(0.55), mix(float(0.74), float(0.42), soil), weight);
  material.roughnessNode = mix(material.roughnessNode, mix(float(0.85), float(0.94), soil), weight);
  const height = mix(paved.a, eroded.a, soil).mul(0.024).sub(grain.a.mul(soil.oneMinus()).mul(0.017));
  const flat = bumpNormal(height);
  material.normalNode = normalize(mix(material.normalNode, flat, weight));
  if (material.emissiveNode) material.emissiveNode = material.emissiveNode.mul(weight.oneMinus());
  if (material.metalnessNode) material.metalnessNode = material.metalnessNode.mul(weight.oneMinus());
  return material;
}
