import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { HIGHWAY_ROUTES, highwayX, highwayCorridor, highwayScale } from '../js/highway-layout.js';
import { routeHighway } from '../tools/highways/routing.mjs';
import { polygonBoxOverlaps } from '../js/building-collision.js';
import { createRoadCorridor, subtractRoadQuad } from '../js/road-corridor.js';
import { createGroundSurfaces } from '../js/ground-surfaces.js';

const rect = (a,b,c,d) => [{x:a,z:c},{x:b,z:c},{x:b,z:d},{x:a,z:d}];

test('corridor search chooses a continuous bypass instead of stopping traffic at a facade', () => {
  const rows=Array.from({length:121},(_,i)=>({z:i*3,west:false,preferred:80}));
  const b={minX:72,maxX:100,minZ:150,maxZ:190,polygons:[{outer:rect(72,100,150,190),holes:[]}]};
  const path=routeHighway(rows,[b],()=>({westX:0,eastX:110}),{reach:110});
  assert.equal(path.length,rows.length);
  assert.ok(path.find(p=>p.z===171).x<=63);
  for(const p of path)assert.equal(polygonBoxOverlaps(b.polygons[0],p.x,p.z,7.6,1.5),false);
  assert.ok(path.every((p,i)=>!i||Math.abs(p.x-path[i-1].x)<5));
  assert.throws(()=>routeHighway(rows,[{...b,minX:0,polygons:[{outer:rect(0,110,150,190),holes:[]}]}],()=>({westX:0,eastX:110}),{reach:110}),/No continuous/);
});

test('both complete highway alignments clear surveyed buildings with a van body at every metre', async () => {
  const fetchBefore=globalThis.fetch;
  let buildings;
  try { globalThis.fetch=async u=>new Response(readFileSync(new URL(u))); ({REAL_BUILDINGS:buildings}=await import('../js/building-geodata.js')); }
  finally { globalThis.fetch=fetchBefore; }
  const cells=new Map();
  for(const b of buildings)for(let z=Math.floor(b.minZ/32);z<=Math.floor(b.maxZ/32);z++){
    if(!cells.has(z))cells.set(z,[]);cells.get(z).push(b);
  }
  assert.equal(HIGHWAY_ROUTES.length,2);
  for(const r of HIGHWAY_ROUTES){
    assert.ok(r.x.length>4000,'no road segments are deleted');
    for(let i=1;i<r.x.length;i++){
      const z=r.z0+(i-1)*r.step;
      const near=new Set();
      for(let k=Math.floor((z-5)/32);k<=Math.floor((z+8)/32);k++)for(const b of cells.get(k)||[])
        if(b.maxX>Math.min(r.x[i-1],r.x[i])-24&&b.minX<Math.max(r.x[i-1],r.x[i])+24)near.add(b);
      if(!near.size)continue;
      for(const offset of [-5.55,-2.25,2.25,5.55])for(let k=0;k<=3;k++){
        const scaleA = r.west || z <= 4250 ? highwayScale(r.west,z) : 1, scaleB = r.west || z + 3 <= 4250 ? highwayScale(r.west,z+3) : 1;
        const ax = r.x[i-1] + offset * scaleA, bx = r.x[i] + offset * scaleB, dx = bx - ax;
        const len = Math.hypot(dx,3), cs = 3 / len, sn = dx / len;
        const x=ax+dx*k/3,at=z+k;
        for(const b of near){
          if(b.minZ>at+5||b.maxZ<at-5)continue;
          assert.ok(!b.polygons.some(p=>polygonBoxOverlaps(p,x,at,1.3,3.6,cs,sn)),`${r.west?'west':'east'} x=${x} z=${at}`);
        }
      }
    }
  }
  const reported=buildings.find(b=>b.minX===1315.5&&b.minZ===886.5);
  assert.ok(reported,'keep the surveyed building intact');
  for(let z=885;z<=961;z++)assert.ok(highwayX(false,z)+7.6<reported.maxX);
  assert.ok(highwayX(false,923)<1310,'the road now passes inland of the building');
});

test('terrain subtraction preserves attributes and removes only the carriageway', () => {
  const q=[[-2,0,-20],[2,0,-20],[2,0,20],[-2,0,20]];
  const triangle=[[-10,.22,-10,0],[10,.22,-10,20],[0,.22,10,10]];
  const pieces=subtractRoadQuad(triangle,q);
  const area=p=>Math.abs(p.reduce((a,v,i)=>{const w=p[(i+1)%p.length];return a+v[0]*w[2]-w[0]*v[2]},0)/2);
  assert.equal(pieces.length,2);
  assert.ok(Math.abs(pieces.reduce((a,p)=>a+area(p),0)-128)<1e-8);
  for(const p of pieces)for(const v of p){assert.ok(Math.abs(v[0])>=2-1e-8);assert.equal(v[1],.22);assert.ok(Math.abs(v[3]-v[0]-10)<1e-8);}
  assert.deepEqual(subtractRoadQuad([[0,0,0],[1,0,0],[1,0,1]],q),[]);
});

