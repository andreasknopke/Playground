// Nav grid + flow field: uniform 0.5 m grid over the street, Dijkstra from the
// player's cell over 8-connected cells. Reachability assertion at boot.
// See Plan.txt §1.5, §2.22.
import { PLAYER_SPAWN } from './constants.js';
import { MASK } from './collision.js';

const CELL = 0.5;
const ORIGIN_X = -60;
const ORIGIN_Z = -6;
const COLS = 240; // x in [-60, 60]
const ROWS = 24; // z in [-6, 6]
const AGENT_R = 0.3;
const SQRT2 = Math.SQRT2;

export class Nav {
  constructor(G) {
    this.G = G;
    this.blocked = new Uint8Array(COLS * ROWS);
    this.dist = new Float32Array(COLS * ROWS);
    this._targetCol = -1;
    this._targetRow = -1;
    this._dirty = true;
    this._accum = 0;
    // binary min-heap over parallel typed arrays (no per-tick allocation)
    const cap = COLS * ROWS * 4;
    this._heapCost = new Float32Array(cap);
    this._heapIdx = new Int32Array(cap);
    this._heapLen = 0;
  }

  _col(x) { return Math.floor((x - ORIGIN_X) / CELL); }
  _row(z) { return Math.floor((z - ORIGIN_Z) / CELL); }
  _idx(c, r) { return r * COLS + c; }
  _cellX(c) { return ORIGIN_X + (c + 0.5) * CELL; }
  _cellZ(r) { return ORIGIN_Z + (r + 0.5) * CELL; }

  init() {
    this.build();
  }

