// Town: street, boardwalks, lots, buildings, barricades, surroundings, sky,
// mesas. Registers static colliders, exposes floorHeightAt / walkable /
// anchors / playerSpawn / getLightAnchors. See Plan.txt §2.11, §3.3, §3.4.
import * as THREE from 'three';
import { MAT } from './materials.js';
import { buildBuilding } from './buildings.js';
import { mergeGeos, bakeVertexAO, ensureColorAttr } from './utils.js';
import { MASK } from './collision.js';
import { STREET, BOARDWALK, LOT, PLAYER_SPAWN, BUILDINGS, BARRICADES, SECTORS } from './constants.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

class Bucket {
  constructor() { this.map = new Map(); }
  add(matName, geo, matrix, color = 0xffffff) {
    ensureColorAttr(geo, color);
    if (matrix) geo.applyMatrix4(matrix);
    if (!this.map.has(matName)) this.map.set(matName, []);
    this.map.get(matName).push(geo);
  }
  build(scene, ao = null) {
    const meshes = [];
    for (const [name, geos] of this.map) {
      const merged = mergeGeos(geos, false);
      const mat = MAT[name];
      if (!mat) continue;
      if (ao) bakeVertexAO(merged, ao.occluders, ao.opts);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      scene.add(mesh);
      meshes.push(mesh);
    }
    return meshes;
  }
}

function box(b, mat, w, h, d, x, y, z, color = 0xffffff) {
  _p.set(x, y, z); _q.identity(); _s.set(1, 1, 1); _m.compose(_p, _q, _s);
  b.add(mat, new THREE.BoxGeometry(w, h, d), _m.clone(), color);
}

export class Town {
  constructor(G) {
    this.G = G;
    this.group = new THREE.Group();
    this.anchors = [];
    this.buildings = [];
    this.playerSpawn = { pos: new THREE.Vector3(...PLAYER_SPAWN.pos), yaw: PLAYER_SPAWN.yaw, pitch: PLAYER_SPAWN.pitch };
    this.walkable = [
      { minX: -60, maxX: 60, minZ: -6, maxZ: 6, y: 0 },
      { minX: -60, maxX: 60, minZ: -8, maxZ: 8, y: 0 },
      { minX: -60, maxX: 60, minZ: -14, maxZ: 14, y: 0 },
    ];
    this.sectors = SECTORS;
    this._lightAnchors = null;
  }

  floorHeightAt(x, z) {
    if (x >= -60 && x <= 60) {
      const az = Math.abs(z);
      if (az <= 6.0) return 0; // street
      if (az <= 8.0) return 0; // boardwalks
      if (az <= 14.0) return 0; // building lots
    }
    return null;
  }

