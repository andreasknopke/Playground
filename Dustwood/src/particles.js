// Particles: pooled GPU Points (dust/spark/smoke), instanced tracers (96),
// casings (64), muzzle flash sprite, dust motes, blob shadows (40).
// No per-tick allocations. See Plan.txt §2.16, §3.7.
import * as THREE from 'three';
import { MAT } from './materials.js';
import { FX, LAYERS, BALLISTICS } from './constants.js';
import { Pool } from './utils.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

// Simple Points pool with a CPU-simulated buffer uploaded each frame.
class PointPool {
  constructor(cap, matName, additive) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.size = new Float32Array(cap);
    this.col = new Float32Array(cap * 3);
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1000);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 300 } },
      vertexShader: `
        attribute float aSize; attribute vec3 aColor; attribute float aLife;
        varying vec3 vColor; varying float vLife;
        uniform float uScale;
        void main(){
          vColor = aColor; vLife = aLife;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * (uScale / max(0.001, -mv.z));
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vLife;
        void main(){
          if (vLife <= 0.0) discard;
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.1, length(d));
          gl_FragColor = vec4(vColor, a * clamp(vLife, 0.0, 1.0));
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.layers.set(LAYERS.NO_ENV);
    this.geo = geo;
  }
  spawn(x, y, z, vx, vy, vz, life, size, r, g, b) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.cap;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
  }
  update(dt, gravity) {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const i3 = i * 3;
      this.vel[i3 + 1] -= gravity * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
  }
  reset() { this.life.fill(0); this.geo.attributes.aLife.needsUpdate = true; }
}

export class Particles {
  constructor(G) {
    this.G = G;
    this.group = new THREE.Group();
    this._tracerCursor = 0;
    this._casingCursor = 0;
    this._blobCursor = 0;
    this.tracers = { live: 0, list: [] };
    this._casings = [];
    this._blobs = [];
    this._flash = { mesh: null, life: 0 };
  }

  init() {
    const G = this.G;
    G.scene.add(this.group);

    // Spark / dust / smoke point pools
    this.sparks = new PointPool(1024, null, true);
    this.smoke = new PointPool(FX.smoke * 8, null, false);
    this.dust = new PointPool(FX.dustMotes, null, false);
    this.group.add(this.sparks.points, this.smoke.points, this.dust.points);

    // Tracers: instanced thin cylinders
    const tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 4, 1, true);
    tracerGeo.translate(0, 0.5, 0); // base at origin, extends +Y
    this.tracerMesh = new THREE.InstancedMesh(tracerGeo, MAT.tracer, FX.tracers);
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.layers.set(LAYERS.NO_ENV);
    this._hideAll(this.tracerMesh, FX.tracers);
    this.group.add(this.tracerMesh);
    for (let i = 0; i < FX.tracers; i++) this.tracers.list.push({ active: false, from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, traveled: 0, speed: BALLISTICS.tracerSpeed, radius: 0.012, len: 0.9 });

    // Casings: instanced small cylinders
    const casingGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.09, 6);
    this.casingMesh = new THREE.InstancedMesh(casingGeo, MAT.casingBrass, FX.casings);
    this.casingMesh.frustumCulled = false;
    for (let i = 0; i < FX.casings; i++) { this._casings.push({ active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), angVel: new THREE.Vector3(), life: 0 }); }
    this._hideAll(this.casingMesh, FX.casings);
    this.group.add(this.casingMesh);

    // Muzzle flash sprite (viewmodel layer)
    this._flash.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), MAT.muzzleFlash);
    this._flash.mesh.visible = false;
    this._flash.mesh.layers.set(LAYERS.VIEWMODEL);
    this.group.add(this._flash.mesh);

    // Blob shadows: instanced radial plane on floor
    const blobGeo = new THREE.PlaneGeometry(1, 1);
    blobGeo.rotateX(-Math.PI / 2);
    this.blobMesh = new THREE.InstancedMesh(blobGeo, MAT.blobShadow, 40);
    this.blobMesh.frustumCulled = false;
    this._hideAll(this.blobMesh, 40);
    this.group.add(this.blobMesh);
    for (let i = 0; i < 40; i++) this._blobs.push({ active: false, pos: new THREE.Vector3(), scale: 1, target: null });

    // Init dust motes scattered around player
    this._initDust();
  }

  _initDust() {
    for (let i = 0; i < FX.dustMotes; i++) {
      const x = (this.G.rngBuild() - 0.5) * 40;
      const y = this.G.rngBuild() * 3;
      const z = (this.G.rngBuild() - 0.5) * 20;
      this.dust.spawn(x, y, z, (this.G.rngBuild() - 0.5) * 0.1, 0.02 + this.G.rngBuild() * 0.03, (this.G.rngBuild() - 0.5) * 0.1, 1e9, 0.02, 0.7, 0.65, 0.55);
    }
  }

  _hideAll(mesh, count) {
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < count; i++) mesh.setMatrixAt(i, _m);
    mesh.instanceMatrix.needsUpdate = true;
  }

  emit(pos, dir, count, opts = {}) {
    const spread = opts.spread ?? 1;
    const speed = opts.speed ?? 3;
    const life = opts.life ?? 0.4;
    const size = opts.size ?? 0.05;
    const col = opts.color ?? [1, 0.8, 0.4];
    const gravity = opts.gravity ?? 6;
    for (let i = 0; i < count; i++) {
      const vx = (dir.x + (this.G.rng() - 0.5) * spread) * speed;
      const vy = (dir.y + (this.G.rng() - 0.5) * spread + 0.3) * speed;
      const vz = (dir.z + (this.G.rng() - 0.5) * spread) * speed;
      this.sparks.spawn(pos.x, pos.y, pos.z, vx, vy, vz, life * (0.6 + this.G.rng() * 0.6), size, col[0], col[1], col[2]);
    }
  }

  impact(pos, normal, surface) {
    const col = surface === 'wood' ? [0.6, 0.45, 0.25] : surface === 'metal' ? [1, 0.9, 0.5] : [0.7, 0.65, 0.55];
    this.emit(pos, normal, 6, { spread: 1.2, speed: 4, life: 0.3, size: 0.04, color: col, gravity: 8 });
    // dust puff
    this.smoke.spawn(pos.x, pos.y, pos.z, normal.x * 0.5, normal.y * 0.5 + 0.3, normal.z * 0.5, 0.5, 0.15, 0.5, 0.45, 0.4);
  }

  blood(pos, dir) {
    this.emit(pos, dir, 8, { spread: 0.8, speed: 3, life: 0.5, size: 0.06, color: [0.5, 0.02, 0.02], gravity: 10 });
  }

  smoke(pos, count = 1) {
    for (let i = 0; i < count; i++) {
      this.smoke.spawn(pos.x, pos.y, pos.z, (this.G.rng() - 0.5) * 0.3, 0.4 + this.G.rng() * 0.3, (this.G.rng() - 0.5) * 0.3, FX.smokeLife, 0.2, 0.4, 0.4, 0.4);
    }
  }

  tracer(from, to, radius = 0.012, len = 0.9) {
    const t = this.tracers.list[this._tracerCursor];
    this._tracerCursor = (this._tracerCursor + 1) % FX.tracers;
    t.active = true;
    t.from.copy(from);
    _v.copy(to).sub(from);
    t.dist = _v.length();
    t.dir.copy(_v).normalize();
    t.traveled = 0;
    t.radius = radius;
    t.len = Math.min(len, t.dist);
    t.speed = Math.max(t.dist / BALLISTICS.tracerMaxTime, t.dist / BALLISTICS.tracerMinTime > 0 ? BALLISTICS.tracerSpeed : BALLISTICS.tracerSpeed);
    this.tracers.live = this.tracers.list.reduce((n, x) => n + (x.active ? 1 : 0), 0);
  }

  ejectCasing(pos, right, up, kind = 'brass44') {
    const c = this._casings[this._casingCursor];
    this._casingCursor = (this._casingCursor + 1) % FX.casings;
    c.active = true;
    c.pos.copy(pos);
    c.vel.copy(right).multiplyScalar(2 + this.G.rng()).addScaledVector(up, 2 + this.G.rng());
    c.angVel.set(this.G.rng() * 10, this.G.rng() * 10, this.G.rng() * 10);
    c.rot.set(this.G.rng() * 6, this.G.rng() * 6, this.G.rng() * 6);
    c.life = FX.casingLife;
  }

  muzzleFlash(pos, dir, scale) {
    // world-space flash handled by lighting; here we drive the viewmodel sprite
    this._flash.mesh.position.copy(pos);
    this._flash.mesh.scale.setScalar(scale);
    this._flash.mesh.visible = true;
    this._flash.life = FX.flashLife;
  }

  setBlob(i, pos, scale) {
    if (i >= this._blobs.length) return;
    const b = this._blobs[i];
    b.active = true;
    b.pos.copy(pos);
    b.scale = scale;
  }

  blobShadows() { return this._blobs; }

  update(dt) {
    const G = this.G;
    // sparks / smoke / dust
    this.sparks.update(dt, 8);
    this.smoke.update(dt, -0.2); // smoke rises (negative gravity)
    // dust motes drift, wrap around player
    this._updateDust(dt);

    // tracers
    let live = 0;
    for (let i = 0; i < FX.tracers; i++) {
      const t = this.tracers.list[i];
      if (!t.active) continue;
      t.traveled += t.speed * dt;
      if (t.traveled >= t.dist) { t.active = false; this.tracerMesh.setMatrixAt(i, _m.makeScale(0, 0, 0)); continue; }
      live++;
      // head position
      _v.copy(t.dir).multiplyScalar(t.traveled).add(t.from);
      // orient cylinder from head backward
      _v2.copy(t.dir).multiplyScalar(-1);
      _q.setFromUnitVectors(_upY, _v2);
      _s.set(t.radius, t.len, t.radius);
      _m.compose(_v, _q, _s);
      this.tracerMesh.setMatrixAt(i, _m);
    }
    this.tracerMesh.instanceMatrix.needsUpdate = true;
    this.tracers.live = live;

    // casings
    for (let i = 0; i < FX.casings; i++) {
      const c = this._casings[i];
      if (!c.active) continue;
      c.life -= dt;
      c.vel.y -= 9.8 * dt;
      c.pos.addScaledVector(c.vel, dt);
      if (c.pos.y < 0.02) { c.pos.y = 0.02; c.vel.multiplyScalar(0.3); c.vel.y = 0; c.angVel.multiplyScalar(0.2); }
      c.rot.x += c.angVel.x * dt; c.rot.y += c.angVel.y * dt; c.rot.z += c.angVel.z * dt;
      if (c.life <= 0) { c.active = false; this.casingMesh.setMatrixAt(i, _m.makeScale(0, 0, 0)); continue; }
      _q.setFromEuler(c.rot); _s.set(1, 1, 1);
      _m.compose(c.pos, _q, _s);
      this.casingMesh.setMatrixAt(i, _m);
    }
    this.casingMesh.instanceMatrix.needsUpdate = true;

    // muzzle flash fade
    if (this._flash.life > 0) {
      this._flash.life -= dt;
      if (this._flash.life <= 0) this._flash.mesh.visible = false;
    }

    // blob shadows follow targets
    for (let i = 0; i < this._blobs.length; i++) {
      const b = this._blobs[i];
      if (!b.active) continue;
      _s.set(b.scale, b.scale, b.scale); _q.identity(); _v.set(b.pos.x, 0.02, b.pos.z);
      _m.compose(_v, _q, _s);
      this.blobMesh.setMatrixAt(i, _m);
    }
    this.blobMesh.instanceMatrix.needsUpdate = true;
  }

  _updateDust(dt) {
    const p = this.G.player;
    const cx = p && p.pos ? p.pos.x : 0, cz = p && p.pos ? p.pos.z : 0;
    const pos = this.dust.pos, life = this.dust.life;
    for (let i = 0; i < this.dust.cap; i++) {
      const i3 = i * 3;
      pos[i3] += this.dust.vel[i3] * dt;
      pos[i3 + 1] += this.dust.vel[i3 + 1] * dt;
      pos[i3 + 2] += this.dust.vel[i3 + 2] * dt;
      // wrap around player in a 40x20 box
      if (pos[i3] - cx > 20) pos[i3] -= 40; else if (pos[i3] - cx < -20) pos[i3] += 40;
      if (pos[i3 + 2] - cz > 10) pos[i3 + 2] -= 20; else if (pos[i3 + 2] - cz < -10) pos[i3 + 2] += 20;
      if (pos[i3 + 1] > 3.5) pos[i3 + 1] = 0;
    }
    this.dust.geo.attributes.position.needsUpdate = true;
  }

  getPools() {
    return {
      tracers: { cap: FX.tracers, live: this.tracers.live },
      casings: { cap: FX.casings, live: this._casings.reduce((n, c) => n + (c.active ? 1 : 0), 0) },
      sparks: { cap: this.sparks.cap, live: this.sparks.life.reduce((n, l) => n + (l > 0 ? 1 : 0), 0) },
      smoke: { cap: this.smoke.cap, live: this.smoke.life.reduce((n, l) => n + (l > 0 ? 1 : 0), 0) },
      dust: { cap: this.dust.cap, live: this.dust.cap },
    };
  }

  warmupDone() {}
  render() {}
  reset() {
    this.sparks.reset(); this.smoke.reset();
    for (const t of this.tracers.list) t.active = false;
    this.tracers.live = 0;
    for (const c of this._casings) c.active = false;
    this._flash.life = 0; this._flash.mesh.visible = false;
    this._initDust();
  }
  dispose() {
    this.sparks.geo.dispose(); this.smoke.geo.dispose(); this.dust.geo.dispose();
    this.tracerMesh.geometry.dispose(); this.casingMesh.geometry.dispose(); this.blobMesh.geometry.dispose();
  }
}

const _upY = new THREE.Vector3(0, 1, 0);
