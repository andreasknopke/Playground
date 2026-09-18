// Enemies: pooled anchored AI (window/roof/barricade), hit capsules, damage,
// death/corpse/sink, vocals, blob shadows. See Plan.txt §2.21, §4.5, §5.
import * as THREE from 'three';
import { MAT } from './materials.js';
import { ENEMY, ENEMY_TYPES, LAYERS } from './constants.js';
import { MASK } from './collision.js';
import { clamp, degToRad, wrapAngle, rayCapsule, raySphere, TMP } from './utils.js';
import {
  buildRig, makePose, applyPose, refreshCapsules, clipIdle, clipPeek, clipAim,
  clipFire, clipDuck, clipReload, clipFlinch, clipDeath, PART_NAMES, PART_GROUP,
} from './rig.js';

const _hit = { enemy: null, group: null, dist: 0, point: [0, 0, 0] };
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _losOut = {};

// A small revolver held in the right hand. Modelled in the hand's local space
// with the barrel pointing +z (the enemy's facing at rest).
function buildEnemyGun() {
  const g = new THREE.Group();
  const gm = MAT.gunmetal, br = MAT.brass;
  const add = (geo, mat, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.x = rx;
    m.layers.set(LAYERS.NO_ENV);
    g.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(0.05, 0.06, 0.26), gm, 0, 0.02, 0.14); // barrel/frame
  add(new THREE.BoxGeometry(0.045, 0.14, 0.05), gm, 0, -0.06, 0.03, 0.35); // grip
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.06, 8), br, 0, 0.0, 0.12, Math.PI / 2); // cylinder
  add(new THREE.BoxGeometry(0.02, 0.03, 0.02), gm, 0, 0.06, 0.26); // front sight
  // The barrel is modelled along +z. The gun is parented to the right_hand bone,
  // whose world orientation changes with every pose, so a static rotation can't
  // keep the barrel level. Instead _aimGun() orients the gun each frame so its
  // local +z (the barrel) points at the player's eye.
  return g;
}

// A cowboy hat: wide brim + creased crown + band. Built in head-bone local
// space; the head joint sits at the neck, the skull centre is ~0.11 above it,
// so the hat is positioned to rest on top of the head.
function buildEnemyHat() {
  const g = new THREE.Group();
  const felt = MAT.hatFelt, band = MAT.hatBand;
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.layers.set(LAYERS.NO_ENV);
    g.add(m);
    return m;
  };
  // brim: wide, thin, slightly upturned via a low cylinder
  add(new THREE.CylinderGeometry(0.26, 0.28, 0.02, 20), felt, 0, 0.17, 0);
  // crown: tapered cylinder sitting on the brim
  add(new THREE.CylinderGeometry(0.11, 0.135, 0.16, 18), felt, 0, 0.25, 0);
  // crease dent on top of the crown
  add(new THREE.BoxGeometry(0.05, 0.03, 0.2), felt, 0, 0.325, 0);
  // hat band around the crown base
  add(new THREE.CylinderGeometry(0.14, 0.14, 0.035, 18), band, 0, 0.185, 0);
  return g;
}

let _nextEnemyId = 1;

class EnemyUnit {
  constructor(index) {
    this.index = index;
    this.id = 0;
    this.active = false;
    const { geometry, rootBone, boneByName, skeleton } = buildRig();
    this.geometry = geometry;
    this.rootBone = rootBone;
    this.boneByName = boneByName;
    this.skeleton = skeleton;
    this.mesh = new THREE.SkinnedMesh(geometry, MAT.enemy);
    this.mesh.add(rootBone);
    this.mesh.bind(skeleton);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(LAYERS.NO_ENV);
    this.mesh.visible = false;
    // Visible pistol rigidly bound to the right hand so it follows the aim pose.
    this.gun = buildEnemyGun();
    rootBone.getObjectByName('right_hand').add(this.gun);
    // Cowboy hat bound to the head so it follows head/pose rotation.
    this.hat = buildEnemyHat();
    rootBone.getObjectByName('head').add(this.hat);
    this.root = new THREE.Group();
    this.root.add(this.mesh);
    this.root.visible = false;
    this.pose = makePose();
    this.capsules = new Float32Array(PART_NAMES.length * 7);
    this.headPos = new THREE.Vector3();
    // state fields
    this.type = 'window';
    this.def = ENEMY_TYPES.window;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.hp = 60; this.maxHp = 60;
    this.state = 'idle';
    this.timer = 0;
    this.phase = 0;
    this.shotsThisMag = 0;
    this.magSize = 3;
    this.flinch = 0;
    this.flinchDir = 1;
    this.deathMode = 'crumple';
    this.variant = 0;
    this.anchorId = null;
    this.anchor = null;
    this.blobIndex = 0;
    this.vocalTimer = 0;
    this.bodyScale = 1;
    this.animPhase = 0;
    this.distToPlayer = 0;
    this.alive = false;
    this.lastHitDir = new THREE.Vector3();
  }
}

