// Weapons: 3 weapons, state machine, firing/ballistics, reload/break/switch,
// bloom/spread, recoil, damage ownership. Viewmodels via viewmodels.js.
// See Plan.txt §2.18, §4.2, §4.3.
import * as THREE from 'three';
import { WEAPONS, WEAPON_ORDER, BALLISTICS, RECOIL, damageMultiplier } from './constants.js';
import { MASK } from './collision.js';
import { clamp, degToRad, damp } from './utils.js';
import { buildViewmodel, poseFire, poseReload, poseShotgunReload, poseBreak, poseSwitch, resetPose } from './viewmodels.js';

const _dir = new THREE.Vector3();
const _base = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _enemyHit = { enemy: null, group: null, dist: 0, point: [0, 0, 0] };
const _worldHit = {};

function makeState(id) {
  const def = WEAPONS[id];
  return {
    id, def, mag: def.mag, reserve: def.reserve,
    state: 'ready', timer: 0, cooldown: 0, bloom: 0, bloomDelay: 0,
    reloadEmpty: false, reloadShells: 0, reloadShellTimer: 0, reloadPhase: '', reloadShellsLoaded: 0,
    switchFrom: -1, dryTimer: 0, autoReloadTimer: -1,
    vmKick: { pos: new THREE.Vector3(), rot: new THREE.Euler() },
    vmKickVel: { pos: new THREE.Vector3(), rot: new THREE.Vector3() },
    viewmodel: null,
  };
}

export class Weapons {
  constructor(G) {
    this.G = G;
    this.list = WEAPON_ORDER.map(makeState);
    this.current = this.list[0];
    this.index = 0;
    this.lastIndex = 1;
    this.infiniteAmmo = false;
    this.triggerDown = false;
    this._pendingSwitch = -1;
    this._shotFiredThisTick = false;
  }

  init() {
    const G = this.G;
    for (const st of this.list) {
      st.viewmodel = buildViewmodel(st.id);
      st.viewmodel.group.visible = st === this.current;
      G.player.viewRoot.add(st.viewmodel.group);
    }
    this.current.state = 'ready';
    G.bus.on('shot-hit-world', (e) => this._onWorldHit(e));
  }

  // ---- queries ----
  getAmmo() { return { mag: this.current.mag, reserve: this.current.reserve }; }
  getAmmoAll() { const o = {}; for (const s of this.list) o[s.id] = { mag: s.mag, reserve: s.reserve }; return o; }
  getName() { return this.current.def.name; }
  getState() { return this.current.state; }
  canFire() { return this.G.player.alive && !this.G.player.sprinting; }
  getSpreadDeg() {
    const w = this.current.def;
    const p = this.G.player;
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const moveAdd = w.moveSpreadDeg * clamp(speed / 4.2, 0, 1.4);
    return w.spreadDeg + moveAdd + this.current.bloom;
  }

  addAmmo(weaponId, rounds) {
    const s = this.list.find((x) => x.id === weaponId);
    if (!s) return;
    s.reserve = clamp(s.reserve + rounds, 0, s.def.maxReserve);
  }
  resupplyAll() { for (const s of this.list) { s.mag = s.def.mag; s.reserve = s.def.maxReserve; } }

  // ---- trigger ----
  setTrigger(b) {
    this.triggerDown = b;
    if (b) this._tryFire();
  }

  fire() {
    // one-shot fire (debug + semi/lever press)
    return this._tryFire();
  }

  _tryFire() {
    const st = this.current;
    const w = st.def;
    if (!this.canFire()) return false;
    if (st.state !== 'ready') return false;
    if (st.cooldown > 0) return false;
    if (st.mag <= 0 && !this.infiniteAmmo) {
      this._dryFire(st);
      return false;
    }
    this._fireShot(st);
    return true;
  }