test('wheels and terrain share the exact curved reservation; decks remain solid beyond the shore', () => {
  const road=createRoadCorridor([{west:true,z0:0,step:10,x:[0,10,10]}],3),ground=createGroundSurfaces(),hit={};
  ground.add(rect(-30,30,-30,30),.22);
  ground.setRoadCorridor(road);
  assert.ok(ground.sample(5,5,hit));assert.equal(hit.y,0);assert.equal(hit.curb,false);
  ground.sample(12,5,hit);assert.equal(hit.y,.22);
  const waterDeck=createGroundSurfaces();
  waterDeck.add(rect(100,120,0,20),.12,{deck:true,curb:false});
  waterDeck.add(rect(100,120,0,20),7.6,{deck:true,curb:false});
  waterDeck.sample(110,10,hit,1);assert.equal(hit.y,.12);assert.equal(hit.deck,true);
  waterDeck.sample(110,10,hit,8);assert.equal(hit.y,7.6);
  assert.equal(waterDeck.sample(121,10,hit),false,'no invisible platform outside the visible deck');
  for(let z=860;z<=1050;z+=3)assert.ok(highwayCorridor.contains(highwayX(false,z)+5.55*highwayScale(false,z),z));
});

test('highway drivers prepare for a bend at a finite rolling speed and keep cruising on a straight', async () => {
  const {highwaySpeedProfile}=await import('../js/highway-driving.js');
  const points=Array.from({length:51},(_,i)=>({x:0,z:i*2}));
  for(let i=1;i<=24;i++){const t=i/24*Math.PI/2;points.push({x:15-15*Math.cos(t),z:100+15*Math.sin(t)});}
  for(let i=1;i<=50;i++)points.push({x:15+i*2,z:115});
  const distances=[0];for(let i=1;i<points.length;i++)distances.push(distances.at(-1)+Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z));
  const speed=highwaySpeedProfile(points,distances,17.5);
  assert.equal(speed[0],17.5);
  assert.ok(speed[48]<10,'brakes before the turn');
  assert.ok(speed[60]<7&&speed[60]>4,'turns without stopping');
  assert.equal(speed.at(-1),17.5);
  for(let i=1;i<speed.length;i++)assert.ok(speed[i-1]**2<=speed[i]**2+2*2.8*(distances[i]-distances[i-1])+1e-4);
});

test('authored pier headhouses clear the carriageway without moving their seaward end', async () => {
  const { fitPierToRoad } = await import('../js/road-corridor.js');
  const { highwayGroundCut } = await import('../js/highway-layout.js');
  const { WATERFRONT_PIERS, getIslandBoundsAtZ } = await import('../js/city-config.js');
  let adjusted = 0;
  for (const p of WATERFRONT_PIERS) {
    const west = p.side === 'west', shore = z => getIslandBoundsAtZ(z)[west ? 'westX' : 'eastX'];
    let dx = Math.cos(p.angle), dz = Math.sin(p.angle);
    const out = (x, z) => west ? shore(z) - x : x - shore(z);
    if (out(p.cx + dx * p.length / 2, p.cz + dz * p.length / 2) < out(p.cx - dx * p.length / 2, p.cz - dz * p.length / 2)) { dx = -dx; dz = -dz; }
    const x = p.cx - dx * p.length / 2, z = p.cz - dz * p.length / 2;
    const r = fitPierToRoad(highwayGroundCut, { x, z, dx, dz, length: p.length, halfWidth: p.width / 2 });
    assert.ok(Math.abs(r.x + dx * r.length - x - dx * p.length) < 1e-8);
    assert.ok(Math.abs(r.z + dz * r.length - z - dz * p.length) < 1e-8);
    for (const q of highwayGroundCut.query(r.x - p.length, r.x + p.length, r.z - p.length, r.z + p.length)) {
      const polygon = { outer: q.poly.map(v => ({ x: v[0], z: v[2] })), holes: [] };
      assert.equal(polygonBoxOverlaps(polygon, r.x + dx * r.length / 2, r.z + dz * r.length / 2, p.width / 2 + 1, r.length / 2 + 1, dz, dx), false, p.name);
    }
    if (r.setback) adjusted++;
  }
  assert.equal(adjusted, 2, 'Chelsea Pier 59 and Canal Street Pier 34');
  const small = fitPierToRoad(createRoadCorridor([]), { x: 0, z: 0, dx: 1, dz: 0, length: 10, halfWidth: 2 });
  assert.equal(small.length, 10);
});

