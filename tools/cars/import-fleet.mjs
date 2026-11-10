#!/usr/bin/env node
// Reproducible offline replacement of the fourteen non-Zenith cars; physics comes exclusively from the locked manifest.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, importCar } from './import-cars.mjs';
import { FLEET_MODELS } from './fleet-models.mjs';

const args = process.argv.slice(2), source = args[0];
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const assets = fileURLToPath(new URL('../../assets/cars/', import.meta.url));
const output = path.resolve(option('--out') ?? assets), lockFile = option('--lock-manifest') ?? path.join(assets, 'models.json');
const only = option('--only')?.split(',') ?? Object.keys(FLEET_MODELS);
if (!source || source.startsWith('--') || only.some(id => !FLEET_MODELS[id])) throw new Error('Usage : node tools/cars/import-fleet.mjs <dossier GLB> [--out dossier] [--only sedan,suv] [--lock-manifest fichier]');
const locked = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
if (output !== path.resolve(assets) && !fs.existsSync(path.join(output, 'models.json'))) fs.cpSync(assets, output, { recursive: true });
fs.mkdirSync(output, { recursive: true });
const manifestPath = path.join(output, 'models.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { ...locked };
for (const id of only) {
  const original = MODELS.find(model => model.id === id), recipe = FLEET_MODELS[id];
  const model = { ...original, ...recipe, id };
  const imported = await importCar(model, { source: path.resolve(source), out: output, locked: locked[id] });
  if (JSON.stringify(imported.spec) !== JSON.stringify(locked[id].spec)) throw new Error(`${id}: physical rig changed`);
  manifest[id] = imported;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  console.log(JSON.stringify({ model: id, hero: imported.sourceGeometry.nearTriangles,
    traffic: imported.trafficShell ? (imported.trafficShell[1] + imported.trafficWheels.reduce((n, range) => n + range[1], 0)) / 3 : null,
    far: imported.ranges[5] / 3, sourceInterior: !!imported.sourceInterior }));
}
