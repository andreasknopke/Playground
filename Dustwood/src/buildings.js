// Building modules. Imported only by town.js. See Plan.txt §2.12, §3.3.
// Each buildBuilding(G, def) returns { group, anchors, colliders, name }.
// Geometry is merged per material to keep draw calls low. UVs are in metres.
//
// Buildings are modelled as HOLLOW shells (thin walls with real window/door
// openings + an interior floor + a pitched roof) so the decorated front faces
// the street and you can look inside through the glass.
import * as THREE from 'three';
import { MAT } from './materials.js';
import { mergeGeos, ensureColorAttr, bakeVertexAO } from './utils.js';
import { MASK } from './collision.js';

// Collect geometry into per-material buckets, then merge.
class Bucket {
  constructor() { this.map = new Map(); }
  add(matName, geo, matrix, color = 0xffffff) {
    ensureColorAttr(geo, color);
    if (matrix) geo.applyMatrix4(matrix);
    if (!this.map.has(matName)) this.map.set(matName, []);
    this.map.get(matName).push(geo);
  }
  build(scene) {
    const meshes = [];
    for (const [name, geos] of this.map) {
      const merged = mergeGeos(geos, false);
      const mat = MAT[name];
      if (!mat) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      scene.add(mesh);
      meshes.push(mesh);
    }
    return meshes;
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler();

function box(b, mat, w, h, d, x, y, z, ry = 0, color = 0xffffff) {
  _p.set(x, y, z); _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry); _s.set(1, 1, 1);
  _m.compose(_p, _q, _s);
  b.add(mat, new THREE.BoxGeometry(w, h, d), _m.clone(), color);
}
function boxE(b, mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, color = 0xffffff) {
  _p.set(x, y, z); _q.setFromEuler(_e.set(rx, ry, rz)); _s.set(1, 1, 1);
  _m.compose(_p, _q, _s);
  b.add(mat, new THREE.BoxGeometry(w, h, d), _m.clone(), color);
}
function plane(b, mat, w, h, x, y, z, rx = 0, ry = 0, color = 0xffffff) {
  _p.set(x, y, z);
  _q.setFromEuler(new THREE.Euler(rx, ry, 0));
  _s.set(1, 1, 1); _m.compose(_p, _q, _s);
  b.add(mat, new THREE.PlaneGeometry(w, h), _m.clone(), color);
}

// ---- Wall with rectangular openings --------------------------------------
// ax='x': wall runs along X at fixed z. ax='z': runs along Z at fixed x.
// openings: [{ u, w, y0, y1 }] in wall-local coords (u along the run).
function wallSeg(b, mat, color, ax, fixed, a0, a1, y0, y1, t) {
  const len = a1 - a0, h = y1 - y0;
  if (len <= 0.002 || h <= 0.002) return;
  const cu = (a0 + a1) / 2, cy = (y0 + y1) / 2;
  if (ax === 'x') box(b, mat, len, h, t, cu, cy, fixed, 0, color);
  else box(b, mat, t, h, len, fixed, cy, cu, 0, color);
}
function wall(b, mat, color, ax, fixed, a0, a1, y0, y1, t, openings = []) {
  const ops = openings.filter((o) => o.u - o.w / 2 < a1 && o.u + o.w / 2 > a0)
    .sort((p, q) => p.u - q.u);
  let cursor = a0;
  for (const o of ops) {
    const o0 = Math.max(a0, o.u - o.w / 2), o1 = Math.min(a1, o.u + o.w / 2);
    if (o0 > cursor) wallSeg(b, mat, color, ax, fixed, cursor, o0, y0, y1, t);
    if (o.y0 > y0 + 0.002) wallSeg(b, mat, color, ax, fixed, o0, o1, y0, o.y0, t); // sill
    if (o.y1 < y1 - 0.002) wallSeg(b, mat, color, ax, fixed, o0, o1, o.y1, y1, t); // lintel
    cursor = Math.max(cursor, o1);
  }
  if (cursor < a1 - 0.002) wallSeg(b, mat, color, ax, fixed, cursor, a1, y0, y1, t);
}
// Glass pane filling a window opening (thin, semi-transparent).
function glassPane(b, ax, fixed, u, y0, y1, w) {
  const cy = (y0 + y1) / 2, h = y1 - y0;
  if (ax === 'x') box(b, 'glass', w, h, 0.05, u, cy, fixed, 0, 0xffffff);
  else box(b, 'glass', 0.05, h, w, fixed, cy, u, 0, 0xffffff);
}
// Window frame (4 thin bars) around an opening for definition.
function windowFrame(b, ax, fixed, u, y0, y1, w, t) {
  const cy = (y0 + y1) / 2, h = y1 - y0, f = 0.09, o = 0.05;
  const m = 'woodWorn', c = 0x3a2818;
  if (ax === 'x') {
    box(b, m, w + o * 2, f, t + 0.04, u, y0 - f / 2, fixed, 0, c);
    box(b, m, w + o * 2, f, t + 0.04, u, y1 + f / 2, fixed, 0, c);
    box(b, m, f, h + o * 2, t + 0.04, u - w / 2 - f / 2, cy, fixed, 0, c);
    box(b, m, f, h + o * 2, t + 0.04, u + w / 2 + f / 2, cy, fixed, 0, c);
    box(b, m, 0.05, h, t + 0.02, u, cy, fixed, 0, c); // mullion
  } else {
    box(b, m, t + 0.04, f, w + o * 2, fixed, y0 - f / 2, u, 0, c);
    box(b, m, t + 0.04, f, w + o * 2, fixed, y1 + f / 2, u, 0, c);
    box(b, m, t + 0.04, h + o * 2, f, fixed, cy, u - w / 2 - f / 2, 0, c);
    box(b, m, t + 0.04, h + o * 2, f, fixed, cy, u + w / 2 + f / 2, 0, c);
    box(b, m, t + 0.02, h, 0.05, fixed, cy, u, 0, c);
  }
}
// Opaque door leaf in a doorway opening.
function doorLeaf(b, ax, fixed, u, y0, y1, w, color = 0x4a2f1a) {
  const cy = (y0 + y1) / 2, h = y1 - y0;
  if (ax === 'x') box(b, 'woodWorn', w, h, 0.12, u, cy, fixed, 0, color);
  else box(b, 'woodWorn', 0.12, h, w, fixed, cy, u, 0, color);
  // knob
  const kx = ax === 'x' ? u + w * 0.32 : fixed + 0.09;
  const kz = ax === 'x' ? fixed + 0.09 : u + w * 0.32;
  box(b, 'brass', 0.06, 0.06, 0.06, kx, cy, kz, 0, 0xffffff);
}
// Pitched gable roof: ridge runs along X (front/back walls at ±z).
function gableRoof(b, mat, color, w, d, baseY, rise, overhang = 0.4) {
  const half = d / 2 + overhang;
  const ang = Math.atan2(rise, half);
  const slope = Math.hypot(rise, half);
  const len = w + overhang * 2;
  boxE(b, mat, len, 0.16, slope, 0, baseY + rise / 2, -half / 2, ang, 0, 0, color);
  boxE(b, mat, len, 0.16, slope, 0, baseY + rise / 2, half / 2, -ang, 0, 0, color);
  // ridge cap
  box(b, mat, len, 0.12, 0.3, 0, baseY + rise, 0, 0, color);
  // gable end triangles (thin boxes approximating)
  box(b, mat, 0.16, rise, d, -w / 2, baseY + rise / 2, 0, 0, color);
  box(b, mat, 0.16, rise, d, w / 2, baseY + rise / 2, 0, 0, color);
}

function makeBuilding(name, def, buildFn) {
  const group = new THREE.Group();
  group.name = name;
  const bucket = new Bucket();
  const anchors = { window: [], roof: [], barricade: [] };
  const colliders = [];
  const ctx = { group, bucket, anchors, colliders, def, G: null };
  buildFn(ctx, def);
  bucket.build(group);
  group.updateMatrixWorld(true);
  return { group, anchors, colliders, name };
}

// Interior floor + a couple of crates so the inside reads as a room.
function interior(b, w, d, wallColor) {
  box(b, 'woodPlank', w - 0.4, 0.1, d - 0.4, 0, 0.05, 0, 0, 0x6a4a30); // floor
  // back interior wall lighter so it catches light through windows
  box(b, 'woodPlank', w - 0.6, 0.05, 0.05, 0, 1.5, d / 2 - 0.3, 0, wallColor);
}

// ---- Saloon: two-story, balcony, swinging doors, sign ----
function buildSaloon(ctx, def) {
  const { bucket, anchors, colliders } = ctx;
  const { w, d, h } = def;
  const t = 0.28, hw = w / 2, hd = d / 2;
  const wallC = 0xd8c098;
  interior(bucket, w, d, wallC);
  // back wall (solid)
  wall(bucket, 'woodPlank', wallC, 'x', hd, -hw, hw, 0, h, t, []);
  // side walls with a window each
  wall(bucket, 'woodPlank', wallC, 'z', -hw, -hd, hd, 0, h, t, [{ u: 0, w: 1.2, y0: 1.4, y1: 3.0 }]);
  wall(bucket, 'woodPlank', wallC, 'z', hw, -hd, hd, 0, h, t, [{ u: 0, w: 1.2, y0: 1.4, y1: 3.0 }]);
  glassPane(bucket, 'z', -hw, 0, 1.4, 3.0, 1.2); windowFrame(bucket, 'z', -hw, 0, 1.4, 3.0, 1.2, t);
  glassPane(bucket, 'z', hw, 0, 1.4, 3.0, 1.2); windowFrame(bucket, 'z', hw, 0, 1.4, 3.0, 1.2, t);
  // front wall (faces -z): door + ground windows + 2nd-floor windows
  const win2 = [{ u: -w * 0.3, w: 1.2, y0: h * 0.62, y1: h * 0.62 + 1.4 },
    { u: 0, w: 1.2, y0: h * 0.62, y1: h * 0.62 + 1.4 },
    { u: w * 0.3, w: 1.2, y0: h * 0.62, y1: h * 0.62 + 1.4 }];
  const winG = [{ u: -w * 0.32, w: 1.4, y0: 1.2, y1: 2.8 }, { u: w * 0.32, w: 1.4, y0: 1.2, y1: 2.8 }];
  const door = { u: 0, w: 1.6, y0: 0, y1: 2.6 };
  wall(bucket, 'woodPlank', wallC, 'x', -hd, -hw, hw, 0, h, t, [...win2, ...winG, door]);
  for (const o of win2) { glassPane(bucket, 'x', -hd, o.u, o.y0, o.y1, o.w); windowFrame(bucket, 'x', -hd, o.u, o.y0, o.y1, o.w, t); }
  for (const o of winG) { glassPane(bucket, 'x', -hd, o.u, o.y0, o.y1, o.w); windowFrame(bucket, 'x', -hd, o.u, o.y0, o.y1, o.w, t); }
  // swinging saloon doors (two half-height leaves)
  box(bucket, 'woodWorn', 0.72, 1.1, 0.08, -0.42, 1.5, -hd - 0.12, 0, 0x8a5a30);
  box(bucket, 'woodWorn', 0.72, 1.1, 0.08, 0.42, 1.5, -hd - 0.12, 0, 0x8a5a30);
  // saloon red band + false front parapet
  box(bucket, 'saloonRed', w + 0.2, 0.6, 0.2, 0, h - 1.2, -hd - 0.05, 0, 0xffffff);
  box(bucket, 'woodPlank', w + 0.4, 1.4, 0.3, 0, h + 0.4, -hd, 0, 0xc8b088);
  // balcony (front, second floor)
  box(bucket, 'woodPlank', w * 0.8, 0.2, 2.2, 0, h * 0.55, -hd - 1.1, 0, 0xb89a72);
  for (let i = 0; i < 8; i++) box(bucket, 'woodWorn', 0.12, 0.9, 0.12, -w * 0.4 + i * (w * 0.8 / 7), h * 0.55 + 0.55, -hd - 2.1, 0, 0xffffff);
  box(bucket, 'woodWorn', w * 0.8, 0.12, 0.12, 0, h * 0.55 + 1.0, -hd - 2.1, 0, 0xffffff);
  box(bucket, 'woodWorn', 0.2, h * 0.55, 0.2, -w * 0.38, h * 0.275, -hd - 2.0, 0, 0xffffff);
  box(bucket, 'woodWorn', 0.2, h * 0.55, 0.2, w * 0.38, h * 0.275, -hd - 2.0, 0, 0xffffff);
  // porch roof over ground floor front
  box(bucket, 'woodPlank', w + 0.4, 0.15, 2.4, 0, h * 0.5, -hd - 1.2, 0, 0xb89a72);
  // SALOON sign. ry=PI so the readable face points -z (toward the street for
  // +z-side buildings); the group's 180° turn then keeps -z-side buildings correct.
  plane(bucket, 'signSaloon', 4, 2, 0, h + 0.4, -hd - 0.25, 0, Math.PI, 0xffffff);
  // roof
  gableRoof(bucket, 'woodWorn', 0x6a4a30, w, d, h, 1.6);

  const wy = h * 0.62 + 0.7;
  for (let i = 0; i < 3; i++) anchors.window.push(new THREE.Vector3(-w * 0.3 + i * (w * 0.3), wy, -hd - 0.4));
  anchors.window.push(new THREE.Vector3(0, 1.4, -hd - 0.4));
  anchors.roof.push(new THREE.Vector3(0, h * 0.55 + 1.0, -hd - 1.6));

  colliders.push({ type: 'box', min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2], tag: 'building-saloon', surface: 'wood', mask: MASK.SOLID });
}