test('a mixed pier batch keeps its tall structure while removing the low slab across a road', async () => {
  const THREE = await import('../vendor/three/build/three.core.js');
  const { loadModule } = await import('./helpers/module.cjs');
  const { cutRoadGround } = loadModule(readFileSync(new URL('../js/road-ground-cut.js', import.meta.url), 'utf8'), {
    imports: { 'three/webgpu': THREE, './road-corridor.js': { subtractRoadQuad } }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -10,.12,-10, 10,.12,-10, 0,.12,10,
    -10,8,-10, 10,8,-10, 0,8,10,
    -10,-3,-10, 10,-3,-10, 0,-3,10
  ], 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()), group = new THREE.Group();
  group.add(mesh);
  const corridor = createRoadCorridor([{west:true,z0:-20,step:40,x:[0,0]}],2);
  assert.equal(cutRoadGround(group, corridor), 1);
  const pos = mesh.geometry.attributes.position;
  let high = 0, lowArea = 0, piles = 0;
  for (let i=0;i<pos.count;i+=3) {
    const y=pos.getY(i);
    if(y>1) high++; else if(y<0) piles++; else {
      const xs=[0,1,2].map(k=>pos.getX(i+k));
      assert.ok(xs.every(x=>x<=-2+1e-6)||xs.every(x=>x>=2-1e-6));
      lowArea+=Math.abs((pos.getX(i+1)-pos.getX(i))*(pos.getZ(i+2)-pos.getZ(i))-(pos.getX(i+2)-pos.getX(i))*(pos.getZ(i+1)-pos.getZ(i)))/2;
    }
  }
  assert.equal(high,1); assert.equal(piles,1); assert.ok(Math.abs(lowArea-128)<1e-5);
});

test('a shallow highway ramp replaces the old sidewalk but does not pull cars onto an overhead deck', () => {
  for (const reverse of [false,true]) {
    const ground = createGroundSurfaces(), hit = {}, poly = rect(0,20,0,20);
    const addWalk = () => ground.add(poly,.22), addRoad = () => ground.add(poly,.04,{curb:false,deck:true,road:true});
    for (const add of reverse ? [addRoad,addWalk] : [addWalk,addRoad]) add();
    ground.add(poly,7.6,{curb:false,deck:true,road:true});
    ground.sample(10,10,hit,1); assert.equal(hit.y,.04); assert.equal(hit.curb,false);
    ground.sample(10,10,hit,8); assert.equal(hit.y,7.6);
  }
});

test('worksite containers and their cones can occupy parking but never a traffic lane', async () => {
  const { overlapsTrafficLanes } = await import('../js/road-corridor.js');
  const e = { sx:0, sz:0, dx:0, dz:1, rx:1, rz:0, len:80, lanes:[2,5.5] };
  assert.equal(overlapsTrafficLanes({outer:rect(7.2,9.4,10,18),holes:[]},[e]),false);
  assert.equal(overlapsTrafficLanes({outer:rect(6.8,9,10,18),holes:[]},[e]),true,'a corner of the container blocks the outer lane');
  assert.equal(overlapsTrafficLanes({outer:rect(1.9,2.1,-3,-2),holes:[]},[e]),true,'the van nose reaches beyond the stopline');
  const diagonal={sx:10,sz:20,dx:Math.SQRT1_2,dz:Math.SQRT1_2,rx:Math.SQRT1_2,rz:-Math.SQRT1_2,len:50,lanes:[0]};
  assert.equal(overlapsTrafficLanes({outer:rect(30,32,40,42),holes:[]},[diagonal]),true);
  assert.equal(overlapsTrafficLanes({outer:rect(30,32,20,22),holes:[]},[diagonal]),false);
});

test('the island-wide seawall below the asphalt remains intact during road subtraction', async () => {
  const THREE = await import('../vendor/three/build/three.core.js');
  const { loadModule } = await import('./helpers/module.cjs');
  const { cutRoadGround } = loadModule(readFileSync(new URL('../js/road-ground-cut.js', import.meta.url), 'utf8'), {
    imports: { 'three/webgpu': THREE, './road-corridor.js': { subtractRoadQuad } }
  });
  const geometry = new THREE.BoxGeometry(6000,2.31,14000).translate(0,-1.195,0);
  const mesh = new THREE.Mesh(geometry,new THREE.MeshBasicMaterial()),group = new THREE.Group();group.add(mesh);
  const corridor=createRoadCorridor([{west:true,z0:-7000,step:14000,x:[0,0]}]);
  assert.equal(cutRoadGround(group,corridor),0);
  assert.equal(mesh.geometry,geometry,'do not fragment the supporting seawall under the whole island');
});

test('Battery railings join both esplanades without a lateral opening and preserve access gaps', async () => {
  const { southernShoreRails } = await import('../js/highway-shore.js');
  const rails=southernShoreRails(rect(0,100,5900,6600),()=>({westX:0,eastX:100}),(x,z)=>x>50&&z>6400&&z<6420);
  const points=rails.flatMap(([x,z,bx,bz])=>[[x,z],[bx,bz]]);
  assert.ok(points.some(([x,z])=>Math.abs(x+5.8)<1e-8&&z===6000));
  assert.ok(points.some(([x,z])=>Math.abs(x-105.8)<1e-8&&z===6150));
  for(const [x,z,bx,bz] of rails){
    assert.ok(Math.hypot(x-bx,z-bz)<8,'no long connector across the promenade');
    assert.ok(!((x+bx)/2>99&&(z+bz)/2>6400&&(z+bz)/2<6420),'ferry gap');
  }
});
