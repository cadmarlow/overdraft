import * as THREE from 'three/webgpu';
import { color, floor, mix, positionLocal, positionWorld, sin, time, uv, vec3 } from 'three/tsl';
import { finishGeometry, standard } from './district-geometry.js';
import { groundRailColliders } from './ground-surfaces.js';
import { makeMaterials, groundBuilder, fountain, wayfinding, plant, seat, visit, watch } from './urban-places.js';
import { campusPoint, asphaltPoint, unPoint, campusWalk, campusLowPlaza, campusLawns, asphaltField, asphaltLawns,
  unPlaza, unGarden, unPool } from './manhattan-sites-plan.js';

const to = (p, points) => points.map(([x,z]) => p(x,z));
const Y = 0.265;
const rectangle = (a,b,c,d) => [[a,b],[c,b],[c,d],[a,d]];
const circle = (x, z, r, n = 28) => Array.from({ length: n }, (_, i) => {
  const a = i * 2 * Math.PI / n;
  return [x + Math.cos(a) * r, z + Math.sin(a) * r];
});

function litMaterials() {
  const m = makeMaterials();
  m.sand = standard(0xb58a66);
  m.track = standard(0x884336);
  m.glassBlue = standard(0x275769, 0.47, 0.22);
  m.marble = standard(0xc3bba8);
  m.bronze = standard(0x626950, 0.54, 0.52);
  m.field = standard(0x417147);
  m.field.colorNode = mix(color(0x3b6945), color(0x547d4b), sin(floor(positionWorld.x.div(5.1)).mul(2.77)).mul(0.32).add(0.5));
  m.brickWalk = standard(0x9e725c);
  const row = floor(positionWorld.z.div(0.24));
  const tile = floor(positionWorld.x.add(sin(row.mul(Math.PI / 2)).mul(0.21)).div(0.43));
  const grain = sin(tile.mul(1.29).add(row.mul(3.19))).mul(0.14).add(0.5);
  const joint = positionWorld.z.div(0.24).fract().min(positionWorld.x.add(sin(row.mul(Math.PI / 2)).mul(0.21)).div(0.43).fract());
  m.brickWalk.colorNode = mix(color(0x777064),mix(color(0x875c48),color(0xac7e60),grain),joint.smoothstep(0.035,0.085));
  return m;
}

function tilted(g, ground, vertices, indices, mat, style, options = {}) {
  const position = vertices.flatMap(p => [p.x,p.y,p.z]);
  const geometry = finishGeometry(position, indices, style);
  g.batch.add(mat, geometry, false);
  ground.addTriangles(position, indices, { curb: false, ...options });
}

function landscapePath(g, ground, point, a, b, width, ya, yb, mat, style, deck = false) {
  const normal = [a[1]-b[1],b[0]-a[0]], k = width * 0.5 / Math.hypot(...normal);
  const offset = (p, side, y) => ({ ...point(p[0] + normal[0] * k * side,p[1] + normal[1] * k * side), y });
  const vertices = [offset(a,1,ya),offset(b,1,yb),offset(b,-1,yb),offset(a,-1,ya)];
  tilted(g,ground,vertices,[0,1,2,0,2,3],mat,style,{ deck });
}

function lowSteps(g, p, m, x0, x1, start, end, a, b, count) {
  for (let i = 0; i < count; i++) {
    const z = start + (end - start) * i / count, previous = start + (end - start) * (i + 1) / count;
    const y = a + (b - a) * (i + 1) / count;
    g.rect(x0,z,x1,previous,y,m.paving,1);
    g.box(m.marble,p((x0+x1)/2,Math.max(z,previous)-0.025),y - Math.abs(b-a)/count,x1-x0,Math.abs(b-a)/count,0.085);
  }
}

