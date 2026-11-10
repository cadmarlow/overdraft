// Offline recipes for four licensed source models. Names below identify source parts, never runtime brands.
const shared = { fitSpec: true, triangles: 70000, atlasSize: [2048, 2048], glassOnly: true, sourceInterior: false };

function solid(original, colour, roughness, metallic = 0) {
  return { name: original?.name, doubleSided: original?.doubleSided,
    pbrMetallicRoughness: { baseColorFactor: [...colour, 1], roughnessFactor: roughness, metallicFactor: metallic } };
}

function unlitSource(original) {
  const material = { ...original };
  delete material.emissiveTexture;
  delete material.emissiveFactor;
  return material;
}

function windowMaterial(original) {
  const material = solid(original, [0.11, 0.16, 0.19], 0.12, 0.05);
  material.alphaMode = 'BLEND';
  material.pbrMetallicRoughness.baseColorFactor[3] = 0.58;
  return material;
}

// Keep source shading/UV seams while compacting away removed badge vertices. Source coordinates are world-space.
function removeTriangles(data, reject) {
  const indices = [];
  for (let i = 0; i < data.index.length; i += 3) {
    const triangle = [data.index[i], data.index[i + 1], data.index[i + 2]];
    if (!triangle.every(v => reject(data.pos[v * 3], data.pos[v * 3 + 1], data.pos[v * 3 + 2]))) indices.push(...triangle);
  }
  if (indices.length === data.index.length) return data;
  const vertices = [], remap = new Map();
  for (const v of indices) if (!remap.has(v)) { remap.set(v, vertices.length); vertices.push(v); }
  const result = { ...data, index: Uint32Array.from(indices, v => remap.get(v)) };
  for (const [name, size] of [['pos', 3], ['nor', 3], ['uv', 2]]) {
    if (!data[name]) continue;
    result[name] = new data[name].constructor(vertices.length * size);
    for (let i = 0; i < vertices.length; i++) for (let c = 0; c < size; c++) result[name][i * size + c] = data[name][vertices[i] * size + c];
  }
  return result;
}

function patch(image, box, colour) {
  const { data, info: { width, height } } = image;
  const x0 = Math.max(0, Math.floor(box[0] * width)), x1 = Math.min(width, Math.ceil(box[2] * width));
  const y0 = Math.max(0, Math.floor(box[1] * height)), y1 = Math.min(height, Math.ceil(box[3] * height));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) data[i + c] = colour[c];
    data[i + 3] = 255;
  }
}

const miniPaint = /^(?:main_hull|door_02|door001|front_bumper|rear_bumper|front_hood|rear_hood|spoiler)_/;
const fiatCabin = new Set(['Object_23', 'Object_56', 'Object_57', 'Object_59', 'Object_61', 'Object_63',
  'Object_65', 'Object_67', 'Object_69', 'Object_71', 'Object_72', 'Object_74', 'Object_77', 'Object_78', 'Object_85']);
const rimBrandBoxes = [[0.145, 0.642, 0.207, 0.746], [0.565, 0.631, 0.625, 0.737]];
let wagonBodyPixels = null;

