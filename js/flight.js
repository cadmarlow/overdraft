// The plane's flight model: arcade but honest. Bank to turn, speed carries lift, too slow and it stalls, and a landing has
// to be flat and gentle. Everything runs on the entity, so an abandoned plane keeps flying (and falling) on its own.

const STALL_SPEED = 28; // m/s: below this the wings stop carrying the plane
const ROTATE_SPEED = 32; // m/s: fast enough to lift off the runway (or the avenue)
const THRUST = 12;
const DRAG = 0.0016; // cruises around 240 km/h, tops out around 310 km/h
const GROUND_FRICTION = 0.6;
const BRAKE = 9;
const MAX_BANK = 1.15;
const MAX_PITCH = 1.2;
const CEILING = 900;
const TOUCHDOWN = { sink: 7, bank: 0.32, noseDown: -0.14, noseUp: 0.42 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * One physics step. `input`: pitch (+1 nose up), roll (+1 bank left), throttle (+1 opens, -1 closes, brakes on the ground).
 * `env`: ground(x, z), water(x, z), hit(position) for a building in the way. Sets plane.crashed on a fatal contact.
 */
function stepPlane(plane, input, dt, env) {
  const p = plane;
  p.throttle = clamp(p.throttle + input.throttle * 0.75 * dt, 0, 1);

  if (p.onGround) {
    // Taxi and take-off run: the rudder steers, the brakes bite, past rotation speed the nose lifts it off
    const grip = clamp(Math.abs(p.speed) / 10, 0, 1);
    p.heading += input.roll * 0.8 * grip * dt;
    const braking = input.throttle < 0 ? BRAKE : GROUND_FRICTION;
    p.speed += (p.throttle * THRUST - DRAG * p.speed * p.speed) * dt;
    p.speed = Math.max(0, p.speed - braking * dt);
    p.pitch += (Math.max(0, input.pitch) * 0.12 - p.pitch) * Math.min(1, dt * 5);
    p.roll += -p.roll * Math.min(1, dt * 8);
    if (p.speed >= ROTATE_SPEED && input.pitch > 0) {
      p.onGround = false;
      p.pitch = 0.16;
    }
  } else {
    // Authority fades with airspeed; banking turns the plane; a loose stick settles back towards level flight
    const authority = clamp(p.speed / STALL_SPEED, 0.2, 1);
    p.pitch = clamp(p.pitch + input.pitch * 1.05 * authority * dt, -MAX_PITCH, MAX_PITCH);
    if (!input.pitch) p.pitch *= Math.exp(-dt * 0.3);
    p.roll += (input.roll * MAX_BANK - p.roll) * Math.min(1, dt * (input.roll ? 2.6 : 1.8));
    p.heading += Math.tan(clamp(p.roll, -1.2, 1.2)) * 13 / Math.max(p.speed, 24) * dt;
    p.speed += (p.throttle * THRUST - DRAG * p.speed * p.speed - 9.81 * Math.sin(p.pitch) * 0.85) * dt;
    p.speed = Math.max(0, p.speed);
  }

  const stall = p.onGround ? 0 : clamp(1 - p.speed / STALL_SPEED, 0, 1);
  if (stall > 0) p.pitch = clamp(p.pitch - stall * 1.1 * dt, -MAX_PITCH, MAX_PITCH);
  const climb = Math.sin(p.pitch), level = Math.cos(p.pitch);
  p.verticalSpeed = p.onGround ? 0 : p.speed * climb - stall * stall * 24;
  p.position.x += Math.sin(p.heading) * level * p.speed * dt;
  p.position.z += Math.cos(p.heading) * level * p.speed * dt;
  p.position.y = Math.min(CEILING, p.position.y + p.verticalSpeed * dt);

  const ground = env.ground(p.position.x, p.position.z);
  if (p.onGround) p.position.y = ground;
  else if (p.position.y <= ground) {
    const gentle = p.verticalSpeed > -TOUCHDOWN.sink && Math.abs(p.roll) < TOUCHDOWN.bank && p.pitch > TOUCHDOWN.noseDown && p.pitch < TOUCHDOWN.noseUp;
    p.position.y = ground;
    if (gentle && !env.water(p.position.x, p.position.z)) { p.onGround = true; p.pitch = 0; p.roll = 0; }
    else p.crashed = true;
  }
  if (env.hit(p.position)) {
    if (p.speed > 9) p.crashed = true;
    else p.speed = 0;
  }
}

export { stepPlane, STALL_SPEED, ROTATE_SPEED };
