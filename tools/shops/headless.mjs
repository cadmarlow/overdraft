// Run one page of this repository in a headless Chrome and hand back what it leaves in window.__result.
// The dev server must be running (npm run dev). Used by the offline builders of tools/shops.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function runPage(url, { timeout = 600000, width = 1024, height = 768, log = true } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'overdraft-tools-'));
  const port = 9400 + Math.floor(Math.random() * 400);
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`, '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu',
    '--disable-gpu-vsync', '--disable-frame-rate-limit', 'about:blank'], { stdio: 'ignore' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    let version = null;
    for (let i = 0; i < 120 && !version; i++) {
      try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await wait(250); }
    }
    if (!version) throw new Error('Chrome did not start');
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => { ws.onopen = r; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      if (log && m.method === 'Runtime.consoleAPICalled') console.log('[page]', m.params.args.map((a) => a.value ?? a.description).join(' '));
      if (m.method === 'Runtime.exceptionThrown') console.log('[page error]', m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    };
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    const start = Date.now();
    while (Date.now() - start < timeout) {
      await wait(500);
      const r = await send('Runtime.evaluate', { expression: 'window.__result === undefined ? null : JSON.stringify(window.__result)', returnByValue: true });
      const value = r.result?.result?.value;
      if (value) return JSON.parse(value);
    }
    throw new Error(`Timed out on ${url}`);
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

export { runPage };
