// Viewmodels: procedural weapon geometry (revolver/rifle/shotgun) with moving
// parts, attached to player.viewRoot. Pose functions for fire/reload/break/
// switch. See Plan.txt §2.19, §3.7.
import * as THREE from 'three';
import { MAT } from './materials.js';
import { LAYERS } from './constants.js';
import { easeOutBack, degToRad } from './utils.js';

const REST = {
  revolver: { pos: [0.17, -0.15, -0.30], rot: [0, 0.04, 0] },
  rifle: { pos: [0.13, -0.14, -0.34], rot: [0, 0.04, 0] },
  shotgun: { pos: [0.12, -0.15, -0.38], rot: [0, 0.05, 0] },
};

function part(geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.renderOrder = 10;
  m.frustumCulled = false;
  m.layers.set(LAYERS.VIEWMODEL);
  return m;
}

function hand(mat) {
  const g = new THREE.Group();
  const palm = part(new THREE.BoxGeometry(0.06, 0.09, 0.04), mat, 0, 0, 0);
  g.add(palm);
  for (let i = 0; i < 4; i++) {
    const f = part(new THREE.CapsuleGeometry(0.008, 0.04, 3, 4), mat, -0.02 + i * 0.014, -0.06, 0.01);
    g.add(f);
  }
  const thumb = part(new THREE.CapsuleGeometry(0.009, 0.03, 3, 4), mat, 0.03, -0.02, 0.02);
  thumb.rotation.z = 0.6;
  g.add(thumb);
  return g;
}

export function buildViewmodel(id) {
  const group = new THREE.Group();
  const vm = { id, group, parts: {}, rest: { x: REST[id].pos[0], y: REST[id].pos[1], z: REST[id].pos[2], rx: REST[id].rot[0], rz: REST[id].rot[2] } };
  const gm = MAT.gunmetal, br = MAT.brass, gw = MAT.gunWood, sk = MAT.skinHands, sg = MAT.sightGlow;

  if (id === 'revolver') {
    group.add(part(new THREE.BoxGeometry(0.03, 0.035, 0.19), gm, 0, 0, -0.02)); // frame
    const cyl = part(new THREE.CylinderGeometry(0.025, 0.025, 0.05, 12), gm, 0, 0.005, -0.02);
    cyl.rotation.x = Math.PI / 2;
    group.add(cyl); vm.parts.cylinder = cyl;
    group.add(part(new THREE.CylinderGeometry(0.006, 0.006, 0.09, 8), gm, 0, 0.015, -0.09)); // barrel
    const hammer = part(new THREE.BoxGeometry(0.01, 0.03, 0.012), gm, 0, 0.03, 0.02);
    group.add(hammer); vm.parts.hammer = hammer;
    group.add(part(new THREE.TorusGeometry(0.02, 0.004, 6, 10, Math.PI), gm, 0, -0.02, 0.0)); // trigger guard
    const grip = part(new THREE.BoxGeometry(0.028, 0.09, 0.04), gw, 0, -0.06, 0.05);
    grip.rotation.x = -0.3;
    group.add(grip);
    group.add(part(new THREE.BoxGeometry(0.004, 0.012, 0.004), sg, 0, 0.03, -0.13)); // front sight
    vm.muzzle = new THREE.Object3D(); vm.muzzle.position.set(0, 0.02, -0.13); group.add(vm.muzzle);
  } else if (id === 'rifle') {
    group.add(part(new THREE.BoxGeometry(0.06, 0.07, 0.25), gm, 0, 0, -0.02)); // receiver
    const barrel = part(new THREE.CylinderGeometry(0.009, 0.009, 0.30, 8), gm, 0, 0.02, -0.28);
    barrel.rotation.x = Math.PI / 2;
    group.add(barrel);
    const tube = part(new THREE.CylinderGeometry(0.008, 0.008, 0.26, 8), gm, 0, -0.01, -0.24);
    tube.rotation.x = Math.PI / 2;
    group.add(tube);
    const lever = part(new THREE.TorusGeometry(0.03, 0.005, 6, 10, Math.PI * 1.2), gm, 0, -0.03, -0.02);
    group.add(lever); vm.parts.lever = lever;
    const stock = part(new THREE.BoxGeometry(0.05, 0.06, 0.18), gw, 0, -0.02, 0.12);
    stock.rotation.x = 0.1;
    group.add(stock);
    group.add(part(new THREE.BoxGeometry(0.004, 0.014, 0.004), sg, 0, 0.05, -0.4)); // front sight
    vm.muzzle = new THREE.Object3D(); vm.muzzle.position.set(0, 0.045, -0.43); group.add(vm.muzzle);
  } else { // shotgun
    group.add(part(new THREE.BoxGeometry(0.055, 0.05, 0.2), gm, 0, 0, -0.05)); // receiver
    const b1 = part(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 8), gm, -0.013, 0.02, -0.35);
    b1.rotation.x = Math.PI / 2;
    const b2 = part(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 8), gm, 0.013, 0.02, -0.35);
    b2.rotation.x = Math.PI / 2;
    const barrels = new THREE.Group(); barrels.add(b1, b2); group.add(barrels); vm.parts.barrels = barrels;
    const forend = part(new THREE.BoxGeometry(0.05, 0.03, 0.16), gw, 0, -0.01, -0.28);
    group.add(forend); vm.parts.forend = forend;
    const stock = part(new THREE.BoxGeometry(0.05, 0.06, 0.18), gw, 0, -0.02, 0.12);
    stock.rotation.x = 0.12;
    group.add(stock);
    const breakLever = part(new THREE.BoxGeometry(0.01, 0.02, 0.03), br, 0, 0.03, 0.02);
    group.add(breakLever); vm.parts.breakLever = breakLever;
    group.add(part(new THREE.SphereGeometry(0.006, 6, 6), br, 0, 0.035, -0.6)); // bead
    vm.muzzle = new THREE.Object3D(); vm.muzzle.position.set(0, 0.04, -0.6); group.add(vm.muzzle);
  }

  // hands: only the firing (right) hand grips the weapon. The off-hand is
  // intentionally omitted — a second hand floating near the barrel looked wrong.
  const handR = hand(sk); handR.position.set(0.0, -0.06, 0.05); group.add(handR); vm.handR = handR;

  group.scale.setScalar(0.9);
  group.renderOrder = 10;
  vm.dispose = () => { group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); };
  return vm;
}

