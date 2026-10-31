import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
await rm(resolve(root, 'dist'), { recursive: true, force: true });
await mkdir(resolve(root, 'dist'), { recursive: true });
for (const name of ['index.html', 'js', 'css', 'vendor', 'assets', 'LICENSE', 'CREDITS.md']) {
  await cp(resolve(root, name), resolve(root, 'dist', name), { recursive: true });
}
await writeFile(resolve(root, 'dist/_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n/vendor/*\n  Cache-Control: public, max-age=31536000, immutable\n');
if (process.argv.includes('--with-source')) {
  const downloads = resolve(root, 'dist/downloads');
  await mkdir(downloads, { recursive: true });
  execFileSync('git', ['archive', '--format=zip', '--prefix=overdraft/', `--output=${resolve(downloads, 'overdraft-source.zip')}`, 'HEAD', '--', '.', ':(exclude).openai'], { cwd: root });
  execFileSync('git', ['bundle', 'create', resolve(downloads, 'overdraft.bundle'), '--all'], { cwd: root });
  await writeFile(resolve(downloads, 'index.html'), `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OVERDRAFT — Code source</title><style>body{max-width:760px;margin:70px auto;padding:0 24px;background:#111a13;color:#f3f0e6;font:16px/1.7 system-ui}a{color:#e1f3a0}pre{background:#1d2b20;padding:18px;overflow:auto}small{color:#a6b49b}</style><h1>OVERDRAFT — Code source</h1><p>Version 0.4.0 — Human Capital.</p><p><a href="./overdraft-source.zip" download>Télécharger le ZIP du projet</a> · <a href="./overdraft.bundle" download>Télécharger le dépôt Git portable</a></p><p>Après extraction du ZIP, avec Node.js 22 ou plus récent :</p><pre>cd overdraft\nnpm run dev</pre><p>Ouvrir <a href="http://localhost:5173/?stats=1">http://localhost:5173/?stats=1</a>. Aucune installation de dépendances nécessaire.</p><p>Pour récupérer l'historique Git depuis le fichier bundle téléchargé :</p><pre>git clone overdraft.bundle overdraft\ncd overdraft\nnpm run dev</pre><p>La branche <code>v1-published</code> conserve la version initialement publiée. La branche <code>main</code> contient le correctif et le serveur local.</p><small>Code basé sur Slop New York (MIT). Les licences et attributions des données sont incluses.</small></html>`);
}
console.log('Static production build ready in dist/');