  init() {
    const G = this.G;
    G.scene.add(this.group);
    const bucket = new Bucket();

    // ---- Street slab ----
    const streetW = STREET.xMax - STREET.xMin; // 120
    const streetD = STREET.zMax - STREET.zMin; // 12
    const cx = (STREET.xMin + STREET.xMax) / 2;
    box(bucket, 'sand', streetW, STREET.thickness, streetD, cx, -STREET.thickness / 2, 0, 0xffffff);
    // wagon ruts (recessed darker strips)
    for (const rz of [-1.6, 1.6]) {
      box(bucket, 'sand', streetW, 0.02, 0.5, cx, 0.005, rz, 0x8a7a58);
    }
    // dry puddles (recessed strips)
    for (const px of [-30, -10, 12, 30, 44, -46]) {
      box(bucket, 'puddle', 0.4, 0.01, 0.25, px, 0.006, (px % 3) - 1, 0xffffff);
    }

    // ---- Boardwalks ----
    for (const side of [-1, 1]) {
      const zc = side * (BOARDWALK.zInner + (BOARDWALK.zOuter - BOARDWALK.zInner) / 2); // ±7
      const w = BOARDWALK.zOuter - BOARDWALK.zInner; // 2
      box(bucket, 'boardwalk', streetW, 0.15, w, cx, 0.005, zc, 0xffffff);
    }

    // ---- Building lots ----
    for (const side of [-1, 1]) {
      const zc = side * (LOT.zInner + (LOT.zOuter - LOT.zInner) / 2); // ±11
      const d = LOT.zOuter - LOT.zInner; // 6
      box(bucket, 'sand', streetW, 0.15, d, cx, 0.005, zc, 0xffffff);
    }

    // AO occluders: buildings + barricades (approx boxes)
    const occluders = [];

    // ---- Buildings ----
    const defs = [
      { name: 'saloon', ...BUILDINGS.saloon },
      { name: 'livery', ...BUILDINGS.livery },
      { name: 'church', ...BUILDINGS.church },
      { name: 'sheriff', ...BUILDINGS.sheriff },
    ];
    BUILDINGS.house.forEach((h, i) => defs.push({ name: 'house' + i, x: h.x, z: h.z, w: 8, d: 8, h: 5, houseIndex: i }));

    for (const def of defs) {
      const b = buildBuilding(G, def);
      this.group.add(b.group);
      this.buildings.push({ name: def.name, x: def.x, z: def.z });
      // register colliders (world space)
      for (const c of b.colliders) {
        const wc = this._toWorldCollider(c, b.group);
        G.colliders.addStatic(wc);
        occluders.push({ min: wc.min, max: wc.max });
      }
      // transform anchors to world
      for (const kind of ['window', 'roof', 'barricade']) {
        for (const a of b.anchors[kind]) {
          const wp = a.clone();
          b.group.localToWorld(wp);
          this.anchors.push({ id: `${def.name}-${kind}-${this.anchors.length}`, kind, pos: wp, yaw: this._anchorYaw(def), cover: wp.clone(), building: def.name });
        }
      }
    }

    // ---- Barricades ----
    BARRICADES.forEach(([bx, kind], i) => {
      this._buildBarricade(bucket, occluders, bx, kind, i);
    });

    // ---- Surroundings: cacti, shrubs, dead trees, mesas, sky ----
    this._buildSurroundings(bucket, occluders);

    // Build merged meshes with AO
    bucket.build(this.group, { occluders, opts: { radius: 0.7, strength: 0.55, floorY: 0 } });

    // AO strips along building bases (cheap gradient planes)
    this._buildAoStrips(occluders);

    this._lightAnchors = this._computeLightAnchors();
  }

  _anchorYaw(def) {
    // face the street (toward z=0)
    return def.z > 0 ? Math.PI : 0;
  }

  _toWorldCollider(c, group) {
    // Only axis-aligned boxes/cyls with group rotation 0 or PI about Y.
    const pos = group.position;
    const rotY = group.rotation.y;
    const cos = Math.round(Math.cos(rotY)), sin = Math.round(Math.sin(rotY));
    if (c.type === 'box') {
      // transform the 8 corners
      let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
      const pts = [];
      for (const x of [c.min[0], c.max[0]]) for (const y of [c.min[1], c.max[1]]) for (const z of [c.min[2], c.max[2]]) pts.push([x, y, z]);
      const v = new THREE.Vector3();
      for (const pt of pts) { v.set(pt[0], pt[1], pt[2]); group.localToWorld(v); minx = Math.min(minx, v.x); miny = Math.min(miny, v.y); minz = Math.min(minz, v.z); maxx = Math.max(maxx, v.x); maxy = Math.max(maxy, v.y); maxz = Math.max(maxz, v.z); }
      return { type: 'box', min: [minx, miny, minz], max: [maxx, maxy, maxz], tag: c.tag, surface: c.surface, mask: c.mask };
    } else {
      const v = new THREE.Vector3(c.x, 0, c.z); group.localToWorld(v);
      return { type: 'cyl', x: v.x, z: v.z, r: c.r, y0: c.y0, y1: c.y1, tag: c.tag, surface: c.surface, mask: c.mask };
    }
  }

