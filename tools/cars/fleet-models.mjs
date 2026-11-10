// Offline-only recipes for licensed replacement geometry. Runtime names remain OVERDRAFT's original identities.
import { LARGE_MODELS } from './fleet-large.mjs';
import { SMALL_MODELS } from './fleet-small.mjs';
import { OFFROAD_MODELS } from './fleet-offroad.mjs';
import { splitDisconnected } from './split-parts.mjs';
const shared = { fitSpec: true, triangles: 110000, atlasSize: [2048, 2048], flatPaint: true, glassOnly: true };

const FLEET_MODELS = {
  ...LARGE_MODELS, ...SMALL_MODELS, ...OFFROAD_MODELS,
  muscle: {
    ...shared, file: 'ford-mustang', flip: false, paint: /^carpaint$/,
    sourceInterior: true, steering: /\.Steer_/, seat: /\.Seat.Ft.L_/, pedal: /\.Pedal.Brake_/, gauges: /\.Gauges_/,
    glass: /^tinted_glass /,
    drop: /Badge|Engine|Supercharger|Transmission|Subframe|Lowerarm|Lowrarm|Upperarm|Halfshaft|Tierod|Strutbar|Stut\.|Shock\.|Spring\.|Swaybar|Fueltank|Diff_|Radiator|Hub\./,
    light(p) {
      if (p.name === 'rearlight') return 2;
      if (p.name === 'orange') return 4;
      if (p.name === 'light') return 1;
      if (/HeadlightGlass/.test(p.item.node)) return 1;
      return p.glass ? 6 : 0;
    }
  },
  sport: {
    ...shared, file: 'honda-nsx', flip: false, paint: /^Material\.003$/,
    wheel: / Material\.(?:011|018|021|023)$/, glass: /^Material\.(?:004|007|014) /,
    dropMaterial: /^Material\.016$/,
    filterData(data, item) {
      if (item.node !== 'Object_33' || item.material?.name !== 'Material.010') return data;
      // This exterior source closes the cabin with a flat 16-triangle cap. It obscures the working instruments;
      // remove just that disconnected cap, retaining the seats and every exterior seal sharing its material.
      const index = [];
      for (const part of splitDisconnected(data)) {
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < part.pos.length; i += 3) for (let axis = 0; axis < 3; axis++) {
          lo[axis] = Math.min(lo[axis], part.pos[i + axis]); hi[axis] = Math.max(hi[axis], part.pos[i + axis]);
        }
        if (hi[0] - lo[0] > 1 && hi[1] - lo[1] < 0.1) continue;
        for (const vertex of part.index) index.push(part.sourceVertexIndices[vertex]);
      }
      return { ...data, index: Uint32Array.from(index) };
    },
    light(p) {
      if (/^Material\.(007|008|014)$/.test(p.name)) return 1;
      if (p.name === 'Material.009') return 2;
      return p.glass ? 6 : 0;
    },
    processImage(source, { data, info: { width, height } }) {
      if (source === 1 || source === 2) {
        const replacement = source === 1 ? [28, 28, 28, 255] : [128, 128, 255, 255];
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (Math.hypot(x / width - 0.5, y / height - 0.5) > 0.385) data.set(replacement, (y * width + x) * 4);
      }
      if (source === 0) {
        for (let y = Math.floor(height * 0.535); y < height * 0.597; y++) {
          const from = (y * width + Math.floor(width * 0.47)) * 4, colour = Array.from(data.subarray(from, from + 4));
          for (let x = Math.floor(width * 0.479); x < width * 0.522; x++) data.set(colour, (y * width + x) * 4);
        }
      }
    }
  },
  taxi: {
    ...shared, file: 'bmw-e34', flip: true, paint: /^body_paint$/,
    wheel: /^wheel /, glass: /^(?:material|Material\.001) /,
    drop: /^(?:brake |focus int)/,
    dropMaterial: /^(?:bmw_logo|bbs_tex(?:\.00[234])?|body_print|tree|tree_rope|material_47|\.001|number_texture(?:\.001)?)$/,
    light(p) {
      if (/^(headlight|Material\.001|Material\.003)$/.test(p.name)) return 1;
      return p.glass ? 6 : 0;
    },
    vertexLight(p, v, x, y, z) {
      if (p.name === 'headlight_signal_lights') return z > 0 ? 4 : 2;
    }
  }
};

export { FLEET_MODELS };
