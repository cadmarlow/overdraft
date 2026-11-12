import { isTypingInField } from './city-config.js';

const DEAD_ZONE = 0.15;
// Standard Gamepad mapping (Xbox button names).
const A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, LT = 6, RT = 7;
const VIEW = 8, MENU = 9, L3 = 10, R3 = 11, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;
const BUTTON_COUNT = 16;
const TRIGGER_PRESS = 0.22, TRIGGER_RELEASE = 0.12;

function axis(value) {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

function steeringAxis(value) {
  const v = axis(value);
  return Math.sign(v) * Math.max(0, (Math.abs(v) - DEAD_ZONE) / (1 - DEAD_ZONE));
}

function stick(pad, offset) {
  const x = axis(pad.axes?.[offset]), y = axis(pad.axes?.[offset + 1]);
  const distance = Math.hypot(x, y);
  const strength = Math.max(0, (Math.min(distance, 1) - DEAD_ZONE) / (1 - DEAD_ZONE));
  return distance ? { x: x / distance * strength, y: y / distance * strength } : { x: 0, y: 0 };
}

function buttonValue(pad, index) {
  const button = pad.buttons?.[index];
  return Number.isFinite(button?.value) ? Math.max(0, Math.min(1, button.value)) : button?.pressed ? 1 : 0;
}

function buttons(pad, previous) {
  return Array.from({ length: BUTTON_COUNT }, (_, i) => {
    if (i === LT || i === RT) return buttonValue(pad, i) > (previous[i] ? TRIGGER_RELEASE : TRIGGER_PRESS);
    return Boolean(pad.buttons?.[i]?.pressed) || buttonValue(pad, i) > 0.5;
  });
}

class GamepadControls {
  constructor(controller, camera, { onCycleCamera, onHorn } = {}) {
    Object.assign(this, { controller, camera, onCycleCamera, onHorn });
    this.connected = false;
    this.using = false;
    this.enabled = true;
    this.previous = [];
    this.suppressed = [];
    this.sync = true;
    this.focused = document.hasFocus();
    window.addEventListener('blur', () => { this.focused = false; this.reset(); });
    window.addEventListener('focus', () => { this.focused = true; this.reset(); });
    document.addEventListener('visibilitychange', () => this.reset());
    window.addEventListener('keydown', () => this.setUsing(false), true);
    window.addEventListener('pointerdown', (e) => { if (e.isTrusted) this.setUsing(false); }, true);
  }

  setUsing(using) {
    if (this.using === using) return;
    this.using = using;
    document.body.classList.toggle('using-gamepad', using);
    this.game?.updateKeybar();
    for (const [menu, pad, keyboard] of [
      [this.game?.arsenal, 'LB', 'TAB'],
      [this.game?.garage, 'View', 'G'],
      [this.game?.phone, '↑', 'P']
    ]) {
      const hint = menu?.button?.querySelector('kbd');
      if (hint) hint.textContent = using ? pad : keyboard;
    }
  }

  readPad() {
    // Some browsers expose the API but reject it through Permissions Policy.
    try {
      const pads = navigator.getGamepads?.();
      let first = null;
      for (const pad of pads ?? []) {
        if (!pad?.connected || pad.mapping !== 'standard') continue;
        if (pad.index === this.padIndex && pad.id === this.padId) return pad;
        first ??= pad;
      }
      return first;
    } catch {
      return null;
    }
  }

  clearCombat() {
    if (this.bufferedShot && this.game) this.game.triggerBuffer = 0;
    this.aim = this.fire = this.firePressed = this.bufferedShot = false;
  }

  reset() {
    this.controller.clearGamepadInput();
    this.clearCombat();
    this.game?.arsenal?.cancelHold('gamepad');
    this.sync = true;
    this.driveBy = false;
    this.viewHold = 0;
    this.direction = '';
    this.repeatAt = 0;
  }

  setEnabled(enabled) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.reset();
  }

  update(dt) {
    const g = this.game;
    if (!g) return;
    const pad = this.readPad();
    if (!pad || pad.index !== this.padIndex || pad.id !== this.padId) {
      if (pad || this.connected) this.reset();
      this.padIndex = pad?.index;
      this.padId = pad?.id;
    }
    this.connected = !!pad;
    if (!pad) { this.setUsing(false); return; }

    const target = document.activeElement;
    const typing = !g.map.isFullMapOpen && (isTypingInField({ target }) || target?.tagName === 'TEXTAREA' || target?.isContentEditable);
    if (!this.focused || document.hidden || !document.hasFocus() || typing) {
      if (!this.sync) this.reset();
      return;
    }

    const dialog = document.querySelector('dialog[open]');
    const context = dialog || (g.openingScreen?.ready ? 'opening' : g.map.isFullMapOpen ? 'map' : g.pauseMenu.visible ? 'pause'
      : g.phone.open ? 'phone' : g.garage.open ? 'garage' : g.shops.open ? 'shop' : g.frontierLife?.view ? 'frontier'
      : this.enabled && g.active ? g.state : 'inactive');
    if (context !== this.context) {
      this.reset();
      this.context = context;
    }
    const previous = this.previous;
    const pressed = this.previous = buttons(pad, previous);
    if (this.sync) {
      // Never let a held trigger or button cross a screen, focus change or vehicle transition.
      this.suppressed = pressed.slice();
      this.sync = false;
    }
    for (let i = 0; i < BUTTON_COUNT; i++) if (!pressed[i]) this.suppressed[i] = false;
    const held = (i) => pressed[i] && !this.suppressed[i];
    const edge = (i) => held(i) && !previous[i];
    const released = (i) => previous[i] && !pressed[i];
    const movement = stick(pad, 0), look = stick(pad, 2);
    const buttonActivity = pressed.some((down, i) => down && !previous[i]);
    if (buttonActivity || Math.hypot(movement.x, movement.y) > 0.12 || Math.hypot(look.x, look.y) > 0.12) this.setUsing(true);

    if (dialog || ['opening', 'map', 'pause', 'phone', 'garage', 'shop', 'frontier'].includes(context)) {
      const direction = this.menuDirection(held, movement, dt);
      if (dialog) g.pauseMenu.controlDialog(dialog, direction, edge(A), edge(B) || edge(MENU));
      else if (context === 'opening') {
        const opening = g.openingScreen;
        if (edge(A)) (opening.root.contains(target) && target.tagName === 'BUTTON' ? target : opening.play).click();
        else if (direction) g.pauseMenu.focusNextButton(opening.root, direction, opening.play);
      } else if (context === 'map') {
        if (edge(B) || edge(MENU) || edge(DOWN)) g.map.toggleFullMap(false);
        else g.map.controlGamepad(movement.x, movement.y, Number(held(RT)) - Number(held(LT)), dt, edge(A), edge(X));
      } else if (context === 'pause') {
        g.pauseMenu.controlGamepad(direction, Number(edge(RB)) - Number(edge(LB)), edge(A), edge(MENU) || edge(B), look.y * dt);
      } else if (context === 'phone') {
        if (edge(B)) g.phone.back();
        else if (edge(A)) g.phone.activate();
        else if (direction) g.phone.navigate(direction);
      } else if (context === 'garage') {
        if (edge(B)) g.garage.close();
        else if (edge(A)) g.garage.pick(g.garage.sel);
        else if (direction) g.garage.navigate(direction);
      } else if (context === 'frontier') {
        g.frontierLife.control(direction, edge(A), edge(B) || edge(Y) || edge(MENU), look.x * dt);
      } else if (edge(B)) g.shops.close();
      else if (edge(A)) g.shops.buy();
      else if (direction === 'up' || direction === 'down') g.shops.navigate(direction === 'up' ? -1 : 1);
      else if (direction === 'left' || direction === 'right') g.shops.turn(direction === 'left' ? -1 : 1);
      else if (edge(LB) || edge(RB)) g.shops.turn(edge(RB) ? 1 : -1);
      return;
    }

    if (context === 'inactive') return;
    if (g.intro) {
      if (pressed.some((_, i) => edge(i)) || Math.hypot(movement.x, movement.y, look.x, look.y) > 0.25) g.endIntro();
      return;
    }
    if (edge(MENU)) {
      this.reset();
      g.setPaused(true);
      return;
    }
    if (edge(DOWN)) {
      this.reset();
      g.releasePointer();
      g.map.toggleFullMap(true);
      return;
    }

    // in an aircraft the bumpers are the rudder pedals, not the weapon wheel
    const wheel = g.arsenal, piloting = !!g.aviation?.piloted;
    if (edge(LB) && !piloting) wheel.press('gamepad');
    if (wheel.open) {
      this.controller.clearGamepadInput();
      this.clearCombat();
      // A trigger pressed in the wheel must be released before it can fire again.
      if (pressed[RT]) this.suppressed[RT] = true;
      if (pressed[LT]) this.suppressed[LT] = true;
      if (edge(B)) wheel.cancelHold('gamepad', true);
      else if (wheel.source === 'gamepad' && released(LB)) wheel.release();
      else if (wheel.sticky && edge(A)) wheel.pick(wheel.sel);
      else wheel.point(look.x, look.y);
      return;
    }
    if (wheel.source === 'gamepad' && released(LB)) wheel.release();

    if (edge(UP)) { g.phone.toggle(); return; }
    if (held(VIEW)) {
      if (this.viewHold >= 0 && (this.viewHold += dt) >= 0.35) {
        this.viewHold = -1;
        g.garage.toggle();
        if (g.garage.open) return;
      }
    } else if (released(VIEW)) {
      if (this.viewHold > 0) this.onCycleCamera?.(1);
      this.viewHold = 0;
    }
    if (edge(Y)) { g.interact(); return; }
    if (edge(A) && g.director.current && g.state !== 'driving') g.director.skip = true;

    const mode = this.controller.activeMode;
    const driving = mode === 'car' || mode === 'cyclist';
    const onFoot = g.state === 'onFoot' || g.state === 'surfing';
    const station = Number(edge(RIGHT)) - Number(edge(LEFT));
    if (station && g.state === 'driving') g.changeRadio(station);
    if (driving) {
      if (edge(L3)) this.onHorn?.();
      if (edge(B)) {
        if (held(X) && g.canDriveBy) g.reload();
        else g.resetStoppedVehicle();
      }
      if (edge(X) && !g.canDriveBy && !g.car.bicycle && g.weapons.pistol) g.selectWeapon('pistol');
    } else if (piloting) {
      if (edge(X)) g.aviation.toggleGear();
      if (edge(R3)) this.camera.resetOrbit();
    } else {
      if (edge(RB)) g.vertical.toggleGrapple();
      if (edge(L3) && onFoot) g.toggleAimAssist();
      if (edge(R3)) {
        if (held(LT) && onFoot) this.camera.swapShoulder();
        else this.camera.resetOrbit();
      }
      if (edge(B) && onFoot) g.reload();
    }
    const driveBy = driving && held(X) && g.canDriveBy;
    if (driveBy !== this.driveBy && pressed[RT] && !edge(RT)) this.suppressed[RT] = true;
    this.driveBy = driveBy;
    this.aim = driveBy || (onFoot && held(LT));
    if (onFoot && edge(LT)) { g.aimToggle = false; g.drawForAim(); }
    const canFire = driveBy || onFoot || (!driving && g.weaponId === 'grapple' && g.vertical.canFire);
    this.fire = canFire && held(RT);
    this.firePressed = canFire && edge(RT);

    const drive = driving ? this.trigger(pad, RT, driveBy) - this.trigger(pad, LT) : -movement.y;
    const vertical = mode === 'helicopter' || mode === 'plane' ? this.trigger(pad, RT) - this.trigger(pad, LT) : 0;
    const steer = driving ? steeringAxis(pad.axes?.[0]) : movement.x;
    const jump = mode === 'person' && held(X);
    this.controller.setGamepadInput('forward', Math.max(0, drive));
    this.controller.setGamepadInput('backward', Math.max(0, -drive));
    this.controller.setGamepadInput('left', Math.max(0, -steer));
    this.controller.setGamepadInput('right', Math.max(0, steer));
    this.controller.setGamepadInput('up', jump || Math.max(0, vertical));
    this.controller.setGamepadInput('jump', jump);
    this.controller.setGamepadInput('run', mode === 'person' && held(A));
    this.controller.setGamepadInput('sprint', (driving && held(RB)) || (piloting && held(A)));
    this.controller.setGamepadInput('lever', piloting ? Math.max(0, -vertical) : 0);
    this.controller.setGamepadInput('yawLeft', piloting && held(LB));
    this.controller.setGamepadInput('yawRight', piloting && held(RB));
    this.controller.setGamepadInput('handbrake', (driving && held(A)) || (piloting && held(B)));
    this.controller.setGamepadInput('down', driving ? held(R3) : Math.max(0, -vertical));
    this.camera.applyGamepadInput(look.x, look.y, 0, dt);
  }

  trigger(pad, index, blocked = false) {
    return blocked || this.suppressed[index] ? 0 : buttonValue(pad, index);
  }

  menuDirection(held, { x, y }, dt) {
    const stickDirection = Math.max(Math.abs(x), Math.abs(y)) > 0.5
      ? (Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up')) : '';
    const direction = held(UP) ? 'up' : held(DOWN) ? 'down' : held(LEFT) ? 'left' : held(RIGHT) ? 'right' : stickDirection;
    if (direction !== this.direction) {
      this.direction = direction;
      this.repeatAt = 0.32;
      return direction;
    }
    if (!direction || (this.repeatAt -= dt) > 0) return '';
    this.repeatAt = 0.13;
    return direction;
  }
}

export { GamepadControls };