// ---- Livery: open gates, hayloft, stalls, ladder ----
function buildLivery(ctx, def) {
  const { bucket, anchors, colliders } = ctx;
  const { w, d, h } = def;
  const t = 0.28, hw = w / 2, hd = d / 2, wallC = 0xc8a878;
  interior(bucket, w, d, wallC);
  // back + side walls
  wall(bucket, 'woodPlank', wallC, 'x', hd, -hw, hw, 0, h, t, []);
  wall(bucket, 'woodPlank', wallC, 'z', -hw, -hd, hd, 0, h, t, []);
  wall(bucket, 'woodPlank', wallC, 'z', hw, -hd, hd, 0, h, t, []);
  // front wall faces -z with a big open gate in the middle + hayloft opening
  wall(bucket, 'woodPlank', wallC, 'x', -hd, -hw, hw, 0, h, t, [
    { u: 0, w: w * 0.4, y0: 0, y1: h * 0.6 },        // gate
    { u: 0, w: 2.4, y0: h * 0.72, y1: h * 0.72 + 1.6 }, // hayloft
  ]);
  // hayloft dark recess
  box(bucket, 'woodWorn', 2.4, 1.6, 0.1, 0, h * 0.72 + 0.8, -hd - 0.05, 0, 0x2a1a10);
  gableRoof(bucket, 'woodWorn', 0x6a4a30, w, d, h, 1.4);
  // stalls inside
  for (let i = 0; i < 3; i++) box(bucket, 'woodWorn', 0.15, 1.4, d * 0.6, -w * 0.3 + i * (w * 0.3), 0.7, d * 0.15, 0, 0xffffff);
  // ladder to loft
  box(bucket, 'woodWorn', 0.6, 3.5, 0.1, 1.5, 1.75, -d * 0.1, 0.3, 0xffffff);
  // LIVERY sign (ry=PI so the readable face points toward the street)
  plane(bucket, 'signLivery', 4.5, 1.6, 0, h * 0.82, -hd - 0.2, 0, Math.PI, 0xffffff);

  anchors.roof.push(new THREE.Vector3(0, h + 0.3, -hd + 0.5));
  anchors.window.push(new THREE.Vector3(-w * 0.35, 1.5, -hd - 0.4));
  colliders.push({ type: 'box', min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2], tag: 'building-livery', surface: 'wood', mask: MASK.SOLID });
}

