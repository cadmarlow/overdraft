#!/usr/bin/env node
// Deterministic whole-vehicle acceptance runs against the actual shipped wheelbases and tracks. No renderer or deps.
// Usage: node tools/cars/benchmark-dynamics.mjs [--json] [--output /tmp/report.json] [--baseline /path/car-physics.js]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import * as physics from '../../js/car-physics.js';

const { values: args } = parseArgs({ options: { json: { type: 'boolean' }, output: { type: 'string' }, baseline: { type: 'string' } } });
const fleet = JSON.parse(readFileSync(new URL('../../assets/cars/models.json', import.meta.url), 'utf8'));
const DT = 1 / 60;
const STILL = { throttle: 0, steer: 0, handbrake: false };
const POWER = { ...STILL, throttle: 1 };
const BRAKE = { ...STILL, throttle: -1 };
const round = (value, digits = 3) => Number(value.toFixed(digits));
function makeCar(kind, api = physics) {
  const s = fleet[kind].spec;
  const tune = api.makeTune(kind, { ...s, halfL: Math.max(s.zFront, -s.zRear), wheelX: (s.wheelX + s.wheelXr) / 2 });
  return { kind, tune, body: api.createBody(tune), position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, vx: 0, vz: 0, angularVel: 0, steerAngle: 0 };
}
function road(grip = 1) {
  return { grip, ground(x, z, hit) { hit.y = hit.nx = hit.nz = hit.rough = 0; hit.ny = hit.grip = 1; hit.curb = false; } };
}
function run(car, input, seconds, dt, world, each) {
  for (let i = 0, count = Math.round(seconds / dt); i < count; i++) { physics.stepCar(car, input, dt, world); each?.(car); }
}
function check(ok, message) { if (!ok) throw new Error(message); }
function finite(car) {
  const b = car.body, p = car.position;
  check([p.x, p.y, p.z, ...b.q, b.vx, b.vy, b.vz, b.wx, b.wy, b.wz].every(Number.isFinite), `${car.kind} : état physique non fini`);
}
function acceleration(car) {
  const world = road();
  let time = 0;
  while (car.speed < 100 / 3.6 && time < 30) { physics.stepCar(car, POWER, DT, world); time += DT; }
  check(car.speed >= 100 / 3.6, `${car.kind} : 100 km/h non atteints en 30 s`);
  return time;
}
function braking(car, grip) {
  // Normalize the entry speed so a faster engine's threshold overshoot cannot inflate its measured stopping distance.
  car.speed = 100 / 3.6;
  const world = road(grip), origin = { ...car.position };
  let time = 0, abs = 0;
  while (car.speed > 3 / 3.6 && time < 15) {
    physics.stepCar(car, BRAKE, DT, world); time += DT;
    abs = Math.max(abs, car.body.abs); finite(car);
  }
  check(car.speed <= 3 / 3.6, `${car.kind} : freinage inachevé`);
  return { metres: round(Math.hypot(car.position.x - origin.x, car.position.z - origin.z), 2), seconds: round(time), absPeak: round(abs) };
}

const vehicles = [];
for (const kind of Object.keys(fleet)) {
  const dry = makeCar(kind), wet = makeCar(kind), reversing = makeCar(kind);
  const zero100 = acceleration(dry); acceleration(wet);
  let reversePeak = 0;
  run(reversing, BRAKE, 8, DT, road(), (car) => { reversePeak = Math.max(reversePeak, -car.speed); });
  const row = { kind, massKg: dry.tune.mass, drivetrain: dry.tune.rear === 0 ? 'traction' : dry.tune.rear === 1 ? 'propulsion' : 'intégrale',
    zero100Seconds: round(zero100, 2), dryBraking100to3: braking(dry, 1), wetBraking100to3: braking(wet, 0.45), reversePeakKmh: round(reversePeak * 3.6, 1) };
  check(reversePeak < reversing.tune.reverseTop + 1, `${kind} : marche arrière trop rapide`);
  check(row.wetBraking100to3.metres > row.dryBraking100to3.metres, `${kind} : la pluie n'allonge pas le freinage`);
  vehicles.push(row);
}