  build() {
    const G = this.G;
    this.blocked.fill(0);
    // Rasterize: blocked if floorHeightAt(cellCentre) === null or a NAV collider
    // (inflated by agent radius) overlaps the cell.
    const inflate = AGENT_R;
    for (let r = 0; r < ROWS; r++) {
      const z = this._cellZ(r);
      for (let c = 0; c < COLS; c++) {
        const x = this._cellX(c);
        if (G.town.floorHeightAt(x, z) === null) this.blocked[this._idx(c, r)] = 1;
      }
    }
    // NAV colliders (MASK.NAV bit) inflate-block cells.
    G.colliders.forEachInRange(ORIGIN_X - 1, ORIGIN_X + COLS * CELL + 1, MASK.NAV, (col) => {
      let minX, maxX, minZ, maxZ;
      if (col.type === 'box') {
        minX = col.min[0] - inflate; maxX = col.max[0] + inflate;
        minZ = col.min[2] - inflate; maxZ = col.max[2] + inflate;
      } else {
        minX = col.x - col.r - inflate; maxX = col.x + col.r + inflate;
        minZ = col.z - col.r - inflate; maxZ = col.z + col.r + inflate;
      }
      const c0 = Math.max(0, this._col(minX)), c1 = Math.min(COLS - 1, this._col(maxX));
      const r0 = Math.max(0, this._row(minZ)), r1 = Math.min(ROWS - 1, this._row(maxZ));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) this.blocked[this._idx(c, r)] = 1;
      }
    });

    // Dijkstra from the player spawn; boot-time reachability assertion.
    const sc = this._col(PLAYER_SPAWN.pos[0]), sr = this._row(PLAYER_SPAWN.pos[2]);
    this._dijkstra(sc, sr);
    if (typeof console !== 'undefined' && G.town.anchors) {
      // Anchors are enemy firing positions on buildings (window/roof/barricade),
      // not walkable street cells. Assert each has a walkable street cell nearby
      // so an enemy can reach the building base.
      for (const a of G.town.anchors) {
        const near = this.nearestWalkable(a.pos.x, a.pos.z, _pt);
        if (!near) {
          console.warn(`nav: anchor ${a.id} has no walkable cell nearby`);
        }
      }
    }
    this._dirty = true; // target will be recomputed on first update
  }

  _dijkstra(sc, sr) {
    const dist = this.dist;
    dist.fill(Infinity);
    if (sc < 0 || sc >= COLS || sr < 0 || sr >= ROWS || this.blocked[this._idx(sc, sr)]) return;
    dist[this._idx(sc, sr)] = 0;
    // binary min-heap (sift-up push / sift-down pop) over parallel arrays.
    const cost = this._heapCost, hidx = this._heapIdx;
    this._heapLen = 0;
    this._hpush(0, this._idx(sc, sr));
    const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]];
    while (this._heapLen > 0) {
      const [d, idx] = this._hpop();
      if (d > dist[idx]) continue;
      const c = idx % COLS, r = (idx / COLS) | 0;
      for (const [dc, dr, w] of NB) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
        const ni = this._idx(nc, nr);
        if (this.blocked[ni]) continue;
        // no corner cutting through diagonal blocked cells
        if (dc && dr && (this.blocked[this._idx(c + dc, r)] || this.blocked[this._idx(c, r + dr)])) continue;
        const nd = d + w * CELL;
        if (nd < dist[ni]) {
          dist[ni] = nd;
          this._hpush(nd, ni);
        }
      }
    }
  }

  // ---- binary min-heap over this._heapCost / this._heapIdx ----
  _hpush(c, i) {
    const cost = this._heapCost, idx = this._heapIdx;
    let n = this._heapLen++;
    if (n >= cost.length) { this._heapLen = n; return; } // overflow guard
    cost[n] = c; idx[n] = i;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (cost[p] <= cost[n]) break;
      const tc = cost[p], ti = idx[p];
      cost[p] = cost[n]; idx[p] = idx[n];
      cost[n] = tc; idx[n] = ti;
      n = p;
    }
  }

  _hpop() {
    const cost = this._heapCost, idx = this._heapIdx;
    const topC = cost[0], topI = idx[0];
    const last = --this._heapLen;
    cost[0] = cost[last]; idx[0] = idx[last];
    let n = 0;
    for (;;) {
      const l = 2 * n + 1, r = l + 1;
      let s = n;
      if (l < this._heapLen && cost[l] < cost[s]) s = l;
      if (r < this._heapLen && cost[r] < cost[s]) s = r;
      if (s === n) break;
      const tc = cost[s], ti = idx[s];
      cost[s] = cost[n]; idx[s] = idx[n];
      cost[n] = tc; idx[n] = ti;
      n = s;
    }
    return [topC, topI];
  }

  setTarget(x, z) {
    let c = this._col(x), r = this._row(z);
    if (c < 0) c = 0; else if (c >= COLS) c = COLS - 1;
    if (r < 0) r = 0; else if (r >= ROWS) r = ROWS - 1;
    if (this.blocked[this._idx(c, r)]) {
      if (!this.nearestWalkable(x, z, _pt)) return;
      c = this._col(_pt.x); r = this._row(_pt.z);
      c = Math.max(0, Math.min(COLS - 1, c));
      r = Math.max(0, Math.min(ROWS - 1, r));
    }
    if (c === this._targetCol && r === this._targetRow) return;
    this._targetCol = c; this._targetRow = r;
    this._dirty = true;
  }

  update(dt) {
    const p = this.G.player;
    if (p) this.setTarget(p.pos.x, p.pos.z);
    this._accum += dt;
    if (this._dirty && this._accum >= 0.25) {
      this._accum = 0;
      this._dirty = false;
      this._dijkstra(this._targetCol, this._targetRow);
    }
  }

  // Gradient direction (normalized, XZ) toward the target, written to out.
  flowAt(x, z, out) {
    const c = this._col(x), r = this._row(z);
    out.set(0, 0, 0);
    if (c < 1 || c >= COLS - 1 || r < 1 || r >= ROWS - 1) return out;
    const here = this.dist[this._idx(c, r)];
    let best = here, bx = 0, bz = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dc && !dr) continue;
        const ni = this._idx(c + dc, r + dr);
        if (this.blocked[ni]) continue;
        const d = this.dist[ni];
        if (d < best) { best = d; bx = dc; bz = dr; }
      }
    }
    if (bx === 0 && bz === 0) return out;
    // steer toward the centre of the best neighbour cell
    const tx = this._cellX(c + bx), tz = this._cellZ(r + bz);
    out.set(tx - x, 0, tz - z);
    if (out.lengthSq() > 1e-9) out.normalize();
    return out;
  }

  isWalkable(x, z) {
    const c = this._col(x), r = this._row(z);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
    return this.blocked[this._idx(c, r)] === 0;
  }

  nearestWalkable(x, z, out) {
    if (out) { out.x = x; out.z = z; }
    if (this.isWalkable(x, z)) return out || { x, z };
    for (let rad = 1; rad <= 40; rad++) {
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
          const nx = x + dc * CELL, nz = z + dr * CELL;
          if (this.isWalkable(nx, nz)) {
            if (out) { out.x = nx; out.z = nz; }
            return out || { x: nx, z: nz };
          }
        }
      }
    }
    return null;
  }

  distanceAt(x, z) {
    const c = this._col(x), r = this._row(z);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return -1;
    const d = this.dist[this._idx(c, r)];
    return isFinite(d) ? d : -1;
  }

  randomWalkable(minDistFromTarget, out) {
    const rng = this.G.rng;
    for (let tries = 0; tries < 64; tries++) {
      const c = rng.int(COLS), r = rng.int(ROWS);
      if (this.blocked[this._idx(c, r)]) continue;
      const d = this.dist[this._idx(c, r)];
      if (!isFinite(d) || d < minDistFromTarget) continue;
      out.x = this._cellX(c); out.z = this._cellZ(r);
      return out;
    }
    return null;
  }

  debugMesh() { return null; }

  reset() {
    this._dirty = true;
    this._targetCol = -1;
    this._accum = 1; // rebuild on next update
  }

  dispose() {}
}

const _pt = { x: 0, z: 0 };
