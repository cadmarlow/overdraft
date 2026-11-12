import * as THREE from 'three/webgpu';
import { abs, float, normalWorldGeometry, positionWorld, select, texture, uv, vec2, vec3 } from 'three/tsl';
import { CITY_RING, cityBoundsAt, insideCity } from './city-frontier.js';
import { FRONTIER_HALTS, FRONTIER_POSTS, FRONTIER_PROGRAMS, FRONTIER_SALVAGE, MARKET_DECK } from './frontier-activity.js';
import { FRONTIER_SITES, frontierHash, frontierPoint } from './frontier-districts.js';
import { createGroundSurfaces } from './ground-surfaces.js';
import { ground } from './ground-assets.js';
import { world } from './world-assets.js';
import { sampleSalt, saltRoadAt } from './wasteland-plan.js';
import { fixItem } from './wasteland-scatter.js';

const C = {
  iron: 0x3c423d, wood: 0x765842, old: 0x4f4540, zinc: 0x8b8d80, tile: 0x7e776c, brick: 0x906758,
  darkBrick: 0x78564a, ochre: 0xc18a53, petrol: 0x3e6e69, pale: 0xc6b891, rust: 0xa34e35,
  bone: 0xb1a48f, roof: 0x555751, red: 0xa0372c, black: 0x242927, soil: 0x544a37
};
const PROFILES = {
  lisieres: { w: 25, d: 18, h: 6.7, trim: C.petrol, sign: 'TROC · CONTRÔLE · PIÈCES' },
  serres: { w: 19, d: 17, h: 3.6, trim: C.ochre, sign: 'CUISINE · RÉCOLTE · EAU' },
  atelier: { w: 24, d: 18, h: 5.1, trim: C.rust, sign: 'PNEUS · CARROSSERIE · MOTEUR' },
  balance: { w: 20, d: 16, h: 4.6, trim: C.ochre, sign: 'PESÉE · CHARGEMENT' },
  vigie: { w: 15, d: 14, h: 4.25, trim: C.petrol, sign: 'VISIBILITÉ · BULLETIN DE LA RADE' },
  cour: { w: 20, d: 16, h: 4.5, trim: C.petrol, sign: 'CONSIGNE · INVENTAIRE · RETRAIT' }
};
const UNIT = new THREE.BoxGeometry(1, 1, 1);
const AXLE = new THREE.CylinderGeometry(0.32, 0.32, 0.092, 14).rotateZ(Math.PI / 2);
const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);

function cladding() {
  const wear = texture(ground.masksA, positionWorld.xz.add(positionWorld.yy.mul(2.1)).div(8.5)).a;
  const plain = new THREE.MeshStandardNodeMaterial({ roughness: 0.88 });
  plain.name = 'Lisières · matériaux de récupération';
  plain.colorNode = vec3(wear.mul(0.35).add(0.65));
  plain.aoNode = float(0.67);
  const brick = new THREE.MeshStandardNodeMaterial({ roughness: 0.88 });
  brick.name = 'Lisières · brique lavée';
  const u = select(abs(normalWorldGeometry.x).greaterThan(abs(normalWorldGeometry.z)), positionWorld.z, positionWorld.x);
  const photograph = texture(world.redbrick.color, vec2(u, positionWorld.y.negate()).div(world.redbrick.metres));
  brick.colorNode = photograph.rgb.mul(3.4).mul(wear.mul(0.38).add(0.64));
  brick.aoNode = float(0.76);
  const glass = new THREE.MeshStandardNodeMaterial({ color: 0x8a9e8c, roughness: 0.42, metalness: 0.14 });
  const concrete = new THREE.MeshStandardNodeMaterial({ roughness: 0.96 });
  const surface = texture(ground.concrete.color, positionWorld.xz.div(ground.concrete.metres));
  concrete.colorNode = surface.rgb.mul(wear.mul(1.7).add(1.9));
  concrete.aoNode = float(0.72);
  return { plain, brick, glass, concrete };
}

