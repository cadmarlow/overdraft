const {chromium}=require('/opt/codex/cua_node/lib/node_modules/playwright-core');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const server=http.createServer((req,res)=>{const target=path.join(process.cwd(),decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.gz':'application/octet-stream','.md':'text/plain'};fs.readFile(target,(err,data)=>{if(err){res.writeHead(404);res.end('Not found');return}res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream'});res.end(data)});});await new Promise(resolve=>server.listen(8010,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--allow-file-access-from-files','--enable-unsafe-webgpu','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-dev-shm-usage','--disable-gpu-sandbox','--disable-gpu-watchdog']});
 const page=await browser.newPage({viewport:{width:800,height:600}});page.setDefaultTimeout(180000);
 await page.addInitScript(()=>{window.__retainedGPU=navigator.gpu;const gpu=navigator.gpu;if(gpu){const original=gpu.requestAdapter.bind(gpu);gpu.requestAdapter=async function(o){const adapter=await original(o);window.__retainedAdapter=adapter;return adapter;}}});
 page.on('console',m=>{if(m.type()==='error'||m.type()==='warn'||m.text().includes('[init]'))console.log(m.type(),m.text().slice(0,700))});
 page.on('pageerror',e=>console.log('PAGEERROR',e.message));
 await page.goto('http://127.0.0.1:8010/?qa&quality=performance');
 let done=false;
 for(let i=0;i<48;i++){
  await page.waitForTimeout(3000);const status=await page.locator('#loading-status').textContent();console.log('LOAD',status);
  if(status.includes('Impossible')||status.includes('interrompu'))break;
  if(await page.locator('#loading-overlay').evaluate(e=>e.classList.contains('hidden'))){done=true;break;}
 }
console.log('READY',done);
 if(done){
  await page.evaluate(()=>{window.__playground.qaFrozen=true;});
  await page.bringToFront();await page.locator('#play-button').click({timeout:30000});
  console.log('START',await page.evaluate(()=>({active:window.__playground.active,paused:window.__playground.paused})));
  const step=async(seconds)=>page.evaluate(seconds=>{const g=window.__playground;for(let i=0;i<Math.ceil(seconds*60);i++){g.beforeUpdate(1/60);g.controllers.update(1/60,g.clock,g.controllers.getActiveEntity().position);g.camera.update(1/60,g.clock);g.update(1/60);}},seconds);
  console.log('ON_FOOT',await page.evaluate(()=>{const g=window.__playground,p=g.controllers.entities.person;return {state:g.state,position:p.position,cam:g.camera.currentPos,rig:{x:p.rig.x,z:p.rig.z,speed:p.rig.speed},meshes:p.crowd.meshes.map(m=>({count:m.count,visible:m.visible}))}}));
  await page.keyboard.press('f');await step(1.7);
  console.log('ENTRY',await page.evaluate(()=>({state:window.__playground.state,inside:window.__playground.controllers.entities.person.inVehicle})));
  if(await page.evaluate(()=>window.__playground.state)!=='driving')throw Error('Vehicle entry failed');
  await page.keyboard.down('w');await step(1.5);await page.keyboard.up('w');
  const driving=await page.evaluate(()=>({speed:window.__playground.controllers.entities.car.speed,distance:window.__playground.distance}));console.log('DRIVE',driving);if(driving.speed<1)throw Error('Acceleration failed');
  await page.keyboard.press('f');if(await page.evaluate(()=>window.__playground.state)!=='driving')throw Error('Unsafe vehicle exit was allowed');
  await page.keyboard.down('s');await step(0.9);await page.keyboard.up('s');
  await page.evaluate(()=>{const c=window.__playground.controllers.entities.car;c.speed=c.vx=c.vz=c.angularVel=0});
  await page.keyboard.press('f');await step(1.3);
  const exited=await page.evaluate(()=>({state:window.__playground.state,inside:window.__playground.controllers.entities.person.inVehicle,position:window.__playground.controllers.entities.person.position}));console.log('EXIT',exited);if(exited.state!=='onFoot'||exited.inside)throw Error('Vehicle exit failed');
  await page.keyboard.down('w');await step(0.8);await page.keyboard.up('w');
  console.log('WALK',await page.evaluate(()=>window.__playground.controllers.entities.person.position));
  await page.evaluate(()=>{window.__playground.save();window.__playground.renderForQA();});
  await page.waitForTimeout(1000);console.log('MENU_VISIBILITY',await page.evaluate(()=>({class:document.getElementById('game-menu').className,opacity:getComputedStyle(document.getElementById('game-menu')).opacity,visibility:getComputedStyle(document.getElementById('game-menu')).visibility})));await page.screenshot({path:'after-exit.png',timeout:180000,animations:'disabled'});
  if(await page.locator('#game-menu').isVisible())throw Error('Menu did not close');console.log('BROWSER_GAMEPLAY_PASS');
 }
 await browser.close();server.close();
})().catch(e=>{console.error(e);process.exit(1)});