export class Enemies {
  constructor(G) {
    this.G = G;
    this.group = new THREE.Group();
    this.pool = [];
    this.alive = [];
    this.aiEnabled = true;
    this.speedScale = 1;
    this.totalKilled = 0;
    this._lodToggle = 0;
  }

  init() {
    const G = this.G;
    G.scene.add(this.group);
    for (let i = 0; i < ENEMY.poolSize; i++) {
      const u = new EnemyUnit(i);
      this.pool.push(u);
      this.group.add(u.root);
    }
    // warm-up placeholder: one enemy parked below the world
    const w = this.pool[0];
    w.root.position.set(0, -50, 0);
    w.root.visible = true;
    w.mesh.visible = true;
  }

  warmupDone() {
    const w = this.pool[0];
    w.root.visible = false;
    w.mesh.visible = false;
  }

  get aliveCount() { return this.alive.length; }
  get corpseCount() {
    let n = 0;
    for (const u of this.pool) if (u.active && (u.state === 'dead' || u.state === 'corpse' || u.state === 'sinking')) n++;
    return n;
  }

  byId(id) {
    for (const u of this.pool) if (u.active && u.id === id) return u;
    return null;
  }

  getAll() {
    const out = [];
    for (const u of this.pool) if (u.active) out.push(u);
    return out;
  }

  forEachAlive(fn) {
    const a = this.alive;
    for (let i = 0; i < a.length; i++) fn(a[i]);
  }

