import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
await rm(resolve(root, 'dist'), { recursive: true, force: true });
await mkdir(resolve(root, 'dist'), { recursive: true });
for (const name of ['index.html', 'js', 'css', 'vendor', 'LICENSE', 'CREDITS.md']) {
  await cp(resolve(root, name), resolve(root, 'dist', name), { recursive: true });
}
await writeFile(resolve(root, 'dist/_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n/vendor/*\n  Cache-Control: public, max-age=31536000, immutable\n');
console.log('Static production build ready in dist/');
