// Offline recipes for the CC-BY Defender source by meeww. Only OVERDRAFT identities are used at runtime.
import { convertDefenderPickup } from './pickup-conversion.mjs';

// Node names are intentionally matched at the start of the importer's "node mesh material" label. Mesh Object_74,
// for example, is a dashboard component; node Object_74 is a running wheel. Loose Object_N matches are unsafe here.
const runningWheels = /^Object_(?:74|75|86|94|120|121|129|135|671|672|673|675|676|677)(?:\s|$)/;

// These nine front-right source pieces were mirrored in the authoring file without reversing their baked faces.
// Their outermost lens normals point into the car, unlike the geometrically identical left set. A double-sided body
// shader quite correctly treats them as cabin trim, so repair the source winding and normals before atlas/LOD fitting.
const invertedFrontParts = new Set([457, 459, 461, 463, 465, 469, 649, 651, 653].map(id => `Object_${id}`));
export function correctDefenderFrontNormals(data, item) {
  if (!invertedFrontParts.has(item.node)) return data;
  return { ...data, nor: data.nor.map(value => -value), flipped: !data.flipped };
}

function lampRole(label) {
  if (/(?:front|back)(?:left|right)turnlight|back(?:left|right)light1/i.test(label)) return 4;
  if (/back(?:left|right)(?:brakelight|foglight|light)/i.test(label)) return 2;
  if (/trailerlight/i.test(label)) return 3;
  if (/front(?:left|right)(?:headlight|foglight|light)|leftfrontlightcover/i.test(label)) return 1;
  return 0;
}

function material(source, item = {}) {
  const result = { ...source, pbrMetallicRoughness: { ...source.pbrMetallicRoughness } };
  if (source.name === 'glass') {
    // Its texture carries transparency that the opaque colour atlas cannot retain. Keep a clear, lightly tinted glass.
    result.pbrMetallicRoughness = { baseColorFactor: [0.3, 0.36, 0.38, 0.42], roughnessFactor: 0.075, metallicFactor: 0.04 };
    result.alphaMode = 'BLEND';
  }
  if (source.name === 'Material.002') {
    result.pbrMetallicRoughness.roughnessFactor = 0.84; result.pbrMetallicRoughness.metallicFactor = 0;
  }
  // The source shares a white transmissive material between headlights and rear lenses; its emission colour alone
  // cannot colour the game's opaque atlas. Give each existing lens its actual optical role, without tinting reflectors.
  const role = lampRole(item.path ?? '');
  if (/^Material\.(?:006|007|009)$/.test(source.name) && role) {
    result.pbrMetallicRoughness = {
      ...result.pbrMetallicRoughness,
      baseColorFactor: role === 2 ? [0.48, 0.008, 0.012, 1] : role === 4 ? [0.8, 0.16, 0.008, 1] : [0.8, 0.86, 0.9, 1],
      roughnessFactor: 0.19, metallicFactor: 0.04
    };
    result.emissiveFactor = [0, 0, 0];
  }
  return result;
}

function light(p) {
  if (p.item.node === 'PickupBrakeLight') return 2;
  if (p.item.node === 'PickupReverseLight') return 3;
  const label = p.item.path ?? p.label ?? '';
  // The source calls the large black headlamp surrounds "lightcover" too. They are body panels, not luminous lenses.
  if ((p.name ?? p.material?.name) === 'matteblack') return p.glass ? 6 : 0;
  return lampRole(label) || (p.glass ? 6 : 0);
}

const shared = {
  file: 'land-rover-defender-110', flip: false, mirrorX: true, fitSpec: true,
  triangles: 110000, atlasSize: [2048, 2048], flatPaint: true,
  paint: /^Material\.005$/, wheel: runningWheels,
  glassOnly: true, glass: /^glass(?:\s|$)/, material, light, filterData: correctDefenderFrontNormals,
  // Remove the unrelated covered object and six excessively dense roof-basket parts. Keeping the basket as the height
  // reference would shrink the actual cabin when fitting the existing rig. The SUV keeps its white passenger roof.
  // The running-wheel matcher leaves its rear spare static; the pickup conversion removes that spare and cargo roof.
  drop: /^Object_(?:64[2-7]|669)$/,
  sourceInterior: true, steering: /^Object_141$/, seat: /^Object_163$/, gauges: /^Object_625$/,
  // These anchors are in the unmirrored, unscaled source coordinates. The importer mirrors/converts them with the mesh.
  // The steering primitive also contains a long shaft, so its bounding-box centre is not the wheel's rotation pivot.
  // The hip rests on the rear third of the sloping cushion, not its taller front lip; roof is the actual inner shell.
  sourceSeat: [-4.1561698, 3.55, -5.2], sourceRoof: 11.95,
  steeringPosition: [-4.6334740, 5.3138956, -0.2762771],
  steeringAxis: [0, -0.4471754, 0.8944463], steeringRadius: 1.7782570
};

export const OFFROAD_MODELS = {
  offroad: { ...shared },
  // A single cab has a wall directly behind the driver. Keep the reclined shoulders and jacket in front of that wall,
  // while placing the hip on the same real cushion (its upward slope is 3.55 at z -5.2, 3.61 near z -3.7).
  pickup: { ...shared, sourceSeat: [-4.1561698, 3.58, -4.35], transformParts: convertDefenderPickup }
};