const invariance = [];
for (const kind of Object.keys(fleet)) {
  const samples = [];
  for (const fps of [20, 30, 60, 144]) {
    const car = makeCar(kind), dt = 1 / fps, world = road(0.65);
    let minUp = 1;
    const observe = (c) => { finite(c); minUp = Math.min(minUp, c.body.r[4]); };
    // Fixed timed instructions are identical at every display rate; this is not a controller chasing a target result.
    run(car, POWER, 6, dt, world, observe);
    run(car, { ...STILL, throttle: 0.6, steer: 0.65 }, 2, dt, world, observe);
    run(car, { ...BRAKE, steer: 0.7 }, 1, dt, world, observe);
    run(car, { ...STILL, steer: 1, handbrake: true }, 0.5, dt, world, observe);
    run(car, { ...POWER, steer: -0.2 }, 1, dt, world, observe);
    run(car, POWER, 1, dt, world, observe);
    run(car, { ...BRAKE, steer: 0.1 }, 2, dt, world, observe);
    samples.push({ fps, x: car.position.x, z: car.position.z, speed: car.speed, heading: car.heading, minUp });
  }
  const reference = samples.find((row) => row.fps === 60);
  const row = { kind,
    maxPositionErrorMetres: round(Math.max(...samples.map((s) => Math.hypot(s.x - reference.x, s.z - reference.z)))),
    maxSpeedErrorMs: round(Math.max(...samples.map((s) => Math.abs(s.speed - reference.speed)))),
    maxHeadingErrorDegrees: round(Math.max(...samples.map((s) => Math.abs(Math.atan2(Math.sin(s.heading - reference.heading), Math.cos(s.heading - reference.heading))))) * 180 / Math.PI),
    minUp: round(Math.min(...samples.map((s) => s.minUp))), samples };
  check(row.minUp > 0.9, `${kind} : retournement pendant l'essai de cadence`);
  check(row.maxPositionErrorMetres < 2 && row.maxSpeedErrorMs < 0.25 && row.maxHeadingErrorDegrees < 2, `${kind} : sensibilité excessive à la cadence`);
  invariance.push(row);
}

const transitions = [];
for (const kind of Object.keys(fleet)) {
  const car = makeCar(kind), world = road();
  run(car, POWER, 3, DT, world);
  const origin = { ...car.position }, velocity = car.speed;
  for (const delta of [0, -1, NaN, Infinity]) physics.stepCar(car, POWER, delta, world);
  check(JSON.stringify(car.position) === JSON.stringify(origin) && car.speed === velocity, `${kind} : déplacement pendant la pause`);
  physics.stepCar(car, { ...POWER, steer: 1 }, 2, world); finite(car);
  const resumeMetres = Math.hypot(car.position.x - origin.x, car.position.z - origin.z);
  check(resumeMetres < 4, `${kind} : saut à la reprise de l'onglet`);
  const wallZ = car.position.z + 8;
  world.collide = (c) => { if (c.position.z > wallZ) { c.position.z = wallZ; c.speed = Math.min(0, c.speed); c.vx = c.vz = 0; } };
  run(car, POWER, 3, DT, world, finite);
  run(car, BRAKE, 2, DT, world, finite);
  check(car.speed < -1, `${kind} : coincé contre un obstacle`);
  delete world.collide;
  car.position.x = car.position.z = 0; car.position.y = 2.8; physics.settleBody(car, 0);
  car.body.q[0] = 1; car.body.q[3] = 0; car.body.vz = 10;
  let scraped = false;
  run(car, STILL, 10, DT, world, (c) => { finite(c); scraped ||= c.body.scrape > 0; });
  check(scraped && car.body.r[4] > 0.98 && Math.abs(car.position.y) < 0.05, `${kind} : récupération du retournement incorrecte`);
  transitions.push({ kind, pauseStable: true, resumeMetres: round(resumeMetres), reversedFromObstacle: true, roofScraped: scraped, recoveredUp: round(car.body.r[4]) });
}

