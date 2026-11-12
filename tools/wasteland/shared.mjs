// What build-surfaces.mjs and build-kit.mjs share: where sharp and meshoptimizer are found, and the downloads from
// Poly Haven (CC0, no account, no key), kept in a work folder outside the repository.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGENT = { headers: { 'User-Agent': 'overdraft-game-tools' } };

// sharp and meshoptimizer: this folder's own node_modules first, then the other tools' (tools/world installs both),
// in this checkout, in a checkout above it, or in the main checkout when this one is a git worktree (its .git is then
// a file that names the main checkout's .git folder)
export function dependency(name) {
  const roots = [HERE];
  const tools = (dir) => { for (const tool of ['wasteland', 'world', 'calibre', 'cars', 'people']) roots.push(path.join(dir, 'tools', tool)); };
  for (let dir = HERE; ; dir = path.dirname(dir)) {
    tools(dir);
    const git = path.join(dir, '.git');
    if (fs.existsSync(git) && fs.statSync(git).isFile()) {
      const main = /^gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/]/m.exec(fs.readFileSync(git, 'utf8'))?.[1];
      if (main) tools(main);
    }
    if (path.dirname(dir) === dir) break;
  }
  for (const root of roots) {
    try { return createRequire(path.join(root, 'package.json'))(name); } catch { /* next */ }
  }
  throw new Error(`${name} is not installed: run "npm install" in tools/world (sharp and meshoptimizer)`);
}

// The downloads of one run: everything lands in `work` and is read from there the next time
export function polyHaven(work, fetching) {
  async function json(url, file) {
    if (fs.existsSync(file) && fs.statSync(file).size) return JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!fetching) throw new Error(`missing ${file}`);
    const r = await fetch(url, AGENT);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    const data = await r.json();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
    return data;
  }
  async function save(url, file) {
    if (fs.existsSync(file) && fs.statSync(file).size) return file;
    if (!fetching) throw new Error(`missing ${file}`);
    const r = await fetch(url, AGENT);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    return file;
  }
  // One map of a texture (Diffuse, nor_gl, Rough, Displacement...), as a jpg
  async function texture(id, map, res = '2k') {
    const folder = path.join(work, 'textures', id);
    const files = await json(`https://api.polyhaven.com/files/${id}`, path.join(folder, 'files.json'));
    const url = files[map]?.[res]?.jpg?.url;
    if (!url) throw new Error(`${id}: no ${map} at ${res} (has ${Object.keys(files).join(', ')})`);
    return save(url, path.join(folder, `${map}_${res}.jpg`));
  }
  // A model as glTF with its .bin and its 1k textures; returns the .gltf and the asset's description
  async function model(id) {
    const folder = path.join(work, 'models', id);
    const files = await json(`https://api.polyhaven.com/files/${id}`, path.join(folder, 'files.json'));
    const info = await json(`https://api.polyhaven.com/info/${id}`, path.join(folder, 'info.json'));
    const entry = files.gltf['1k'].gltf;
    const file = await save(entry.url, path.join(folder, 'model.gltf'));
    await Promise.all(Object.entries(entry.include).map(([rel, f]) => save(f.url, path.join(folder, rel))));
    return { file, info };
  }
  // A map of a model that its glTF does not carry: the cut-out of leaves or of a wire mesh (Alpha, wire_alpha...)
  async function modelMap(id, map, res = '1k') {
    const folder = path.join(work, 'models', id);
    const files = await json(`https://api.polyhaven.com/files/${id}`, path.join(folder, 'files.json'));
    const url = files[map]?.[res]?.jpg?.url;
    if (!url) throw new Error(`${id}: no ${map} at ${res} (has ${Object.keys(files).join(', ')})`);
    return save(url, path.join(folder, 'textures', `${map}_${res}.jpg`));
  }
  const info = (id, kind) => json(`https://api.polyhaven.com/info/${id}`, path.join(work, kind, id, 'info.json'));
  return { texture, model, modelMap, info };
}

export async function pool(items, size, job) {
  const queue = items.map((item, i) => [item, i]), out = new Array(items.length);
  await Promise.all(Array.from({ length: size }, async () => { while (queue.length) { const [item, i] = queue.shift(); out[i] = await job(item); } }));
  return out;
}
