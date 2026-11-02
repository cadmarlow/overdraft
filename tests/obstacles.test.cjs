const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { vehicleContact, resolveVehicleContact, sweptVehicleContact } = (() => {
  const { loadModule } = require('./helpers/module.cjs');
  return loadModule(readFileSync(join(__dirname, '../js/vehicle-physics.js'), 'utf8'));
})();

// roundContact lives in controllers.js with all of three.js behind it: it is lifted out here to test it alone
const source = readFileSync(join(__dirname, '../js/controllers.js'), 'utf8');
const body = source.slice(source.indexOf('function roundContact'), source.indexOf('// Movement and teleports share'));
const roundContact = new Function(`${body}; return roundContact;`)();

const car = (heading) => ({ car: true, sin: Math.sin(heading), cos: Math.cos(heading), hx: 0.86, hz: 2.18, radius: 2 });
const trunk = (cx, cz, round) => ({ cx, cz, round });
const walker = { car: false, radius: 0.34 };

test('a car driving north stops on a trunk dead ahead: pushed back along its own axis', () => {
  const contact = {};
  assert.equal(roundContact(trunk(0, 2.3, 0.3), 0, 0, car(0), contact), true);
  assert.ok(Math.abs(contact.nx) < 1e-9);
  assert.ok(contact.nz < -0.99, `normal ${contact.nz}`);
  assert.ok(Math.abs(contact.depth - 0.18) < 1e-6);
});

test('a trunk beside a car, or past its length, does not touch it', () => {
  assert.equal(roundContact(trunk(1.3, 0, 0.3), 0, 0, car(0), {}), false);
  assert.equal(roundContact(trunk(0, 2.6, 0.3), 0, 0, car(0), {}), false);
});

test('the car\'s heading counts: turned a quarter, its side is where its nose was', () => {
  const contact = {};
  assert.equal(roundContact(trunk(0, 1, 0.3), 0, 0, car(Math.PI / 2), contact), true);
  assert.ok(contact.nz < -0.99);
  assert.equal(roundContact(trunk(2.3, 0, 0.3), 0, 0, car(Math.PI / 2), {}), true);
});

test('a trunk at a corner pushes along the line through it, so cars glance off', () => {
  const contact = {};
  assert.equal(roundContact(trunk(1.0, 2.3, 0.3), 0, 0, car(0), contact), true);
  assert.ok(contact.nx < -0.5 && contact.nz < -0.5, `${contact.nx} ${contact.nz}`);
});

test('a trunk that ends up inside a car still throws it out the shortest way', () => {
  const contact = {};
  assert.equal(roundContact(trunk(0.5, 0, 0.3), 0, 0, car(0), contact), true);
  assert.ok(contact.nx < -0.99);
  assert.ok(contact.depth > 0.6);
});

test('someone walking stops at the sum of the two radii', () => {
  const contact = {};
  assert.equal(roundContact(trunk(0.5, 0, 0.3), 0, 0, walker, contact), true);
  assert.ok(contact.nx < -0.99);
  assert.ok(Math.abs(contact.depth - 0.14) < 1e-6);
  assert.equal(roundContact(trunk(0.7, 0, 0.3), 0, 0, walker, {}), false);
});

const body2 = (over) => ({ x: 0, z: 0, prevX: 0, prevZ: 0, sin: 0, cos: 1, halfW: 0.9, halfL: 2.2, mass: 1700, vx: 0, vz: 0, angularVel: 0, ...over });

test('a car rear-ending a highway car shoves it on and loses speed', () => {
  const a = body2({ z: -4.2, prevZ: -4.7, vz: 30 });
  const b = body2({ z: 0, prevZ: 0, vz: 20, mass: 1600 });
  const hit = {};
  assert.ok(sweptVehicleContact(a, b, hit) || vehicleContact(a, b, hit));
  assert.ok(resolveVehicleContact(a, b, hit) > 0);
  assert.ok(a.vz < 30);
  assert.ok(b.vz > 20);
});

test('even at speed a car cannot jump through another between two frames', () => {
  const a = body2({ z: 5, prevZ: -6, vz: 80 });
  const b = body2({ z: 0, prevZ: 0, vz: 0 });
  assert.equal(vehicleContact(a, b, {}), false, 'no overlap on this frame alone');
  assert.equal(sweptVehicleContact(a, b, {}), true);
});