function campusStatue(g, m, p) {
  g.box(m.stone,p(0,-53.5),3.03,4.05,0.31,3.7);
  g.box(m.stone,p(0,-53.5),3.34,2.66,1.34,2.58);
  g.box(m.marble,p(0,-53.5),4.68,3.12,0.25,2.91);
  g.box(m.bronze,p(0,-54),4.93,1.48,1.13,1.46);
  g.batch.add(m.bronze,new THREE.CapsuleGeometry(0.49,0.83,5,12).scale(1,1,0.72).translate(p(0,-53.83).x,6.02,p(0,-53.83).z));
  g.batch.add(m.bronze,new THREE.SphereGeometry(0.29,16,10).scale(0.82,1.12,0.86).translate(p(0,-53.83).x,7.14,p(0,-53.83).z));
  g.box(m.bronze,p(0,-53.18),5.61,1.43,0.27,0.7);
  for (const side of [-1,1]) g.tube(m.bronze, [[p(side * 0.42,-53.84).x,6.41,p(0,-53.84).z],
    [p(side * 0.59,-53.56).x,5.93,p(0,-53.56).z],[p(side * 0.4,-53.08).x,5.75,p(0,-53.08).z]],0.13,6);
  g.tube(m.bronze,[[p(0.71,-53.64).x,5.19,p(0,-53.64).z],[p(0.78,-53.64).x,7.11,p(0,-53.64).z]],0.039,2);
  g.wall(to(p,rectangle(-1.95,-55.1,1.95,-51.75)),3.03,7.45);
}

function campusGround(scene, city, m) {
  const p = campusPoint, g = groundBuilder(scene,'Columbia · College Walk et Low Plaza',p,city,m);
  const { addTree, addBench, addLamp, ground } = city;
  g.floor(to(p,campusWalk),0.29,m.brickWalk);
  g.rect(-122,-0.36,119,0.36,0.298,m.paving,2);
  for (const z of [-7.4,7.4]) g.rect(-121,z,118,z+0.34,0.304,m.paving,1);
  g.floor(to(p,campusLowPlaza),0.33,m.paving,1);
  g.rect(-33,-15,33,-8,0.313,m.paving,1);
  g.rect(-8,8,8,105,0.32,m.brickWalk);
  g.rect(-27,73,27,104,0.322,m.paving,1);
  for (const lawn of campusLawns) {
    g.floor(to(p,lawn),0.31,m.lawn);
    const [a,b,c] = lawn;
    g.rail(m.stone,p(...a),p(...b),0.24,0.15,0.19);
    g.rail(m.stone,p(...b),p(...c),0.24,0.15,0.19);
  }
  lowSteps(g,p,m,-28.6,28.6,-22,-46,0.33,3.03,18);
  g.rect(-31,-59,31,-46,3.03,m.brickWalk);
  lowSteps(g,p,m,-23.5,23.5,-59,-72.75,3.03,6.5,22);
  g.rect(-25,-79.1,25,-72.75,6.5,m.paving,1);
  for (const side of [-1,1]) {
    g.box(m.stone,p(side * 30.1,-32.6),0.33,2.9,2.69,22);
    g.box(m.marble,p(side * 30.1,-32.6),3.02,3.12,0.15,22.3);
    g.wall(to(p,rectangle(side*30.1-1.45,-43.6,side*30.1+1.45,-21.6)),0.33,3.17);
    g.box(m.stone,p(side * 24.1,-64.9),3.02,1.24,3.51,13);
    g.wall(to(p,rectangle(side*24.1-0.62,-71.4,side*24.1+0.62,-58.4)),3.02,6.54);
    // Long parallel walks reach the landings without forcing a stair approach.
    landscapePath(g,ground,p,[side * 35,-18],[side * 35,-58],3.6,0.31,3.03,m.paving,1);
    landscapePath(g,ground,p,[side * 35,-58],[side * 35,-77],3.6,3.03,4.17,m.paving,1);
    landscapePath(g,ground,p,[side * 35,-77],[side * 20,-77],3.6,4.17,6.5,m.paving,1);
    const col = p(side * 27.5,-54.2);
    g.cylinder(m.iron,col,3.03,0.075,0.115,7.7,10);
    for (let i = 0; i < 7; i++) {
      const x = side * (42+i*10.9);
      plant(addTree,p(x,-12.5),0.3,i,0.77+(i%3)*0.1);
      if (i<5) plant(addTree,p(x,12),0.25,i+1,0.71+(i%3)*0.1);
    }
  }
  campusStatue(g,m,p);
  for (const [x,z] of [[-110,-10],[-84,10],[-55,-11],[57,-11],[86,10],[109,-10],[-31,-17],[31,-17],[-7,43],[7,72]]) {
    const pt=p(x,z); addLamp(pt.x,0.31,pt.z);
  }
  const seats = [[-62,-10.7,0],[-36,-17,0],[39,-16,0],[61,10.6,Math.PI],[-11,56,Math.PI/2]]
    .map(([x,z,yaw])=>seat(addBench,p,x,z,0.32,yaw));
  wayfinding(g,m,p(-13,-10),0.29,['COLUMBIA','COLLEGE WALK  ·  LOW PLAZA',0],'#3c4955');
  g.finish();
  const sidewalks = [[-122,0],[118,0]];
  return [
    visit(p,[-79,0],[[-69,0],[-62,-8]],seats[0],sidewalks,[-88,0]),
    visit(p,[-52,-2],[[-41,-6],[-36,-13]],seats[1],sidewalks,[-58,0]),
    visit(p,[58,-3],[[49,-8],[39,-13]],seats[2],sidewalks,[66,0]),
    visit(p,[83,0],[[76,2],[62,7]],seats[3],sidewalks,[91,0]),
    visit(p,[-3,21],[[-3,40],[-9,53]],seats[4],[[0,12],[0,40]],[0,19]),
    watch(p,[10,-13],[[10,-26],[13,-40]],[13,-48],p(0,-54),[[10,-11],[10,-23]]),
    watch(p,[-8,-15],[[-13,-26],[-15,-39]],[-13,-48],p(0,-54),[[-8,-9],[-8,-23]])
  ];
}

