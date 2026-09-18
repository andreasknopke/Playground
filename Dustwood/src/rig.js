// Humanoid rig modelled on the SMPL body architecture (see
// github.com/bozcomlekci/smpl-jax ARCHITECTURE.md): a 24-joint kinematic tree
// with SMPL canonical joint names and rest joint locations, linear blend
// skinning, rigid part binding, hit capsules, and per-tick pose clips (no
// AnimationMixer). Imported only by enemies.js. See Plan.txt §5.
import * as THREE from 'three';
import { mergeGeos, ensureColorAttr } from './utils.js';

// ---- SMPL 24-joint kinematic tree ----------------------------------------
// Order matches the SMPL joint regressor. `parent` is the index of the parent
// joint (-1 = root). `pos` is the REST joint location in metres (y-up, ~1.7 m,
// left = +X), taken from SMPL's rest-pose joint regressor and adapted to a
// standing gunslinger.
export const JOINTS = [
  { name: 'pelvis', parent: -1, pos: [0, 0.96, 0] },
  { name: 'right_hip', parent: 0, pos: [-0.07, 0.90, 0] },
  { name: 'left_hip', parent: 0, pos: [0.07, 0.90, 0] },
  { name: 'spine', parent: 0, pos: [0, 1.10, 0] },
  { name: 'right_knee', parent: 1, pos: [-0.07, 0.52, 0] },
  { name: 'left_knee', parent: 2, pos: [0.07, 0.52, 0] },
  { name: 'chest', parent: 3, pos: [0, 1.28, 0] },
  { name: 'right_ankle', parent: 4, pos: [-0.07, 0.10, 0] },
  { name: 'left_ankle', parent: 5, pos: [0.07, 0.10, 0] },
  { name: 'neck', parent: 6, pos: [0, 1.44, 0] },
  { name: 'right_foot', parent: 7, pos: [-0.07, 0.02, 0.10] },
  { name: 'left_foot', parent: 8, pos: [0.07, 0.02, 0.10] },
  { name: 'head', parent: 9, pos: [0, 1.56, 0] },
  { name: 'right_collar', parent: 6, pos: [-0.06, 1.40, 0] },
  { name: 'left_collar', parent: 6, pos: [0.06, 1.40, 0] },
  { name: 'right_shoulder', parent: 13, pos: [-0.18, 1.38, 0] },
  { name: 'left_shoulder', parent: 14, pos: [0.18, 1.38, 0] },
  { name: 'right_elbow', parent: 15, pos: [-0.20, 1.10, 0] },
  { name: 'left_elbow', parent: 16, pos: [0.20, 1.10, 0] },
  { name: 'right_wrist', parent: 17, pos: [-0.20, 0.86, 0.02] },
  { name: 'left_wrist', parent: 18, pos: [0.20, 0.86, 0.02] },
  { name: 'right_hand', parent: 19, pos: [-0.20, 0.74, 0.04] },
  { name: 'left_hand', parent: 20, pos: [0.20, 0.74, 0.04] },
  { name: 'head_tip', parent: 12, pos: [0, 1.70, 0] },
];

export const BONE_NAMES = JOINTS.map((j) => j.name);
export const BONE_INDEX = {};
BONE_NAMES.forEach((n, i) => { BONE_INDEX[n] = i; });

// part -> hit group (SMPL joints grouped for damage multipliers, §4.3)
export const PART_GROUP = {
  head: 'head', neck: 'head',
  chest: 'torso', spine: 'torso', pelvis: 'torso',
  right_collar: 'arm', left_collar: 'arm',
  right_shoulder: 'arm', left_shoulder: 'arm',
  right_elbow: 'arm', left_elbow: 'arm',
  right_wrist: 'arm', left_wrist: 'arm',
  right_hand: 'arm', left_hand: 'arm',
  right_hip: 'leg', left_hip: 'leg',
  right_knee: 'leg', left_knee: 'leg',
  right_ankle: 'leg', left_ankle: 'leg',
  right_foot: 'leg', left_foot: 'leg',
};

