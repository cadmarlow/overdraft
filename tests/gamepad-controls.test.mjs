import assert from 'node:assert/strict';
import test from 'node:test';
import { GamepadControls } from '../js/gamepad-controls.js';

function setup() {
  const pad = { id: 'Xbox', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: [] };
  const inputs = {};
  const calls = [];
  const document = new EventTarget();
  document.body = { classList: { toggle() {} } };
  document.hasFocus = () => true;
  document.querySelector = () => null;
  globalThis.document = document;
  globalThis.window = new EventTarget();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [pad] } });

  const controller = {
    activeMode: 'person',
    setGamepadInput(key, value) { inputs[key] = value; },
    clearGamepadInput() { for (const key of Object.keys(inputs)) delete inputs[key]; }
  };
  const camera = { applyGamepadInput() {}, resetOrbit() {}, swapShoulder() {} };
  const controls = new GamepadControls(controller, camera, { onCycleCamera: () => calls.push('camera') });
  const game = controls.game = {
    state: 'onFoot', active: true, car: {}, weapons: { pistol: {} },
    arsenal: {
      open: false,
      cancelHold() {},
      press(source) { this.source = source; calls.push('wheel press'); },
      release() { this.source = null; this.open = false; calls.push('wheel release'); }
    },
    map: {
      isFullMapOpen: false,
      toggleFullMap(open) { this.isFullMapOpen = open; },
      controlGamepad(x, y, zoom, dt, waypoint) { if (waypoint) calls.push('waypoint'); }
    },
    pauseMenu: { visible: false, controlGamepad() {} },
    phone: { open: false, toggle() { this.open = true; }, activate() { calls.push('phone confirm'); }, back() { this.open = false; } },
    garage: { open: false, toggle() { this.open = !this.open; } },
    shops: { open: false },
    director: {},
    vertical: {},
    updateKeybar() {},
    releasePointer() {},
    interact() { calls.push('interact'); },
    drawForAim() { calls.push('aim'); }
  };
  const button = (i, value) => { pad.buttons[i] = { value, pressed: value > 0.5 }; };
  const step = () => controls.update(1 / 60);
  step();
  return { pad, controls, game, controller, inputs, calls, button, step };
}

test('the title screen accepts gamepad confirmation without carrying a held button into the game', () => {
  const { game, calls, button, step } = setup();
  game.active = false;
  game.openingScreen = {
    ready: true,
    root: { contains: () => false },
    play: { click() { game.openingScreen.ready = false; game.active = true; calls.push('start'); } }
  };
  button(0, 1);
  step();
  assert.deepEqual(calls, []);
  button(0, 0);
  step();
  button(0, 1);
  step();
  assert.deepEqual(calls, ['start']);
  step();
  assert.deepEqual(calls, ['start']);
});

test('LT and RT use independent analog thresholds and fire edges, with no stuck combat input on disconnect', () => {
  const { pad, controls, game, calls, button, step } = setup();
  button(6, 0.35);
  button(7, 0.3);
  step();
  assert.deepEqual(calls, ['aim']);
  assert.equal(controls.aim, true);
  assert.equal(controls.fire, true);
  assert.equal(controls.firePressed, true);
  button(7, 0.16);
  step();
  assert.equal(controls.fire, true);
  assert.equal(controls.firePressed, false);
  button(6, 0);
  step();
  assert.equal(controls.aim, false);
  controls.bufferedShot = true;
  game.triggerBuffer = 0.5;
  pad.connected = false;
  step();
  assert.equal(controls.fire, false);
  assert.equal(game.triggerBuffer, 0);
});

test('held RT cannot carry out of a vehicle or start an automatic drive-by when X is pressed', () => {
  const { controls, game, controller, inputs, button, step } = setup();
  game.state = 'driving';
  game.canDriveBy = true;
  controller.activeMode = 'car';
  step();
  button(7, 0.7);
  step();
  assert.equal(inputs.forward, 0.7);
  assert.equal(controls.fire, false);
  button(2, 1);
  step();
  assert.equal(inputs.forward, 0);
  assert.equal(controls.aim, true);
  assert.equal(controls.fire, false);
  button(7, 0);
  step();
  button(7, 0.7);
  step();
  assert.equal(controls.firePressed, true);
  assert.equal(inputs.forward, 0);
  game.state = 'onFoot';
  controller.activeMode = 'person';
  step();
  assert.equal(controls.fire, false);
  assert.equal(inputs.jump, false);
});

test('Xbox A holds the handbrake, RB boosts, and LT remains an independent brake/reverse trigger', () => {
  const { game, controller, inputs, pad, button, step } = setup();
  game.state = 'driving';
  game.director.current = {};
  controller.activeMode = 'car';
  step();
  button(0, 1);
  step();
  assert.equal(inputs.handbrake, true);
  assert.equal(inputs.sprint, false, 'handbraking must not consume nitro');
  assert.equal(game.director.skip, undefined, 'handbraking must not skip mission dialogue');
  step();
  assert.equal(inputs.handbrake, true, 'the brake stays held between frames');
  button(0, 0);
  button(5, 1);
  step();
  assert.equal(inputs.handbrake, false);
  assert.equal(inputs.sprint, true);
  button(5, 0);
  button(6, 0.65);
  step();
  assert.equal(inputs.backward, 0.65);
  assert.equal(inputs.handbrake, false);
  button(0, 1);
  step();
  assert.equal(inputs.handbrake, true);
  pad.connected = false;
  step();
  assert.equal(inputs.handbrake, undefined, 'disconnect releases the brake');
});

test('the map and phone consume their own controls and prevent an exit button from acting on the street', () => {
  const { game, inputs, calls, button, step } = setup();
  button(13, 1);
  step();
  assert.equal(game.map.isFullMapOpen, true);
  step();
  assert.equal(game.map.isFullMapOpen, true);
  button(0, 1);
  step();
  assert.deepEqual(calls, ['waypoint']);
  button(1, 1);
  step();
  assert.equal(game.map.isFullMapOpen, false);
  step();
  assert.equal(inputs.run, false);
  button(12, 1);
  step();
  assert.equal(game.phone.open, true);
  step();
  assert.deepEqual(calls, ['waypoint']);
  button(0, 0);
  step();
  button(0, 1);
  step();
  assert.deepEqual(calls, ['waypoint', 'phone confirm']);
});

test('releasing LB selects the weapon but cannot fire a trigger pressed on the same frame', () => {
  const { controls, game, calls, button, step } = setup();
  button(4, 1);
  step();
  game.arsenal.open = true;
  button(4, 0);
  button(7, 1);
  step();
  assert.deepEqual(calls, ['wheel press', 'wheel release']);
  assert.equal(controls.firePressed, false);
  step();
  assert.equal(controls.fire, false);
  button(7, 0);
  step();
  button(7, 1);
  step();
  assert.equal(controls.firePressed, true);
});
