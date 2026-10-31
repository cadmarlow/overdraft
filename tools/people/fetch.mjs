// Downloads Rocketbox avatars (FBX and textures) from GitHub into a working folder, each in its own directory.
// Usage: node fetch.mjs <dir> Adults/Male_Adult_04 Professions/Police_Male_03 ...
import fs from 'node:fs';
import path from 'node:path';

const [dir, ...avatars] = process.argv.slice(2);
const BASE = 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/Avatars';
const tree = await (await fetch('https://api.github.com/repos/microsoft/Microsoft-Rocketbox/git/trees/master?recursive=1')).json();
const files = tree.tree.filter((e) => e.type === 'blob').map((e) => e.path);
for (const avatar of avatars) {
  const name = path.basename(avatar);
  const out = path.join(dir, name);
  fs.mkdirSync(out, { recursive: true });
  const prefix = `Assets/Avatars/${avatar}/`;
  const colorOnly = process.env.COLOR_ONLY === '1'; // the crowd paints with colour maps alone
  const wanted = files.filter((f) => f.startsWith(prefix) && (f.endsWith(`Export/${name}.fbx`) || (f.includes('/Textures/') && (!colorOnly || f.endsWith('_color.tga')))));
  await Promise.all(wanted.map(async (f) => {
    const target = path.join(out, path.basename(f));
    if (fs.existsSync(target) && fs.statSync(target).size) return;
    const r = await fetch(`${BASE}/${f.slice('Assets/Avatars/'.length)}`);
    if (!r.ok) throw new Error(`${f}: ${r.status}`);
    fs.writeFileSync(target, Buffer.from(await r.arrayBuffer()));
  }));
  console.log(name, wanted.length);
}
