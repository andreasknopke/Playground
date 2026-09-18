// Shared leaf utilities: RNG, math, pooling, spatial hash, springs, geometry
// helpers, ray/circle tests, and vertex-AO baking. See Plan.txt §2.5.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---- RNG (mulberry32) ----
export function mulberry32(seed) {
  let a = seed >>> 0;
  const rng = function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (lo, hi) => lo + (hi - lo) * rng();
  rng.int = (n) => Math.floor(rng() * n);
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.sign = () => (rng() < 0.5 ? -1 : 1);
  rng.gauss = () => {
    // Box-Muller
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  rng.seed = (n) => { a = n >>> 0; };
  rng.state = () => a >>> 0;
  return rng;
}

// ---- Math ----
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
export const easeInCubic = (t) => t * t * t;
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export function lerpAngle(a, b, t) {
  return a + wrapAngle(b - a) * t;
}
export const degToRad = (d) => (d * Math.PI) / 180;
export const radToDeg = (r) => (r * 180) / Math.PI;
// forward = (-sin yaw, 0, -cos yaw); yawFromDir(dx,dz) = atan2(-dx,-dz)
export const yawFromDir = (dx, dz) => Math.atan2(-dx, -dz);
export function dirFromYaw(yaw, out = new THREE.Vector3()) {
  return out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
}

// ---- Pool ----
export class Pool {
  constructor(capacity, factory) {
    this.capacity = capacity;
    this.factory = factory;
    this.items = new Array(capacity);
    this.active = [];
    this.free = [];
    for (let i = 0; i < capacity; i++) {
      const it = factory(i);
      it._poolIndex = i;
      it._poolActive = false;
      this.items[i] = it;
      this.free.push(i);
    }
  }
  acquire() {
    if (this.free.length === 0) {
      // steal oldest active
      const oldest = this.active.shift();
      if (oldest) {
        oldest._poolActive = false;
        this.free.push(oldest._poolIndex);
      }
    }
    const idx = this.free.pop();
    const it = this.items[idx];
    it._poolActive = true;
    this.active.push(it);
    return it;
  }
  tryAcquire() {
    if (this.free.length === 0) return null;
    return this.acquire();
  }
  release(item) {
    if (!item || !item._poolActive) return;
    item._poolActive = false;
    const i = this.active.indexOf(item);
    if (i >= 0) this.active.splice(i, 1);
    this.free.push(item._poolIndex);
  }
  forEachActive(fn) {
    const a = this.active;
    for (let i = 0; i < a.length; i++) fn(a[i]);
  }
  reset() {
    for (let i = 0; i < this.active.length; i++) this.active[i]._poolActive = false;
    this.active.length = 0;
    this.free.length = 0;
    for (let i = 0; i < this.capacity; i++) this.free.push(i);
  }
  get live() { return this.active.length; }
}

// ---- SpatialHash (2D, XZ) ----
export class SpatialHash {
  constructor(cell = 8) {
    this.cell = cell;
    this.map = new Map();
  }
  _key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  clear() { this.map.clear(); }
  insert(x, z, item) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    const k = this._key(cx, cz);
    let arr = this.map.get(k);
    if (!arr) { arr = []; this.map.set(k, arr); }
    arr.push(item);
  }
  query(x, z, r, out) {
    out.length = 0;
    const c0x = Math.floor((x - r) / this.cell), c1x = Math.floor((x + r) / this.cell);
    const c0z = Math.floor((z - r) / this.cell), c1z = Math.floor((z + r) / this.cell);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const arr = this.map.get(this._key(cx, cz));
        if (arr) for (let i = 0; i < arr.length; i++) out.push(arr[i]);
      }
    }
    return out;
  }
}

// ---- Spring (scalar) ----
export class Spring {
  constructor(k = 200, d = 20) { this.k = k; this.d = d; this.value = 0; this.vel = 0; this.target = 0; }
  step(dt) {
    const acc = -this.k * (this.value - this.target) - this.d * this.vel;
    this.vel += acc * dt;
    this.value += this.vel * dt;
    return this.value;
  }
  impulse(v) { this.vel += v; }
  reset(v = 0) { this.value = v; this.vel = 0; this.target = 0; }
}

// ---- Spring3 (vector) ----
export class Spring3 {
  constructor(k = 200, d = 20) {
    this.k = k; this.d = d;
    this.value = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.target = new THREE.Vector3();
  }
  step(dt) {
    const _t = TMP.v1.copy(this.value).sub(this.target).multiplyScalar(-this.k);
    _t.addScaledVector(this.vel, -this.d);
    this.vel.addScaledVector(_t, dt);
    this.value.addScaledVector(this.vel, dt);
    return this.value;
  }
  impulse(v) { this.vel.add(v); }
  reset() { this.value.set(0, 0, 0); this.vel.set(0, 0, 0); this.target.set(0, 0, 0); }
}