  _dryFire(st) {
    if (st.dryTimer > 0) return;
    st.dryTimer = 0.25;
    this.G.bus.emit('weapon-empty', { id: st.id });
    if (st.reserve > 0 || this.infiniteAmmo) st.autoReloadTimer = 0.25;
  }

  _fireShot(st) {
    const G = this.G;
    const w = st.def;
    const p = G.player;
    if (!this.infiniteAmmo) st.mag--;
    st.cooldown = 60 / w.rpm;
    st.bloom = Math.min(w.maxBloomDeg, st.bloom + w.bloomDeg);
    st.bloomDelay = w.bloomDelay;
    st.state = 'firing';
    st.timer = w.mode === 'break' ? w.shotTime : 0.06;

    // aim ray including recoil
    const ray = p.getAimRay();
    _base.copy(ray.dir);
    _muzzle.copy(ray.origin).addScaledVector(_base, 0.3);
    p.getRight(_right);

    // muzzle flash + light
    G.particles.muzzleFlash(_muzzle, _base, w.flashScale);
    G.lighting.flashMuzzle(_muzzle, w.flashLight);
    G.bus.emit('shot-fired', { id: w.id, pos: _muzzle, dir: _base, weapon: w.id });
    G.stats.shotsFired++;

    // pellets
    const pellets = w.pellets;
    const spreadRad = degToRad(this.getSpreadDeg());
    const patternAngle = G.rng() * Math.PI * 2;
    let anyHit = false, anyHead = false, anyKill = false;
    for (let i = 0; i < pellets; i++) {
      _dir.copy(_base);
      let ang = spreadRad * (0.5 + G.rng() * 0.5);
      let az = G.rng() * Math.PI * 2;
      if (pellets > 1 && w.patternRingDeg) {
        // fixed pattern: pellet 0 on axis, 1-3 ring0, 4-8 ring1
        if (i === 0) { ang = 0; }
        else {
          const ring = i <= 3 ? 0 : 1;
          ang = degToRad(w.patternRingDeg[ring]) + degToRad(w.patternJitterDeg) * G.rng();
          az = patternAngle + (i / pellets) * Math.PI * 2;
        }
      }
      if (ang > 0) _perturb(_dir, ang, az);

      const hit = this._trace(ray.origin, _dir, BALLISTICS.maxDist);
      if (hit) {
        const dist = hit.dist;
        if (hit.enemy) {
          const mult = damageMultiplier(hit.group, w.id, hit.enemy.type);
          const falloff = _falloff(w, dist);
          const dmg = w.damage * mult * falloff;
          const res = G.enemies.applyDamage(hit.enemy, hit.group, dmg, hit.point, _dir, w.id);
          anyHit = true;
          if (res.headshot) anyHead = true;
          if (res.killed) anyKill = true;
        } else {
          G.bus.emit('shot-hit-world', { pos: hit.point, normal: hit.normal, surface: hit.surface, tag: hit.tag, dir: _dir, weapon: w.id });
        }
        // tracer
        if (dist >= BALLISTICS.tracerMinDist) {
          _tmp.set(hit.point[0], hit.point[1], hit.point[2]);
          G.particles.tracer(_muzzle, _tmp, w.tracerRadius, w.tracerLen);
        }
      } else {
        // tracer to max range
        _tmp.copy(ray.origin).addScaledVector(_dir, 60);
        G.particles.tracer(_muzzle, _tmp, w.tracerRadius, w.tracerLen);
      }
    }
    if (anyHit) { G.stats.shotsHit++; if (anyHead) G.stats.headshots++; }

    // recoil (camera)
    const kickPitch = degToRad(w.kickPitchDeg) * (0.9 + G.rng() * 0.25);
    const kickYaw = degToRad(w.kickYawDeg) * (G.rng() * 2 - 1);
    const kickRoll = w.kickRollDeg ? degToRad(w.kickRollDeg) * (G.rng() * 2 - 1) : 0;
    p.addRecoil(kickPitch, kickYaw, kickRoll);

    // viewmodel kick
    st.vmKickVel.pos.z += w.vmKickBack;
    st.vmKickVel.rot.x += degToRad(w.vmKickUpDeg);
    st.vmKickVel.rot.z += (G.rng() * 2 - 1) * degToRad(w.vmKickUpDeg) * 0.3;
    st.vmKickVel.pos.x += (G.rng() * 2 - 1) * w.vmKickBack * 0.25;

    // casing (revolver/rifle on shot; shotgun on break stroke)
    if (w.mode !== 'break') G.particles.ejectCasing(_muzzle, _right, _up, w.casing);

    G.hud.onShot();
    if (anyKill) G.hud.hitMarker(true, anyHead);
    else if (anyHit) G.hud.hitMarker(false, anyHead);

    // shotgun transitions to breaking after shot time (handled in update)
  }