// ---- Church: whitewash, bell tower, cross, graveyard ----
function buildChurch(ctx, def) {
  const { bucket, anchors, colliders } = ctx;
  const { w, d, h } = def;
  const t = 0.28, hw = w / 2, hd = d / 2, bodyH = h * 0.7;
  interior(bucket, w, d, 0xf0e8d8);
  // walls (front faces -z)
  wall(bucket, 'churchWhite', 0xffffff, 'x', hd, -hw, hw, 0, bodyH, t, []);
  wall(bucket, 'churchWhite', 0xffffff, 'z', -hw, -hd, hd, 0, bodyH, t, [{ u: 0, w: 1.0, y0: 1.2, y1: 3.2 }]);
  wall(bucket, 'churchWhite', 0xffffff, 'z', hw, -hd, hd, 0, bodyH, t, [{ u: 0, w: 1.0, y0: 1.2, y1: 3.2 }]);
  glassPane(bucket, 'z', -hw, 0, 1.2, 3.2, 1.0); windowFrame(bucket, 'z', -hw, 0, 1.2, 3.2, 1.0, t);
  glassPane(bucket, 'z', hw, 0, 1.2, 3.2, 1.0); windowFrame(bucket, 'z', hw, 0, 1.2, 3.2, 1.0, t);
  const cwin = [{ u: -w * 0.28, w: 0.9, y0: 1.2, y1: 3.2 }, { u: w * 0.28, w: 0.9, y0: 1.2, y1: 3.2 }];
  const cdoor = { u: 0, w: 1.6, y0: 0, y1: 2.6 };
  wall(bucket, 'churchWhite', 0xffffff, 'x', -hd, -hw, hw, 0, bodyH, t, [...cwin, cdoor]);
  for (const o of cwin) { glassPane(bucket, 'x', -hd, o.u, o.y0, o.y1, o.w); windowFrame(bucket, 'x', -hd, o.u, o.y0, o.y1, o.w, t); }
  doorLeaf(bucket, 'x', -hd, 0, 0, 2.6, 1.5, 0x4a2f1a);
  // CHURCH sign above the front door (ry=PI so the readable face points -z,
  // toward the street for +z-side buildings; group turn keeps -z-side correct).
  plane(bucket, 'signChurch', 3.2, 1.4, 0, bodyH - 0.7, -hd - 0.16, 0, Math.PI, 0xffffff);
  // gable roof
  gableRoof(bucket, 'woodWorn', 0x5a4030, w, d, bodyH, 1.8);
  // bell tower
  const tw = 2.6;
  const tz = -hd + tw / 2 + 0.5;
  wall(bucket, 'churchWhite', 0xffffff, 'x', tz + tw / 2, -tw / 2, tw / 2, bodyH, bodyH + h * 0.5, t, []);
  wall(bucket, 'churchWhite', 0xffffff, 'x', tz - tw / 2, -tw / 2, tw / 2, bodyH, bodyH + h * 0.5, t, [{ u: 0, w: 1.2, y0: bodyH + h * 0.2, y1: bodyH + h * 0.42 }]);
  glassPane(bucket, 'x', tz - tw / 2, 0, bodyH + h * 0.2, bodyH + h * 0.42, 1.2);
  box(bucket, 'woodWorn', tw + 0.4, 0.2, tw + 0.4, 0, bodyH + h * 0.5, tz, 0, 0x5a4030);
  // steeple + cross
  box(bucket, 'woodWorn', 0.3, 1.6, 0.3, 0, bodyH + h * 0.5 + 0.9, tz, 0, 0xffffff);
  box(bucket, 'crossWood', 0.15, 1.2, 0.15, 0, bodyH + h * 0.5 + 2.0, tz, 0, 0xffffff);
  box(bucket, 'crossWood', 0.7, 0.15, 0.15, 0, bodyH + h * 0.5 + 2.2, tz, 0, 0xffffff);

  anchors.roof.push(new THREE.Vector3(0, bodyH + h * 0.5, tz));
  colliders.push({ type: 'box', min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2], tag: 'building-church', surface: 'adobe', mask: MASK.SOLID });
}