// Hit capsules in bone-local space: a/b endpoints + radius. For limb segments
// a is the joint origin and b points toward the child joint (bone-local).
export const HIT_CAPSULES = {
  pelvis: { bone: 'pelvis', a: [0, 0, 0], b: [0, 0.14, 0], r: 0.16 },
  spine: { bone: 'spine', a: [0, 0, 0], b: [0, 0.18, 0], r: 0.16 },
  chest: { bone: 'chest', a: [0, 0, 0], b: [0, 0.16, 0], r: 0.19 },
  neck: { bone: 'neck', a: [0, 0, 0], b: [0, 0.12, 0], r: 0.07 },
  head: { bone: 'head', a: [0, 0.02, 0], b: [0, 0.16, 0], r: 0.13 },
  right_shoulder: { bone: 'right_shoulder', a: [0, 0, 0], b: [-0.02, -0.28, 0], r: 0.06 },
  right_elbow: { bone: 'right_elbow', a: [0, 0, 0], b: [0, -0.24, 0.02], r: 0.05 },
  right_wrist: { bone: 'right_wrist', a: [0, 0, 0], b: [0, -0.12, 0.02], r: 0.05 },
  left_shoulder: { bone: 'left_shoulder', a: [0, 0, 0], b: [0.02, -0.28, 0], r: 0.06 },
  left_elbow: { bone: 'left_elbow', a: [0, 0, 0], b: [0, -0.24, 0.02], r: 0.05 },
  left_wrist: { bone: 'left_wrist', a: [0, 0, 0], b: [0, -0.12, 0.02], r: 0.05 },
  right_hip: { bone: 'right_hip', a: [0, 0, 0], b: [0, -0.38, 0], r: 0.08 },
  right_knee: { bone: 'right_knee', a: [0, 0, 0], b: [0, -0.42, 0], r: 0.06 },
  right_ankle: { bone: 'right_ankle', a: [0, 0, 0], b: [0, -0.08, 0.10], r: 0.06 },
  left_hip: { bone: 'left_hip', a: [0, 0, 0], b: [0, -0.38, 0], r: 0.08 },
  left_knee: { bone: 'left_knee', a: [0, 0, 0], b: [0, -0.42, 0], r: 0.06 },
  left_ankle: { bone: 'left_ankle', a: [0, 0, 0], b: [0, -0.08, 0.10], r: 0.06 },
};

// Parts that have a hit capsule (raycast + damage targets). PART_GROUP maps
// these (and the remaining cosmetic joints) to damage groups.
export const PART_NAMES = Object.keys(HIT_CAPSULES);

// Visual part boxes rigidly bound to a bone (bone-local centre offset + size).
const PART_SHAPES = [
  { part: 'pelvis', bone: 'pelvis', w: 0.30, h: 0.20, d: 0.20, y: 0.07 },
  { part: 'spine', bone: 'spine', w: 0.30, h: 0.18, d: 0.19, y: 0.09 },
  { part: 'chest', bone: 'chest', w: 0.34, h: 0.26, d: 0.21, y: 0.10 },
  { part: 'neck', bone: 'neck', w: 0.10, h: 0.12, d: 0.10, y: 0.06 },
  { part: 'head', bone: 'head', w: 0.18, h: 0.22, d: 0.19, y: 0.11 },
  { part: 'right_shoulder', bone: 'right_shoulder', w: 0.09, h: 0.28, d: 0.09, y: -0.14 },
  { part: 'right_elbow', bone: 'right_elbow', w: 0.08, h: 0.24, d: 0.08, y: -0.12 },
  { part: 'right_wrist', bone: 'right_wrist', w: 0.08, h: 0.12, d: 0.06, y: -0.06 },
  // NOTE: the left arm has no visual geometry — the enemy holds the pistol with
  // one hand only, so the second (off-hand) would otherwise float near the gun
  // with fingers pointing down. The left bones remain for the skeleton/hit
  // capsules but render nothing.
  { part: 'right_hip', bone: 'right_hip', w: 0.13, h: 0.38, d: 0.13, y: -0.19 },
  { part: 'right_knee', bone: 'right_knee', w: 0.11, h: 0.42, d: 0.11, y: -0.21 },
  { part: 'right_ankle', bone: 'right_ankle', w: 0.10, h: 0.10, d: 0.22, y: -0.04 },
  { part: 'left_hip', bone: 'left_hip', w: 0.13, h: 0.38, d: 0.13, y: -0.19 },
  { part: 'left_knee', bone: 'left_knee', w: 0.11, h: 0.42, d: 0.11, y: -0.21 },
  { part: 'left_ankle', bone: 'left_ankle', w: 0.10, h: 0.10, d: 0.22, y: -0.04 },
];