// ---- pose functions (apply on top of rest; weapons.js sets base each tick) ----
export function resetPose(vm) {
  if (vm.parts.cylinder) vm.parts.cylinder.rotation.z = 0;
  if (vm.parts.hammer) vm.parts.hammer.rotation.x = 0;
  if (vm.parts.lever) vm.parts.lever.rotation.x = 0;
  if (vm.parts.barrels) vm.parts.barrels.rotation.x = 0;
  if (vm.parts.breakLever) vm.parts.breakLever.rotation.z = 0;
  if (vm.handL) { vm.handL.position.set(-0.02, -0.05, -0.12); vm.handL.rotation.set(0, 0, 0); }
}

export function poseFire(vm, id, t) {
  // t: 0..1 over the fire animation
  const k = Math.sin(Math.min(1, t) * Math.PI);
  if (id === 'revolver' && vm.parts.hammer) vm.parts.hammer.rotation.x = -0.6 * k;
  if (id === 'rifle' && vm.parts.lever) vm.parts.lever.rotation.x = 0.8 * k;
}

export function poseReload(vm, id, t, empty) {
  t = Math.max(0, Math.min(1, t));
  const g = vm.group;
  if (id === 'revolver') {
    g.rotation.z = 0.44 * Math.sin(t * Math.PI); // roll left 25deg
    g.rotation.x = -0.17 * Math.sin(t * Math.PI); // pitch down
    if (vm.parts.cylinder) vm.parts.cylinder.rotation.z = (t > 0.22 && t < 0.85) ? 1.4 : 0;
    if (vm.handL) vm.handL.position.set(-0.02, -0.05 + (t > 0.3 && t < 0.75 ? -0.06 : 0), -0.02);
  } else {
    g.rotation.z = -0.35 * Math.sin(t * Math.PI); // tilt right 20deg
    if (vm.parts.lever) vm.parts.lever.rotation.x = (t > 0.15 && t < 0.3) ? 1.2 : (t > 0.9 ? 0.6 : 0);
    if (vm.handL) vm.handL.position.set(-0.02, -0.05 + (t > 0.3 && t < 0.7 ? -0.07 : 0), -0.1);
  }
}

export function poseShotgunReload(vm, phase, t) {
  const g = vm.group;
  g.rotation.z = 0.52 * Math.min(1, t * 3); // roll right 30deg
  if (vm.handL) vm.handL.position.set(-0.02, -0.05 - 0.04 * Math.abs(Math.sin(t * 8)), -0.2);
}

export function poseBreak(vm, t) {
  const g = vm.group;
  // t: 0..1 over break
  let open = 0;
  if (t < 0.12) open = 0;
  else if (t < 0.3) open = (t - 0.12) / 0.18;
  else if (t < 0.45) open = 1;
  else if (t < 0.65) open = 1 - (t - 0.45) / 0.2;
  if (vm.parts.barrels) vm.parts.barrels.rotation.x = -0.4 * open;
  if (vm.parts.breakLever) vm.parts.breakLever.rotation.z = 0.6 * open;
  g.position.y += -0.01 * open;
  g.rotation.z += degToRad(3) * open;
}

export function poseSwitch(vm, t, lowering) {
  const g = vm.group;
  const e = lowering ? t * t : easeOutBack(Math.min(1, t));
  const dy = -0.25 * (lowering ? e : 1 - e);
  const pitch = -degToRad(35) * (lowering ? e : 1 - e);
  g.position.y += dy;
  g.rotation.x += pitch;
}

export function setSlideLocked(vm, locked) {}