  _trace(origin, dir, maxDist) {
    const G = this.G;
    const world = G.colliders.raycast(origin, dir, maxDist, MASK.BULLET, _worldHit);
    const worldDist = world ? world.dist : maxDist;
    _enemyHit.enemy = null;
    const enemy = G.enemies && G.enemies.raycast ? G.enemies.raycast(origin, dir, worldDist, _enemyHit) : null;
    if (enemy && _enemyHit.dist < worldDist) {
      return { enemy: _enemyHit.enemy, group: _enemyHit.group, dist: _enemyHit.dist, point: _enemyHit.point };
    }
    if (world) return { enemy: null, group: null, dist: world.dist, point: world.pos, normal: world.normal, surface: world.surface, tag: world.tag };
    return null;
  }

  _onWorldHit(e) {
    const G = this.G;
    if (e.surface) G.particles.impact(_tmp.set(e.pos[0], e.pos[1], e.pos[2]), _up.set(e.normal[0], e.normal[1], e.normal[2]), e.surface);
  }

  // ---- reload ----
  reload() {
    const st = this.current;
    const w = st.def;
    if (st.state === 'reloading' || st.state === 'lowering' || st.state === 'raising') return false;
    if (st.mag >= w.mag && !this.infiniteAmmo) return false;
    if (st.reserve <= 0 && !this.infiniteAmmo) return false;
    st.state = 'reloading';
    st.reloadEmpty = st.mag === 0;
    st.timer = 0;
    st.reloadPhase = '';
    if (w.mode === 'break') { st.reloadShells = w.mag - st.mag; st.reloadShellTimer = 0; }
    G.bus.emit('weapon-reload', { id: w.id });
    return true;
  }

  // ---- switch ----
  switchTo(indexOrId) {
    let idx = typeof indexOrId === 'number' ? indexOrId : WEAPON_ORDER.indexOf(indexOrId);
    if (idx < 0 || idx >= this.list.length || idx === this.index) return null;
    this.lastIndex = this.index;
    this.index = idx;
    const prev = this.current;
    this.current = this.list[idx];
    this.current.state = 'raising';
    this.current.timer = 0;
    this.current.switchFrom = this.lastIndex;
    prev.state = 'holstered';
    prev.viewmodel.group.visible = false;
    this.current.viewmodel.group.visible = true;
    this.G.bus.emit('weapon-switch', { id: this.current.id });
    return this.current.id;
  }

  switchLast() { return this.switchTo(this.lastIndex); }

  // ---- update ----
  update(dt) {
    const G = this.G;
    const input = G.input;

    // trigger handling for held fire (auto not used; semi/lever use just-pressed)
    if (input.fireJustPressed) this._tryFire();
    if (input.reload) this.reload();
    if (input.switchTo >= 0) this.switchTo(input.switchTo);
    if (input.lastWeapon) this.switchLast();

    for (const st of this.list) {
      const w = st.def;
      // cooldown / bloom
      if (st.cooldown > 0) st.cooldown = Math.max(0, st.cooldown - dt);
      if (st.dryTimer > 0) st.dryTimer = Math.max(0, st.dryTimer - dt);
      if (st.bloomDelay > 0) st.bloomDelay -= dt;
      else if (st.bloom > 0) st.bloom = Math.max(0, st.bloom - w.bloomRecoverDegPerS * dt);
      // auto reload
      if (st.autoReloadTimer > 0) {
        st.autoReloadTimer -= dt;
        if (st.autoReloadTimer <= 0) { st.autoReloadTimer = -1; if (st === this.current) this.reload(); }
      }
      this._updateState(st, dt);
      this._updateVmKick(st, dt);
      this._poseViewmodel(st, dt);
    }
  }

