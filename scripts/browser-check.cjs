const {chromium}=require('/opt/codex/cua_node/lib/node_modules/playwright-core');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const server=http.createServer((req,res)=>{const target=path.join(process.cwd(),decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.gz':'application/octet-stream','.md':'text/plain'};fs.readFile(target,(err,data)=>{if(err){res.writeHead(404);res.end('Not found');return}res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream'});res.end(data)});});await new Promise(resolve=>server.listen(8010,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--allow-file-access-from-files','--enable-unsafe-webgpu','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-dev-shm-usage','--disable-gpu-sandbox']});
 const page=await browser.newPage({viewport:{width:960,height:600}});page.setDefaultTimeout(180000);
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
 await page.screenshot({path:'menu.png'});console.log('READY',done);
 if(done){
  await page.bringToFront();await page.locator('#play-button').click();await page.waitForTimeout(1500);await page.evaluate(()=>window.__playground.setPaused(false));await page.screenshot({path:'on-foot.png'});
  console.log('STATE',await page.evaluate(()=>({state:window.__playground.state,position:window.__playground.controllers.entities.person.position,candidate:!!window.__playground.candidate,playing:window.__playground.playing,paused:window.__playground.paused,cam:window.__playground.camera.currentPos,rig:{x:window.__playground.controllers.entities.person.rig.x,z:window.__playground.controllers.entities.person.rig.z,speed:window.__playground.controllers.entities.person.rig.speed},meshes:window.__playground.controllers.entities.person.crowd.meshes.map(m=>({name:m.name,count:m.count,visible:m.visible}))})));
  await page.bringToFront();await page.evaluate(()=>window.__playground.setPaused(false));await page.keyboard.press('f');await page.waitForFunction(()=>window.__playground.state==='driving',{},{timeout:60000});await page.waitForTimeout(1000);await page.screenshot({path:'driving.png'});
  console.log('AFTER_F',await page.evaluate(()=>({state:window.__playground.state,position:window.__playground.controllers.entities.person.position})));
  await page.keyboard.down('w');await page.waitForTimeout(1200);await page.keyboard.up('w');console.log('ACCELERATION',await page.evaluate(()=>({speed:window.__playground.controllers.entities.car.speed,distance:window.__playground.distance})));
  await page.keyboard.down('s');await page.waitForTimeout(1600);await page.keyboard.up('s');await page.evaluate(()=>{const c=window.__playground.controllers.entities.car;c.speed=c.vx=c.vz=c.angularVel=0});await page.keyboard.press('f');await page.waitForFunction(()=>window.__playground.state==='onFoot',{},{timeout:60000});console.log('EXIT_OK',await page.evaluate(()=>({state:window.__playground.state,person:window.__playground.controllers.entities.person.position,paused:window.__playground.paused})));await page.screenshot({path:'after-exit.png'});
 }
 await browser.close();server.close();
})().catch(e=>{console.error(e);process.exit(1)});
