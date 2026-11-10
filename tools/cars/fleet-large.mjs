// Offline recipes; coordinates in the brand filters are decoded GLB world coordinates, before fitting.
import { splitDisconnected } from './split-parts.mjs';

const shared = { fitSpec: true, triangles: 110000, atlasSize: [2048, 2048], flatPaint: true, glassOnly: true };

function removeTriangles(data, inside) {
  const index = [];
  for (let at = 0; at < data.index.length; at += 3) {
    const triangle = data.index.slice(at, at + 3);
    if (!triangle.every(i => inside(data.pos[i * 3], data.pos[i * 3 + 1], data.pos[i * 3 + 2]))) index.push(...triangle);
  }
  return index.length === data.index.length ? data : { ...data, index };
}

function utilityMaterial(original, utility = false) {
  const name = original.name, pbr = { ...original.pbrMetallicRoughness };
  if (name === 'chrome') { pbr.metallicFactor = 0.95; pbr.roughnessFactor = utility ? 0.3 : 0.18; }
  if (name === 'metal' || name === 'metal_dark') { pbr.metallicFactor = 0.78; pbr.roughnessFactor = 0.32; }
  if (name === 'wheel_rubber') { pbr.metallicFactor = 0; pbr.roughnessFactor = 0.88; }
  if (name === 'black_plastic') { pbr.metallicFactor = 0; pbr.roughnessFactor = utility ? 0.72 : 0.5; }
  if (name === 'varnish') { pbr.metallicFactor = 0.25; pbr.roughnessFactor = utility ? 0.34 : 0.25; }
  return { ...original, pbrMetallicRoughness: pbr };
}

function utilityLight(p) {
  if (p.name === 'brakelights_red') return 2;
  if (p.name === 'rearlights_white') return 3;
  if (/^(back_blinkers|blinker_lamps)$/.test(p.name)) return 4;
  if (p.name === 'front_lamps') return 1;
  // Transparent covers still receive the matching lamp flag; window glass alone uses flag 6.
  if (p.name === 'glass' && /frontlights/.test(p.item.node)) return 1;
  if (p.name === 'glass' && /backlights/.test(p.item.node)) return 2;
  return p.glass ? 6 : 0;
}

const ducato = {
  ...shared, file: 'fiat-ducato', flip: false, paint: /^varnish$/,
  wheel: /ducato-14_(?:FL|FR|BL|BR)_wheel_/, glass: /^glass /,
  // Seats, dashboard and pedals share primitives: use the functional OVERDRAFT cabin as one complete set.
  sourceInterior: false, drop: /^ducato-14_(?:interior|driving_wheel)_/,
  filterData(data, item) {
    if (item.mesh !== 'ducato-14_exterior_chrome_0') return data;
    // FIAT letters and their rings only. Keep the mirror and fog-lamp chrome in this same primitive.
    return removeTriangles(data, (x, y, z) =>
      (Math.abs(x) < 6 && y > 79 && y < 92 && z > 241) ||
      (x > 35 && x < 48 && y > 115 && y < 129 && z < -238));
  },
  light: utilityLight
};