  _buildBarricade(bucket, occluders, bx, kind, i) {
    const tag = `barricade-${i}`;
    if (kind === 'wagon') {
      // overturned wagon body
      box(bucket, 'wagonWood', 3.5, 1.6, 2.2, bx, 1.0, 0, 0xffffff);
      // wheels
      for (const wx of [-1.2, 1.2]) {
        _p.set(bx + wx, 0.7, 1.2); _q.setFromEuler(_e.set(0, 0, Math.PI / 2)); _s.set(1, 1, 1); _m.compose(_p, _q, _s);
        const wheel = new THREE.CylinderGeometry(0.7, 0.7, 0.2, 12);
        ensureColorAttr(wheel, 0xffffff); wheel.applyMatrix4(_m);
        bucket.add('wagonWood', wheel, null, 0xffffff);
      }
      occluders.push({ min: [bx - 1.8, 0, -1.2], max: [bx + 1.8, 1.8, 1.2] });
      this.G.colliders.addStaticBox([bx - 1.8, 0, -1.2], [bx + 1.8, 1.8, 1.2], tag, 'wood', MASK.SOLID);
    } else if (kind === 'barrels') {
      const positions = [[-0.6, 0], [0.6, 0], [0, 0.9]];
      for (const [ox, oy] of positions) {
        _p.set(bx + ox, 0.5 + oy, 0); _q.identity(); _s.set(1, 1, 1); _m.compose(_p, _q, _s);
        const barrel = new THREE.CylinderGeometry(0.45, 0.45, 1.0, 12);
        ensureColorAttr(barrel, 0xffffff); barrel.applyMatrix4(_m);
        bucket.add('barrelWood', barrel, null, 0xffffff);
      }
      occluders.push({ min: [bx - 1.1, 0, -0.5], max: [bx + 1.1, 1.5, 0.5] });
      this.G.colliders.addStaticBox([bx - 1.1, 0, -0.5], [bx + 1.1, 1.5, 0.5], tag, 'wood', MASK.SOLID);
    } else { // crates
      const positions = [[-0.6, 0.5], [0.6, 0.5], [0, 1.5]];
      for (const [ox, oy] of positions) {
        box(bucket, 'crateWood', 1.0, 1.0, 1.0, bx + ox, oy, 0, 0xffffff);
      }
      occluders.push({ min: [bx - 1.1, 0, -0.5], max: [bx + 1.1, 2.0, 0.5] });
      this.G.colliders.addStaticBox([bx - 1.1, 0, -0.5], [bx + 1.1, 2.0, 0.5], tag, 'wood', MASK.SOLID);
    }
  }

  _buildSurroundings(bucket, occluders) {
    const rng = this.G.rngBuild;
    // Cacti (instanced via merged planes with alpha)
    const cactusSpots = [[-52, -12], [-44, 12], [-16, -13], [4, 13], [18, -13], [36, 13], [50, -13], [58, 12]];
    for (const [x, z] of cactusSpots) {
      _p.set(x, 1.2, z); _q.identity(); _s.set(1.4, 1.4, 1.4); _m.compose(_p, _q, _s);
      const g = new THREE.PlaneGeometry(2, 2.4); ensureColorAttr(g, 0xffffff); g.applyMatrix4(_m);
      bucket.add('cactus', g, null, 0xffffff);
      // cross plane for volume
      _q.setFromEuler(_e.set(0, Math.PI / 2, 0)); _m.compose(_p, _q, _s);
      const g2 = new THREE.PlaneGeometry(2, 2.4); ensureColorAttr(g2, 0xffffff); g2.applyMatrix4(_m);
      bucket.add('cactus', g2, null, 0xffffff);
      this.G.colliders.addStaticCyl(x, z, 0.4, 0, 2.4, 'cactus', 'wood', MASK.SOLID);
    }
    // Dry shrubs
    const shrubSpots = [[-56, 10], [-34, -12], [-20, 12], [-8, 13], [12, -13], [26, 13], [40, -13], [46, 12], [-50, -12], [30, -12], [54, 10], [-2, 13]];
    for (const [x, z] of shrubSpots) {
      _p.set(x, 0.5, z); _q.identity(); _s.set(1.2, 1.2, 1.2); _m.compose(_p, _q, _s);
      const g = new THREE.PlaneGeometry(1.4, 1.0); ensureColorAttr(g, 0xffffff); g.applyMatrix4(_m);
      bucket.add('shrub', g, null, 0xffffff);
      this.G.colliders.addStaticCyl(x, z, 0.3, 0, 1.0, 'shrub', 'wood', MASK.SOLID);
    }
    // Dead trees
    const treeSpots = [[-58, -13], [-26, 13], [16, 13], [52, -13]];
    for (const [x, z] of treeSpots) {
      _p.set(x, 2.5, z); _q.identity(); _s.set(2.5, 2.5, 2.5); _m.compose(_p, _q, _s);
      const g = new THREE.PlaneGeometry(3, 5); ensureColorAttr(g, 0xffffff); g.applyMatrix4(_m);
      bucket.add('deadTree', g, null, 0xffffff);
      _q.setFromEuler(_e.set(0, Math.PI / 2, 0)); _m.compose(_p, _q, _s);
      const g2 = new THREE.PlaneGeometry(3, 5); ensureColorAttr(g2, 0xffffff); g2.applyMatrix4(_m);
      bucket.add('deadTree', g2, null, 0xffffff);
      this.G.colliders.addStaticCyl(x, z, 0.4, 0, 5, 'tree', 'wood', MASK.SOLID);
    }
    // Distant mesas (big billboard ring)
    const mesaGeo = new THREE.PlaneGeometry(400, 60);
    ensureColorAttr(mesaGeo, 0xffffff);
    _p.set(0, 20, -160); _q.identity(); _s.set(1, 1, 1); _m.compose(_p, _q, _s); mesaGeo.applyMatrix4(_m);
    bucket.add('mesa', mesaGeo, null, 0xffffff);
    const mesaGeo2 = new THREE.PlaneGeometry(400, 60); ensureColorAttr(mesaGeo2, 0xffffff);
    _p.set(0, 20, 160); _q.setFromEuler(_e.set(0, Math.PI, 0)); _m.compose(_p, _q, _s); mesaGeo2.applyMatrix4(_m);
    bucket.add('mesa', mesaGeo2, null, 0xffffff);
    const mesaGeo3 = new THREE.PlaneGeometry(400, 60); ensureColorAttr(mesaGeo3, 0xffffff);
    _p.set(-200, 20, 0); _q.setFromEuler(_e.set(0, Math.PI / 2, 0)); _m.compose(_p, _q, _s); mesaGeo3.applyMatrix4(_m);
    bucket.add('mesa', mesaGeo3, null, 0xffffff);
    const mesaGeo4 = new THREE.PlaneGeometry(400, 60); ensureColorAttr(mesaGeo4, 0xffffff);
    _p.set(200, 20, 0); _q.setFromEuler(_e.set(0, -Math.PI / 2, 0)); _m.compose(_p, _q, _s); mesaGeo4.applyMatrix4(_m);
    bucket.add('mesa', mesaGeo4, null, 0xffffff);

    // Sky dome (large sphere, back side)
    const sky = new THREE.Mesh(new THREE.SphereGeometry(240, 24, 16), MAT.sky);
    sky.matrixAutoUpdate = false; sky.updateMatrix();
    this.group.add(sky);
  }

