#!/usr/bin/env node
// Pictures of tools/wasteland/kit-preview.html taken by a headless Chrome of its own (WebGPU), to judge the kit and the
// surfaces without opening a browser. Node 22+, no dependencies. It starts its own Chrome (own profile folder, own
// debugging port) and stops it by its PID. The checkout must already be served (npm run dev, or scripts/dev.mjs).
//
//   node tools/wasteland/shots.mjs <output folder> rocks="sheet=1&only=boulder_a,boulder_b&cols=4" ground="surfaces=1&el=35" ...
//     --port 5173        the dev server      --debug 9371   Chrome's debugging port
//     --size 1600x1000   the picture         --profile <folder>   Chrome's profile (default: <output>/.chrome)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2), options = { port: '5173', debug: '9371', size: '1600x1000', profile: null }, shots = [];
let out = null;
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) options[args[i].slice(2)] = args[++i];
  else if (args[i].includes('=')) shots.push([args[i].slice(0, args[i].indexOf('=')), args[i].slice(args[i].indexOf('=') + 1)]);
  else out = args[i];
}
if (!out || !shots.length) { console.error('usage: node tools/wasteland/shots.mjs <output folder> name="sheet=1&only=tyre" ... [--port 5173] [--debug 9371] [--size 1600x1000]'); process.exit(1); }
fs.mkdirSync(out, { recursive: true });
const [W, H] = options.size.split('x').map(Number);
const chromePath = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = options.profile || path.join(out, '.chrome');
const chrome = spawn(chromePath, ['--headless=new', '--enable-unsafe-webgpu', '--enable-features=WebGPU', '--use-angle=metal', `--remote-debugging-port=${options.debug}`,
  `--user-data-dir=${profile}`, `--window-size=${W},${H}`, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
const endpoint = `http://127.0.0.1:${options.debug}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
try {
  for (let i = 0; ; i++) {
    try { await fetch(`${endpoint}/json/version`); break; } catch { if (i > 80) throw new Error('Chrome did not start'); await sleep(150); }
  }
  for (const [name, query] of shots) {
    const url = `http://localhost:${options.port}/tools/wasteland/kit-preview.html?${query}`;
    const target = await (await fetch(`${endpoint}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json();
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    const pending = new Map(), problems = [];
    let sequence = 0;
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
      if (message.method === 'Runtime.exceptionThrown') problems.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) problems.push(message.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    };
    const call = (method, params = {}) => new Promise((resolve) => { const id = ++sequence; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })); });
    await call('Runtime.enable');
    await call('Page.enable');
    await call('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    // the user's game pad is seen by every Chrome on this Mac: not by this page
    await call('Page.addScriptToEvaluateOnNewDocument', { source: 'navigator.getGamepads = () => [];' });
    await call('Page.navigate', { url });
    let done = false;
    for (let t = 0; t < 600 && !done; t++) {
      await sleep(100);
      const r = await call('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
      done = r.result?.result?.value === 'done';
      if (problems.some((p) => /Error|error/.test(p)) && t > 30) break;
    }
    const shot = await call('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
    const file = path.join(out, `${name}.jpg`);
    fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    console.log(`${done ? 'ok  ' : 'FAIL'} ${file}`);
    for (const p of [...new Set(problems)].slice(0, 6)) console.log(`     ${String(p).split('\n').slice(0, 3).join(' | ').slice(0, 400)}`);
    if (!done) failed = true;
    socket.close();
    await fetch(`${endpoint}/json/close/${target.id}`);
  }
} finally {
  chrome.kill('SIGTERM');
}
process.exit(failed ? 1 : 0);