function pitch(g, m, p, x0,z0,x1,z1,y) {
  g.rect(x0,z0,x1,z1,y,m.field);
  const mid=(x0+x1)/2, center=(z0+z1)/2, lineY=y+0.011;
  const mark = (a,b) => g.rail(m.paint,p(...a),p(...b),lineY,0.002,0.089);
  const xw=x0+1.6,xe=x1-1.6,zn=z0+1.35,zs=z1-1.35;
  const lines = [[[xw,zn],[xe,zn]],[[xe,zn],[xe,zs]],[[xe,zs],[xw,zs]],[[xw,zs],[xw,zn]],[[mid,zn],[mid,zs]]];
  for (const [a,b] of lines) mark(a,b);
  const ring=circle(mid,center,8.7,40);
  for(let i=0;i<ring.length;i++) mark(ring[i],ring[(i+1)%ring.length]);
  for (const side of [-1,1]) {
    const x = side<0?xw:xe, xa=x-side*14.1;
    mark([x,center-17],[xa,center-17]);mark([xa,center-17],[xa,center+17]);mark([xa,center+17],[x,center+17]);
    for(const dz of [-3.66,3.66])g.box(m.paint,p(x,center+dz),y,0.105,2.45,0.12);
    g.box(m.paint,p(x,center),y+2.41,0.105,0.11,7.38);
    const back=x+side*1.2;
    for(const dz of [-3.66,3.66])g.rail(m.paint,p(back,center+dz),p(x,center+dz),y+0.05,0.065,0.055);
    for(let i=0;i<=24;i++){
      const z=center-3.66+i*7.32/24;
      g.rail(m.paint,p(back,z),p(x,z),y+2.43,0.014,0.014);
      g.box(m.paint,p(back,z),y+0.03,0.014,2.42,0.014);
    }
    for(let i=0;i<=8;i++)g.rail(m.paint,p(back,center-3.66),p(back,center+3.66),y+i*0.3,0.012,0.012);
  }
}

function fence(g, m, city, a, b, y, height = 2.6, mesh = true) {
  const d=Math.hypot(b.x-a.x,b.z-a.z), n=Math.ceil(d/3.5);
  if(d<0.01)return;
  g.rail(m.iron,a,b,y+height,0.061,0.057);
  g.rail(m.iron,a,b,y+0.16,0.036,0.036);
  for(let i=0;i<=n;i++)g.box(m.iron,{x:a.x+(b.x-a.x)*i/n,z:a.z+(b.z-a.z)*i/n},y,0.072,height+0.06,0.072);
  if(mesh) {
    const fine=Math.ceil(d/0.48);
    for(let i=1;i<fine;i++)g.box(m.iron,{x:a.x+(b.x-a.x)*i/fine,z:a.z+(b.z-a.z)*i/fine},y+0.18,0.013,height-0.18,0.013);
    for(let i=1;i<6;i++)g.rail(m.iron,a,b,y+height*i/6,0.015,0.013);
  }
  city.colliders.push(...groundRailColliders([[a.x,a.z,b.x,b.z]],y,height+0.07,0.095));
}

