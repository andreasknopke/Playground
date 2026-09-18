// Static + dynamic collider registry with raycast and circle resolution.
// See Plan.txt §1.4, §2.6. Movement is 2-D in XZ; a mover of radius r at feet
// height y participates only with colliders whose [min.y,max.y] overlaps
// [y+0.05, y+1.0]. Broad phase: statics bucketed into 8 m slabs along X.
import * as THREE from 'three';
import { circleVsBox, circleVsCircle, rayBox, rayCylinderY, TMP } from './utils.js';

export const MASK = { PLAYER: 1, ENEMY: 2, BULLET: 4, NAV: 8, SOLID: 15, WALKERS: 3 };

let _nextId = 1;

export class Colliders {
  constructor(G) {
    this.G = G;
    this.statics = [];
    this.dynamics = new Map();
    this._slabs = new Map(); // slabIndex -> statics[]
    this._slabSize = 8;
    this._debug = null;
    this._outN = { x: 0, z: 0 };
  }

  _slabKey(x) { return Math.floor(x / this._slabSize); }

  _addSlab(c) {
    let lo, hi;
    if (c.type === 'box') { lo = this._slabKey(c.min[0]); hi = this._slabKey(c.max[0]); }
    else { lo = this._slabKey(c.x - c.r); hi = this._slabKey(c.x + c.r); }
    for (let s = lo; s <= hi; s++) {
      let arr = this._slabs.get(s);
      if (!arr) { arr = []; this._slabs.set(s, arr); }
      arr.push(c);
    }
  }

  addStatic(c) {
    c.id = _nextId++;
    this.statics.push(c);
    this._addSlab(c);
    return c;
  }