  _updateState(st, dt) {
    const G = this.G;
    const w = st.def;
    switch (st.state) {
      case 'firing':
        st.timer -= dt;
        if (st.timer <= 0) {
          if (w.mode === 'break') { st.state = 'breaking'; st.timer = w.breakTime; }
          else st.state = 'ready';
        }
        break;
      case 'breaking':
        st.timer -= dt;
        if (st.timer <= w.breakTime - w.breakEjectAt && !st._ejected) {
          st._ejected = true;
          _muzzle.set(0, 0, 0);
          G.particles.ejectCasing(G.player.eye, G.player.getRight(_right), _up, w.casing);
        }
        if (st.timer <= 0) { st._ejected = false; st.state = 'ready'; }
        break;
      case 'reloading':
        this._updateReload(st, dt);
        break;
      case 'raising':
        st.timer += dt;
        if (st.timer >= w.raise) st.state = 'ready';
        break;
      case 'lowering':
        st.timer += dt;
        if (st.timer >= w.lower) { st.state = 'raising'; st.timer = 0; }
        break;
      default: break;
    }
  }

  _updateReload(st, dt) {
    const G = this.G;
    const w = st.def;
    st.timer += dt;
    if (w.mode === 'break') {
      // start 0.35, shells 0.55 each, end 0.40. Ammo +1 at 0.6 into each shell.
      const startT = w.reloadStart;
      const shellT = w.reloadShell;
      const endT = w.reloadEnd;
      const total = startT + shellT * st.reloadShells + endT;
      const elapsed = Math.max(0, st.timer - startT);
      const shouldHave = Math.min(st.reloadShells, Math.floor((elapsed + shellT * 0.6) / shellT));
      if (st.reloadShellsLoaded == null) st.reloadShellsLoaded = 0;
      while (st.reloadShellsLoaded < shouldHave && st.mag < w.mag && (this.infiniteAmmo || st.reserve > 0)) {
        st.reloadShellsLoaded++;
        if (!this.infiniteAmmo) { st.mag++; st.reserve--; }
      }
      if (st.timer >= total || st.mag >= w.mag || (!this.infiniteAmmo && st.reserve <= 0)) {
        st.state = 'ready'; st.reloadShellsLoaded = 0;
      }
    } else {
      const dur = st.reloadEmpty ? w.reloadEmpty : w.reload;
      const transferAt = dur * w.reloadTransfer;
      if (!st._transferred && st.timer >= transferAt) {
        st._transferred = true;
        const n = Math.min(w.mag - st.mag, this.infiniteAmmo ? w.mag : st.reserve);
        st.mag += n;
        if (!this.infiniteAmmo) st.reserve -= n;
      }
      if (st.timer >= dur) { st.state = 'ready'; st._transferred = false; }
    }
  }

  _updateVmKick(st, dt) {
    const k = RECOIL.vmSpringK, d = RECOIL.vmSpringD;
    const kp = st.vmKick, kv = st.vmKickVel;
    // position spring (z back, x lateral)
    kv.pos.z += (-k * kp.pos.z - d * kv.pos.z) * dt;
    kp.pos.z += kv.pos.z * dt;
    kv.pos.x += (-k * kp.pos.x - d * kv.pos.x) * dt;
    kp.pos.x += kv.pos.x * dt;
    // rotation spring (x up, z roll)
    kv.rot.x += (-RECOIL.vmRotK * kp.rot.x - RECOIL.vmRotD * kv.rot.x) * dt;
    kp.rot.x += kv.rot.x * dt;
    kv.rot.z += (-RECOIL.vmRotK * kp.rot.z - RECOIL.vmRotD * kv.rot.z) * dt;
    kp.rot.z += kv.rot.z * dt;
  }

