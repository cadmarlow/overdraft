// Read the same physical signals that drive the tyres, suspension and engine sound.
// Reuse the output object and only change DOM text when the displayed value changes.
const unit = n => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const finite = n => Number.isFinite(n) ? n : 0;
function drivingTelemetry(car, out = {}) {
  const b = car.body, tune = car.tune;
  const speed = b ? Math.hypot(finite(b.vx), finite(b.vz)) : Math.abs(finite(car.speed));
  out.speed = Math.round(speed * 3.6);
  out.physical = !!(b && tune);
  out.gear = car.air ? `${Math.round(finite(car.position?.y))} M` : b?.reversing || car.speed < -0.2 ? 'R' : b ? String(b.gear + 1) : out.speed < 1 ? 'N' : String(Math.min(6, 1 + Math.floor(out.speed / 29)));
  out.rpm = b ? Math.round(finite(b.rpm) / 50) * 50 : 0;
  out.revs = unit(b && tune ? b.rpm / tune.redline : speed / (car.drive?.speed || 40));
  out.nitro = b ? unit(car.nitro) : 0;
  out.health = unit((car.hp ?? 100) / 100);
  out.throttle = unit(b?.throttle);
  out.brake = unit(b?.brake);
  out.abs = finite(b?.abs) > 0.08;
  out.tc = finite(b?.tractionControl) > 0.1;
  out.longG = Math.max(-1.6, Math.min(1.6, finite(b?.longG)));
  out.lateralG = Math.max(-1.6, Math.min(1.6, finite(b?.lateralG)));
  out.g = Math.hypot(out.longG, out.lateralG).toFixed(1);
  out.boosting = !!b?.nitro;
  return out;
}

class DriveInstruments {
  constructor(root) {
    this.root = root;
    root.setAttribute('aria-label', 'Instrumentation du véhicule');
    root.innerHTML = `
      <header class="drive-revs"><span>RÉGIME</span><b id="drive-rpm">0</b><small>TR/MIN</small><span class="drive-assists"><i id="drive-tc">TC</i><i id="drive-abs">ABS</i></span></header>
      <div class="drive-tach"><i id="drive-power"></i><b></b></div>
      <div class="drive-readout"><span class="drive-gear-wrap"><small>RAPPORT</small><b id="drive-gear">1</b></span><strong id="drive-speed">000</strong><span class="drive-unit">KM/H</span></div>
      <div class="drive-bottom"><div class="drive-g-meter"><i id="drive-g-dot"></i><b id="drive-g-value">0.0</b><small>G</small></div><div class="drive-pedals"><span>GAZ<i><b id="drive-throttle"></b></i></span><span>FREIN<i><b id="drive-brake"></b></i></span></div><div class="drive-reserves"><span>NITRO<i><b id="drive-nitro"></b></i></span><span>ÉTAT<i><b id="drive-health"></b></i></span></div></div>`;
    this.nodes = Object.fromEntries([...root.querySelectorAll('[id]')].map(n => [n.id, n]));
    this.last = {};
    this.telemetry = {};
  }

  text(id, value) {
    if (this.last[id] === value) return;
    this.last[id] = value;
    this.nodes[id].textContent = value;
  }

  update(car) {
    const t = drivingTelemetry(car, this.telemetry), n = this.nodes;
    this.text('drive-speed', String(t.speed).padStart(3, '0'));
    this.text('drive-gear', t.gear);
    this.text('drive-rpm', String(t.rpm));
    this.text('drive-g-value', t.g.replace('.', ','));
    this.root.classList.toggle('drive-simple', !t.physical);
    n['drive-power'].style.transform = `scaleX(${t.revs.toFixed(3)})`;
    n['drive-power'].classList.toggle('redline', t.revs > 0.92);
    n['drive-nitro'].style.transform = `scaleX(${t.nitro.toFixed(3)})`;
    n['drive-nitro'].classList.toggle('burning', t.boosting);
    n['drive-health'].style.transform = `scaleX(${t.health.toFixed(3)})`;
    n['drive-health'].classList.toggle('low', t.health < 0.35);
    n['drive-throttle'].style.transform = `scaleX(${t.throttle.toFixed(3)})`;
    n['drive-brake'].style.transform = `scaleX(${t.brake.toFixed(3)})`;
    n['drive-tc'].classList.toggle('active', t.tc);
    n['drive-abs'].classList.toggle('active', t.abs);
    const travel = Math.min(10, 12 / Math.max(0.01, Math.hypot(t.longG, t.lateralG)));
    n['drive-g-dot'].style.transform = `translate(${(-t.lateralG * travel).toFixed(1)}px, ${(t.longG * travel).toFixed(1)}px)`;
  }
}
export { drivingTelemetry, DriveInstruments };