  addStaticBox(min, max, tag, surface, mask = MASK.SOLID) {
    return this.addStatic({ type: 'box', min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]], tag, surface, mask, id: 0 });
  }

  addStaticCyl(x, z, r, y0, y1, tag, surface, mask = MASK.SOLID) {
    return this.addStatic({ type: 'cyl', x, z, r, y0, y1, tag, surface, mask, id: 0 });
  }

  removeStatic(c) {
    const i = this.statics.indexOf(c);
    if (i >= 0) this.statics.splice(i, 1);
    for (const arr of this._slabs.values()) {
      const j = arr.indexOf(c);
      if (j >= 0) arr.splice(j, 1);
    }
  }

  setDynamic(key, list) { this.dynamics.set(key, list); }
  clearDynamic(key) { this.dynamics.delete(key); }

  _forEachCandidate(x, mask, fn) {
    const arr = this._slabs.get(this._slabKey(x));
    if (arr) for (let i = 0; i < arr.length; i++) { const c = arr[i]; if (c.mask & mask) fn(c); }
  }

  // Raycast in 3D. Returns {dist, pos:[x,y,z], normal:[x,y,z], surface, tag} or null.
  raycast(origin, dir, maxDist, mask, out = {}) {
    let best = -1, bestC = null;
    const ox = origin.x, oy = origin.y, oz = origin.z;
    const dx = dir.x, dy = dir.y, dz = dir.z;
    // Walk slabs along the ray's X extent.
    const xEnd = ox + dx * maxDist;
    let s0 = this._slabKey(Math.min(ox, xEnd));
    let s1 = this._slabKey(Math.max(ox, xEnd));
    const seen = new Set();
    for (let s = s0; s <= s1; s++) {
      const arr = this._slabs.get(s);
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        const c = arr[i];
        if (!(c.mask & mask) || seen.has(c.id)) continue;
        seen.add(c.id);
        let t = -1;
        if (c.type === 'box') t = rayBox(ox, oy, oz, dx, dy, dz, c.min, c.max);
        else t = rayCylinderY(ox, oy, oz, dx, dy, dz, c.x, c.z, c.r, c.y0, c.y1);
        if (t >= 0 && t <= maxDist && (best < 0 || t < best)) { best = t; bestC = c; }
      }
    }
    if (!bestC) return null;
    const px = ox + dx * best, py = oy + dy * best, pz = oz + dz * best;
    const n = TMP.v1;
    if (bestC.type === 'box') {
      // pick dominant face normal
      const cx = (bestC.min[0] + bestC.max[0]) / 2, cy = (bestC.min[1] + bestC.max[1]) / 2, cz = (bestC.min[2] + bestC.max[2]) / 2;
      const ex = (bestC.max[0] - bestC.min[0]) / 2, ey = (bestC.max[1] - bestC.min[1]) / 2, ez = (bestC.max[2] - bestC.min[2]) / 2;
      const rx = Math.abs(px - cx) / ex, ry = Math.abs(py - cy) / ey, rz = Math.abs(pz - cz) / ez;
      if (rx >= ry && rx >= rz) n.set(Math.sign(px - cx), 0, 0);
      else if (ry >= rz) n.set(0, Math.sign(py - cy), 0);
      else n.set(0, 0, Math.sign(pz - cz));
    } else {
      n.set(px - bestC.x, 0, pz - bestC.z);
      if (n.lengthSq() < 1e-9) n.set(0, 1, 0); else n.normalize();
    }
    out.dist = best;
    out.pos = [px, py, pz];
    out.normal = [n.x, n.y, n.z];
    out.surface = bestC.surface;
    out.tag = bestC.tag;
    return out;
  }

  _overlapsY(c, yFeet, height) {
    const lo = yFeet + 0.05, hi = yFeet + height;
    const cy0 = c.type === 'box' ? c.min[1] : c.y0;
    const cy1 = c.type === 'box' ? c.max[1] : c.y1;
    return cy0 < hi && cy1 > lo;
  }

  // Resolve a moving circle (XZ) out of statics+dynamics. Mutates and returns pos.
  resolveCircle(pos, radius, mask, yFeet = pos.y, height = 1.0, ignoreTags = null) {
    const n = this._outN;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const test = (c) => {
        if (ignoreTags && ignoreTags.includes(c.tag)) return;
        if (!this._overlapsY(c, yFeet, height)) return;
        let pen = 0;
        if (c.type === 'box') pen = circleVsBox(pos.x, pos.z, radius, c.min[0], c.min[2], c.max[0], c.max[2], n);
        else pen = circleVsCircle(pos.x, pos.z, radius, c.x, c.z, c.r, n);
        if (pen > 0) { pos.x += n.x * pen; pos.z += n.z * pen; moved = true; }
      };
      this._forEachCandidate(pos.x, mask, test);
      for (const list of this.dynamics.values()) {
        for (let i = 0; i < list.length; i++) { const c = list[i]; if (c.mask & mask) test(c); }
      }
      if (!moved) break;
    }
    return pos;
  }

  overlapsCircle(x, z, r, mask, yFeet = 0, height = 1.0) {
    const n = this._outN;
    let hit = false;
    const test = (c) => {
      if (hit || !this._overlapsY(c, yFeet, height)) return;
      let pen = 0;
      if (c.type === 'box') pen = circleVsBox(x, z, r, c.min[0], c.min[2], c.max[0], c.max[2], n);
      else pen = circleVsCircle(x, z, r, c.x, c.z, c.r, n);
      if (pen > 0) hit = true;
    };
    this._forEachCandidate(x, mask, test);
    return hit;
  }

  forEachInRange(xMin, xMax, mask, fn) {
    const s0 = this._slabKey(xMin), s1 = this._slabKey(xMax);
    const seen = new Set();
    for (let s = s0; s <= s1; s++) {
      const arr = this._slabs.get(s);
      if (!arr) continue;
      for (const c of arr) {
        if (seen.has(c.id) || !(c.mask & mask)) continue;
        seen.add(c.id);
        fn(c);
      }
    }
  }

  debugGroup() {
    if (this._debug) return this._debug;
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
    for (const c of this.statics) {
      let mesh;
      if (c.type === 'box') {
        const w = c.max[0] - c.min[0], h = c.max[1] - c.min[1], d = c.max[2] - c.min[2];
        mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        mesh.position.set((c.min[0] + c.max[0]) / 2, (c.min[1] + c.max[1]) / 2, (c.min[2] + c.max[2]) / 2);
      } else {
        const h = c.y1 - c.y0;
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(c.r, c.r, h, 8), mat);
        mesh.position.set(c.x, (c.y0 + c.y1) / 2, c.z);
      }
      g.add(mesh);
    }
    this._debug = g;
    return g;
  }
}