// Build a SkinnedMesh geometry with rigid bone binding + a skeleton factory,
// following the SMPL kinematic tree.
export function buildRig() {
  const bones = [];
  const boneByName = {};
  for (let i = 0; i < JOINTS.length; i++) {
    const j = JOINTS[i];
    const b = new THREE.Bone();
    b.name = j.name;
    // local offset = rest pos - parent rest pos (root: relative to feet origin)
    if (j.parent === -1) {
      b.position.set(j.pos[0], j.pos[1], j.pos[2]);
    } else {
      const p = JOINTS[j.parent].pos;
      b.position.set(j.pos[0] - p[0], j.pos[1] - p[1], j.pos[2] - p[2]);
    }
    boneByName[j.name] = b;
    bones.push(b);
  }
  for (let i = 0; i < JOINTS.length; i++) {
    const p = JOINTS[i].parent;
    if (p >= 0) boneByName[JOINTS[p].name].add(boneByName[JOINTS[i].name]);
  }

  // geometry: one box per part, rigidly bound to its bone (LBS weight 1).
  // Skin geometry must be authored in REST-WORLD space (relative to the mesh
  // root at the feet): the skinning formula is B_now·B_rest⁻¹·v, so at rest the
  // vertex stays at its authored position. Place each box at its bone's rest
  // joint location plus the part's local offset.
  const geos = [];
  for (const ps of PART_SHAPES) {
    const g = new THREE.BoxGeometry(ps.w, ps.h, ps.d);
    const jr = JOINTS[BONE_INDEX[ps.bone]].pos;
    g.translate(jr[0], jr[1] + ps.y, jr[2]);
    ensureColorAttr(g, 0xffffff);
    const bi = BONE_INDEX[ps.bone];
    const count = g.getAttribute('position').count;
    const si = new Uint16Array(count * 4);
    const sw = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) { si[i * 4] = bi; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geos.push(g);
  }
  const geometry = mergeGeos(geos, false);
  const skeleton = new THREE.Skeleton(bones);
  return { geometry, rootBone: boneByName.pelvis, boneByName, skeleton };
}

// ---- Pose clips -----------------------------------------------------------
// A pose is a Float32Array(BONE_NAMES.length * 3) of Euler XYZ bone rotations.
export function makePose() {
  return new Float32Array(BONE_NAMES.length * 3);
}

function setBone(pose, bone, x, y, z) {
  const i = BONE_INDEX[bone] * 3;
  pose[i] += x; pose[i + 1] += y; pose[i + 2] += z;
}

// idle: breathing + slight sway
export function clipIdle(pose, t, w = 1) {
  const b = Math.sin(t * 1.6) * 0.02;
  setBone(pose, 'spine', b * 0.5 * w, 0, 0);
  setBone(pose, 'chest', b * w, 0, 0);
  setBone(pose, 'head', -b * 0.6 * w, Math.sin(t * 0.4) * 0.1 * w, 0);
  setBone(pose, 'right_shoulder', 0.05 * w, 0, 0.08 * w);
  setBone(pose, 'left_shoulder', 0.05 * w, 0, -0.08 * w);
}

// peek: lean out of cover (rise/lean forward), arms raise a weapon
export function clipPeek(pose, t, amount, w = 1) {
  const a = amount * w;
  setBone(pose, 'spine', 0.18 * a, 0, 0);
  setBone(pose, 'chest', 0.12 * a, 0, 0);
  setBone(pose, 'head', -0.1 * a, 0, 0);
  setBone(pose, 'left_shoulder', -1.2 * a, 0, -0.2 * a);
  setBone(pose, 'left_elbow', -0.4 * a, 0, 0);
  setBone(pose, 'right_shoulder', -1.3 * a, 0, 0.2 * a);
  setBone(pose, 'right_elbow', -0.5 * a, 0, 0);
}

// aim: track player (yaw on root; pitch small)
export function clipAim(pose, t, pitch, w = 1) {
  setBone(pose, 'head', -pitch * 0.6 * w, 0, 0);
  setBone(pose, 'chest', pitch * 0.3 * w, 0, 0);
  setBone(pose, 'left_shoulder', -0.1 * pitch * w, 0, 0);
  setBone(pose, 'right_shoulder', -0.1 * pitch * w, 0, 0);
}

// fire: recoil snap
export function clipFire(pose, amount, w = 1) {
  const a = amount * w;
  setBone(pose, 'chest', -0.15 * a, 0, 0);
  setBone(pose, 'head', -0.1 * a, 0, 0);
  setBone(pose, 'right_shoulder', 0.25 * a, 0, 0);
}

