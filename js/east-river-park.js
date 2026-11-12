import * as THREE from 'three/webgpu';
import { groundRailColliders } from './ground-surfaces.js';
import { groundBuilder, plant, seat, visit, watch, wayfinding } from './urban-places.js';
import { litMaterials, tilted, pitch, fence } from './manhattan-grounds.js';
import { riverBridge, riverLimits, riverPoint, riverSpan, riverPromenade, riverStage } from './manhattan-sites-plan.js';

const bank = (x,z) => ({ x,z });
const WALK = 0.385;
const lerp = (a,b,t) => a + (b-a)*t;


function bankBand(g, city, m, z0, z1, fractions, h, mat) {
  const position=[], indices=[];
  const n=Math.ceil((z1-z0)/6);
  for(let i=0;i<=n;i++){
    const z=lerp(z0,z1,i/n);
    for(const fraction of fractions)position.push({ ...riverPoint(fraction,z), y:h });
    if(i>0){
      const k=i*2;
      indices.push(k-2,k,k+1,k-2,k+1,k-1);
    }
  }
  tilted(g,city.ground,position,indices,mat,0,{ grip:mat===m.lawn?0.67:0.92,rough:0.012 });
}

function bridge(g, city, m) {
  const { westLanding,westDeck,eastDeck,eastLanding,y,width }=riverBridge;
  const knots=[{...westLanding,y:0.32},{...westDeck,y},{...eastDeck,y},{...eastLanding,y:WALK}];
  const offsets=knots.map((p,i)=>{
    const a=knots[Math.max(0,i-1)],b=knots[Math.min(knots.length-1,i+1)];
    const n=width/2/Math.hypot(b.x-a.x,b.z-a.z);
    return [-(b.z-a.z)*n,(b.x-a.x)*n];
  });
  for(let i=1;i<knots.length;i++){
    const a=knots[i-1],b=knots[i], u=offsets[i-1],v=offsets[i];
    const vertices=[
      {x:a.x+u[0],y:a.y,z:a.z+u[1]},{x:b.x+v[0],y:b.y,z:b.z+v[1]},
      {x:b.x-v[0],y:b.y,z:b.z-v[1]},{x:a.x-u[0],y:a.y,z:a.z-u[1]}
    ];
    tilted(g,city.ground,vertices,[0,1,2,0,2,3],m.paving,1,{deck:true,overpass:true});
    const dist=Math.hypot(b.x-a.x,b.z-a.z), count=Math.ceil(dist/2.7);
    for(const side of [-1,1]){
      for(let j=0;j<count;j++){
        const t=j/count,s=(j+1)/count;
        const at=(k)=>[lerp(a.x+u[0]*side,b.x+v[0]*side,k),lerp(a.y,b.y,k),lerp(a.z+u[1]*side,b.z+v[1]*side,k)];
        const [x0,y0,z0]=at(t),[x1,y1,z1]=at(s);
        for(const h of [-0.28,0.52,1.12])g.tube(h<0?m.stone:m.iron,[[x0,y0+h,z0],[x1,y1+h,z1]],h<0?0.22:0.039,2);
        g.box(m.iron,bank(x0,z0),y0,0.069,1.18,0.069);
        for(let k=1;k<=6;k++){
          const [px,py,pz]=at(lerp(t,s,k/7));
          g.box(m.iron,bank(px,pz),py,0.021,1.13,0.025);
        }
        city.colliders.push(...groundRailColliders([[x0,z0,x1,z1]],Math.min(y0,y1),Math.abs(y1-y0)+1.19,0.08));
      }
    }
  }
  for(const [x,z] of [[2147,2557],[2178,2557],[2232,2574],[2245,2609]]){
    const t=x<2195?(x-westLanding.x)/(westDeck.x-westLanding.x):(z-eastDeck.z)/(eastLanding.z-eastDeck.z);
    const h=x<2195?lerp(0.32,y,t):lerp(y,WALK,t);
    g.box(m.stone,bank(x,z),0,1.02,h,1.39);
    g.wall([bank(x-.51,z-.69),bank(x+.51,z-.69),bank(x+.51,z+.69),bank(x-.51,z+.69)],0,h-.34);
  }
  wayfinding(g,m,bank(2130,2553.3),0.25,['EAST RIVER PARK','PASSERELLE  ·  10e RUE',-Math.PI/2],'#31515a');
}