function asphaltGround(scene, city, m) {
  const p=asphaltPoint,g=groundBuilder(scene,'Asphalt Green · Litwin Field et parvis',p,city,m);
  const { addTree,addBench,addLamp }=city;
  for(const lawn of asphaltLawns)g.floor(to(p,lawn),Y,m.lawn);
  g.rect(26,-28,125,31,Y+0.012,m.track);
  const [a,,c]=asphaltField;
  pitch(g,m,p,...a,...c,Y+0.022);
  for(const [a,b] of [[[28,-28],[124,-28]],[[124,-28],[124,31]],[[124,31],[28,31]],
    [[28,31],[28,4]],[[28,-3],[28,-28]]])fence(g,m,city,p(...a),p(...b),Y+0.02,2.75);
  g.walk([[24,0],[24,-7],[27,-26],[29,-33],[64,-33],[87,-33],[117,-32]],3.4,0.304,2);
  g.walk([[24,5],[24,29],[29,34],[73,34],[112,34],[141,34],[151,34]],3.8,0.304,2);
  g.rect(152,19,184,41,0.307,m.paving,1);
  g.rect(153,20,183,40,0.315,m.glassBlue);
  g.rect(154,21,182,39,0.32,m.track);
  for(const [a,b] of [[[154,21],[182,21]],[[154,39],[182,39]],[[182,21],[182,39]],
    [[154,21],[154,39]],[[168,21],[168,39]]])g.rail(m.paint,p(...a),p(...b),0.329,0.004,0.06);
  for(const x of [155.8,180.2]) {
    g.box(m.iron,p(x,30),0.317,0.14,3.7,0.14);
    g.box(m.paint,p(x,30),3.17,0.1,1.05,1.67);
    const pt=p(x+(x<168?0.43:-0.43),30);
    g.batch.add(m.red,new THREE.TorusGeometry(0.23,0.016,7,24).rotateX(-Math.PI/2).translate(pt.x,3.27,pt.z));
  }
  const sundial=p(138,26);
  g.cylinder(m.stone,sundial,0.32,2.03,2.15,0.46);
  g.batch.add(m.bronze,new THREE.ConeGeometry(0.69,1.38,3).rotateZ(0.39).translate(sundial.x,1.29,sundial.z));
  for(let i=0;i<12;i++){
    const t=i*Math.PI/6;
    g.box(m.bronze,p(138+Math.cos(t)*1.66,26+Math.sin(t)*1.66),0.787,0.23,0.02,0.075,-t);
  }
  g.wall(to(p,circle(138,26,2.12,18)),0.32,0.78);
  for(const [i,[x,z]] of [[31,-60],[33,-83],[32,-90],[31,-33],[50,-33],[76,-33],[24,21],[32,34],[58,34],[87,34],[140,31],[160,19]].entries()){
    const pt=p(x,z);plant(addTree,pt,Y,i,0.76+(i%4)*0.075);
    if(i%2===0)addLamp(pt.x+1,0.3,pt.z+1);
  }
  const benches=[[26,-14,Math.PI/2],[43,-32,0],[66,-32,0],[25,14,Math.PI/2],[86,34,Math.PI],[146,34,Math.PI]]
    .map(([x,z,yaw])=>seat(addBench,p,x,z,0.31,yaw));
  wayfinding(g,m,p(25,4.9),0.3,['ASPHALT GREEN','TERRAIN LITWIN  ·  BASKET',-Math.PI/2],'#314939');
  g.finish();
  return [
    visit(p,[25,1],[[25,-5]],benches[0],[[24,-15],[24,17]],[24,0]),
    visit(p,[28,-25],[[31,-32],[35,-32]],benches[1],[[27,-12],[30,-32]],[28,-21]),
    visit(p,[50,-32],[[58,-32]],benches[2],[[37,-32],[62,-32]],[45,-32]),
    visit(p,[25,3],[[25,8]],benches[3],[[24,-10],[24,19]],[24,2]),
    visit(p,[55,33],[[70,33],[82,33]],benches[4],[[38,33],[66,33]],[49,33]),
    visit(p,[123,33],[[133,30],[141,28]],benches[5],[[108,33],[130,33]],[117,33])
  ];
}