// duck: drop behind cover
export function clipDuck(pose, amount, w = 1) {
  const a = amount * w;
  setBone(pose, 'spine', 0.5 * a, 0, 0);
  setBone(pose, 'chest', 0.3 * a, 0, 0);
  setBone(pose, 'right_hip', -0.6 * a, 0, 0);
  setBone(pose, 'left_hip', -0.6 * a, 0, 0);
  setBone(pose, 'right_knee', 0.8 * a, 0, 0);
  setBone(pose, 'left_knee', 0.8 * a, 0, 0);
}

// reload: lever/cylinder motion
export function clipReload(pose, t, w = 1) {
  const k = Math.sin(t * Math.PI * 2);
  setBone(pose, 'right_shoulder', -1.3 * w + k * 0.2 * w, 0, 0.2 * w);
  setBone(pose, 'right_elbow', -0.6 * w, 0, 0);
  setBone(pose, 'left_shoulder', -1.1 * w - k * 0.15 * w, 0, -0.2 * w);
  setBone(pose, 'chest', 0.1 * w, 0.1 * k * w, 0);
}

// flinch: additive hit reaction
export function clipFlinch(pose, amount, dir, w = 1) {
  const a = amount * w;
  setBone(pose, 'chest', -0.3 * a * (dir || 1), 0, 0.1 * a);
  setBone(pose, 'head', -0.4 * a, 0.2 * a, 0);
}

// death: kinematic fall. phase 0..1. mode: 'back'|'forward'|'crumple'
export function clipDeath(pose, phase, mode, w = 1) {
  const p = Math.min(1, phase) * w;
  if (mode === 'back') {
    setBone(pose, 'pelvis', -1.5 * p, 0, 0);
    setBone(pose, 'chest', 0.3 * p, 0, 0);
    setBone(pose, 'head', 0.4 * p, 0, 0);
    setBone(pose, 'right_hip', 0.4 * p, 0, 0);
    setBone(pose, 'left_hip', 0.3 * p, 0, 0);
  } else if (mode === 'forward') {
    setBone(pose, 'pelvis', 1.4 * p, 0, 0);
    setBone(pose, 'chest', -0.2 * p, 0, 0);
    setBone(pose, 'left_shoulder', 0.8 * p, 0, 0);
    setBone(pose, 'right_shoulder', 0.8 * p, 0, 0);
  } else { // crumple
    setBone(pose, 'pelvis', -0.6 * p, 0.4 * p, 0.3 * p);
    setBone(pose, 'right_hip', 0.9 * p, 0, 0.2 * p);
    setBone(pose, 'left_hip', 0.7 * p, 0, -0.2 * p);
    setBone(pose, 'right_knee', 1.1 * p, 0, 0);
    setBone(pose, 'left_knee', 0.9 * p, 0, 0);
    setBone(pose, 'chest', 0.4 * p, 0, 0);
  }
}

// Apply a pose buffer to a skeleton (bone Euler rotations).
export function applyPose(boneByName, pose) {
  for (let i = 0; i < BONE_NAMES.length; i++) {
    const b = boneByName[BONE_NAMES[i]];
    b.rotation.set(pose[i * 3], pose[i * 3 + 1], pose[i * 3 + 2]);
  }
}

// Refresh world-space capsule data for hit tests: Float32Array(N*7)
// [ax,ay,az,bx,by,bz,r] per capsule, in PART_NAMES order.
const _ca = new THREE.Vector3();
const _cb = new THREE.Vector3();
export function refreshCapsules(boneByName, out) {
  for (let i = 0; i < PART_NAMES.length; i++) {
    const part = PART_NAMES[i];
    const cap = HIT_CAPSULES[part];
    const bone = boneByName[cap.bone];
    _ca.set(cap.a[0], cap.a[1], cap.a[2]).applyMatrix4(bone.matrixWorld);
    _cb.set(cap.b[0], cap.b[1], cap.b[2]).applyMatrix4(bone.matrixWorld);
    const o = i * 7;
    out[o] = _ca.x; out[o + 1] = _ca.y; out[o + 2] = _ca.z;
    out[o + 3] = _cb.x; out[o + 4] = _cb.y; out[o + 5] = _cb.z;
    out[o + 6] = cap.r;
  }
}
