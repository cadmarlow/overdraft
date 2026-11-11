// Executed inside an isolated QA page by audit.mjs. Collider helpers come from the current controllers.js source.
export async function auditScene({ collisionBody, buildingContact }) {
const {getIslandBoundsAtZ}=await import('/js/city-config.js');
const {THREE,cityGrid,highwayTraffic}=__render, ctrl=__game.controllers;
const cells=new Map(), CELL=64;let triangles=0;
const v=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()];
cityGrid.group.updateMatrixWorld(true);
cityGrid.group.traverse(o=>{
 if(!o.isMesh||o.isInstancedMesh||o.material?.transparent)return;
 const g=o.geometry,p=g.attributes.position;if(!p)return;const idx=g.index,N=idx?idx.count:p.count;
 for(let i=0;i<N;i+=3){
 for(let k=0;k<3;k++)v[k].fromBufferAttribute(p,idx?idx.getX(i+k):i+k).applyMatrix4(o.matrixWorld);
 const[a,b,c]=v,minY=Math.min(a.y,b.y,c.y),maxY=Math.max(a.y,b.y,c.y);
 if(minY>12||maxY<.065)continue;
 const D=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);if(Math.abs(D)<.001)continue;
 const xmin=Math.min(a.x,b.x,c.x),xmax=Math.max(a.x,b.x,c.x),zmin=Math.min(a.z,b.z,c.z),zmax=Math.max(a.z,b.z,c.z);
 const t={a:a.toArray(),b:b.toArray(),c:c.toArray(),D,minY,maxY,name:o.name,mat:o.material.name};triangles++;
 for(let x=Math.floor(xmin/CELL);x<=Math.floor(xmax/CELL);x++)for(let z=Math.floor(zmin/CELL);z<=Math.floor(zmax/CELL);z++){const key=x+','+z;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(t);}
 }
});
function visibleHeight(x,z,y){let result=null;for(const t of cells.get(Math.floor(x/CELL)+','+Math.floor(z/CELL))||[]){if(t.minY>y+3.5||t.maxY<y+.07)continue;const{a,b,c,D}=t,u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/D,w=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/D;if(u<1e-5||w<1e-5||u+w>1-1e-5)continue;const h=u*a[1]+w*b[1]+(1-u-w)*c[1];if(h>y+.07&&h<y+3.5&&(!result||h>result.h))result={h,name:t.name,mat:t.mat};}return result;}
const issues=[],groups=new Map();let samples=0,coastalStreetSamples=0,undergroundSamples=0;
function issue(type,x,y,z,data){const id=type+':'+Math.round(x/25)+','+Math.round(z/25);const old=groups.get(id);if(old){old.count++;return;}const q={type,x,y,z,count:1,...data};groups.set(id,q);issues.push(q);}
function check(x,y,z,yaw,kind){samples++;if(y<-.1){undergroundSamples++;return;}const b=collisionBody('car',1.3,yaw,0,1.3,3.6);b.top=3.5;
 for(const c of ctrl.nearColliders(x,z,4)){if(buildingContact(c,x,y,z,b))issue('collider',x,y,z,{kind,roof:!!c.roof,obstacle:c.obstacle,bounds:[c.minX,c.maxX,c.minZ,c.maxZ],maxY:c.maxY});}
 ctrl._groundVehicleY=y;const hit={};ctrl.carGround(x,z,hit);ctrl._groundVehicleY=undefined;
 if(Math.abs(hit.y-y)>.13)issue('ground',x,y,z,{kind,ground:hit.y});
 const top=visibleHeight(x,z,y);if(top)issue('surface',x,y,z,{kind,...top});
}
for(let lane=0;lane<highwayTraffic.lanes.length;lane++){const l=highwayTraffic.lanes[lane];for(let i=1;i<l.pts.length;i++){const a=l.pts[i-1],b=l.pts[i],N=Math.max(1,Math.ceil(a.distanceTo(b)/2)),yaw=Math.atan2(b.x-a.x,b.z-a.z);for(let k=0;k<N;k++){const t=k/N;check(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t,yaw,'highway');}}}
for(const e of __game.traffic.network.edges){const ex=e.sx+e.dx*e.len,ez=e.sz+e.dz*e.len;const sh=getIslandBoundsAtZ((e.sz+ez)/2);if(Math.min(Math.abs((e.sx+ex)/2-sh.westX),Math.abs((e.sx+ex)/2-sh.eastX))>250)continue;for(const o of e.lanes)for(let s=4;s<e.len-4;s+=4){const x=e.sx+e.dx*s+e.rx*o,z=e.sz+e.dz*s+e.rz*o;check(x,0,z,Math.atan2(e.dx,e.dz),'street');coastalStreetSamples++;}}return{triangles,samples,checkedSamples:samples-undergroundSamples,undergroundSamples,coastalStreetSamples,issues};

}