const LARGE_MODELS = {
  sedan: {
    ...shared, file: 'audi-a7', flip: true, paint: /^car_color$/, sourceInterior: false,
    wheel: /^Torus\.00[3-6]_[01]/,
    glass: /^(?:glass(?:side[123]|back|front) |Material Plane\.001_0$|Material\.001 (?:glassslightback_0|Plane\.027_0)$)/,
    // These four torus meshes are Audi emblems; similarly named .003–.006 meshes are the road wheels.
    drop: /^Torus(?:\.00[12])?_[01]$/,
    material(original) {
      const pbr = { ...original.pbrMetallicRoughness };
      if (/^chromeiam/.test(original.name)) { pbr.metallicFactor = 0.9; pbr.roughnessFactor = 0.2; }
      if (original.name === 'Material.004') { pbr.metallicFactor = 0; pbr.roughnessFactor = 0.82; }
      if (/^glass(?:side[123]|back|front)$/.test(original.name)) {
        pbr.baseColorFactor = [0.34, 0.43, 0.5, 0.2]; pbr.roughnessFactor = 0.08; pbr.metallicFactor = 0;
        delete pbr.metallicRoughnessTexture;
      }
      return { ...original, pbrMetallicRoughness: pbr };
    },
    light(p) {
      if (p.name === 'Material.002' || p.item.node === 'Plane.001_0') return 1;
      if (p.name === 'Material.003' || p.name === 'Material.001') return 2;
      return p.glass ? 6 : 0;
    }
  },
  suv: {
    ...shared, file: 'audi-q7', flip: false, paint: /^varnish$/, sourceInterior: false,
    wheel: /q7-15_(?:FL|FR|BL|BR)_wheel_/, glass: /^glass /,
    drop: /^q7-15_(?:interior|driving_wheel)_/,
    filterData(data, item) {
      if (item.mesh === 'q7-15_exterior_black_plastic_0') {
        // The chromed rings also have eight black backing pieces. Remove complete enclosed components only:
        // nearby grille slats cross these bounds and must remain continuous behind the former badge.
        const kept = splitDisconnected(data).filter(part => !part.index.every(i => {
          const x = part.pos[i * 3], y = part.pos[i * 3 + 1], z = part.pos[i * 3 + 2];
          return Math.abs(x) < 18.4 && y > 77.5 && y < 91.7 && z > 251.5;
        }));
        return { ...data, index: kept.flatMap(part => Array.from(part.index, i => part.sourceVertexIndices[i])) };
      }
      if (item.mesh !== 'q7-15_exterior_chrome_0') return data;
      // Both four-ring emblems are disconnected from the window surrounds and exhaust trim.
      return removeTriangles(data, (x, y, z) => (Math.abs(x) < 18 && z > 261) || (Math.abs(x) < 13 && z < -228));
    },
    material: original => utilityMaterial(original), light: utilityLight
  },
  minivan: {
    ...shared, file: 'citroen-picasso', flip: false, paint: /^Default$/, sourceInterior: false, splitWheels: true,
    // Each of these material groups contains all four wheels; split before wheel-cluster detection.
    wheel: /(?:^| )(?:tires|wheels|black1|HL_mirror1)(?: |$)|^Object_(?:17|18|21|24|25|26|27|28) /,
    glass: /^(?:glass|material) /, dropMaterial: /^Plate$/,
    filterData(data, item) {
      if (item.mesh !== 'Object_3' || item.material?.name !== 'HL_mirror2') return data;
      // Four centreline chevrons share their material with the rear reflectors, which lie |z| > 519.
      return removeTriangles(data, (x, y, z) => Math.abs(z) < 100);
    },
    transformParts(parts) {
      return parts.flatMap(p => {
        if (p.name !== 'HL_rear') return [p];
        // The source batches red rear lenses with two front fog covers. Window tint would wash out the red;
        // keep both as physical optics, separating their colour and lamp class without changing any triangles.
        const rear = removeTriangles(p.data, x => x < 0), front = removeTriangles(p.data, x => x > 0);
        return [{ ...p, data: rear }, { ...p, name: 'HL_front_aux', data: front,
          material: { ...p.material, pbrMetallicRoughness: { ...p.material.pbrMetallicRoughness,
            baseColorFactor: [0.7, 0.74, 0.78, 1] } } }];
      });
    },
    material(original) {
      const pbr = { ...original.pbrMetallicRoughness };
      if (original.name === 'wheels') { pbr.baseColorFactor = [0.44, 0.46, 0.49, 1]; pbr.metallicFactor = 0.92; pbr.roughnessFactor = 0.25; }
      if (/^(rubber|tires|black1)$/.test(original.name)) { pbr.metallicFactor = 0; pbr.roughnessFactor = 0.82; }
      if (original.name === 'glass') { pbr.baseColorFactor = [0.3, 0.4, 0.46, 0.2]; pbr.roughnessFactor = 0.08; }
      if (original.name === 'HL_rear') { pbr.baseColorFactor = [0.298039, 0, 0, 1]; pbr.roughnessFactor = 0.18; pbr.metallicFactor = 0; }
      if (original.name === 'inox') { pbr.baseColorFactor = [0.65, 0.67, 0.7, 1]; pbr.metallicFactor = 0.9; pbr.roughnessFactor = 0.25; }
      return { ...original, pbrMetallicRoughness: pbr };
    },
    light(p) {
      if (p.name === 'Light') return 4;
      if (p.name === 'HL_rear' || p.name === 'HL_mirror2') return 2;
      if (p.name === 'HL_front_aux') return 1;
      if (p.name === 'HL_mirror' || p.name === 'material') return 1;
      return p.glass ? 6 : 0;
    }
  },
  van: { ...ducato, material: original => utilityMaterial(original) },
  delivery: { ...ducato, material: original => utilityMaterial(original, true) }
};

export { LARGE_MODELS };