const flags = [
  ['v','#163b80','#fffaf0','#bc263b'], ['h','#191c1f','#b62b36','#e7b845'], ['v','#248353','#fffdf1','#c44247'],
  ['circle','#fffdf6','#bd3450'], ['h','#b1323e','#fff6de','#258568'], ['h','#bb3138','#fffaf0','#294783'],
  ['h','#f4ca46','#345693','#ba3846'], ['v','#204f9c','#efc436','#b12a3d'], ['h','#248b62','#f0d744','#bd3742'],
  ['cross','#265a94','#f5ce38'], ['cross','#bc3142','#fffbef'], ['h','#eac932','#217291','#ad3540'],
  ['h','#f7f1dc','#315c96','#ae343e'], ['v','#24625f','#f5e5af','#bf6539'], ['h','#b83043','#fff8e8'],
  ['h','#fff7e7','#cf3138'], ['h','#2e6d9d','#151c22','#f6f3e4'], ['h','#d18f38','#fff7e6','#3c8655'],
  ['h','#3790b5','#f8f7e8','#3790b5'], ['h','#365d91','#e6b133'], ['h','#ba3444','#f2cd43','#ba3444'],
  ['cross','#f5f3e2','#284a7a'], ['cross','#bc253f','#fffbea'], ['v','#202022','#eac137','#bd3040'],
  ['h','#c63748','#fff6e5','#ba2d41'], ['circle','#24764b','#c43646'], ['h','#2f8a53','#e9c442','#bd373c'],
  ['v','#c33e44','#fff8e8','#c33e44'], ['h','#2b905a','#fff9eb','#3f6eaa'], ['h','#f7bd38','#bf3348'],
  ['v','#e48535','#fff7e4','#299163'], ['h','#c63243','#28599a','#d98c3b']
];

function plazaFlags(g, m, p, city) {
  const canvas=document.createElement('canvas');
  canvas.width=512;
  canvas.height=512;
  const ctx=canvas.getContext('2d');
  const cols=4, rows=8, w=128, h=64;
  for(let i=0;i<flags.length;i++){
    const [type,...colors]=flags[i], x=(i%cols)*w, z=Math.floor(i/cols)*h;
    ctx.fillStyle=colors[0];ctx.fillRect(x,z,w,h);
    if(type==='h'||type==='v')colors.forEach((shade,j)=>{
      ctx.fillStyle=shade;
      if(type==='h')ctx.fillRect(x,z+j*h/colors.length,w,h/colors.length+0.1);
      else ctx.fillRect(x+j*w/colors.length,z,w/colors.length+0.1,h);
    });
    if(type==='circle'){
      ctx.fillStyle=colors[1];ctx.beginPath();ctx.arc(x+w*0.47,z+h/2,h*0.29,0,Math.PI*2);ctx.fill();
    }
    if(type==='cross'){
      ctx.fillStyle=colors[1];ctx.fillRect(x+w*0.31,z,w*0.11,h);ctx.fillRect(x,z+h*0.4,w,h*0.17);
    }
  }
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
  const cloth=new THREE.MeshStandardNodeMaterial({ map, side:THREE.DoubleSide, roughness:0.89 });
  cloth.userData.cullDistance=280;
  const pole=standard(0xa2a5a0,0.49,0.58);
  const origin=-192;
  for(let i=0;i<flags.length;i++){
    const z=origin+i*5.7, x=11.5+Math.sin(i*0.1)*2.1, height=6.8;
    const site=p(x,z);
    g.cylinder(m.stone,site,0.28,0.29,0.38,0.33,12);
    g.cylinder(pole,site,0.6,0.046,0.067,height,12);
    g.batch.add(pole,new THREE.SphereGeometry(0.084,8,6).translate(site.x,0.6+height,site.z));
    const geometry=new THREE.PlaneGeometry(1.75,1.02,8,3);
    const uv=geometry.attributes.uv;
    for(let k=0;k<uv.count;k++) {
      const u=uv.getX(k),v=uv.getY(k), a=(i%cols+u*0.98+0.01)/cols;
      uv.setXY(k,a,1-(Math.floor(i/cols)+(1-v)*0.94+0.03)/rows);
    }
    geometry.translate(0.91,6.47,0).rotateY(-0.32).translate(site.x,0,site.z);
    g.batch.add(cloth,geometry,false);
  }
  // Stretch the wave to zero at the pole, using the atlas column's fractional UV as the cloth coordinate.
  const extent=uv().x.mul(4).fract().sub(0.01).max(0);
  cloth.positionNode=positionLocal.add(vec3(0,sin(positionLocal.z.mul(0.47).sub(time.mul(2.25))).mul(extent).mul(0.095),
    sin(positionLocal.z.mul(0.21).add(extent.mul(8.3)).sub(time.mul(3.25))).mul(extent).mul(0.24)));
  for(const z of [-184,-145,-112,-70,-32,10]){
    const pt=p(17,z);city.addLamp(pt.x,0.28,pt.z);
  }
}


