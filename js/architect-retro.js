// The Architect's rear-view mirror: the last six seconds of the world, ten times a second (the player, the vehicle
// they drive, the Architect, the frame rate), so that a sensor that fires can say what led up to it; a burst of photos
// from his eye, aimed at the spot, for what follows. It also watches the cars near the camera and reports one that
// tips past 60 degrees and stays there (the car that reared up to the vertical in a jam, his first ticket).

const EVERY = 0.1; // seconds between samples
const KEEP = 6; // seconds kept
const TIP = 60 * Math.PI / 180;
const TIP_TIME = 0.6;
const TIP_RANGE = 140;
// Sensor events whose spot deserves photos
const BURST = new Set(['accident', 'retournement', 'enfonce', 'sous-sol']);

const deg = (r) => Math.round(r * 180 / Math.PI);

// Legacy speed is only the component along the car's nose; a blast and a drift also carry it sideways and upwards.
function vehicleSpeed(car) {
  const h = car.heading || 0, speed = car.speed || 0;
  return Math.hypot(Math.sin(h) * speed + (car.vx || 0), Math.cos(h) * speed + (car.vz || 0), car.body?.vy || 0);
}

// Pitch, roll and tilt of a car on the rigid-body model (car-physics.js: the columns of body.r are its axes in the world)
function attitude(car) {
  const r = car.body?.r;
  if (!r) return null;
  return { pitch: Math.asin(Math.max(-1, Math.min(1, r[7]))), roll: Math.asin(Math.max(-1, Math.min(1, r[1]))), tilt: Math.acos(Math.max(-1, Math.min(1, r[4]))) };
}

class ArchitectRetro {
  constructor(architect) {
    this.architect = architect;
    this.game = architect.game;
    this.samples = [];
    this.t = 0;
    this.scanT = 0;
    this.tipped = new Map(); // car -> seconds tipped
    this.reported = new Map(); // car -> clock of the last report
    this.bursts = new Set();
  }

  update(dt) {
    const g = this.game, a = this.architect;
    if (!a.present || dt <= 0) return;
    this.t += dt;
    if (this.t >= EVERY) {
      this.t = 0;
      const pl = g.player, car = g.state === 'driving' ? g.car : null, att = car ? attitude(car) : null, f = a.focus();
      this.samples.push({
        clock: g.clock, state: g.state, px: pl.x, py: g.person.position.y, pz: pl.z,
        car: car ? { kind: car.kind, x: car.position.x, y: car.position.y, z: car.position.z, speed: vehicleSpeed(car) * 3.6, pitch: att?.pitch ?? 0, roll: att?.roll ?? 0 } : null,
        ax: f.x, ay: f.y, az: f.z, amode: a.ride === a.car ? 'voiture' : a.ride === a.heli ? 'hélico' : 'à pied', fps: Math.round(a.senses.fpsAvg || 0)
      });
      while (this.samples.length && g.clock - this.samples[0].clock > KEEP) this.samples.shift();
    }
    this.scanT -= dt;
    if (this.scanT <= 0) { this.scanT = 0.2; this.scanCars(0.2); }
  }

  // Cars near the camera tipped past 60 degrees for more than half a second (once per car every 20 s)
  scanCars(dt) {
    const g = this.game, cam = g.camera.camera.position;
    const live = new Set(g.allCars || []);
    // Loose cars and laboratory targets are regularly removed; a sensor must not keep their geometry/materials alive.
    for (const car of this.tipped.keys()) if (!live.has(car) || !car.mesh?.visible || car.destroyed) this.tipped.delete(car);
    for (const car of this.reported.keys()) if (!live.has(car)) this.reported.delete(car);
    for (const car of g.allCars || []) {
      if (!car.mesh?.visible || car.boat || car.air || !car.body) continue;
      if (Math.hypot(car.position.x - cam.x, car.position.z - cam.z) > TIP_RANGE) { this.tipped.delete(car); continue; }
      const att = attitude(car);
      if (!att || att.tilt < TIP || car.destroyed) { this.tipped.delete(car); continue; }
      const t = (this.tipped.get(car) || 0) + dt;
      this.tipped.set(car, t);
      if (t < TIP_TIME || g.clock - (this.reported.get(car) ?? -99) < 20) continue;
      this.reported.set(car, g.clock);
      const who = car === g.car && g.state === 'driving' ? 'voiture du joueur' : car === this.architect.car ? 'voiture de l’Architecte' : car.lite ? 'voiture sortie du trafic' : 'voiture';
      this.architect.senses.report('retournement', {
        who, x: car.position.x, y: car.position.y, z: car.position.z,
        detail: `${who} (${car.kind || 'voiture'}) inclinée à ${deg(att.tilt)}° (tangage ${deg(att.pitch)}°, roulis ${deg(att.roll)}°) depuis ${t.toFixed(1)} s, ${Math.round(Math.abs(car.speed || 0) * 3.6)} km/h, à ${car.position.y.toFixed(1)} m de haut.`
      });
    }
  }

  // The seconds before now, a line every half second, for his mind
  window(seconds = 4) {
    const g = this.game, out = [];
    let next = g.clock - seconds;
    for (const s of this.samples) {
      if (s.clock < next) continue;
      next = s.clock + 0.5;
      const ago = (g.clock - s.clock).toFixed(1);
      const car = s.car ? ` ; au volant (${s.car.kind}) ${Math.round(s.car.speed)} km/h, tangage ${deg(s.car.pitch)}°, roulis ${deg(s.car.roll)}°, y ${s.car.y.toFixed(2)}` : '';
      out.push(`t-${ago} s : joueur ${s.state} (x ${Math.round(s.px)}, z ${Math.round(s.pz)}, y ${s.py.toFixed(2)})${car} ; Architecte ${s.amode} (x ${Math.round(s.ax)}, z ${Math.round(s.az)}) ; ${s.fps} i/s`);
    }
    return out.join('\n');
  }

  wantsBurst(kind) { return BURST.has(kind); }

  cancelBursts() { for (const controller of this.bursts) controller.abort(); }

  // A few photos from his eye, aimed at the spot, a fraction of a second apart
  async burst({ x, y, z }, count = 3, gap = 450) {
    const eye = this.architect.eye, shots = [];
    const controller = new AbortController(), { signal } = controller;
    this.bursts.add(controller);
    try { for (let i = 0; i < count && !signal.aborted; i++) {
      const f = this.architect.focus();
      const far = Math.hypot(x - f.x, z - f.z);
      // too close to frame it: the player's own view
      const pose = far < 2 ? null : eye.pose({ direction: 'vers_point', x, y: (y ?? 0) + 0.6, z, zoom: far > 60 ? 'serre' : 'normal' });
      const img = pose ? await eye.shoot(pose, { width: 768, quality: 0.7, signal }) : await this.architect.capture({ width: 768, quality: 0.7, signal });
      if (signal.aborted) break;
      if (img) shots.push(img);
      if (i < count - 1) await new Promise((resolve) => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
        const timer = setTimeout(finish, gap);
        signal.addEventListener('abort', finish, { once: true });
      });
    } } finally { this.bursts.delete(controller); }
    return shots;
  }
}

export { ArchitectRetro, attitude, vehicleSpeed };