let cpu = null;
if (args.baseline) {
  const baseline = await import(pathToFileURL(resolve(args.baseline)).href);
  for (const key of ['makeTune', 'createBody', 'stepCar']) check(typeof baseline[key] === 'function', `Référence invalide : ${key} absent`);
  const measure = (api, count) => {
    const car = makeCar('sedan', api), world = road(), input = { ...POWER }, start = performance.now(), usage = process.cpuUsage();
    for (let i = 0; i < count; i++) { input.steer = Math.sin(i * 0.01) * 0.5; api.stepCar(car, input, DT, world); }
    const used = process.cpuUsage(usage);
    return { wallMsPerFrame: (performance.now() - start) / count, cpuMsPerFrame: (used.user + used.system) / 1000 / count };
  };
  measure(baseline, 2500); measure(physics, 2500);
  const samples = [];
  for (let i = 0; i < 6; i++) {
    // Alternate order to reduce bias from CPU temperature, contention and JIT warmup.
    let before, after;
    if (i % 2) { after = measure(physics, 6000); before = measure(baseline, 6000); }
    else { before = measure(baseline, 6000); after = measure(physics, 6000); }
    samples.push({ before, after });
  }
  const median = (list) => { const sorted = [...list].sort((a, b) => a - b); return (sorted[2] + sorted[3]) * 0.5; };
  cpu = { node: process.version, note: 'Temps CPU par voiture et par image simulée à 60 Hz, physique seule ; ce chiffre ne mesure pas les FPS du jeu.',
    baselineMedianMs: median(samples.map((s) => s.before.cpuMsPerFrame)), currentMedianMs: median(samples.map((s) => s.after.cpuMsPerFrame)), samples };
}

const report = { protocol: { frequencyHz: 60, dryGrip: 1, wetBrakingGrip: 0.45, wetHandlingGrip: 0.65,
  brakingEntryKmh: 100, brakingEndKmh: 3, nitro: false, handlingRunSeconds: 13.5,
  note: 'Simulation déterministe sur route plane avec les géométries réelles des 15 modèles ; ne remplace pas la validation visuelle et les essais clavier dans Chrome.' }, vehicles, invariance, transitions, cpu };
const json = `${JSON.stringify(report, null, 2)}\n`;
if (args.output) writeFileSync(resolve(args.output), json);
if (args.json) process.stdout.write(json);
else {
  console.log('OVERDRAFT — banc dynamique, flotte de série, sans nitro');
  console.table(vehicles.map((r) => ({ Voiture: r.kind, '0–100 (s)': r.zero100Seconds, 'Freinage sec (m)': r.dryBraking100to3.metres,
    'Freinage mouillé (m)': r.wetBraking100to3.metres, 'Marche arrière (km/h)': r.reversePeakKmh })));
  console.log('Cadences 20/30/60/144 Hz, séquence de 13,5 s sur sol mouillé :');
  console.table(invariance.map((r) => ({ Voiture: r.kind, 'Écart position (m)': r.maxPositionErrorMetres, 'Écart vitesse (m/s)': r.maxSpeedErrorMs, 'Écart cap (°)': r.maxHeadingErrorDegrees })));
  console.log('15/15 : pause, reprise, obstacle et récupération sur les roues validés.');
  if (cpu) console.log(`CPU par voiture/image : référence ${cpu.baselineMedianMs.toFixed(4)} ms ; version courante ${cpu.currentMedianMs.toFixed(4)} ms.`);
  if (args.output) console.log(`Rapport JSON : ${resolve(args.output)}`);
}