// ---- Sheriff: reinforced, iron bars, 2 jail cells, wanted posters ----
function buildSheriff(ctx, def) {
  const { bucket, anchors, colliders } = ctx;
  const { w, d, h } = def;
  const t = 0.28, hw = w / 2, hd = d / 2, wallC = 0xb89a72;
  interior(bucket, w, d, wallC);
  wall(bucket, 'woodPlank', wallC, 'x', hd, -hw, hw, 0, h, t, []);
  wall(bucket, 'woodPlank', wallC, 'z', -hw, -hd, hd, 0, h, t, [{ u: 0, w: 1.2, y0: 1.4, y1: 2.8 }]);
  wall(bucket, 'woodPlank', wallC, 'z', hw, -hd, hd, 0, h, t, [{ u: 0, w: 1.2, y0: 1.4, y1: 2.8 }]);
  glassPane(bucket, 'z', -hw, 0, 1.4, 2.8, 1.2); windowFrame(bucket, 'z', -hw, 0, 1.4, 2.8, 1.2, t);
  glassPane(bucket, 'z', hw, 0, 1.4, 2.8, 1.2); windowFrame(bucket, 'z', hw, 0, 1.4, 2.8, 1.2, t);
  // front wall: door + 2 windows
  const swin = [{ u: -w * 0.32, w: 1.2, y0: 1.4, y1: 2.8 }, { u: w * 0.32, w: 1.2, y0: 1.4, y1: 2.8 }];
  const sdoor = { u: 0, w: 1.5, y0: 0, y1: 2.6 };
  wall(bucket, 'woodPlank', wallC, 'x', -hd, -hw, hw, 0, h, t, [...swin, sdoor]);
  for (const o of swin) { glassPane(bucket, 'x', -hd, o.u, o.y0, o.y1, o.w); windowFrame(bucket, 'x', -hd, o.u, o.y0, o.y1, o.w, t); }
  doorLeaf(bucket, 'x', -hd, 0, 0, 2.6, 1.4, 0x4a2f1a);
  // reinforced trim + roof
  box(bucket, 'rust', w + 0.2, 0.5, 0.2, 0, h - 0.6, -hd - 0.05, 0, 0xffffff);
  gableRoof(bucket, 'woodWorn', 0x5a4030, w, d, h, 1.3);
  // front porch
  box(bucket, 'woodPlank', w + 0.4, 0.15, 2.2, 0, h * 0.6, -hd - 1.1, 0, 0xb89a72);
  box(bucket, 'woodWorn', 0.2, h * 0.6, 0.2, -w * 0.4, h * 0.3, -hd - 2.0, 0, 0xffffff);
  box(bucket, 'woodWorn', 0.2, h * 0.6, 0.2, w * 0.4, h * 0.3, -hd - 2.0, 0, 0xffffff);
  // jail cells (interior, visible through front): iron bars
  for (let c = 0; c < 2; c++) {
    const cx = -w * 0.25 + c * w * 0.5;
    for (let i = 0; i < 6; i++) {
      const bx = cx - 1.25 + i * 0.5;
      box(bucket, 'gunmetal', 0.08, 2.6, 0.08, bx, 1.3, -hd + 1.5, 0, 0xffffff);
      colliders.push({ type: 'box', min: [bx - 0.05, 0, -hd + 1.4], max: [bx + 0.05, 2.6, -hd + 1.6], tag: 'jail-bar', surface: 'metal', mask: MASK.BULLET });
    }
    box(bucket, 'gunmetal', 2.6, 0.15, 0.15, cx, 2.65, -hd + 1.5, 0, 0xffffff);
    box(bucket, 'gunmetal', 2.6, 0.15, 0.15, cx, 0.05, -hd + 1.5, 0, 0xffffff);
  }
  colliders.push({ type: 'box', min: [-0.1, 0, -hd + 1.3], max: [0.1, 2.6, -hd + 1.7], tag: 'cell-door', surface: 'metal', mask: MASK.SOLID });
  // wanted posters on porch posts
  plane(bucket, 'wantedPoster', 0.8, 1.2, -w * 0.4, 1.6, -hd - 2.11, 0, 0, 0xffffff);
  plane(bucket, 'wantedPoster', 0.8, 1.2, w * 0.4, 1.6, -hd - 2.11, 0, 0, 0xffffff);
  // SHERIFF sign (ry=PI so the readable face points toward the street)
  plane(bucket, 'signSheriff', 3.5, 1.6, 0, h - 1.2, -hd - 0.25, 0, Math.PI, 0xffffff);

  anchors.window.push(new THREE.Vector3(-w * 0.32, h * 0.6, -hd - 0.4));
  anchors.window.push(new THREE.Vector3(w * 0.32, h * 0.6, -hd - 0.4));
  anchors.barricade.push(new THREE.Vector3(-w * 0.3, 0, -hd - 3.0));
  anchors.barricade.push(new THREE.Vector3(w * 0.3, 0, -hd - 3.0));
  colliders.push({ type: 'box', min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2], tag: 'building-sheriff', surface: 'wood', mask: MASK.SOLID });
}