export function buildFrontierWorld(parent, { sign, colliders, fires, keepOut, kit }) {
  const materials = cladding(), decks = createGroundSurfaces(), hubs = new Map(), posts = new Map(), salvage = new Map(), halts = [];
  const lampMat = new THREE.MeshStandardNodeMaterial({ color: 0xe1a34a, emissive: 0xff9328, emissiveIntensity: 1.25 });
  const redLamp = new THREE.MeshStandardNodeMaterial({ color: 0xa42d1b, emissive: 0xf53111, emissiveIntensity: 1.38 });
  const kitMat = new THREE.MeshStandardNodeMaterial({ map: kit.maps.color, normalMap: kit.maps.normal, roughnessMap: kit.maps.orm, roughness: 0.93 });
  kitMat.aoNode = texture(kit.maps.orm, uv()).r;
  const cutout = new THREE.MeshStandardNodeMaterial({ map: kit.maps.color, normalMap: kit.maps.normal,
    roughness: 0.93, alphaTest: 0.5, side: THREE.DoubleSide });
  cutout.aoNode = kitMat.aoNode;
  const paint = new Map();
  const colorMat = hex => {
    if (!paint.has(hex)) paint.set(hex, new THREE.MeshStandardNodeMaterial({ color: hex, roughness: 0.82 }));
    return paint.get(hex);
  };
  const scratch = new THREE.Object3D();
  const dummyColor = new THREE.Color();
  const parts = (group, mat, data) => {
    if (!data.length) return;
    const mesh = new THREE.InstancedMesh(UNIT, mat, data.length);
    mesh.castShadow = mesh.receiveShadow = true;
    for (const [i, b] of data.entries()) {
      scratch.position.set(b.x, b.y, b.z);
      scratch.rotation.set(b.rx, b.yaw, b.rz, 'YXZ');
      scratch.scale.set(b.w, b.h, b.d);
      scratch.updateMatrix();
      mesh.setMatrixAt(i, scratch.matrix);
      mesh.setColorAt(i, dummyColor.setHex(b.color));
    }
    mesh.computeBoundingSphere();
    group.add(mesh);
  };
  const meshAt = (parent, geometry, material, x, y, z, w = 1, h = 1, d = 1) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    mesh.receiveShadow = mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const propMesh = (container, name, x, y, z, scale) =>
    meshAt(container, kit.props[name].full, kit.props[name].cutout ? cutout : kitMat, x, y, z, scale, scale, scale);

  const layout = (site, name = site.name, top = sampleSalt(site.x, site.z)) => {
    const group = new THREE.Group(), pieces = [], masonry = [], panes = [], paving = [];
    group.name = name;
    parent.add(group);
    const point = (x, z) => frontierPoint(site, x, z);
    const cs = Math.cos(site.yaw), sn = Math.sin(site.yaw);
    const solid = (x, y, z, w, h, d) => {
      const p = point(x, z), hx = w / 2, hz = d / 2;
      const dx = Math.abs(cs) * hx + Math.abs(sn) * hz, dz = Math.abs(sn) * hx + Math.abs(cs) * hz;
      return { minX: p.x - dx, maxX: p.x + dx, minZ: p.z - dz, maxZ: p.z + dz, minY: top + y,
        maxY: top + y + h, obb: { cx: p.x, cz: p.z, cs, sn, hx, hz }, roof: false, obstacle: 'wall' };
    };
    const box = (x, y, z, w, h, d, color, kind = 'plain', fixed = false, rx = 0, rz = 0) => {
      const row = { ...point(x, z), y: top + y + h / 2, w, h, d, color, yaw: site.yaw, rx, rz };
      (kind === 'brick' ? masonry : kind === 'glass' ? panes : kind === 'concrete' ? paving : pieces).push(row);
      if (fixed) colliders.push(solid(x, y, z, w, h, d));
    };
    const prop = (name, x, z, size = 1, turn = 0) => fixItem({ name, ...point(x, z), yaw: site.yaw + turn, scale: size });
    const board = (name, label, x, y, z, width) => {
      const at = point(x, z);
      sign(group, at.x, top + y, at.z, site.yaw, name, label, width);
    };
    const floor = (x, z, w, d, height, color = C.tile, thickness = 0.32) => {
      box(x, height - thickness, z, w, thickness, d, color, color === C.tile ? 'concrete' : 'plain');
      const loop = [[x-w/2,z-d/2],[x+w/2,z-d/2],[x+w/2,z+d/2],[x-w/2,z+d/2]].map(([a,b])=>point(a,b));
      decks.add(loop, top + height, { deck: true, curb: false });
    };
    const rail = (x, y, z, w, d, color = C.iron) => {
      box(x, y + 0.82, z, w, 0.11, d, color);
      // Rails are solid at torso level. The legs remain free to step onto the platform.
      colliders.push(solid(x, y + 0.22, z, w, 0.72, d));
      const length = Math.max(w, d);
      for (let f = -length / 2 + 0.1; f < length / 2; f += 1.65) {
        box(x + (w > d ? f : 0), y, z + (d > w ? f : 0), 0.10, 0.87, 0.10, color);
      }
    };
    const ramp = (x, from, to, w, low, high) => {
      const corners = [[x-w/2,from,low],[x+w/2,from,low],[x-w/2,to,high],[x+w/2,to,high]];
      const position = corners.flatMap(([x,z,y]) => { const p = point(x,z);return [p.x,top+y,p.z]; });
      const index = from > to ? [0,1,2,1,3,2] : [0,2,1,1,2,3];
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(position,3));
      geometry.setIndex(index); geometry.computeVertexNormals();
      const rampMesh = new THREE.Mesh(geometry, colorMat(C.old));
      rampMesh.receiveShadow = true;
      rampMesh.position.y = -0.037;
      group.add(rampMesh);
      decks.addTriangles(position, index, { deck:true, curb:false });
      const l = Math.abs(to - from), n = Math.ceil(l / 0.37), pitch = -Math.atan2(high - low, to - from);
      for (let i=0;i<n;i++){
        const t=(i+0.5)/n, z=from+(to-from)*t, y=low+(high-low)*t;
        box(x, y - 0.067, z, w, 0.119, l / n - 0.012,
          i % 5 === 2 ? C.wood : i % 7 === 3 ? C.zinc : C.old, 'plain', false, pitch);
        for(const s of l > 6 ? [-1,1] : []){
          box(x+s*(w/2+0.06),y+0.84,z,0.1,0.085,l/n+0.07,C.iron,'plain',false,pitch);
          colliders.push(solid(x+s*(w/2+0.06),y+0.26,z,0.13,0.66,l/n+0.06));
          if (i % 4 === 1 && l > 6) {
            box(x+s*(w/2+0.06),y-0.12,z,0.09,0.98,0.09,C.iron);
            const p = point(x+s*(w/2-0.13), z);
            const base = sampleSalt(p.x, p.z) - top - 0.17;
            if (y - base > 0.35) box(x+s*(w/2-0.13),base,z,0.15,y-base,0.14,C.iron,'plain',true);
          }
        }
      }
    };
    const lamp = (x, y, z) => {
      const p = point(x,z);
      meshAt(group, UNIT, lampMat, p.x, top+y, p.z, 0.19,0.15,0.24).castShadow=false;
    };
    return { group, box, board, point, prop, floor, rail, ramp, lamp, solid, y: top, flush() {
      parts(group, materials.plain, pieces);
      parts(group, materials.brick, masonry);
      parts(group, materials.glass, panes);
      parts(group, materials.concrete, paving);
    }};
  };

  for (const site of FRONTIER_SITES) {
    const program = FRONTIER_PROGRAMS[site.id];
    const { w, d, h, trim, sign: legend } = PROFILES[site.id];
    const hw = w / 2, back = 7 - d, front = 6.9;
    const raised = site.id === 'serres' || site.id === 'cour';
    // These two sites straddle terrain triangles on the valley side of their pad.
    let foundation = sampleSalt(site.x, site.z), bottom = foundation;
    if (raised) {
      for (let ix = 0; ix <= 20; ix++) for (let iz = 0; iz <= 16; iz++) {
        const p = frontierPoint(site, -hw + w * ix / 20, back + (front - back) * iz / 16);
        const y = sampleSalt(p.x, p.z);
        foundation = Math.max(foundation, y - 0.16);
        bottom = Math.min(bottom, y);
      }
    }
    const L = layout(site, site.name, foundation);
    const { box, board, point, prop, floor, rail, ramp, lamp, group } = L;
    const lampPosition = point(0, 4.7);
    L.light = { ...lampPosition, y: L.y + Math.min(h - 0.8, 3.7) };
    const glasshouse = site.id === 'serres';
    const building = site.id === 'lisieres' || site.id === 'atelier' || site.id === 'cour';
    const opening = site.id === 'lisieres' ? 9.4 : site.id === 'atelier' ? 7.1 : 5.5;
    floor(0, (back + front) / 2, w, front - back, 0.24, C.tile, Math.max(0.32, foundation - bottom + 0.32));
    const apron = front + (raised ? 3.35 : 1.45);
    const threshold = point(0, apron);
    ramp(0, apron, front, opening - 0.7, sampleSalt(threshold.x, threshold.z) - L.y - 0.025, 0.24);
    box(0,0,back,w,h,0.42,glasshouse?C.zinc:C.darkBrick,glasshouse?'plain':'brick',true);
    for(const side of [-1,1]){
      const sx=side*hw;
      if(building) {
        // The side walls have real openings; timber panels close some of the old bays.
        const mid=(back+front)/2, count=4, length=(front-back)/count;
        box(sx,0,mid,0.37,2.62,front-back,C.darkBrick,'brick',true);
        box(sx,4.25,mid,0.38,h-4.25,front-back,C.brick,'brick',true);
        for(let j=0;j<count;j++){
          const z=back+(j+0.5)*length;
          box(sx,2.62,z-length/2+0.3,0.39,1.64,0.68,C.brick,'brick',true);
          box(sx,2.58,z+0.25,0.63,0.12,length-0.9,C.bone);
          if((j+side+4)%3===0) {
            box(sx,2.71,z+0.25,0.15,1.46,length-0.97,C.wood);
            for(let k=0;k<5;k++) box(sx+side*0.15,2.71+k*0.29,z+0.25,0.055,0.21,length-0.87,k%2?C.wood:C.old);
          } else box(sx,2.76,z+0.25,0.08,1.34,length-1.12,C.black,'glass');
        }
      } else {
        for(let z=back+1;z<=front;z+=3.1) box(sx,0,z,0.21,h,0.22,C.iron,'plain',true);
        box(sx,0,(back+front)/2,0.15,0.82,front-back,trim,'plain',true);
      }
      const half=(hw-opening/2);
      const wing = side * (opening / 2 + half / 2);
      box(wing, 0, front, half, glasshouse ? 1.12 : h - 0.85, 0.41, building ? C.brick : trim, building ? 'brick' : 'plain', true);
      if (glasshouse) {
        for (let i = 0; i < 4; i++) {
          const x = wing + (i - 1.5) * half / 4;
          box(x, 1.12, front, half / 4 - 0.06, 1.63, 0.12, i === 2 ? C.pale : C.petrol, 'glass', true);
          box(x + half / 8, 1.06, front + 0.09, 0.075, 1.71, 0.14, C.iron);
          box(x, 1.97, front + 0.09, half / 4, 0.064, 0.13, C.iron);
        }
      }
      box(side*(opening/2-0.12),0,front,0.33,h,0.54,C.bone,'plain',true);
    }
    box(0,h-0.85,front,w,0.85,0.46,building?C.darkBrick:trim,building?'brick':'plain',true);
    for(let j=0;j<8;j++) {
      const x=-hw+(j+0.5)*w/8;
      const skylight = (site.id === 'lisieres' && [1, 3, 5, 6].includes(j)) || (glasshouse && j % 3 === 1);
      const gap = skylight ? 2.4 : 0;
      const length = front - back + 1.4 - gap;
      const ridge = glasshouse ? 1.04 * (1 - Math.abs(x) / hw) : 0;
      const pitch = glasshouse ? -Math.sign(x) * Math.atan(1.04 / hw) : 0;
      box(x, h - 0.06 + ridge, (back + front - gap) / 2, w / 8 + 0.06, 0.15, length,
        glasshouse && j % 3 !== 0 ? C.zinc : j % 2 ? C.roof : C.zinc,
        glasshouse && j % 3 !== 0 ? 'glass' : 'plain', false, 0, pitch);
      if (skylight) {
        box(x - w / 17, h - 0.06, front - gap / 2 + 0.65, 0.15, 0.18, gap, C.zinc);
        box(x + w / 17, h - 0.06, front - gap / 2 + 0.65, 0.15, 0.18, gap, C.zinc);
      }
      box(x,h-0.19+ridge,(back+front)/2,0.10,0.17,front-back+0.45,C.iron);
    }
    if(building) {
      box(0,h+0.02,front,w,0.32,0.47,C.brick,'brick');
      for(let z=back+1;z<front;z+=3.5) box(0,h-0.38,z,w,0.18,0.18,C.iron);
      // Sections of the rolling shutter were repaired with different sheets.
      for(let j=0;j<6;j++) box(0,h-1.1-j*0.09,front+0.29,opening,0.065,0.1,j%3?trim:C.zinc);
    }
    board(program.shop.toUpperCase(),legend,0,h+0.55,front+0.82,Math.min(9.7,w*0.5));
    const [bx,bz]=program.bench;
    box(bx,0.23,bz,3.0,0.72,0.9,C.iron,'plain',true);
    box(bx,0.91,bz,3.2,0.13,1.08,trim);
    for(let j=0;j<5;j++){
      const x=bx+(j-2)*0.48;
      box(x,1.04,bz,0.30,0.14+(j%3)*0.09,0.31,j%2?C.rust:C.pale);
    }
    // A real counter opening, placed to the side of the through route.
    const [cx,cz]=program.counter;
    box(cx,0.24,cz-1.05,2.6,0.83,0.64,trim,'plain',true);
    box(cx,1.06,cz-1.05,2.73,0.10,0.76,C.wood);
    for(let n=0;n<4;n++){
      box(-hw+0.8,0.25+n*0.61,back+2.7,0.95,0.12,3.7,C.iron);
      for(let k=0;k<4;k++)box(-hw+0.8,0.38+n*0.61,back+1.4+k*0.73,0.52,0.23+(k%2)*0.1,0.51,(k+n)%2?C.ochre:C.old);
    }
    for(const x of [-hw+3,0,hw-3]) lamp(x,h-0.6,front-1.4);

    // Dressed loading aprons, braced storage and weathered marks identify the building's use from the lane.
    if (site.id === 'lisieres' || site.id === 'balance' || site.id === 'cour') {
      for (const side of [-1, 1]) {
        const x = side * (hw - 0.95);
        const p = point(x, 10.7);
        const base = sampleSalt(p.x, p.z) - L.y - 0.17;
        box(x, base, 10.7, 0.17, 3.78 - base, 0.19, C.iron, 'plain', true);
        box(x, 3.56, 8.75, 0.17, 0.22, 4.22, C.iron);
        for (let i = 0; i < 6; i++) box(x - side * i * 0.87, 3.6, 8.8, 0.90, 0.12, 4.5,
          i % 3 === 0 ? C.zinc : i % 2 === 0 ? C.petrol : C.roof, 'plain', false, 0.072);
        prop('crate', x - side * 1.1, 9.2, 0.97, side * 0.22);
        prop('cement_bag', x - side * 2.05, 9.7, 0.83);
        prop('barrel_blue', x + side * 0.85, 10.4, 0.82);
      }
    }
    if (site.id === 'lisieres') {
      // A warehouse front built in separate bays, with the working bay framed by old loading doors.
      for (const side of [-1, 1]) {
        const x = side * 8.35;
        for (const dx of [-2.16, 2.16]) {
          box(x+dx, 0, front+0.26, 0.38, 6.15, 0.30, C.darkBrick, 'brick');
          box(x+dx, 0, front+0.38, 0.52, 0.84, 0.37, C.bone);
        }
        box(x, 0.20, front+0.25, 3.55, 2.97, 0.14, side === 1 ? C.petrol : C.black);
        box(x, 3.10, front+0.35, 4.02, 0.22, 0.24, C.bone);
        for (let i = 0; i < 12; i++) {
          box(x, 0.36 + i * 0.225, front+0.36, 3.48, 0.095, 0.085, i % 5 ? C.iron : C.rust);
        }
        for (const dx of [-1.06, 0.97]) {
          box(x+dx, 4.36, front+0.235, 1.65, 1.15, 0.12, C.black);
          box(x+dx, 4.38, front+0.305, 1.42, 1.04, 0.08, C.petrol, 'glass');
          box(x+dx, 4.31, front+0.42, 1.74, 0.13, 0.23, C.bone);
          box(x+dx, 4.87, front+0.38, 1.56, 0.065, 0.07, C.iron);
          box(x+dx, 4.48, front+0.38, 0.064, 0.89, 0.07, C.iron);
        }
        for (const [i, z] of [13.3, 19.2, 27.6].entries()) {
          const x = side * (12.3 + (i % 2) * 4.7);
          prop('bush_wide', x, z, 0.76 + i * 0.11, 0.38 * i);
          prop('rubble', x - side * 1.28, z - 0.85, 1.1 + i * 0.2, 0.34 * i);
        }
      }
      for (const [x, z, w, h] of [[-15.8, -11.3, 4.5, 3.8], [-20.2, -11.3, 4.4, 2.9], [-24.1, -11.3, 3.6, 2.1]]) {
        const p = point(x, z), base = sampleSalt(p.x, p.z) - L.y - 0.34;
        box(x, base, z, w, h - base, 0.49, C.darkBrick, 'brick', true);
        box(x, h - 0.15, z + 0.03, w, 0.14, 0.53, C.zinc);
        prop('rubble', x + 0.2, z + 1.1, 1.38, x);
      }
      for (const [i, x] of [-9.3, -5.4, -1.5, 2.4, 6.3, 10.2].entries()) {
        box(x, 0.24, back + 1.05, 2.1, 0.13, 1.4, C.wood);
        const p = point(x, back + 1.05);
        propMesh(group, i % 2 ? 'cement_bag' : 'crate', p.x, L.y + 0.37, p.z, 1.05);
        if (i % 3 !== 1) propMesh(group, 'crate', p.x + 0.19, L.y + 0.42, p.z - 0.73, 0.77);
      }
      for (const [x,z,yaw] of [[-8.8,4.6,0.15],[-7.7,4.6,-0.35],[8.8,4.5,0.95],[-4.5,-5,2.3]]) prop('chair',x,z,0.84,yaw);
      board('ATTENTION À LA PESÉE', 'TARE AVANT CHARGEMENT', 3.8, 2.72, back + 0.35, 4.4);
      board('ATELIER DE TRI', 'LAISSEZ L’ALLÉE LIBRE', -6.7, 2.57, back + 0.33, 4.2);
      for (const x of [-5.08, 5.08]) for (let j=0;j<8;j++)
        box(x,0.245,front-0.5-j*1.42,0.10,0.012,0.58+(j%3)*0.24,j%5?C.ochre:C.bone);
    }

    const [sx,sz]=program.cargo;
    const scaleDeck = site.id==='lisieres'||site.id==='balance';
    if(scaleDeck) {
      box(sx,0.24,sz,2.2,0.18,1.8,C.iron);
      box(sx,0.42,sz-1.1,0.18,1.35,0.19,C.petrol);
      const dial = point(sx,sz-1.1);
      const frame = new THREE.Group();frame.position.set(dial.x,L.y+1.78,dial.z);frame.rotation.y=site.yaw;group.add(frame);
      const face = meshAt(frame,cylinder,colorMat(C.pale),0,0,0,0.73,0.13,0.73);face.rotation.x=Math.PI/2;
      for(let i=0;i<9;i++){
        const a=-1.16+i*0.29;
        const notch=meshAt(frame,UNIT,colorMat(C.black),Math.sin(a)*0.29,Math.cos(a)*0.29,0.069,0.013,0.043,0.008);
        notch.rotation.z=-a;
      }
      const pivot=new THREE.Group();frame.add(pivot);
      meshAt(pivot,UNIT,colorMat(C.red),0,0.13,0.083,0.025,0.25,0.021);
      L.dial=pivot;
    }
    const cart = new THREE.Group();cart.name='Chariot de récupération';group.add(cart);
    meshAt(cart,UNIT,colorMat(C.wood),0,0.52,0,0.83,0.13,1.03);
    meshAt(cart,UNIT,colorMat(C.iron),0,0.43,0,0.96,0.06,0.08);
    for(const side of [-1,1]) meshAt(cart,UNIT,colorMat(C.iron),side*0.36,0.69,-0.46,0.075,0.58,0.08).rotation.x=-0.30;
    const wheels=[-0.48,0.48].map(x=>meshAt(cart,AXLE,colorMat(C.black),x,0.31,0));
    const crate=propMesh(cart,'crate',0,0.61,0,0.73);
    cart.visible=false;
    const stock=Array.from({length:4},(_,i)=>{
      const p=point(sx+(i%2-0.5)*0.61,sz+(Math.floor(i/2)-0.5)*0.6);
      return propMesh(group,'crate',p.x,L.y+(scaleDeck?0.42:0.22),p.z,0.48);
    });
    const propBins = site.id==='atelier' ? ['tyre_stack','welding_cart','gas_cylinder','generator']
      : site.id==='serres' ? ['barrel_blue','jerrycan','table','cement_bag'] : ['jerrycan','barrel_blue','crate','tyre_stack'];
    propBins.forEach((name,i)=>prop(name,hw+2.4+(i%2)*2.5,-3.6-Math.floor(i/2)*3,0.92,i*0.43));
    if(site.id==='atelier'){
      prop('covered_car',3.9,1.1,0.99,0.035);
      for(const s of [-1,1])box(3.9+s*0.91,0.24,0.8,0.36,0.20,5.1,C.zinc);
      board('DÉPÔT VÉHICULE','ARRÊT · FREIN À MAIN',5.2,2.05,9.6,3.6);
      for(const x of [3.0,7.3])for(let k=0;k<7;k++)box(x,0.02,9+k*1.15,0.11,0.035,0.7,C.ochre);
    }
    if(glasshouse){
      for(const x of [1.7,5.4,8.1]){
        box(x,0.23,-3,1.5,0.51,8.9,C.wood,'plain',true);
        box(x,0.73,-3,1.26,0.07,8.65,C.soil);
        for(let j=0;j<6;j++){
          const p=point(x+(j%2?0.2:-0.2),-6.7+j*1.31);
          propMesh(group,'bush_wide',p.x,L.y+0.74,p.z,0.47+j%3*0.08);
        }
      }
      meshAt(group,cylinder,colorMat(C.black),point(-3.8,1.8).x,L.y+1.18,point(-3.8,1.8).z,0.6,0.31,0.6);
    }
    if(site.id==='lisieres'){
      const { x,z,width,depth,rise,ramp:len } = MARKET_DECK, entrance=z+depth/2;
      // The last inhabited building keeps a walkable first floor above its abandoned ground floor.
      floor(x,z,width,depth,rise,C.old);
      for(const side of [-1,1])for(const zz of [z-depth/2+0.32,z+depth/2-0.32])
        box(x+side*(width/2-0.27),-0.28,zz,0.44,rise+0.18,0.45,C.darkBrick,'brick',true);
      box(x,rise,z-depth/2,width,4.9,0.46,C.brick,'brick',true);
      for(const side of [-1,1]){
        box(x+side*(width/2-0.13),rise,z-1,0.35,2.22,7.8,C.darkBrick,'brick',true);
        box(x+side*(width/2-0.13),rise+3.78,z-1,0.35,1.12,7.8,C.brick,'brick');
        for(let i=0;i<3;i++)box(x+side*(width/2-0.13),rise+2.2,z-4+i*2.7,0.34,1.65,0.44,C.brick,'brick');
      }
      for (let i = 0; i < 7; i++)
        box(x - width / 2 + (i + 0.5) * width / 7, rise+4.54,z,width/7+0.09,0.19,depth+0.25,
          i % 3 ? C.zinc : C.petrol, 'plain', false, 0.03);
      for (const side of [-1, 1]) {
        box(x+side*(width/2-0.23),0,z+0.8,0.32,1.36,5.4,C.darkBrick,'brick',true);
        box(x+side*(width/2-0.24),1.42,z-1.3,0.16,0.38,1.11,C.brick,'brick');
      }
      box(x-2.77,rise+1.36,z-4.7,1.42,0.9,0.26,C.wood);
      box(x-2.75,rise+1.53,z-4.5,1.28,0.6,0.08,C.petrol);
      prop('barrel_blue',x-1.7,4.7,0.91);
      prop('rubble',x+5.6,2.3,1.35,1.7);
      const entryGround=sampleSalt(point(x,entrance+len).x,point(x,entrance+len).z)-L.y;
      ramp(x,entrance+len,entrance,2.8,entryGround-0.015,rise);
      for(const side of [-1,1])rail(x+side*2.75,rise,entrance,2.55,0.12);
      box(22,rise,3.8,2.7,0.94,0.72,C.petrol,'plain',true);
      box(22,rise+0.93,3.8,2.9,0.12,0.85,C.wood);
      box(21.7,rise+1.05,3.8,0.43,0.29,0.25,C.black);
      box(21.84,rise+1.30,3.8,0.022,0.56,0.022,C.iron,'plain',false,0,0.12);
      board('LES FRÉQUENCES','RADIO · BULLETIN DES VIGIES',x,rise+3.62,entrance+0.12,4.3);
      lamp(22,rise+3.2,5.2);
      for(const z of [1.5,5.7]){
        box(24.55,rise,z,1.02,0.44,1.42,C.wood,'plain',true);
        const p=point(24.55,z);propMesh(group,'bush_wide',p.x,L.y+rise+0.44,p.z,0.71);
      }
      for(let j=0;j<8;j++) {
        const z=-12+j*1.12;
        box(29,-0.27,z,0.34,2.7+(j%4)*0.68,1.08,j%2?C.darkBrick:C.brick,'brick',true);
      }
    }
    if(site.id==='vigie'){
      const x=12.6,z=-0.6,rise=4.2,entrance=2.4;
      floor(x,z,5.9,6,rise,C.wood);
      for(const x0 of [x-2.7,x+2.7])for(const z0 of [-3.2,2.05])box(x0,-0.3,z0,0.24,6.6,0.24,C.iron,'plain',true);
      rail(x-2.84,rise,z,0.13,6);rail(x+2.84,rise,z,0.13,6);rail(x,rise,-3.52,5.75,0.13);
      rail(x-2.1,rise,entrance,1.6,0.13);rail(x+2.1,rise,entrance,1.6,0.13);
      box(x,6.22,z,6.45,0.16,6.5,C.zinc);
      const p=point(x,17);
      ramp(x,17,entrance,2.5,sampleSalt(p.x,p.z)-L.y-0.02,rise);
      box(x,rise,-2.6,0.19,0.95,0.19,C.iron);
      const scope = point(x,-2.6);
      meshAt(group,cylinder,colorMat(C.black),scope.x,L.y+rise+0.98,scope.z,0.23,0.37,0.23).rotation.x=Math.PI/2;
      lamp(x,5.93,-0.5);
      L.scope = { ...point(x,-1.8), y:L.y+rise, yaw:site.yaw+Math.PI, lens:1.9 };
    }
    const fire = point(-hw-3,9);
    prop('fire_pit',-hw-3,9);prop('chair',-hw-4.2,10.3,1,0.3);
    fires.push([fire.x,sampleSalt(fire.x,fire.z)+0.25,fire.z,0.54]);
    keepOut.push({x:site.x,z:site.z,r:site.id==='lisieres'?51:32});
    L.flush();
    hubs.set(site.id,{ ...L, cart,wheels,crate,stock });
  }

  for(const point of FRONTIER_SALVAGE){
    const y=sampleSalt(point.x,point.z);
    const box=propMesh(parent,'ammo_crate',point.x,y,point.z,0.82);
    box.name='Dépôt de pièces';
    salvage.set(point.id,box);
  }

  for(const post of FRONTIER_POSTS) {
    const L=layout(post,'Poste · '+post.name);
    const {box,board,point,floor,rail,ramp,lamp,group}=L;
    const side=post.id==='pumps'?-1:1;
    const x=side*11.7, watchX=-side*12.2, tower=post.id==='nord'?6.8:post.id==='batterie'?6:5.35;
    // Low planted islands and roofed desks keep the pedestrian side free.
    floor(x,-2.1,3.5,6.2,0.18,C.old);
    for(const [dx,dz] of [[-1.6,-4.8],[1.6,-4.8],[-1.6,-0.6],[1.6,-0.6]])box(x+dx,-0.3,dz,0.18,3.27,0.18,C.iron,'plain',true);
    box(x,0,-4.95,3.5,2.85,0.23,C.darkBrick,'brick',true);
    box(x+side*1.55,0,-2.7,0.19,1.15,4.55,C.petrol,'plain',true);
    box(x,2.84,-2.7,4,0.16,5.4,C.zinc,'plain',false,0.04);
    box(x,0.18,-0.64,2.5,0.87,0.38,C.wood,'plain',true);
    lamp(x,2.62,-1.17);
    board(post.name.toUpperCase(),'VIGIE · PASSAGE',x,3.58,-0.16,4.2);
    floor(watchX,-0.6,4.7,4.9,tower,C.wood);
    for(const s of [-1,1])for(const z of [-2.9,1.7])
      box(watchX+s*2.15,-0.46,z,0.25,tower+2.64,0.25,C.iron,'plain',true);
    for(const s of [-1,1]){
      box(watchX+s*2.06,tower-1.6,-0.57,0.17,0.16,4.58,C.wood,'plain',false,s*0.58);
      rail(watchX+s*2.27,tower,-0.6,0.13,4.9);
    }
    rail(watchX,tower,-3.01,4.63,0.13);
    const entry=point(watchX,19.9);
    ramp(watchX,19.9,1.85,2.0,sampleSalt(entry.x,entry.z)-L.y-0.02,tower);
    box(watchX,tower+2.10,-0.6,5.25,0.19,5.6,C.zinc,'plain',false,0.07);
    lamp(watchX,tower+1.81,-0.4);
    const s=side*7.75, at=point(s,0);
    const hinge=new THREE.Group();
    hinge.position.set(at.x,L.y+1.09,at.z);hinge.rotation.y=post.yaw;group.add(hinge);
    const swing=new THREE.Group();hinge.add(swing);swing.rotation.z=-side*Math.PI*0.47;
    parts(swing, materials.plain, Array.from({ length: 10 }, (_, i) => ({
      x: -side * (i + 0.5) * 1.52, y: 0, z: 0, yaw: 0, rx: 0, rz: 0,
      w: 1.52, h: 0.18, d: 0.20, color: i % 2 === 0 ? C.red : C.pale
    })));
    box(s,-0.35,0,0.52,1.8,0.55,C.iron,'plain',true);
    const signal=meshAt(hinge,UNIT,lampMat,0,0.33,0,0.19,0.19,0.19);
    const stopMaterial = redLamp;
    meshAt(hinge, UNIT, redLamp, 0, 0.33, -0.12, 0.115, 0.12, 0.08).castShadow = false;
    const barrier=L.solid(s-side*7.6,0.56,0,15.2,0.68,0.29);
    barrier.obstacle='barrière';
    // Road vehicles see the actual arm; foot traffic can walk round the islands.
    const lookout = { ...point(watchX,-1.92), y:L.y+tower, yaw:post.yaw, lens:4.4 };
    box(watchX + 0.84, tower, 0.62, 0.19, 1.10, 0.19, C.iron);
    const optics = point(watchX + 0.84, 0.62);
    const viewer = meshAt(group, UNIT, colorMat(C.black), optics.x, L.y + tower + 1.18, optics.z, 0.32, 0.17, 0.42);
    viewer.rotation.y = post.yaw;
    const desk={ ...point(x,0.52), y:L.y+0.18,yaw:post.yaw };
    const watchPath=[[watchX,15.5],[watchX,4.2],[watchX,-1.92]].map(([x,z])=>point(x,z));
    posts.set(post.id,{ ...post,group,swing,signal,stopMaterial,lampMat,barrier,side,lookout,desk,watchPath,progress:0,closed:false,inserted:false });
    keepOut.push({x:post.x,z:post.z,r:30});
    L.flush();
  }

  // Between the occupied yards, short party walls and foundations keep the survey's irregular rhythm.
  // Each group is small and static so the open ground retains both shortcuts and sightlines.
  const road={};
  const isFree = (x, z) => !insideCity(x, z) && (!saltRoadAt(x, z, road) || road.distance > road.half + 10) &&
    keepOut.every(site => Math.hypot(x - site.x, z - site.z) > site.r + 12);
  for (const [i, halt] of FRONTIER_HALTS.entries()) {
    const side = halt.side === 'west' ? -1 : 1;
    const place = [0, 24, -24, 48, -48, 77, -77].flatMap(dz => {
      const z = halt.z + dz, edge = cityBoundsAt(z)[halt.side + 'X'];
      return [40, 57, 79, 97].map(dx => ({ x: edge + side * dx, z }));
    }).find(({ x, z }) => {
      const ground = {};
      sampleSalt(x, z, ground);
      return isFree(x, z) && ground.ny > 0.94;
    });
    if (!place) continue;
    const site = { ...halt, ...place, yaw: -side * Math.PI / 2, id: 'halte-' + i };
    const L = layout(site), { box, board, prop, point } = L;
    const tint = [C.pale, C.petrol, C.ochre, C.rust][i % 4];
    for (const x of [-3.6, 3.6]) for (const z of [-1.7, 1.55]) {
      const at = point(x, z), base = sampleSalt(at.x, at.z) - L.y - 0.16;
      box(x, base, z, 0.15, 2.95 - base, 0.16, C.iron, 'plain', true);
    }
    for (let k = 0; k < 5; k++) box((k - 2) * 1.49, 2.86 + (k % 2) * 0.07, -0.11, 1.55, 0.085, 3.7,
      k % 3 ? tint : C.zinc, 'plain', false, 0.16, k % 2 ? 0.03 : -0.05);
    for (let k = 0; k < 7; k++) box((k - 3) * 1.01, -0.25, -2, 1.02, 1.33 + (k % 3) * 0.31,
      0.45, k % 4 ? C.darkBrick : C.brick, 'brick', true);
    box(-2.5, -0.11, -0.82, 1.2, 0.94, 0.65, C.wood);
    prop(site.gear, -2.55, -0.73, 0.79, 0.2);
    prop('chair', 1.83, 0.36, 0.83, 1.4);
    prop('barrel_blue', 3.2, -1.0, 0.83, 0.1);
    prop('rubble', -4.0, -1.8, 1.31, i);
    board(site.name.toUpperCase(), ['ABRI · EAU', 'ENTRETIEN · VEILLE'][i % 2], 0, 2.63, 1.71, 3.4);
    if (i % 2 === 0) {
      const fire = point(3.05, 3.38);
      prop('fire_pit', 3.05, 3.38, 0.8);
      fires.push([fire.x, sampleSalt(fire.x, fire.z) + 0.25, fire.z, 0.47]);
    }
    keepOut.push({ x: site.x, z: site.z, r: 12 });
    L.flush();
    halts.push(site);
  }
  for(const [i,a] of CITY_RING.entries()){
    const b=CITY_RING[(i+1)%CITY_RING.length],dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz);
    for(let along=72,j=0;along<l-40;along+=176,j++){
      const r=frontierHash(i,j,77);
      if(r>0.58)continue;
      const d=38+r*130,x=a.x+(dx*along-dz*d)/l,z=a.z+(dz*along+dx*d)/l;
      if(!isFree(x,z))continue;
      const site={x,z,yaw:Math.atan2(dx,dz)+Math.PI/2};
      const L=layout(site,'Derniers murs');
      const width=6+r*10, end=2.1+r*2;
      for(let k=0;k<5;k++) {
        const x=-width/2+(k+0.5)*width/5, height=0.6+frontierHash(i,j,k+40)*end;
        const p=L.point(x,0), base=Math.min(-0.26,sampleSalt(p.x,p.z)-L.y-0.22);
        L.box(x,base,0,width/5+0.025,height-base,0.48,k%3?C.darkBrick:C.brick,'brick',true);
      }
      L.box(-width/2+0.21,-0.45,1.8,0.48,2.1,3.6,C.darkBrick,'brick',true);
      for(const [x,z] of [[1.6,2.5],[-3.3,-2.7]])L.prop('rubble',x,z,1.0+r*1.65,r*5);
      L.flush();
      keepOut.push({x,z,r:10});
    }
  }
  return { decks, hubs, posts, salvage, halts };
}