function stage(g, city, m) {
  const p=(x,z)=>bank(riverStage.x+x,riverStage.z+z);
  g.rect(-15,11,15,25,0.88,m.paving,2);
  g.box(m.marble,p(0,17.75),0.34,30,0.54,13.6);
  g.box(m.dark,p(0,23.1),0.88,26.3,4.8,1.22);
  g.wall([p(-13.2,22.5),p(13.2,22.5),p(13.2,23.8),p(-13.2,23.8)],0.88,5.68);
  for(const x of [-12.5,-7.5,-2.5,2.5,7.5,12.5]) {
    g.box(m.wood,p(x,22.45),0.88,0.14,4.55,0.16);
    g.box(m.iron,p(x,14.2),0.88,0.12,4.85,0.12);
  }
  const angles=Array.from({length:27},(_,i)=>Math.PI*0.12+i*Math.PI*0.76/26);
  for(let row=0;row<10;row++){
    const radius=11.2+row*1.38, y=WALK+row*0.125;
    for(let i=1;i<angles.length;i++){
      const a=angles[i-1],b=angles[i],run=(r,t)=>p(Math.cos(t)*r,12-Math.sin(t)*r);
      const verts=[run(radius,a),run(radius+1.34,a),run(radius+1.34,b),run(radius,b)].map(v=>({...v,y}));
      tilted(g,city.ground,verts,[0,1,2,0,2,3],m.paving,1);
      if(i>11&&i<16||i<3||i>24)continue;
      g.rail(row%3===0?m.wood:m.marble,run(radius+0.78,a),run(radius+0.78,b),y+0.21,0.25,0.37);
    }
  }
  for(const x of [-16.8,16.8]){
    const pt=p(x,8);city.addLamp(pt.x,WALK,pt.z);
  }
  return { p };
}

function riverPlayground(g,m,city) {
  const p=(x,z)=>{
    const spot=riverPoint(0.45,3650);
    return bank(spot.x+x,spot.z+z);
  };
  g.rect(-14,-19,14,16,0.419,m.track);
  g.rect(-12.8,-17.8,12.8,14.8,0.427,m.sand);
  for(const x of [-7.1,-1.25])for(const z of [-8.9,-2.9]){
    g.box(m.glassBlue,p(x,z),0.427,0.15,3.35,0.15);
    g.box(m.wood,p(x,z),3.42,0.52,0.15,0.52);
  }
  g.box(m.wood,p(-4.18,-5.92),2.29,6.05,0.18,6.1);
  g.box(m.glassBlue,p(-4.18,-5.92),3.69,6.43,0.23,6.52);
  for(let i=0;i<8;i++)g.box(m.wood,p(-4.18,-0.5+i*0.43),2.26-i*0.23,2.31,0.14,0.44);
  g.wall([p(-7.28,-9.1),p(-1.08,-9.1),p(-1.08,-2.65),p(-7.28,-2.65)],0.427,3.94);
  for(const z of [-9.2,1.8])for(const x of [4.4,8.9]){
    g.tube(m.iron,[[p(x+(x<6?-1.2:1.2),z).x,0.427,p(x,z).z],[p(6.62,z).x,3.42,p(x,z).z]],0.08,4);
  }
  g.tube(m.iron,[[p(6.62,-9.2).x,3.42,p(6.62,-9.2).z],[p(6.62,1.8).x,3.42,p(6.62,1.8).z]],0.091,4);
  for(const z of [-6.3,-2.2]) {
    const base=p(6.62,z);
    for(const side of [-1,1])g.tube(m.iron,[[base.x,3.41,base.z+side*.4],[base.x+0.17,0.91,base.z+side*.4]],0.018,4);
    g.box(m.glassBlue,{x:base.x+0.17,z:base.z},0.88,0.39,0.08,0.89);
  }
  for(const x of [-12.6,11.9]){
    const pt=p(x,11);city.addLamp(pt.x,0.43,pt.z);
  }
}