const SMALL_MODELS = {
  compact: {
    ...shared, file: 'mini-cooper', flip: true, flatPaint: true,
    // The source shares one atlas between paint, lamps and windows. Classification must use the actual node.
    paintPart: item => miniPaint.test(item.node),
    glass: /\b(?:rear_window|front_window\d*|Rear_Side_Window)_/i,
    wheel: /^Tyre_\d+_/, dropPart: item => /^interior_/i.test(item.node),
    filterData(data, item) {
      if (item.node !== 'main_hull_Car_0') return data;
      // A long whip antenna raises the source bounding box by a third. Keep its short base but remove the whip,
      // so fitting the roof to the locked vehicle height does not flatten the entire passenger compartment.
      return removeTriangles(data, (x, y, z) => Math.abs(x) < 0.5 && y > 28.3 && z > 21 && z < 26);
    },
    material(original, item) {
      if (miniPaint.test(item.node)) return solid(original, [0.65, 0.65, 0.65], 0.28, 0.62);
      if (/window/i.test(item.node)) return windowMaterial(original);
      if (/^headlight_|^Front_Glass_/i.test(item.node)) return solid(original, [0.74, 0.8, 0.86], 0.19, 0.65);
      if (/^Object011_/.test(item.node)) return solid(original, [0.46, 0.012, 0.018], 0.2, 0.12);
      return unlitSource(original);
    },
    light(p) {
      if (/^Front_Glass_/i.test(p.item.node)) return 1;
      if (/^Object011_/.test(p.item.node)) return 2;
      return p.glass ? 6 : 0;
    }
  },
  hatch: {
    ...shared, file: 'fiat-147', flip: true, flatPaint: true, paint: /^Body$/,
    glass: /^Glass (?!Object_42\b)/, // Object_42 is the pair of mirror faces, not a window.
    wheel: /^Object_(?:33|34|82|83)\b/, splitWheels: true,
    // Four original grille badge strips and source seats/dashboard/controls; shell, vents and trim stay intact.
    dropPart: item => fiatCabin.has(item.node) || /^(?:Object_9|Object_10)$/.test(item.node),
    material(original, item) {
      if (item.node === 'Object_42') return solid(original, [0.48, 0.53, 0.57], 0.05, 0.95);
      if (original.name === 'tyres') return solid(original, [0.009, 0.011, 0.013], 0.82);
      if (original.name === 'Body') return solid(original, [0.65, 0.65, 0.65], 0.3, 0.5);
      if (original.name === 'Glass') return windowMaterial(original);
      return unlitSource(original);
    },
    light(p) {
      if (p.item.node === 'Object_29') return 1;
      if (p.item.node === 'Object_15') return 2;
      if (p.item.node === 'Object_17') return 3;
      if (p.name === 'orange') return 4;
      return p.glass ? 6 : 0;
    }
  },
  wagon: {
    ...shared, file: 'audi-a4', flip: false, flatPaint: false, paint: /^hull\.001$/,
    glass: /^Glass\.001 /, wheel: /^(?:left|right|rear left|rear right)_/,
    dropMaterial: /^Interior\.001$/,
    // The author put the entire exterior under an object named "Car Interior". Normalize that misleading prefix
    // after classification so traffic/far-shell filtering does not discard the complete wagon body.
    transformParts: parts => parts.map(p => /^Car Interior_/.test(p.item.node)
      ? { ...p, item: { ...p.item, node: p.item.node.replace(/^Car Interior_/, 'Body_') } } : p),
    filterData(data, item) {
      if (item.material?.name !== 'Car_extra_parts.001') return data;
      // Four front rings (144 triangles) and four rear rings (103), separate from the grille/door trim.
      return removeTriangles(data, (x, y, z) =>
        (x > -20.4 && x < -2.3 && y > 43 && y < 49.4 && z > 228.5 && z < 231.3)
        || (x > -17.9 && x < -5.5 && y > 65.7 && y < 69.8 && z > -85.2 && z < -82.7));
    },
    material(original) {
      if (original.name === 'Glass.001') return windowMaterial(original);
      return unlitSource(original);
    },
    processImage(source, image) {
      if (source === 1) {
        // Original registration text and regional insignia, confined to both plate UV islands.
        patch(image, [0.4, 0, 0.477, 0.565], [206, 210, 207]);
      }
      if ([9, 10, 11].includes(source)) {
        const colour = source === 11 ? [128, 128, 255] : source === 10 ? [0, 95, 220] : [188, 188, 181];
        for (const box of rimBrandBoxes) patch(image, box, colour);
      }
      if (source === 4) {
        wagonBodyPixels = image;
        // The original navy paint is too dark for hue-based recolouring. Lift only that blue region, keeping lamps,
        // chrome and the complete underside texture. The atlas then derives a neutral paint mask from its hue.
        for (let i = 0; i < image.data.length; i += 4) {
          const r = image.data[i], g = image.data[i + 1], b = image.data[i + 2];
          if (b > 15 && b > r * 1.5 && b > g * 1.18) {
            image.data[i] = 30; image.data[i + 1] = 65; image.data[i + 2] = 150;
          }
        }
      }
    },
    light: p => p.glass ? 6 : 0,
    vertexLight(p, v) {
      if (p.name !== 'hull.001') return undefined;
      const [x, y, z] = p.data.pos.subarray(v * 3, v * 3 + 3);
      // Hull includes lamp lenses. These small endpoint volumes exclude hood, bumpers and grille.
      const side = Math.abs(x + 11.6);
      if (!wagonBodyPixels) return undefined;
      const { data, info: { width, height } } = wagonBodyPixels;
      const u = Math.min(1, Math.max(0, p.data.uv[v * 2])), vv = Math.min(1, Math.max(0, p.data.uv[v * 2 + 1]));
      const i = (Math.round(vv * (height - 1)) * width + Math.round(u * (width - 1))) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2], bright = Math.min(r, g, b) > 90 && Math.max(r, g, b) - Math.min(r, g, b) < 65;
      if (z > 213 && y > 40 && y < 60 && side > 29 && side < 66 && bright) return 1;
      if (z < -67 && y > 54 && y < 80 && side > 41 && side < 66) {
        if (r > 45 && r > g * 1.6 && r > b * 1.8) return g > r * 0.3 ? 4 : 2;
        if (bright) return 3;
      }
      return undefined;
    }
  },
  truck: {
    ...shared, file: 'mazda-titan-92', flip: false, flatPaint: true, paint: /^Main$/,
    glass: /^Glass /,
    wheel: /^Object_(?:73|74|76|77|79|80|84|85)\b/,
    dropPart: item => /^(?:Object_6|Object_7|Object_37|Object_38|Object_39)$/.test(item.node),
    filterData(data, item) {
      if (item.node !== 'Object_5') return data;
      // The dark outlines behind the deleted red TITAN letters are separate geometry in the cab trim material.
      return removeTriangles(data, (x, y, z) => x > 0.77 && x < 1.27 && y > 2 && y < 2.13 && z > 4.43 && z < 4.49);
    },
    material(original) {
      if (original.name === 'Main') return solid(original, [0.65, 0.65, 0.65], 0.32, 0.45);
      if (original.name === 'Glass') return windowMaterial(original);
      if (original.name === 'Rubber') return solid(original, [0.009, 0.011, 0.013], 0.84);
      return unlitSource(original);
    },
    light(p) {
      if (p.name === 'Front_light') return 1;
      if (p.name === 'Red_light') return 2;
      if (p.name === 'White_light') return 3;
      if (p.name === 'Orange_light') return 4;
      return p.glass ? 6 : 0;
    }
  }
};

export { SMALL_MODELS };