// ---- Geometry helpers ----
export function makeBox(w, h, d) { return new THREE.BoxGeometry(w, h, d); }
export function makePlane(w, h) { return new THREE.PlaneGeometry(w, h); }
export function transformGeo(geo, matrix) { geo.applyMatrix4(matrix); return geo; }
export function mergeGeos(geos, useGroups = false) {
  const list = geos.filter(Boolean);
  if (list.length === 0) return new THREE.BufferGeometry();
  if (list.length === 1) return list[0];
  return mergeGeometries(list, useGroups);
}
export function ensureColorAttr(geo, color = 0xffffff) {
  if (geo.getAttribute('color')) return geo;
  const pos = geo.getAttribute('position');
  const c = new THREE.Color(color);
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// Bake cheap vertex AO: darken vertices near occluder boxes / the floor.
// occluders: array of {min:[x,y,z], max:[x,y,z]}. Runs at init only.
export function bakeVertexAO(geo, occluders = [], opts = {}) {
  const radius = opts.radius ?? 0.6;
  const strength = opts.strength ?? 0.5;
  const floorY = opts.floorY ?? 0;
  const pos = geo.getAttribute('position');
  const n = pos.count;
  ensureColorAttr(geo, 0xffffff);
  const col = geo.getAttribute('color');
  const v = TMP.v1, v2 = TMP.v2;
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    let occ = 0;
    // floor proximity
    const dy = v.y - floorY;
    if (dy < radius) occ = Math.max(occ, (1 - dy / radius) * strength * 0.6);
    for (let o = 0; o < occluders.length; o++) {
      const b = occluders[o];
      // distance from vertex to box surface
      const cx = clamp(v.x, b.min[0], b.max[0]);
      const cy = clamp(v.y, b.min[1], b.max[1]);
      const cz = clamp(v.z, b.min[2], b.max[2]);
      const dx = v.x - cx, dyy = v.y - cy, dz = v.z - cz;
      const d = Math.sqrt(dx * dx + dyy * dyy + dz * dz);
      if (d < radius) occ = Math.max(occ, (1 - d / radius) * strength);
    }
    const shade = 1 - clamp(occ, 0, 1);
    col.setXYZ(i, col.getX(i) * shade, col.getY(i) * shade, col.getZ(i) * shade);
  }
  col.needsUpdate = true;
  return geo;
}

// ---- InstancedMesh helpers ----
export function setInstance(mesh, i, matrix, color) {
  mesh.setMatrixAt(i, matrix);
  if (color !== undefined) mesh.setColorAt(i, color);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}
const _hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
export function hideInstance(mesh, i) {
  mesh.setMatrixAt(i, _hiddenMatrix);
  mesh.instanceMatrix.needsUpdate = true;
}

// ---- Ray tests ----
// Returns nearest positive t or -1.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const ex = cx - ox, ey = cy - oy, ez = cz - oz;
  const b = ex * dx + ey * dy + ez * dz;
  const c = ex * ex + ey * ey + ez * ez - r * r;
  if (c > 0 && b < 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let t = b - s;
  if (t < 0) t = b + s;
  return t < 0 ? -1 : t;
}

// Capsule: segment a-b radius r, ray o + t*d. Returns t or -1.
export function rayCapsule(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, r) {
  // transform to cylinder space
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  if (len2 < 1e-9) return raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r);
  const axn = abx / Math.sqrt(len2), ayn = aby / Math.sqrt(len2), azn = abz / Math.sqrt(len2);
  // basis
  let upx = 0, upy = 1, upz = 0;
  if (Math.abs(ayn) > 0.99) { upx = 1; upy = 0; }
  let u1x = ayn * upz - azn * upy, u1y = azn * upx - axn * upz, u1z = axn * upy - ayn * upx;
  const l1 = Math.hypot(u1x, u1y, u1z); u1x /= l1; u1y /= l1; u1z /= l1;
  const u2x = ayn * u1z - azn * u1y, u2y = azn * u1x - axn * u1z, u2z = axn * u1y - ayn * u1x;
  const px = ox - ax, py = oy - ay, pz = oz - az;
  const p1 = px * u1x + py * u1y + pz * u1z;
  const p2 = px * u2x + py * u2y + pz * u2z;
  const pa = px * axn + py * ayn + pz * azn;
  const d1 = dx * u1x + dy * u1y + dz * u1z;
  const d2 = dx * u2x + dy * u2y + dz * u2z;
  const da = dx * axn + dy * ayn + dz * azn;
  const len = Math.sqrt(len2);
  // infinite cylinder in (u1,u2)
  const A = d1 * d1 + d2 * d2;
  const B = 2 * (p1 * d1 + p2 * d2);
  const C = p1 * p1 + p2 * p2 - r * r;
  let t = -1;
  if (A > 1e-8) {
    const disc = B * B - 4 * A * C;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      let t0 = (-B - s) / (2 * A);
      if (t0 < 0) t0 = (-B + s) / (2 * A);
      if (t0 >= 0) {
        const h = pa + da * t0;
        if (h >= 0 && h <= len) t = t0;
      }
    }
  }
  // caps
  const ts = raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r);
  if (ts >= 0 && (t < 0 || ts < t)) t = ts;
  const te = raySphere(ox, oy, oz, dx, dy, dz, bx, by, bz, r);
  if (te >= 0 && (t < 0 || te < t)) t = te;
  return t;
}

