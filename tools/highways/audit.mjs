import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { auditScene } from './audit-scene.mjs';

// Run against a dedicated headless Chrome, never a player's browser. Always create our own page.
const port = Number(process.argv[2] || 9336);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid CDP port');
const output = resolve(process.argv[3] || '/tmp/overdraft-coast-audit');
const host = `http://127.0.0.1:${port}`;
const target = await (await fetch(`${host}/json/new?about:blank`, { method: 'PUT' })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
const pending = new Map();
let sequence = 0;
socket.addEventListener('message', e => {
  const message = JSON.parse(e.data), request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  if (message.error) request.reject(Error(message.error.message)); else request.resolve(message.result);
});
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject, timer: setTimeout(() => {
      pending.delete(id); reject(Error(`${method}: timeout`));
    }, 180000) });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await mkdir(output, { recursive: true });
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await call('Emulation.setFocusEmulationEnabled', { enabled: true });
  await call('Page.addScriptToEvaluateOnNewDocument', { source: 'navigator.getGamepads=()=>[];' });
  await call('Page.navigate', { url: 'http://localhost:5173/?qa=1&quality=high&spawn=fdr&architecte=0' });
  const deadline = Date.now() + 240000;
  while (!await evaluate('!!window.__game&&document.querySelector("#opening-screen")?.dataset.state==="ready"')) {
    if (Date.now() > deadline) throw Error('Game boot timeout');
    await sleep(1000);
  }
  const button = await evaluate(`(()=>{const r=document.querySelector('#play-button').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  for (const type of ['mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, ...button });

  const controllers = await readFile(new URL('../../js/controllers.js', import.meta.url), 'utf8');
  const start = controllers.indexOf('function collisionBody('), end = controllers.indexOf('class ThirdPersonControllerManager');
  if (start < 0 || end <= start) throw Error('Controller collision helper boundaries changed');
  const helpers = controllers.slice(start, end);
  const report = await evaluate(`(async()=>{const {polygonContact}=await import('/js/building-collision.js');${helpers}\nreturn (${auditScene.toString()})({collisionBody,buildingContact});})()`);
  await writeFile(`${output}/audit.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checked: report.checkedSamples, undergroundExcluded: report.undergroundSamples, issues: report.issues.length }));

  // Start on a real northbound lane; teleports prepare each independent test, real input drives the car afterwards.
  await evaluate(`window.__coastPlace=async(west,z)=>{
    const {getIslandBoundsAtZ}=await import('/js/city-config.js');
    const {settleBody}=await import('/js/car-physics.js');
    const shore=getIslandBoundsAtZ(z);let best=null;
    for(const lane of __render.highwayTraffic.lanes)for(let i=1;i<lane.pts.length;i++){
      const a=lane.pts[i-1],b=lane.pts[i];if(b.z>=a.z||z<b.z||z>a.z)continue;
      const t=(z-a.z)/(b.z-a.z),x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;if(y<-.1)continue;
      const distance=Math.abs(x-(west?shore.westX:shore.eastX));
      if(!best||distance<best.distance)best={x,y,z,heading:Math.atan2(b.x-a.x,b.z-a.z),distance};
    }
    if(!best)throw Error('No surface lane');
    const car=__game.car;car.position.set(best.x,best.y,best.z);settleBody(car,best.heading);
    car.prevX=car.position.x;car.prevZ=car.position.z;
    car.mesh.position.copy(car.position);car.mesh.rotation.y=car.heading;car.mesh.updateMatrixWorld(true);
    __game.person.position.copy(car.position);__game.camera.resetForTeleport();__game.camera.initialized=false;
    return best;
  };`);
  const tour = [];
  const stops = [-6980,-6300,-5600,-4900,-4200,-3500,-2800,-2100,-1400,-700,0,700,1400,2100,2544,3000,3700,4240,4700,5300,5750,5920];
  for (const west of [true,false]) for (const z of stops) {
    const name = `${west ? 'west' : 'east'}-${z}`;
    const start = await evaluate(`__coastPlace(${west},${z})`);
    await sleep(300);
    await call('Input.dispatchKeyEvent', { type:'keyDown', code:'KeyW', key:'z', windowsVirtualKeyCode:90 });
    await sleep(1600);
    await call('Input.dispatchKeyEvent', { type:'keyUp', code:'KeyW', key:'z', windowsVirtualKeyCode:90 });
    const state = await evaluate('({position:__game.car.position,speed:__game.car.speed,active:__game.active})');
    const { data } = await call('Page.captureScreenshot', { format:'jpeg', quality:85 });
    await writeFile(`${output}/${name}.jpg`, Buffer.from(data,'base64'));
    tour.push({name,start,...state});
    await writeFile(`${output}/tour.json`, JSON.stringify(tour,null,2));
    console.log(name, JSON.stringify(state));
  }
  const shoreTests = [];
  for (const [west,z] of [[true,6002],[true,6015],[false,6152],[false,6165],[true,6100],[false,6200],[true,6350],[false,6505]]) {
    const name = `railing-${west?'west':'east'}-${z}`;
    const start = await evaluate(`(async()=>{
      const {MANHATTAN_COASTLINE:C}=await import('/js/city-config.js');
      const {settleBody}=await import('/js/car-physics.js');
      let area=0;for(let i=0;i<C.length;i++){const a=C[i],b=C[(i+1)%C.length];area+=a.x*b.z-b.x*a.z;}
      let best=null;
      for(let i=0;i<C.length;i++){
        const a=C[i],b=C[(i+1)%C.length];if(a.z===b.z||${z}<Math.min(a.z,b.z)||${z}>Math.max(a.z,b.z))continue;
        const t=(${z}-a.z)/(b.z-a.z),x=a.x+(b.x-a.x)*t,len=Math.hypot(b.x-a.x,b.z-a.z);
        const sign=area>0?1:-1,ox=sign*(b.z-a.z)/len,oz=-sign*(b.x-a.x)/len;
        if(!best||(${west}?x<best.x:x>best.x))best={x,z:${z},ox,oz};
      }
      const car=__game.car;car.position.set(best.x-best.ox*10,0,best.z-best.oz*10);
      settleBody(car,Math.atan2(best.ox,best.oz));car.prevX=car.position.x;car.prevZ=car.position.z;
      car.mesh.position.copy(car.position);car.mesh.rotation.y=car.heading;car.mesh.updateMatrixWorld(true);
      __game.person.position.copy(car.position);__game.camera.resetForTeleport();__game.camera.initialized=false;
      return best;
    })()`);
    await sleep(300);
    await call('Input.dispatchKeyEvent', { type:'keyDown', code:'KeyW', key:'z', windowsVirtualKeyCode:90 });
    await sleep(3000);
    await call('Input.dispatchKeyEvent', { type:'keyUp', code:'KeyW', key:'z', windowsVirtualKeyCode:90 });
    await sleep(800); // Let the impact settle after releasing the throttle.
    const state = await evaluate('({position:__game.car.position,speed:__game.car.speed,active:__game.active})');
    const outward = (state.position.x-start.x)*start.ox+(state.position.z-start.z)*start.oz;
    const taper = Math.min(1, Math.max(0, (z-(west?6000:6150))/30));
    const railOutward = (west?-5.8:5.8)*start.ox*(1-taper)-.6*taper;
    const stopped = outward < railOutward-1 && outward > -8 && state.position.y > -.3 && Math.abs(state.speed)<1;
    shoreTests.push({name,start,...state,outward,railOutward,stopped});
    const { data } = await call('Page.captureScreenshot', { format:'jpeg', quality:85 });
    await writeFile(`${output}/${name}.jpg`, Buffer.from(data,'base64'));
    await writeFile(`${output}/railings.json`, JSON.stringify(shoreTests,null,2));
    console.log(name, JSON.stringify({ ...state, outward, stopped }));
  }
} finally {
  try { await call('Page.close'); } finally { socket.close(); }
}