  nearestTo(pos) {
    let best = null, bd = Infinity;
    for (const e of this.alive) {
      const d = e.pos.distanceToSquared(pos);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // ---- spawn ----
  spawn(type, anchor = null, opts = {}) {
    const G = this.G;
    const def = ENEMY_TYPES[type];
    if (!def) return null;
    let u = null;
    for (const p of this.pool) if (!p.active) { u = p; break; }
    if (!u) return null;

    u.id = _nextEnemyId++;
    u.active = true;
    u.type = type;
    u.def = def;
    u.maxHp = def.hp;
    u.hp = opts.hp != null ? opts.hp : def.hp;
    u.variant = G.rng.int(3);
    u.bodyScale = G.rng.range(0.94, 1.06);
    u.animPhase = G.rng() * 10;
    u.vocalTimer = G.rng.range(ENEMY.vocalEvery[0], ENEMY.vocalEvery[1]);
    u.shotsThisMag = 0;
    u.flinch = 0;
    u.deathMode = 'crumple';
    u.alive = true;
    u.blobIndex = 1 + u.index;

    if (opts.pos) {
      u.pos.set(opts.pos.x, 0, opts.pos.z);
      const fh = G.town.floorHeightAt(u.pos.x, u.pos.z);
      u.pos.y = fh != null ? fh : 0;
    } else if (anchor) {
      // Anchors mark the firing/cover point (window sill, barricade top, roof).
      // The rig's feet rest at y=0, so the root must sit on a standable floor:
      // roof anchors carry their own stand height; window/barricade shooters
      // stand on the ground below and rise into their cover via the peek pose.
      u.pos.x = anchor.pos.x;
      u.pos.z = anchor.pos.z;
      if (anchor.kind === 'roof') {
        u.pos.y = anchor.pos.y;
      } else {
        const fh = G.town.floorHeightAt(u.pos.x, u.pos.z);
        u.pos.y = fh != null ? fh : 0;
      }
      u.anchorId = anchor.id;
      u.anchor = anchor;
    } else {
      return null;
    }
    u.yaw = opts.yaw != null ? opts.yaw : this._faceStreet(u);

    // tint variant via material color on the mesh (shared material → use vertex
    // color bake is expensive; use per-mesh material clone cached by variant)
    u.mesh.material = this._variantMat(u.variant);

    u.root.visible = true;
    u.mesh.visible = true;
    u.root.scale.setScalar(u.bodyScale);

    const initState = opts.state || 'idle';
    u.state = initState;
    u.timer = 0;
    u.phase = initState === 'peek' ? 1 : 0;

    // Synchronous: evaluate pose, refresh capsules, blob shadow before return.
    this._applyPose(u, 0);
    this._syncTransform(u);
    u.root.updateMatrixWorld(true);
    refreshCapsules(u.boneByName, u.capsules);
    G.particles.setBlob(u.blobIndex, u.pos, 0.45 * u.bodyScale);

    this.alive.push(u);
    G.bus.emit('enemy-spawn', { enemy: u, anchorId: u.anchorId, type });
    return u;
  }

  _faceStreet(u) {
    // face toward the street centre (z=0) from the building side. The model's
    // front is +z (the pistol is held forward along +z), so at yaw=0 the enemy
    // faces +z: an enemy at z<0 faces the street at yaw=0, one at z>0 at yaw=PI.
    return u.pos.z > 0 ? Math.PI : 0;
  }

  // Smoothly turn an enemy to face the player. The model's front is +z (see
  // _faceDir), so the desired yaw is atan2(dx, dz). Turn is rate-limited so
  // enemies visibly rotate toward the player rather than snapping.
  _facePlayer(u, dt) {
    const p = this.G.player;
    if (!p || !p.alive) return;
    const dx = p.pos.x - u.pos.x;
    const dz = p.pos.z - u.pos.z;
    const desired = Math.atan2(dx, dz);
    const diff = wrapAngle(desired - u.yaw);
    const maxStep = ENEMY.turnRate * dt;
    u.yaw = wrapAngle(u.yaw + clamp(diff, -maxStep, maxStep));
  }

  _variantMat(v) {
    if (!this._mats) this._mats = [];
    if (!this._mats[v]) {
      const m = MAT.enemy.clone();
      const tints = [0xffffff, 0xd8c8b0, 0xc0b0a0];
      m.color = new THREE.Color(tints[v % 3]);
      this._mats[v] = m;
    }
    return this._mats[v];
  }

  // ---- raycast ----
  raycast(origin, dir, maxDist, out = _hit) {
    out.enemy = null;
    let best = Infinity, bestGroup = null;
    for (const e of this.alive) {
      if (!this._hittable(e)) continue;
      // bounding sphere at chest
      const bs = this._chestWorld(e, _v1);
      const tSphere = raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, bs.x, bs.y, bs.z, ENEMY.boundingR);
      if (tSphere < 0 || tSphere > maxDist) continue;
      // head first, then the rest; nearest wins (head priority on ties)
      for (let i = 0; i < PART_NAMES.length; i++) {
        const o = i * 7;
        const t = rayCapsule(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z,
          e.capsules[o], e.capsules[o + 1], e.capsules[o + 2],
          e.capsules[o + 3], e.capsules[o + 4], e.capsules[o + 5], e.capsules[o + 6]);
        if (t >= 0 && t <= maxDist && t < best - 1e-4) {
          best = t;
          bestGroup = PART_NAMES[i];
        }
      }
    }
    if (!bestGroup) return null;
    out.enemy = this._rayOwner; // set below
    // re-scan to find which enemy owns the best hit (cheap: 24 max)
    for (const e of this.alive) {
      if (!this._hittable(e)) continue;
      for (let i = 0; i < PART_NAMES.length; i++) {
        if (PART_NAMES[i] !== bestGroup) continue;
        const o = i * 7;
        const t = rayCapsule(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z,
          e.capsules[o], e.capsules[o + 1], e.capsules[o + 2],
          e.capsules[o + 3], e.capsules[o + 4], e.capsules[o + 5], e.capsules[o + 6]);
        if (Math.abs(t - best) < 1e-4) { out.enemy = e; break; }
      }
      if (out.enemy) break;
    }
    if (!out.enemy) return null;
    out.group = bestGroup === 'head' || bestGroup === 'neck' ? 'head' : PART_GROUP[bestGroup];
    out.dist = best;
    out.point = [origin.x + dir.x * best, origin.y + dir.y * best, origin.z + dir.z * best];
    return out;
  }

  _hittable(e) {
    return e.state === 'peek' || e.state === 'aim' || e.state === 'fire' || e.state === 'duck' || e.state === 'reload';
  }

  _chestWorld(e, out) {
    const b = e.boneByName.chest;
    out.set(0, 0.12, 0).applyMatrix4(b.matrixWorld);
    return out;
  }

  hitVolumeCenter(enemy, group, out) {
    // find a capsule whose group matches; use midpoint of chest/head
    const want = group === 'head' ? 'head' : group === 'torso' ? 'chest' : group;
    for (let i = 0; i < PART_NAMES.length; i++) {
      if (PART_NAMES[i] !== want && PART_GROUP[PART_NAMES[i]] !== want) continue;
      const o = i * 7;
      out.set(
        (enemy.capsules[o] + enemy.capsules[o + 3]) / 2,
        (enemy.capsules[o + 1] + enemy.capsules[o + 4]) / 2,
        (enemy.capsules[o + 2] + enemy.capsules[o + 5]) / 2);
      return out;
    }
    return null;
  }

  // ---- damage ----
  applyDamage(enemy, part, damage, point, dir, weaponId) {
    if (!enemy || !enemy.active || !enemy.alive) return { killed: false, headshot: false, staggered: false };
    const G = this.G;
    const headshot = part === 'head';
    enemy.hp -= damage;
    enemy.flinch = 1;
    enemy.flinchDir = dir ? -Math.sign(dir.clone().dot(this._faceDir(enemy, _v2))) : 1;
    if (dir) enemy.lastHitDir.copy(dir);
    G.stats.damageDealt += damage;
    const killed = enemy.hp <= 0;
    const pos = point ? TMP.v1.set(point[0], point[1], point[2]) : this.hitVolumeCenter(enemy, 'torso', TMP.v1);
    G.bus.emit('enemy-hit', {
      enemy, part, group: PART_GROUP[part] ?? part, damage,
      pos, normal: null, dir, weapon: weaponId, killed, headshot,
    });
    let staggered = false;
    if (killed) {
      this._die(enemy, weaponId, headshot);
    } else if (damage >= 25) {
      staggered = true;
      // interrupt aim/peek into duck briefly
      if (enemy.state === 'aim' || enemy.state === 'peek') {
        enemy.state = 'duck';
        enemy.timer = 0;
        enemy.phase = 0;
      }
    }
    return { killed, headshot, staggered };
  }

  _faceDir(e, out) {
    // model front is +z, so at yaw=0 the enemy faces +z
    return out.set(Math.sin(e.yaw), 0, Math.cos(e.yaw));
  }

  _die(enemy, weaponId, headshot) {
    const G = this.G;
    enemy.alive = false;
    enemy.state = 'dead';
    enemy.timer = 0;
    enemy.phase = 0;
    // fall direction: back if hit from front and strong, else crumple
    const face = this._faceDir(enemy, _v1);
    const fromFront = enemy.lastHitDir.dot(face) < 0;
    enemy.deathMode = fromFront ? 'back' : 'crumple';
    const idx = this.alive.indexOf(enemy);
    if (idx >= 0) this.alive.splice(idx, 1);
    G.stats.kills++;
    G.stats.killsByType[enemy.type] = (G.stats.killsByType[enemy.type] || 0) + 1;
    this.totalKilled++;
    G.bus.emit('enemy-killed', {
      enemy, type: enemy.type, part: headshot ? 'head' : 'torso', weapon: weaponId,
      headshot, pos: enemy.pos, dir: enemy.lastHitDir,
    });
  }

  kill(enemy, weaponId = 'debug') {
    if (!enemy || !enemy.active || !enemy.alive) return;
    const center = this.hitVolumeCenter(enemy, 'torso', TMP.v1);
    enemy.hp = 0;
    this._die(enemy, weaponId, false);
  }

  killAll({ silent = false } = {}) {
    const list = this.alive.slice();
    for (const e of list) this.kill(e, 'debug');
    return list.length;
  }

  // ---- update ----
  update(dt) {
    const G = this.G;
    this._lodToggle ^= 1;
    const player = G.player;
    const px = player.pos.x, pz = player.pos.z;

    for (const u of this.pool) {
      if (!u.active) continue;
      u.distToPlayer = Math.hypot(u.pos.x - px, u.pos.z - pz);

      // vocals
      if (u.alive && u.distToPlayer < 25) {
        u.vocalTimer -= dt * this.speedScale;
        if (u.vocalTimer <= 0) {
          u.vocalTimer = G.rng.range(ENEMY.vocalEvery[0], ENEMY.vocalEvery[1]);
          G.bus.emit('enemy-vocal', { enemy: u, type: u.type, pos: u.pos });
        }
      }

      if (u.alive) this._updateAI(u, dt);
      else this._updateDeath(u, dt);

      // flinch decay
      u.flinch = Math.max(0, u.flinch - dt * 6);

      this._applyPose(u, dt);
      this._syncTransform(u);
      u.root.updateMatrixWorld(true);
      // Point the pistol barrel at the player while engaged. lookAt accounts for
      // the hand bone's world orientation and keeps the gun upright.
      if (u.alive && u.state !== 'idle' && player.eye) u.gun.lookAt(player.eye);
      refreshCapsules(u.boneByName, u.capsules);
      const hb = u.boneByName.head;
      u.headPos.set(0, 0.11, 0).applyMatrix4(hb.matrixWorld);

      // blob shadow
      const blobAlpha = u.alive ? 1 : (u.state === 'sinking' ? Math.max(0, 1 - u.timer / ENEMY.sinkTime) : 1);
      if (blobAlpha > 0) G.particles.setBlob(u.blobIndex, u.pos, 0.45 * u.bodyScale * blobAlpha);
    }
  }

  _updateAI(u, dt) {
    const G = this.G;
    if (!this.aiEnabled) return;
    const sdt = dt * this.speedScale;
    u.timer += sdt;
    const r = G.rng;
    // Once engaged (any state other than idle), turn to face the player so the
    // gun tracks them and shots are aimed at them rather than the street.
    if (u.state !== 'idle') this._facePlayer(u, sdt);
    switch (u.state) {
      case 'idle': {
        const peekT = r.range(ENEMY.peekTime[0], ENEMY.peekTime[1]);
        if (u.timer >= peekT * 0.5) {
          u.state = 'peek'; u.timer = 0; u.phase = 0;
          G.bus.emit('enemy-peek', { enemy: u });
        }
        break;
      }
      case 'peek': {
        const dur = r.range(ENEMY.peekTime[0], ENEMY.peekTime[1]);
        u.phase = clamp(u.timer / dur, 0, 1);
        if (u.timer >= dur) { u.state = 'aim'; u.timer = 0; u.phase = 1; }
        break;
      }
      case 'aim': {
        const dur = r.range(ENEMY.aimTime[0], ENEMY.aimTime[1]);
        if (u.timer >= dur) {
          u.state = 'fire'; u.timer = 0;
          this._enemyFire(u);
        }
        break;
      }
      case 'fire': {
        if (u.timer >= ENEMY.fireTime) {
          u.shotsThisMag++;
          if (u.shotsThisMag >= u.magSize) {
            u.state = 'reload'; u.timer = 0; u.shotsThisMag = 0;
          } else {
            u.state = 'duck'; u.timer = 0; u.phase = 0;
            G.bus.emit('enemy-duck', { enemy: u });
          }
        }
        break;
      }
      case 'duck': {
        const dur = r.range(ENEMY.duckTime[0], ENEMY.duckTime[1]);
        u.phase = clamp(u.timer / dur, 0, 1);
        if (u.timer >= dur) { u.state = 'idle'; u.timer = 0; u.phase = 0; }
        break;
      }
      case 'reload': {
        const dur = r.range(ENEMY.reloadTime[0], ENEMY.reloadTime[1]);
        if (u.timer >= dur) { u.state = 'peek'; u.timer = 0; u.phase = 0; }
        break;
      }
      default: break;
    }
  }

  _enemyFire(u) {
    const G = this.G;
    const r = G.rng;
    const player = G.player;
    if (!player.alive) return;
    const eye = player.eye;
    _v1.set(eye.x - u.pos.x, eye.y - (u.pos.y + 1.4), eye.z - u.pos.z);
    const dist = _v1.length();
    const range = u.type === 'barricade' ? 25 : ENEMY.fireRange;
    if (dist > range) return;
    // accuracy: hit chance falls off with distance and accuracy cone
    const accDeg = r.range(ENEMY.fireAccuracyDeg[0], ENEMY.fireAccuracyDeg[1]);
    const hitChance = clamp(1 - dist / (range * 1.4), 0.08, 0.85) * clamp(1.5 - accDeg * 0.4, 0.3, 1);
    const muzzle = TMP.v2.set(u.pos.x, u.pos.y + 1.35, u.pos.z);
    _v2.copy(_v1).normalize();
    G.bus.emit('shot-fired', { weapon: 'enemy', origin: muzzle, dir: _v2, muzzle, enemy: u, id: 'enemy' });
    // line-of-sight: cover (buildings, barricades, lamp posts) blocks the shot
    const los = G.colliders.raycast(muzzle, _v2, dist, MASK.SOLID, _losOut);
    const blocked = los && los.dist < dist - 0.4;
    if (!blocked && r() < hitChance) {
      const dmg = r.range(ENEMY.damage[0], ENEMY.damage[1]);
      player.applyDamage(dmg, u.pos, u);
    }
    // muzzle flash light + tracer occasionally
    G.lighting.flashMuzzle(muzzle, 6);
    if (G.particles.tracer) {
      const end = blocked
        ? TMP.v1.set(los.pos[0], los.pos[1], los.pos[2])
        : TMP.v1.set(eye.x, eye.y, eye.z);
      G.particles.tracer(muzzle, end, 0.008, 0.6);
    }
  }

  _updateDeath(u, dt) {
    const G = this.G;
    u.timer += dt;
    switch (u.state) {
      case 'dead': {
        u.phase = clamp(u.timer / ENEMY.deathFallTime, 0, 1);
        if (u.timer >= ENEMY.deathFallTime) {
          u.state = 'corpse'; u.timer = 0;
          G.bus.emit('enemy-rest', { enemy: u, pos: u.pos });
        }
        break;
      }
      case 'corpse': {
        if (u.timer >= ENEMY.corpseTime) { u.state = 'sinking'; u.timer = 0; }
        break;
      }
      case 'sinking': {
        u.phase = clamp(u.timer / ENEMY.sinkTime, 0, 1);
        if (u.timer >= ENEMY.sinkTime) this._release(u);
        break;
      }
      default: break;
    }
  }

  _release(u) {
    const G = this.G;
    u.active = false;
    u.root.visible = false;
    u.mesh.visible = false;
    // hide blob
    G.particles.setBlob(u.blobIndex, TMP.v1.set(0, -50, 0), 0.001);
  }

  _applyPose(u, dt) {
    const pose = u.pose;
    pose.fill(0);
    const t = u.animPhase + this.G.time;
    clipIdle(pose, t, 0.6);
    switch (u.state) {
      case 'idle': break;
      case 'peek': clipPeek(pose, t, u.phase, 1); break;
      case 'aim': clipPeek(pose, t, 1, 1); clipAim(pose, t, 0, 1); break;
      case 'fire':
        clipPeek(pose, t, 1, 1);
        clipAim(pose, t, 0, 1);
        clipFire(pose, 1 - clamp(u.timer / ENEMY.fireTime, 0, 1), 1);
        break;
      case 'duck': clipDuck(pose, u.phase, 1); break;
      case 'reload': clipReload(pose, clamp(u.timer / 2, 0, 1), 1); break;
      case 'dead': clipDeath(pose, u.phase, u.deathMode, 1); break;
      case 'corpse': clipDeath(pose, 1, u.deathMode, 1); break;
      case 'sinking': clipDeath(pose, 1, u.deathMode, 1); break;
      default: break;
    }
    if (u.flinch > 0) clipFlinch(pose, u.flinch, u.flinchDir, 1);
    applyPose(u.boneByName, pose);
  }

  _syncTransform(u) {
    u.root.position.copy(u.pos);
    u.root.rotation.y = u.yaw;
    // The death pose tips the body horizontal around the pelvis (rest y~0.96),
    // which would otherwise leave the corpse hovering at hip height. Lower the
    // root as the body falls so it settles onto the ground, then keep sinking.
    // The drop is per death mode because each tips the body a different amount.
    if (u.state === 'dead' || u.state === 'corpse' || u.state === 'sinking') {
      const fall = u.state === 'dead' ? u.phase : 1;
      const drop0 = ENEMY.deathDrop[u.deathMode] ?? ENEMY.deathDrop.crumple;
      let drop = drop0 * fall;
      if (u.state === 'sinking') drop += u.phase * ENEMY.sinkDepth;
      u.root.position.y = u.pos.y - drop;
    }
  }

  render() {}

  reset() {
    for (const u of this.pool) {
      u.active = false;
      u.alive = false;
      u.root.visible = false;
      u.mesh.visible = false;
    }
    this.alive.length = 0;
    this.totalKilled = 0;
  }

  dispose() {
    for (const u of this.pool) {
      u.geometry.dispose();
    }
    if (this._mats) for (const m of this._mats) m && m.dispose();
  }
}
