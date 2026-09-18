// Keyboard/mouse -> InputState, plus debug injection setters. See Plan.txt §2.4.
import * as THREE from 'three';
import { PLAYER } from './constants.js';

export class Input {
  constructor(G) {
    this.G = G;
    this.move = new THREE.Vector2();
    this.moveWorld = null;
    this.lookDelta = { x: 0, y: 0 };
    this.sprint = false;
    this.fire = false;
    this.fireJustPressed = false;
    this.fireJustReleased = false;
    this.reload = false;
    this.interact = false;
    this.restart = false;
    this.switchTo = -1;
    this.cycle = 0;
    this.lastWeapon = false;
    this._keys = new Set();
    this._wheelDebounce = 0;
    this._attached = null;
    this._handlers = {};
  }

  init() {
    this.attach(this.G.canvas);
  }

  attach(domElement) {
    this._attached = domElement;
    const H = this._handlers;
    H.keydown = (e) => this._onKey(e, true);
    H.keyup = (e) => this._onKey(e, false);
    H.mousemove = (e) => {
      if (document.pointerLockElement === this._attached || this.G.opts.headless) {
        this.addLook(e.movementX || 0, e.movementY || 0);
      }
    };
    H.mousedown = (e) => { if (e.button === 0) this.pressFire(); };
    H.mouseup = (e) => { if (e.button === 0) this.holdFire(false); };
    H.wheel = (e) => {
      const now = this.G.time;
      if (now - this._wheelDebounce < 0.12) return;
      this._wheelDebounce = now;
      this.cycle += e.deltaY > 0 ? 1 : -1;
    };
    H.contextmenu = (e) => e.preventDefault();
    window.addEventListener('keydown', H.keydown);
    window.addEventListener('keyup', H.keyup);
    window.addEventListener('mousemove', H.mousemove);
    domElement.addEventListener('mousedown', H.mousedown);
    window.addEventListener('mouseup', H.mouseup);
    domElement.addEventListener('wheel', H.wheel, { passive: true });
    domElement.addEventListener('contextmenu', H.contextmenu);
  }

  detach() {
    const H = this._handlers;
    window.removeEventListener('keydown', H.keydown);
    window.removeEventListener('keyup', H.keyup);
    window.removeEventListener('mousemove', H.mousemove);
    if (this._attached) {
      this._attached.removeEventListener('mousedown', H.mousedown);
      this._attached.removeEventListener('wheel', H.wheel);
      this._attached.removeEventListener('contextmenu', H.contextmenu);
    }
    window.removeEventListener('mouseup', H.mouseup);
  }

  _onKey(e, down) {
    const k = e.key.toLowerCase();
    if (down) this._keys.add(k); else this._keys.delete(k);
    if (down) {
      if (k === 'r') this.pressReload();
      else if (k === 'f') this.pressInteract();
      else if (k === '1') this.pressSwitch(0);
      else if (k === '2') this.pressSwitch(1);
      else if (k === '3') this.pressSwitch(2);
      else if (k === 'q') this.lastWeapon = true;
      else if (k === 'enter') this.restart = true;
    }
  }

  // Called once per tick: derive continuous state from held keys.
  update() {
    const k = this._keys;
    let sx = 0, sy = 0;
    if (k.has('w') || k.has('arrowup')) sy += 1;
    if (k.has('s') || k.has('arrowdown')) sy -= 1;
    if (k.has('a') || k.has('arrowleft')) sx -= 1;
    if (k.has('d') || k.has('arrowright')) sx += 1;
    // Debug moveWorld overrides keyboard.
    if (this.moveWorld) {
      this.move.set(this.moveWorld.x, this.moveWorld.y);
    } else {
      this.move.set(sx, sy);
      if (this.move.lengthSq() > 1) this.move.normalize();
    }
    this.sprint = k.has('shift') || this._sprintFlag;
    // fire held state from mouse
    this.fire = this._fireHeld;
    // consume one-shot flags after update reads them (cleared at end of tick by consumers)
  }

  // ---- injection API ----
  setMove(strafe, forward) { this.move.set(strafe || 0, forward || 0); }
  setMoveWorld(dx, dz) {
    if (dx == null) { this.moveWorld = null; return; }
    this.moveWorld = new THREE.Vector2(dx, dz == null ? 0 : dz);
    if (this.moveWorld.lengthSq() > 1) this.moveWorld.normalize();
  }
  addLook(dx, dy) { this.lookDelta.x += dx; this.lookDelta.y += dy; }
  pressFire() { this._fireHeld = true; this.fireJustPressed = true; }
  holdFire(b) { if (b && !this._fireHeld) this.fireJustPressed = true; if (!b && this._fireHeld) this.fireJustReleased = true; this._fireHeld = b; }
  pressReload() { this.reload = true; }
  pressSwitch(index) { this.switchTo = index; }
  pressInteract() { this.interact = true; }
  setSprint(b) { this._sprintFlag = !!b; }

  // Clear one-shot flags (called by player/weapons after consuming).
  consume() {
    this.lookDelta.x = 0; this.lookDelta.y = 0;
    this.fireJustPressed = false; this.fireJustReleased = false;
    this.reload = false; this.interact = false; this.restart = false;
    this.switchTo = -1; this.cycle = 0; this.lastWeapon = false;
  }

  reset() {
    this._keys.clear();
    this.move.set(0, 0); this.moveWorld = null;
    this.lookDelta.x = 0; this.lookDelta.y = 0;
    this.sprint = false; this.fire = false; this._fireHeld = false;
    this.fireJustPressed = false; this.fireJustReleased = false;
    this.reload = false; this.interact = false; this.restart = false;
    this.switchTo = -1; this.cycle = 0; this.lastWeapon = false;
    this._sprintFlag = false;
  }

  dispose() { this.detach(); }
}