function buildEastRiverPark(scene,city) {
  const m=litMaterials(),g=groundBuilder(scene,'East River Park · Promenade, terrains et passerelle',bank,city,m);
  const [z0,z1]=riverLimits;
  for(const [a,b] of [[2358,2730],[2730,3085],[3425,3690],[3690,3890],[3890,4165]])bankBand(g,city,m,a,b,[0.06,0.97],0.33,m.lawn);
  const promenadePoints=Array.from({length:Math.ceil((z1-z0)/8)+1},(_,i)=>riverPromenade(Math.min(z1,z0+i*8)));
  g.walk(promenadePoints,4.6,WALK,2);
  bridge(g,city,m);
  const {p}=stage(g,city,m);
  riverPlayground(g,m,city);
  const fieldCenter=riverPoint(0.46,3810);
  const field=(x,z)=>bank(fieldCenter.x+x,fieldCenter.z+z);
  pitch(g,m,field,-24,-49,24,44,0.414);
  for(const [a,b] of [[[-24,-49],[24,-49]],[[24,-49],[24,44]],[[24,44],[-24,44]],[[-24,44],[-24,13]],[[-24,7],[-24,-49]]]){
    fence(g,m,city,field(...a),field(...b),0.41,2.55);
  }
  const picnic=[];
  for(let i=0,z=2365;z<4160;z+=25,i++){
    const {width}=riverSpan(z);
    if(width<13)continue;
    const point=riverPoint(0.22,z), facing=1.2;
    const fieldKeep=(z>3755&&z<3865)||(z>3627&&z<3673)||(z>4020&&z<4085);
    if(!fieldKeep)plant(city.addTree,point,0.33,i,0.68+(i%5)*0.087);
    if(i%3===0){
      const [x]=riverPromenade(z);
      city.addLamp(x-2.4,WALK,z);
    }
    if(!fieldKeep&&i%5===0){
      const point=riverPoint(0.57,z+6);
      g.floor([bank(point.x-2,point.z-1.65),bank(point.x+2,point.z-1.65),bank(point.x+2,point.z+1.65),bank(point.x-2,point.z+1.65)],0.405,m.paving,1);
      picnic.push(seat(city.addBench,bank,point.x,point.z,0.405,facing));
    }
  }
  const lower=seat(city.addBench,p,15,-5,WALK,0.82);
  const fieldSeat=seat(city.addBench,field,27,17,WALK,-Math.PI/2);
  wayfinding(g,m,bank(...riverPromenade(3855)),WALK,['EAST RIVER PARK','TERRAINS  ·  AMPHITHÉÂTRE',Math.PI],'#31515a');
  g.finish();
  const stops=[
    visit(p,[20,-12],[[18,-10],[16,-7]],lower,[[20,-22],[19,-10]],[20,-15]),
    visit(field,[28,27],[[28,22]],fieldSeat,[[28,14],[28,37]],[28,31]),
    watch(p,[18,-6],[[17,-2]],[16,2],p(0,14),[[18,-12],[18,2]])
  ];
  for(const s of picnic){
    const [x,z]=riverPromenade(s.z+8);
    stops.push(visit(bank,[x,z],[[x,s.z]],s,[riverPromenade(z-12),riverPromenade(z+12)],riverPromenade(z+5)));
  }
  return stops;
}

export { buildEastRiverPark };
