// Player: movement + collision, look, camera sync, recoil spring, view bob,
// head-bob footsteps, shake, health/regen, aim ray. See Plan.txt §2.5.
import * as THREE from 'three';
import { PLAYER } from './constants.js';
import { MASK } from './collision.js';
import { clamp, damp, wrapAngle, Spring3 } from './utils.js';

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _ray = { origin: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, pos: new THREE.Vector3(), normal: new THREE.Vector3(), surface: null, tag: null };

export class Player {
  constructor(G) {
    this.G = G;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.health = PLAYER.maxHealth;
    this.alive = true;
    this.dead = false;
    this.sprinting = false;
    this.god = false;
    this.recoil = { pitch: 0, yaw: 0, roll: 0 };
    this.recoilTarget = { pitch: 0, yaw: 0, roll: 0 };
    this.eye = new THREE.Vector3(0, PLAYER.eyeHeight, 0);
    this.viewRoot = new THREE.Group();
    this._bobPhase = 0;
    this._bob = 0;
    this._bobTarget = 0;
    this._stepAccum = 0;
    this._regenTimer = 0;
    this._hurtFlash = 0;
    this._shake = { amp: 0, decay: 6, x: 0, y: 0 };
    this._fov = PLAYER.fov;
    this._footstep = 0;
    this._lastGroundY = 0;
  }

  init() {
    const G = this.G;
    const spawn = G.town.playerSpawn;
    this.pos.copy(spawn.pos);
    this.yaw = spawn.yaw;
    this.pitch = spawn.pitch || 0;
    this.health = PLAYER.maxHealth;
    this.alive = true; this.dead = false;
    G.camera.add(this.viewRoot);
    this._recoilSpring = new Spring3(260, 20);
    this._syncCameraImmediate();
  }

  // ---- look ----
  setLook(yaw, pitch) {
    this.yaw = wrapAngle(yaw);
    this.pitch = clamp(pitch, -PLAYER.maxPitch, PLAYER.maxPitch);
  }

  aimAt(x, y, z) {
    _fwd.set(x - this.pos.x, y - (this.pos.y + PLAYER.eyeHeight), z - this.pos.z);
    const horiz = Math.hypot(_fwd.x, _fwd.z);
    this.yaw = Math.atan2(-_fwd.x, -_fwd.z);
    this.pitch = Math.atan2(_fwd.y, horiz);
    this.pitch = clamp(this.pitch, -PLAYER.maxPitch, PLAYER.maxPitch);
  }

  getForward(out) { const c = Math.cos(this.pitch); return (out || _fwd).set(-Math.sin(this.yaw) * c, Math.sin(this.pitch), -Math.cos(this.yaw) * c).normalize(); }
  getRight(out) { return (out || _right).set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize(); }

  getAimRay() {
    _ray.origin.set(this.pos.x, this.pos.y + PLAYER.eyeHeight, this.pos.z);
    this.getForward(_ray.dir);
    return _ray;
  }

  // ---- teleport ----
  teleport(x, z, yaw, pitch) {
    this.pos.x = x; this.pos.z = z;
    const fh = this.G.town.floorHeightAt(x, z);
    this.pos.y = fh != null ? fh : 0;
    if (yaw != null) this.yaw = wrapAngle(yaw);
    if (pitch != null) this.pitch = clamp(pitch, -PLAYER.maxPitch, PLAYER.maxPitch);
    this.vel.set(0, 0, 0);
    this._syncCameraImmediate();
  }

  // ---- health ----
  applyDamage(amount, fromPos) {
    if (this.god || !this.alive) return;
    this.health -= amount;
    this._regenTimer = PLAYER.regenDelay;
    this._hurtFlash = 1;
    this.shake(Math.min(0.6, amount * 0.03));
    this.G.bus.emit('player.hurt', { amount, health: this.health, from: fromPos });
    if (this.G.hud) this.G.hud.damageFrom(fromPos);
    if (this.health <= 0) {
      this.health = 0; this.alive = false; this.dead = true;
      this.G.bus.emit('player.die', {});
    }
  }

  heal(amount) { if (!this.alive) return; this.health = clamp(this.health + amount, 0, PLAYER.maxHealth); }
  setHealth(h) { this.health = clamp(h, 0, PLAYER.maxHealth); if (this.health > 0) { this.alive = true; this.dead = false; } }

  shake(amp) { this._shake.amp = Math.max(this._shake.amp, amp); }

