// The pilot's panel: attitude, airspeed, height, climb, load, throttle and the lamps that matter (undercarriage,
// afterburner, smoke, stall), drawn in place of the car's cluster while an aircraft is flown. It reads the flight
// model's own numbers (flight.js) and only touches the page when what is shown changes; everything that moves does so
// by transform or opacity.

const unit = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const finite = (n) => (Number.isFinite(n) ? n : 0);

// What the panel shows, from an aircraft entity: plain numbers, so it can be tested without a page
function flightTelemetry(a, out = {}) {
  const b = a.flight, t = b.tune;
  out.speed = Math.round(finite(b.airspeed) * 3.6);
  out.mach = finite(b.mach);
  out.altitude = Math.max(0, Math.round(finite(a.position.y)));
  out.height = Math.max(0, Math.round(finite(b.agl)));
  out.climb = finite(b.vy);
  out.g = finite(b.gSmooth);
  out.pitch = finite(a.pitch);
  out.roll = finite(a.roll);
  // true compass heading: downtown is +Z and the avenues run 29° east of north, so facing +Z reads 209
  out.heading = ((Math.round(209 - finite(a.heading) * 180 / Math.PI) % 360) + 360) % 360;
  out.throttle = unit(b.throttle);
  out.power = unit(b.power);
  out.reheat = unit(b.ab);
  out.jet = t.engine === 'jet';
  out.gear = t.gearTime ? (b.gear > 0.98 ? 'down' : b.gear < 0.02 ? 'up' : 'moving') : 'fixed';
  out.flaps = b.flaps > 0.25;
  out.brake = b.brake > 0.3;
  out.stall = !b.onGround && b.stall > 0.5;
  // the ground coming up faster than the aircraft can be pulled out of it
  out.pullUp = !b.onGround && b.vy < -8 && b.agl < Math.max(35, -b.vy * 4.5) && b.gear < 0.5;
  out.health = unit((a.hp ?? 100) / 100);
  out.onGround = !!b.onGround;
  out.dead = b.damage.engine >= 1;
  return out;
}

class FlightInstruments {
  constructor(parent = document.body) {
    const root = this.root = document.createElement('div');
    root.id = 'flight-gauge';
    root.setAttribute('aria-label', 'Instruments de vol');
    root.innerHTML = `
      <header class="fl-top"><span>GAZ</span><div class="fl-lever"><i id="fl-power"></i><i id="fl-reheat"></i><b></b></div>
        <span class="fl-lamps"><i id="fl-pc">PC</i><i id="fl-gear">TRAIN</i><i id="fl-flaps">VOLETS</i><i id="fl-smoke">FUMÉE</i></span></header>
      <div class="fl-main">
        <div class="fl-adi"><div id="fl-ball"><b></b></div><i></i></div>
        <div class="fl-speed"><strong id="fl-speed">000</strong><span>KM/H</span><small id="fl-mach"></small></div>
        <div class="fl-side"><span><small>ALT</small><b id="fl-alt">0</b><em>M</em></span><span><small>VARIO</small><b id="fl-climb">0</b><em>M/S</em></span><span><small>CHARGE</small><b id="fl-g">1,0</b><em>G</em></span></div>
      </div>
      <footer class="fl-bottom"><span>CAP <b id="fl-heading">000</b>°</span><span>SOL <b id="fl-height">0</b> M</span><span class="fl-health">ÉTAT<i><b id="fl-health"></b></i></span></footer>`;
    const alert = this.alert = document.createElement('div');
    alert.id = 'flight-alert';
    (parent || document.body).append(root, alert);
    this.nodes = Object.fromEntries([...root.querySelectorAll('[id]')].map((n) => [n.id, n]));
    this.last = {};
    this.telemetry = {};
    this.shown = null;
  }

  text(id, value) {
    if (this.last[id] === value) return;
    this.last[id] = value;
    this.nodes[id].textContent = value;
  }

  flag(id, name, on) {
    const key = `${id}.${name}`;
    if (this.last[key] === on) return;
    this.last[key] = on;
    this.nodes[id].classList.toggle(name, on);
  }

  // a: the aircraft being flown, or null
  update(a, dt, aviation) {
    const kind = a ? a.kind : null;
    if (this.shown !== kind) {
      this.shown = kind;
      if (kind) document.body.dataset.flight = kind; else delete document.body.dataset.flight;
      if (!kind) this.warn('');
    }
    if (!a) return;
    const t = flightTelemetry(a, this.telemetry), n = this.nodes;
    this.text('fl-speed', String(t.speed).padStart(3, '0'));
    this.text('fl-mach', t.jet && t.mach > 0.6 ? `MACH ${t.mach.toFixed(2).replace('.', ',')}` : '');
    this.text('fl-alt', String(t.altitude));
    this.text('fl-height', String(t.height));
    const climb = Math.abs(t.climb) < 0.5 ? '0' : `${t.climb > 0 ? '+' : '−'}${Math.abs(t.climb).toFixed(Math.abs(t.climb) < 10 ? 1 : 0).replace('.', ',')}`;
    this.text('fl-climb', climb);
    this.text('fl-g', t.g.toFixed(1).replace('.', ',').replace('-', '−'));
    this.flag('fl-g', 'hard', t.g > 5.5 || t.g < -1.5);
    this.text('fl-heading', String(t.heading).padStart(3, '0'));
    n['fl-power'].style.transform = `scaleX(${t.power.toFixed(3)})`;
    n['fl-reheat'].style.transform = `scaleX(${t.reheat.toFixed(3)})`;
    this.flag('fl-pc', 'active', t.reheat > 0.3);
    this.flag('fl-pc', 'none', !t.jet);
    this.flag('fl-gear', 'active', t.gear === 'down');
    this.flag('fl-gear', 'moving', t.gear === 'moving');
    this.flag('fl-gear', 'none', t.gear === 'fixed');
    this.flag('fl-flaps', 'active', t.flaps);
    this.flag('fl-flaps', 'none', !t.jet);
    this.flag('fl-smoke', 'active', !!aviation?.smoke);
    this.flag('fl-smoke', 'none', t.jet);
    n['fl-health'].style.transform = `scaleX(${t.health.toFixed(3)})`;
    this.flag('fl-health', 'low', t.health < 0.35);
    // the horizon: rolls with the bank, slides with the pitch (1.1 px a degree)
    const pitch = Math.max(-60, Math.min(60, t.pitch * 180 / Math.PI));
    n['fl-ball'].style.transform = `rotate(${(t.roll * 180 / Math.PI).toFixed(1)}deg) translateY(${(pitch * 1.1).toFixed(1)}px)`;
    this.warn(t.pullUp ? 'REMONTEZ' : t.stall ? 'DÉCROCHAGE' : t.dead && !t.onGround ? 'MOTEUR COUPÉ' : '');
  }

  // One word across the screen while it matters
  warn(text) {
    if (this.last.alert === text) return;
    this.last.alert = text;
    if (text) this.alert.textContent = text;
    this.alert.classList.toggle('show', !!text);
    this.alert.classList.toggle('danger', text === 'REMONTEZ');
  }
}

export { FlightInstruments, flightTelemetry };
