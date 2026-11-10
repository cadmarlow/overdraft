const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { loadModule } = require('./helpers/module.cjs');

function harness() {
  let dialogOpen = false;
  const { Phone } = loadModule(readFileSync(join(__dirname, '../js/phone.js'), 'utf8'), {
    imports: { './drive-fx.js': { repairBody() {} } },
    globals: { document: { querySelector: () => dialogOpen ? {} : null } }
  });
  const calls = { activate: 0, back: 0, toggle: 0, highlight: 0 };
  const phone = Object.assign(Object.create(Phone.prototype), {
    game: { paused: false }, open: true, sel: 0, current: [{}, {}, {}],
    body: { classList: { contains: () => false } },
    activate: () => calls.activate++, back: () => calls.back++, toggle: () => calls.toggle++, highlight: () => calls.highlight++
  });
  const key = code => {
    const event = { code, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    phone.key(event); return event;
  };
  return { phone, calls, key, setDialog: value => { dialogOpen = value; } };
}

test('a phone left open before automatic pause does not react to menu navigation or purchases', () => {
  const h = harness(); h.phone.game.paused = true;
  for (const code of ['ArrowDown', 'ArrowRight', 'Enter', 'Space', 'Escape', 'KeyP']) {
    const e = h.key(code);
    assert.equal(e.prevented, false, `${code} remains available to the pause menu`);
    assert.equal(e.stopped, false);
  }
  assert.equal(h.phone.sel, 0);
  assert.deepEqual(h.calls, { activate: 0, back: 0, toggle: 0, highlight: 0 });
});

test('native credits and reset dialogs keep Escape and Enter even when the phone is open behind them', () => {
  const h = harness(); h.setDialog(true);
  for (const open of [false, true]) {
    h.phone.open = open;
    for (const code of ['Escape', 'Enter', 'KeyP']) {
      const e = h.key(code);
      assert.equal(e.prevented, false, `${code} must reach the native dialog`);
      assert.equal(e.stopped, false);
    }
  }
  assert.deepEqual(h.calls, { activate: 0, back: 0, toggle: 0, highlight: 0 });
});

test('phone navigation and activation recover after pause and dialog closure', () => {
  const h = harness(); h.phone.game.paused = true; h.setDialog(true);
  h.key('ArrowDown'); h.key('Enter');
  h.phone.game.paused = false; h.setDialog(false);
  assert.equal(h.key('ArrowDown').prevented, true);
  assert.equal(h.phone.sel, 1);
  h.key('Enter'); h.key('Escape');
  h.phone.open = false; h.key('KeyP');
  assert.deepEqual(h.calls, { activate: 1, back: 1, toggle: 1, highlight: 1 });
});