// Axis-aligned box slab test. min/max are [x,y,z]. Returns t or -1.
export function rayBox(ox, oy, oz, dx, dy, dz, min, max) {
  let tmin = -Infinity, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return -1;
    } else {
      let t1 = (min[i] - o[i]) / d[i];
      let t2 = (max[i] - o[i]) / d[i];
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  if (tmax < 0) return -1;
  return tmin >= 0 ? tmin : 0;
}

// Vertical cylinder (axis Y) at (cx,cz) radius r, y in [y0,y1]. Returns t or -1.
export function rayCylinderY(ox, oy, oz, dx, dy, dz, cx, cz, r, y0, y1) {
  const px = ox - cx, pz = oz - cz;
  const A = dx * dx + dz * dz;
  const B = 2 * (px * dx + pz * dz);
  const C = px * px + pz * pz - r * r;
  let tSide = -1;
  if (A > 1e-9) {
    const disc = B * B - 4 * A * C;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      let t0 = (-B - s) / (2 * A);
      if (t0 < 0) t0 = (-B + s) / (2 * A);
      if (t0 >= 0) {
        const y = oy + dy * t0;
        if (y >= y0 && y <= y1) tSide = t0;
      }
    }
  }
  // caps
  let t = tSide;
  if (Math.abs(dy) > 1e-9) {
    const ty0 = (y0 - oy) / dy;
    if (ty0 >= 0) {
      const x = ox + dx * ty0, z = oz + dz * ty0;
      if ((x - cx) ** 2 + (z - cz) ** 2 <= r * r && (t < 0 || ty0 < t)) t = ty0;
    }
    const ty1 = (y1 - oy) / dy;
    if (ty1 >= 0) {
      const x = ox + dx * ty1, z = oz + dz * ty1;
      if ((x - cx) ** 2 + (z - cz) ** 2 <= r * r && (t < 0 || ty1 < t)) t = ty1;
    }
  }
  return t;
}

// ---- Circle collision tests (2D XZ) ----
// Circle vs AABB. Returns penetration depth (>=0) and writes normal to outN {x,z}.
export function circleVsBox(cx, cz, r, minx, minz, maxx, maxz, outN) {
  const qx = clamp(cx, minx, maxx);
  const qz = clamp(cz, minz, maxz);
  let dx = cx - qx, dz = cz - qz;
  const d2 = dx * dx + dz * dz;
  if (d2 > r * r) return 0;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    outN.x = dx / d; outN.z = dz / d;
    return r - d;
  }
  // center inside box: push out along nearest face
  const left = cx - minx, right = maxx - cx, back = cz - minz, front = maxz - cz;
  const m = Math.min(left, right, back, front);
  if (m === left) { outN.x = -1; outN.z = 0; return r + left; }
  if (m === right) { outN.x = 1; outN.z = 0; return r + right; }
  if (m === back) { outN.x = 0; outN.z = -1; return r + back; }
  outN.x = 0; outN.z = 1; return r + front;
}

export function circleVsCircle(ax, az, ar, bx, bz, br, outN) {
  const dx = ax - bx, dz = az - bz;
  const rr = ar + br;
  const d2 = dx * dx + dz * dz;
  if (d2 >= rr * rr) return 0;
  const d = Math.sqrt(d2) || 1e-6;
  outN.x = dx / d; outN.z = dz / d;
  return rr - d;
}

export function closestPointSegment(px, pz, ax, az, bx, bz, out) {
  const abx = bx - ax, abz = bz - az;
  const len2 = abx * abx + abz * abz;
  let t = len2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / len2 : 0;
  t = clamp(t, 0, 1);
  out.x = ax + abx * t; out.z = az + abz * t;
  return out;
}

// ---- Shared temporaries (no per-tick allocation) ----
export const TMP = {
  v1: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3(), v4: new THREE.Vector3(),
  q1: new THREE.Quaternion(), m1: new THREE.Matrix4(), e1: new THREE.Euler(), c1: new THREE.Color(),
};