  _buildAoStrips(occluders) {
    const mat = MAT.aoStrip;
    if (!mat) return;
    const group = new THREE.Group();
    for (const o of occluders) {
      const w = o.max[0] - o.min[0], d = o.max[2] - o.min[2];
      const cx = (o.min[0] + o.max[0]) / 2, cz = (o.min[2] + o.max[2]) / 2;
      const stripW = 0.35;
      // four sides
      const sides = [
        [w + stripW * 2, stripW, cx, o.min[2] - stripW / 2, 0],
        [w + stripW * 2, stripW, cx, o.max[2] + stripW / 2, 0],
        [stripW, d + stripW * 2, o.min[0] - stripW / 2, cz, 0],
        [stripW, d + stripW * 2, o.max[0] + stripW / 2, cz, 0],
      ];
      for (const [sw, sd, sx, sz] of sides) {
        const g = new THREE.PlaneGeometry(sw, sd);
        g.rotateX(-Math.PI / 2);
        g.translate(sx, 0.02, sz);
        const m = new THREE.Mesh(g, mat);
        m.matrixAutoUpdate = false; m.updateMatrix();
        group.add(m);
      }
    }
    this.group.add(group);
  }

  _computeLightAnchors() {
    const streetLamps = [];
    for (const x of [-50, -38, -26, -14, 2, 14, 26, 38, 50]) streetLamps.push(new THREE.Vector3(x, 4.0, 0));
    const saloon = new THREE.Vector3(-6, 4.0, -11);
    const sheriff = [new THREE.Vector3(56, 4.0, -11), new THREE.Vector3(56, 4.0, -9)];
    const shafts = [
      { top: new THREE.Vector3(-6, 6, -8), bottom: new THREE.Vector3(-6, 0, -6), rTop: 0.4, rBottom: 1.6, color: 0xffe2b8 },
      { top: new THREE.Vector3(2, 6, -8), bottom: new THREE.Vector3(2, 0, -6), rTop: 0.4, rBottom: 1.6, color: 0xffe2b8 },
    ];
    return { streetLamps, saloon, sheriff, shafts };
  }

  getLightAnchors() { return this._lightAnchors; }

  update() {}
  reset() {}
  dispose() {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}