// ---- Generic house: hollow, door + windows on the street-facing front ----
function buildHouse(ctx, def, idx) {
  const { bucket, anchors, colliders } = ctx;
  const w = 8 + (idx % 3) * 2, d = 8, h = 4.5 + (idx % 2) * 1.5;
  const t = 0.26, hw = w / 2, hd = d / 2;
  const wallC = idx % 2 ? 0xc0a878 : 0xb09068;
  interior(bucket, w, d, wallC);
  // back + side walls
  wall(bucket, 'woodPlank', wallC, 'x', hd, -hw, hw, 0, h, t, []);
  wall(bucket, 'woodPlank', wallC, 'z', -hw, -hd, hd, 0, h, t, [{ u: 0, w: 1.0, y0: 1.4, y1: 2.6 }]);
  wall(bucket, 'woodPlank', wallC, 'z', hw, -hd, hd, 0, h, t, [{ u: 0, w: 1.0, y0: 1.4, y1: 2.6 }]);
  glassPane(bucket, 'z', -hw, 0, 1.4, 2.6, 1.0); windowFrame(bucket, 'z', -hw, 0, 1.4, 2.6, 1.0, t);
  glassPane(bucket, 'z', hw, 0, 1.4, 2.6, 1.0); windowFrame(bucket, 'z', hw, 0, 1.4, 2.6, 1.0, t);
  // front wall (faces -z): door + two windows
  const win = [{ u: -w * 0.3, w: 1.1, y0: 1.4, y1: 2.7 }, { u: w * 0.3, w: 1.1, y0: 1.4, y1: 2.7 }];
  const door = { u: 0, w: 1.3, y0: 0, y1: 2.4 };
  wall(bucket, 'woodPlank', wallC, 'x', -hd, -hw, hw, 0, h, t, [...win, door]);
  for (const o of win) { glassPane(bucket, 'x', -hd, o.u, o.y0, o.y1, o.w); windowFrame(bucket, 'x', -hd, o.u, o.y0, o.y1, o.w, t); }
  doorLeaf(bucket, 'x', -hd, 0, 0, 2.4, 1.2, 0x4a2f1a);
  // porch
  const fz = -(hd + 1.0);
  box(bucket, 'woodPlank', w * 0.9, 0.15, 2.0, 0, 0.12, fz, 0, 0xb89a72);
  box(bucket, 'woodWorn', 0.18, 2.6, 0.18, -w * 0.4, 1.3, fz - 0.9, 0, 0xffffff);
  box(bucket, 'woodWorn', 0.18, 2.6, 0.18, w * 0.4, 1.3, fz - 0.9, 0, 0xffffff);
  box(bucket, 'woodPlank', w * 0.9, 0.12, 2.2, 0, 2.6, fz, 0, 0x6a4a30); // porch roof
  // hand-painted sign
  box(bucket, 'signEnamel', 1.6, 0.6, 0.08, w * 0.3, 3.0, -hd - 0.1, 0, 0xffffff);
  // gable roof
  gableRoof(bucket, 'woodWorn', 0x5a4030, w, d, h, 1.5);

  anchors.window.push(new THREE.Vector3(-w * 0.3, 2.0, -hd - 0.4));
  anchors.window.push(new THREE.Vector3(w * 0.3, 2.0, -hd - 0.4));
  anchors.roof.push(new THREE.Vector3(0, h + 0.6, 0));
  colliders.push({ type: 'box', min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2], tag: `building-house${idx}`, surface: 'wood', mask: MASK.SOLID });
}

const BUILDERS = {
  saloon: buildSaloon, livery: buildLivery, church: buildChurch, sheriff: buildSheriff,
};

export function buildBuilding(G, def) {
  const name = def.name;
  let buildFn = BUILDERS[name];
  if (!buildFn) buildFn = (ctx, d) => buildHouse(ctx, d, def.houseIndex || 0);
  const b = makeBuilding(name, def, buildFn);
  b.group.position.set(def.x, 0, def.z);
  // Geometry authors the decorated front toward -z. Buildings on the -z side of
  // the street (z<0) must be turned 180° so their front faces +z (toward the
  // street at z=0); buildings on the +z side already face -z (the street).
  if (def.z < 0) b.group.rotation.y = Math.PI;
  b.group.updateMatrixWorld(true);
  return b;
}