  // ---- update ----
  update(dt) {
    const G = this.G;
    const input = G.input;

    // look
    if (input.lookDelta.x || input.lookDelta.y) {
      this.yaw = wrapAngle(this.yaw - input.lookDelta.x * PLAYER.mouseSens);
      this.pitch = clamp(this.pitch - input.lookDelta.y * PLAYER.mouseSens, -PLAYER.maxPitch, PLAYER.maxPitch);
    }

    // movement intent in world space
    const speed = (this.sprinting && input.move.lengthSq() > 0) ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    _move.set(0, 0, 0);
    if (input.move.lengthSq() > 0) {
      // move.x = strafe (+right), move.y = forward (+fwd on yaw plane)
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      _move.x = fx * input.move.y + rx * input.move.x;
      _move.z = fz * input.move.y + rz * input.move.x;
      _move.normalize().multiplyScalar(speed);
    }
    this.sprinting = input.sprint && input.move.lengthSq() > 0 && this.alive;

    // accel / friction
    const accel = PLAYER.accel, fric = PLAYER.friction;
    this.vel.x = damp(this.vel.x, _move.x, _move.lengthSq() > 0 ? accel : fric, dt);
    this.vel.z = damp(this.vel.z, _move.z, _move.lengthSq() > 0 ? accel : fric, dt);

    // integrate + collide (axis-separated for wall sliding)
    if (this.alive) {
      const nx = this.pos.x + this.vel.x * dt;
      const nz = this.pos.z + this.vel.z * dt;
      if (!G.colliders.overlapsCircle(nx, this.pos.z, PLAYER.radius, MASK.PLAYER, this.pos.y, PLAYER.height)) this.pos.x = nx; else this.vel.x = 0;
      if (!G.colliders.overlapsCircle(this.pos.x, nz, PLAYER.radius, MASK.PLAYER, this.pos.y, PLAYER.height)) this.pos.z = nz; else this.vel.z = 0;
      // clamp to town bounds
      this.pos.x = clamp(this.pos.x, -59, 59);
      this.pos.z = clamp(this.pos.z, -13.5, 13.5);
      // floor
      const fh = G.town.floorHeightAt(this.pos.x, this.pos.z);
      this.pos.y = fh != null ? fh : this.pos.y;
    }

    // view bob
    const planarSpeed = Math.hypot(this.vel.x, this.vel.z);
    const moving = planarSpeed > 0.5 && this.alive;
    const hz = this.sprinting ? PLAYER.bobSprintHz : PLAYER.bobWalkHz;
    const amp = this.sprinting ? PLAYER.bobAmpSprint : PLAYER.bobAmpWalk;
    if (moving) {
      this._bobPhase += dt * hz * Math.PI * 2;
      this._bobTarget = Math.sin(this._bobPhase) * amp;
      this._stepAccum += dt;
      const stepEvery = PLAYER.footstepEvery / (this.sprinting ? 1.4 : 1);
      if (this._stepAccum >= stepEvery) {
        this._stepAccum = 0;
        G.bus.emit('player.footstep', { pos: this.pos, sprint: this.sprinting });
      }
    } else {
      this._bobTarget = 0;
    }
    this._bob = damp(this._bob, this._bobTarget, 12, dt);

    // recoil spring recover toward 0
    this._recoilSpring.step(dt);
    this.recoilTarget.pitch = damp(this.recoilTarget.pitch, 0, 6, dt);
    this.recoilTarget.yaw = damp(this.recoilTarget.yaw, 0, 6, dt);
    this.recoilTarget.roll = damp(this.recoilTarget.roll, 0, 6, dt);
    this.recoil.pitch = this._recoilSpring.value.x + this.recoilTarget.pitch;
    this.recoil.yaw = this._recoilSpring.value.y + this.recoilTarget.yaw;
    this.recoil.roll = this._recoilSpring.value.z + this.recoilTarget.roll;

    // shake decay
    this._shake.amp = damp(this._shake.amp, 0, this._shake.decay, dt);
    if (this._shake.amp > 0.001) {
      this._shake.x = (G.rng() - 0.5) * this._shake.amp;
      this._shake.y = (G.rng() - 0.5) * this._shake.amp;
    } else { this._shake.x = 0; this._shake.y = 0; }

    // hurt flash decay
    this._hurtFlash = damp(this._hurtFlash, 0, 3, dt);

    // regen
    if (this.alive && this.health < PLAYER.maxHealth) {
      this._regenTimer -= dt;
      if (this._regenTimer <= 0) this.health = clamp(this.health + PLAYER.regenRate * dt, 0, PLAYER.maxHealth);
    }

    // fov
    const targetFov = this.sprinting ? PLAYER.sprintFov : PLAYER.fov;
    this._fov = damp(this._fov, targetFov, 8, dt);
    G.camera.fov = this._fov;
    G.camera.updateProjectionMatrix();

    this._syncCamera();
  }

  addRecoil(pitch, yaw, roll) {
    this._recoilSpring.vel.x += pitch;
    this._recoilSpring.vel.y += yaw;
    this._recoilSpring.vel.z += (roll || 0);
    // persistent component the player must pull down against
    this.recoilTarget.pitch += pitch * 0.5;
    this.recoilTarget.yaw += yaw * 0.5;
    this.recoilTarget.roll += (roll || 0) * 0.5;
    this.recoilTarget.pitch = clamp(this.recoilTarget.pitch, 0, 0.12);
    this.recoilTarget.yaw = clamp(this.recoilTarget.yaw, -0.06, 0.06);
    this.recoilTarget.roll = clamp(this.recoilTarget.roll, -0.05, 0.05);
  }

  _syncCameraImmediate() { this._syncCamera(); }

  _syncCamera() {
    const G = this.G;
    const cam = G.camera;
    cam.position.set(this.pos.x, this.pos.y + PLAYER.eyeHeight + this._bob, this.pos.z);
    cam.rotation.set(this.pitch + this.recoil.pitch + this._shake.y, this.yaw + this.recoil.yaw + this._shake.x, this.recoil.roll, 'YXZ');
    this.eye.copy(cam.position);
  }

  render() {
    // viewmodel is parented to camera by weapons; nothing here beyond camera sync.
  }

  reset() {
    const spawn = this.G.town.playerSpawn;
    this.pos.copy(spawn.pos); this.yaw = spawn.yaw; this.pitch = spawn.pitch || 0;
    this.vel.set(0, 0, 0);
    this.health = PLAYER.maxHealth; this.alive = true; this.dead = false;
    this.sprinting = false; this.god = false;
    this.recoil.pitch = this.recoil.yaw = this.recoil.roll = 0;
    this.recoilTarget.pitch = this.recoilTarget.yaw = this.recoilTarget.roll = 0;
    this._recoilSpring.reset();
    this._bob = 0; this._bobPhase = 0; this._stepAccum = 0; this._regenTimer = 0; this._hurtFlash = 0;
    this._shake.amp = 0;
    this._fov = PLAYER.fov;
    this._syncCameraImmediate();
  }

  dispose() {}
}
