// Decals: three ring-buffer InstancedMeshes (bullet holes 256, blood splats
// 128, blood pools 24). Bus-driven. See Plan.txt §2.17.
import * as THREE from 'three';
import { MAT } from './materials.js';
import { FX, LAYERS } from './constants.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _n = new THREE.Vector3();
const _off = new THREE.Vector3();
const _pos = new THREE.Vector3();

class DecalRing {
  constructor(cap, matName, life) {
    this.cap = cap;
    this.cursor = 0;
    this.life = new Float32Array(cap);
    const geo = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.InstancedMesh(geo, MAT[matName], cap);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(LAYERS.DEFAULT);
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this._lifeTime = life;
  }
  add(pos, normal, size, rot) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.cap;
    _p.copy(pos);
    _q.setFromUnitVectors(_up, normal);
    if (rot) { const r = new THREE.Quaternion().setFromAxisAngle(_up, rot); _q.multiply(r); }
    _s.set(size, size, size);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.life[i] = this._lifeTime;
  }
  update(dt) {
    let dirty = false;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0)); dirty = true; }
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
  reset() {
    this.life.fill(0);
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < this.cap; i++) this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Decals {
  constructor(G) {
    this.G = G;
    this.group = new THREE.Group();
  }

  init() {
    const G = this.G;
    G.scene.add(this.group);
    this.holes = new DecalRing(FX.decalsHoles, 'decalHole', FX.decalLife);
    this.splats = new DecalRing(FX.decalsSplats, 'decalBlood', FX.decalLife);
    this.pools = new DecalRing(FX.decalsPools, 'decalPool', FX.decalLife);
    this.group.add(this.holes.mesh, this.splats.mesh, this.pools.mesh);

    G.bus.on('bullet.impact', (e) => {
      if (e.surface === 'flesh') return;
      this.addBulletHole(e.pos, e.normal, e.radius ?? 0.06);
    });
    G.bus.on('enemy.hit', (e) => {
      if (e.blood) this.addBloodSplat(e.pos, e.normal ?? _up, 0.3 + G.rng() * 0.2);
    });
    G.bus.on('enemy.die', (e) => {
      this.addBloodPool(e.pos, 0.6 + G.rng() * 0.4);
      this.addBloodSplat(new THREE.Vector3(e.pos.x, e.pos.y + 0.5, e.pos.z), _up, 0.5);
    });
  }

  addBulletHole(pos, normal, radius = 0.06) {
    _n.copy(normal || _up).normalize();
    _off.copy(_n).multiplyScalar(FX.decalOffset);
    _pos.copy(pos).add(_off);
    this.holes.add(_pos, _n, radius * 2, this.G.rng() * Math.PI * 2);
  }

  addBloodSplat(pos, normal, size = 0.4) {
    _n.copy(normal || _up).normalize();
    _off.copy(_n).multiplyScalar(FX.decalOffset);
    _pos.copy(pos).add(_off);
    this.splats.add(_pos, _n, size, this.G.rng() * Math.PI * 2);
  }

  addBloodPool(pos, size = 0.8) {
    _pos.set(pos.x, 0.01, pos.z);
    this.pools.add(_pos, _up, size, this.G.rng() * Math.PI * 2);
  }

  update(dt) {
    this.holes.update(dt);
    this.splats.update(dt);
    this.pools.update(dt);
  }

  warmupDone() {}
  reset() { this.holes.reset(); this.splats.reset(); this.pools.reset(); }
  dispose() { this.holes.mesh.geometry.dispose(); this.splats.mesh.geometry.dispose(); this.pools.mesh.geometry.dispose(); }
}