  _poseViewmodel(st, dt) {
    const vm = st.viewmodel;
    if (!vm) return;
    const w = st.def;
    const p = this.G.player;
    const bob = p._bob || 0;
    const g = vm.group;
    const rest = vm.rest || { x: 0.12, y: -0.16, z: -0.32, rx: 0, rz: 0 };
    g.position.set(rest.x + st.vmKick.pos.x, rest.y + bob, rest.z - st.vmKick.pos.z);
    g.rotation.set(rest.rx - st.vmKick.rot.x, 0, rest.rz + st.vmKick.rot.z);
    // state poses
    if (st.state === 'firing') poseFire(vm, st.id, Math.max(0, 1 - st.timer / 0.06));
    else if (st.state === 'reloading') {
      if (w.mode === 'break') poseShotgunReload(vm, st.reloadPhase, st.timer);
      else poseReload(vm, st.id, st.timer / (st.reloadEmpty ? w.reloadEmpty : w.reload), st.reloadEmpty);
    } else if (st.state === 'breaking') poseBreak(vm, 1 - st.timer / w.breakTime);
    else if (st.state === 'raising') poseSwitch(vm, st.timer / w.raise, false);
    else if (st.state === 'lowering') poseSwitch(vm, st.timer / w.lower, true);
    else resetPose(vm);
  }

  render() {}

  reset() {
    for (const st of this.list) {
      st.mag = st.def.mag; st.reserve = st.def.reserve;
      st.state = 'ready'; st.timer = 0; st.cooldown = 0; st.bloom = 0;
      st._transferred = false; st._ejected = false; st.reloadShellsLoaded = 0;
      st.vmKick.pos.set(0, 0, 0); st.vmKick.rot.set(0, 0, 0);
      st.vmKickVel.pos.set(0, 0, 0); st.vmKickVel.rot.set(0, 0, 0);
      st.viewmodel.group.visible = st === this.list[0];
    }
    this.index = 0; this.lastIndex = 1; this.current = this.list[0];
    this.triggerDown = false;
  }

  dispose() { for (const st of this.list) st.viewmodel && st.viewmodel.dispose && st.viewmodel.dispose(); }
}

function kp(st) {
  return { x: st.vmKick.pos.x, y: 0, z: 0, zKick: -st.vmKick.pos.z, rx: -st.vmKick.rot.x, rz: st.vmKick.rot.z };
}

function _falloff(w, dist) {
  if (dist <= w.fullRange) return 1;
  if (dist >= w.minRange) return w.minFactor;
  const t = (dist - w.fullRange) / (w.minRange - w.fullRange);
  return 1 + (w.minFactor - 1) * t;
}

// Perturb a unit direction by `angle` radians around azimuth `az` (in the
// plane perpendicular to dir). Mutates and returns dir.
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
function _perturb(dir, angle, az) {
  _tmp.set(0, 1, 0);
  if (Math.abs(dir.y) > 0.9) _tmp.set(1, 0, 0);
  _pa.crossVectors(_tmp, dir).normalize();
  _pb.crossVectors(dir, _pa).normalize();
  const sa = Math.sin(angle), ca = Math.cos(angle);
  const c = Math.cos(az) * sa, s = Math.sin(az) * sa;
  const ox = _pa.x * c + _pb.x * s;
  const oy = _pa.y * c + _pb.y * s;
  const oz = _pa.z * c + _pb.z * s;
  dir.set(dir.x * ca + ox, dir.y * ca + oy, dir.z * ca + oz).normalize();
  return dir;
}