function unGround(scene,city,m) {
  const p=unPoint,g=groundBuilder(scene,'Siège de l’ONU · jardins et place des visiteurs',p,city,m);
  const { addTree,addBench,addLamp }=city;
  const slab=0.37;
  g.floor(to(p,unPlaza),slab,m.paving,1);
  g.walk([[8,-195],[8,-149],[10,-104],[14,-72],[18,-32],[18,10],[18,63],[21,102],[25,129]],7.2,0.36,2);

  g.floor(to(p,unGarden),0.34,m.lawn);
  g.walk([[13,-186],[27,-175],[62,-170],[99,-161],[111,-139],[105,-122]],4.7,0.389,2);
  g.walk([[28,-128],[62,-131],[96,-142],[111,-139]],3.5,0.397,1);
  g.walk([[26,104],[40,100],[56,94],[65,90]],4.8,0.39,2);
  for(const [i,[x,z]] of [[30,-178],[42,-177],[60,-184],[74,-181],[96,-177],[108,-165],
    [33,-132],[49,-125],[66,-127],[87,-128],[115,-145],[29,70],[37,112],[51,116],[66,112],[88,115]].entries()){
    const pt=p(x,z), y=z>0?slab:0.34;
    plant(addTree,pt,y,i,0.76+(i%5)*0.062);
    if(i%3===0)addLamp(pt.x-1,y,pt.z);
  }
  fountain(g,m,unPool,7.1,slab,false);
  const base=p(74,106);
  g.box(m.stone,base,slab,4.8,0.36,3.6,0.16);
  g.box(m.marble,base,slab+0.36,3.83,0.43,2.57,0.16);
  const loops=[[[73,1.44,106],[75.4,3.65,105.7],[76.9,5.0,104.8],[78.1,3.97,105.8]],
    [[73,1.46,106],[71.8,3.44,107.2],[71.9,4.77,108.2],[73.2,5.51,109.1]]];
  for(const stroke of loops)g.tube(m.bronze,stroke.map(([x,y,z])=>[p(x,z).x,y,p(x,z).z]),0.18,18);
  g.wall(to(p,rectangle(71.6,104.3,76.4,107.7)),slab,1.46);
  for(const z of [-170,-140,-102,-69,-41,18,64,100]){
    const pt=p(31,z);
    addLamp(pt.x,z<-109?0.34:slab,pt.z);
  }
  const benches=[[34,-174,0,0.389],[56,-164,Math.PI,0.389],[91,-142,0,0.389],[31,-45,0,slab],[47,94,0,slab],[77,78,0,slab]]
    .map(([x,z,yaw,y])=>seat(addBench,p,x,z,y,yaw));
  plazaFlags(g,m,p,city);
  wayfinding(g,m,p(22,-72),slab,['NATIONS UNIES','PLACE DES VISITEURS  ·  JARDINS',-Math.PI/2],'#344656');
  g.finish();
  return [
    visit(p,[25,-175],[[28,-174]],benches[0],[[17,-186],[32,-175]],[20,-179]),
    visit(p,[47,-171],[[52,-169]],benches[1],[[43,-171],[62,-170]],[44,-171]),
    visit(p,[63,-131],[[74,-135],[86,-139]],benches[2],[[54,-131],[74,-136]],[60,-131]),
    visit(p,[21,-53],[[26,-49]],benches[3],[[19,-63],[20,-40]],[19,-62]),
    visit(p,[29,102],[[35,102],[42,96]],benches[4],[[23,88],[25,112]],[23,105]),
    watch(p,[62,83],[[67,84]],[74,84],unPool,[[55,83],[67,83]])
  ];
}

function buildManhattanGrounds(scene,city,{ coreOnly = false } = {}) {
  const m=litMaterials();
  const campus = campusGround(scene,city,m);
  return coreOnly ? campus : [...campus,...asphaltGround(scene,city,m),...unGround(scene,city,m)];
}

export { buildManhattanGrounds, litMaterials, pitch, fence, tilted };
