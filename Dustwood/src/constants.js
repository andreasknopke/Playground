// DESIGN NOTE: Era interpreted 1800-1840 (brief said "early 18th century");
// cartridge rifles (Winchester) kept. See Plan.txt §0.3.
import * as THREE from 'three';
export const FIXED_DT = 1 / 60;
export const MAX_SUBSTEPS = 4;
export const DEFAULT_SEED = 1337;
export const VERSION = '1.0.0';
// ---- World layout (metres) ----
export const STREET = { xMin: -60, xMax: 60, zMin: -6, zMax: 6, y: 0, thickness: 0.30 };
export const BOARDWALK = { zInner: 6.0, zOuter: 8.0 };
export const LOT = { zInner: 8.0, zOuter: 14.0 };
export const PLAYER_SPAWN = { pos: [-58, 0, 0], yaw: -Math.PI / 2, pitch: 0 };
export const BUILDINGS = {
  saloon: { x: -6, z: -11, w: 14, d: 10, h: 8.5, variant: 0 },
  livery: { x: 8, z: 11, w: 16, d: 10, h: 7.0, variant: 1 },
  church: { x: 22, z: 11, w: 10, d: 12, h: 9.0, variant: 2 },
  sheriff: { x: 56, z: -11, w: 14, d: 10, h: 6.5, variant: 3 },
  house: [
    { x: -30, z: -11 }, { x: -18, z: 11 }, { x: 2, z: -11 },
    { x: 14, z: -11 }, { x: 30, z: 11 }, { x: 42, z: -11 },
  ],
};
export const BARRICADES = [ // [x, kind]
  [-40, 'wagon'], [-24, 'barrels'], [10, 'crates'], [34, 'wagon'], [48, 'barrels'],
];
export const ENEMY_POP = {
  saloon: { window: 4, roof: 1 }, // balcony
  livery: { roof: 1 }, // hayloft
  church: { roof: 1 }, // tower
  sheriff: { window: 2, barricade: 2 },
};
export const SECTORS = [
  { id: 1, name: 'TOWN ENTRANCE', xMin: -60, xMax: -40 },
  { id: 2, name: 'MAIN STREET', xMin: -40, xMax: -6 },
  { id: 3, name: 'SALOON SHOWDOWN', xMin: -6, xMax: 10 }, // midpoint set-piece
  { id: 4, name: 'FINAL PUSH', xMin: 10, xMax: 56 },
];
// ---- Lighting / atmosphere (bright daytime western) ----
export const LIGHTS = {
  hemi: { sky: 0x9ec6ea, ground: 0xb59063, intensity: 0.85 },
  sun: { color: 0xfff1d6, intensity: 2.6, dir: [0.55, 0.75, 0.35] },
  street: { xs: [-50, -38, -26, -14, 2, 14, 26, 38, 50], y: 4.0, z: 0, color: 0xffe2b8, intensity: 8, distance: 12, decay: 2 },
  saloon: { x: -6, y: 4.0, z: -11, color: 0xffc878, intensity: 12, distance: 14, decay: 2 },
  sheriff: { x: 56, y: 4.0, z: -11, color: 0xffe2b8, intensity: 10, distance: 14, decay: 2 },
  muzzle: { color: 0xffb050, distance: 10, decay: 2 },
  total: 13, // hemi 1 + sun 1 + street 6 + saloon 1 + sheriff 2 + muzzle 1
};
export const FOG = { color: 0xcdd8e2, density: 0.0022 };
export const ENV = { size: 128, intensity: 0.85, capturePos: [0, 1.6, 0] };
export const POST = {
  bloomStrength: 0.22, bloomRadius: 0.3, bloomThreshold: 1.1, exposure: 1.02,
  vignette: 0.32, grain: 0.03, ca: 0.0012, saturation: 1.12, maxPixelRatio: 1.5, maxPixelWidth: 2560,
};
// ---- Player ----
export const PLAYER = {
  radius: 0.35, height: 1.8, eyeHeight: 1.65, walkSpeed: 4.2, sprintSpeed: 6.6,
  accel: 40, friction: 12, maxHealth: 100, regenDelay: 6.0, regenRate: 5.0, lowHealth: 30,
  fov: 75, sprintFov: 80, near: 0.07, far: 260, mouseSens: 0.0022, maxPitch: 1.45,
  bobWalkHz: 1.9, bobSprintHz: 2.6, bobAmpWalk: 0.035, bobAmpSprint: 0.05, footstepEvery: 0.55,
};
// ---- Weapons ----
export const WEAPONS = {
  revolver: {
    id: 'revolver', name: 'COLT PEACEMAKER', mode: 'semi', damage: 40, headMult: 3.0, rpm: 240, mag: 6, reserve: 24, maxReserve: 36,
    pellets: 1, spreadDeg: 0.6, moveSpreadDeg: 0.8, bloomDeg: 0.4, maxBloomDeg: 2.5, bloomRecoverDegPerS: 5, bloomDelay: 0.08,
    fullRange: 18, minRange: 40, minFactor: 0.7, kickPitchDeg: 1.6, kickYawDeg: 0.4, kickRamp: 0.05, kickRecover: 0.16,
    vmKickBack: 0.05, vmKickUpDeg: 3.0, reload: 2.2, reloadEmpty: 2.6, reloadTransfer: 0.70, lower: 0.22, raise: 0.28,
    flashScale: 0.35, flashLight: 8, tracerRadius: 0.012, tracerLen: 0.9, casing: 'brass44', sfx: 'revolverShot',
  },
  rifle: {
    id: 'rifle', name: 'WINCHESTER', mode: 'lever', damage: 30, headMult: 2.5, rpm: 120, mag: 8, reserve: 32, maxReserve: 48,
    pellets: 1, spreadDeg: 0.8, moveSpreadDeg: 0.7, bloomDeg: 0.3, maxBloomDeg: 3.0, bloomRecoverDegPerS: 6, bloomDelay: 0.06,
    fullRange: 25, minRange: 50, minFactor: 0.6, kickPitchDeg: 1.3, kickYawDeg: 0.3, kickRamp: 0.04, kickRecover: 0.13,
    vmKickBack: 0.04, vmKickUpDeg: 2.0, reload: 2.4, reloadEmpty: 2.8, reloadTransfer: 0.70, lower: 0.28, raise: 0.32,
    flashScale: 0.45, flashLight: 10, tracerRadius: 0.012, tracerLen: 0.9, casing: 'brass44', sfx: 'rifleShot',
  },
  shotgun: {
    id: 'shotgun', name: 'DOUBLE-BARREL', mode: 'break', damage: 15, headMult: 1.5, rpm: 40, mag: 2, reserve: 12, maxReserve: 20,
    pellets: 9, spreadDeg: 0.8, moveSpreadDeg: 0.6, bloomDeg: 1.2, maxBloomDeg: 3.0, bloomRecoverDegPerS: 4, bloomDelay: 0.15,
    patternRingDeg: [1.6, 2.3], patternRingCount: [3, 5], patternJitterDeg: 0.3,
    fullRange: 6, minRange: 18, minFactor: 0.25, kickPitchDeg: 4.0, kickYawDeg: 0.8, kickRollDeg: 0.6, kickRamp: 0.06, kickRecover: 0.26,
    vmKickBack: 0.09, vmKickUpDeg: 5.0, shotTime: 0.12, breakTime: 0.80, breakEjectAt: 0.25,
    reloadStart: 0.35, reloadShell: 0.55, reloadEnd: 0.40, lower: 0.30, raise: 0.38,
    flashScale: 0.7, flashLight: 18, tracerRadius: 0.006, tracerLen: 0.5, casing: 'hull12', sfx: 'shotgunShot',
  },
};
export const WEAPON_ORDER = ['revolver', 'rifle', 'shotgun'];
export const GROUP_MULT = { torso: 1.0, arm: 0.75, leg: 0.75 };
export function damageMultiplier(group, weaponId, enemyType) {
  if (group === 'head') return Math.min(WEAPONS[weaponId].headMult, ENEMY_TYPES[enemyType].headMultCap);
  return GROUP_MULT[group] ?? 1.0;
}
export const RECOIL = { holdTime: 0.05, vmSpringK: 220, vmSpringD: 18, vmRotK: 260, vmRotD: 20 };
export const BALLISTICS = { maxDist: 120, tracerSpeed: 280, tracerMinDist: 1.5, tracerMinTime: 0.035, tracerMaxTime: 0.11 };
// ---- Enemies ----
export const ENEMY_TYPES = {
  window: { hp: 60, radius: 0.35, headR: 0.14, headMultCap: 99, anchor: 'window', points: 1, vocalPitch: [0.9, 1.1] },
  roof: { hp: 80, radius: 0.35, headR: 0.14, headMultCap: 99, anchor: 'roof', points: 2, vocalPitch: [1.1, 1.3] },
  barricade: { hp: 100, radius: 0.40, headR: 0.15, headMultCap: 99, anchor: 'barricade', points: 3, vocalPitch: [0.7, 0.9] },
};
export const ENEMY = {
  poolSize: 24, corpseCap: 10, corpseTime: 9, deathFallTime: 0.9, restTwitchTime: 0.4,
  sinkTime: 1.5, sinkDepth: 2.2, hitFlashTime: 0.08, boundingR: 1.6, lodDistance: 45,
  peekTime: [0.8, 1.4], aimTime: [0.5, 0.9], fireTime: 0.1, duckTime: [0.9, 1.6], reloadTime: [1.5, 2.5],
  fireRange: 45, fireAccuracyDeg: [0.5, 2.0], damage: [8, 14], vocalEvery: [3, 9], maxVoices: 6,
};
// ---- Mission ----
export const MISSION = { introTime: 2.0, sectorClearTime: 3.0, showdownIntro: 2.0 };
export const PRISONER = { cellPos: [56, 0, -11], interactDist: 1.6, interactCosAngle: 0.766, keyPos: [56, 1.0, -11] };
// ---- Effects ----
export const FX = {
  tracers: 96, casings: 64, particles: 4096, smoke: 48, decalsHoles: 256, decalsSplats: 128,
  decalsPools: 24, dustMotes: 600, casingLife: 8, decalLife: 90, flashLife: 0.055, smokeLife: 0.6, decalOffset: 0.006,
};
// ---- Budgets / misc ----
export const BUDGET = {
  drawCalls: 400, triangles: 1_500_000, lights: 12, programs: 64,
  textures: 220, canvasTextures: 160, gpuMB: 250, initMsHeadless: 45000, initMsDesktop: 5000, stepMs: 8,
};
export const LAYERS = { DEFAULT: 0, VIEWMODEL: 1, NO_ENV: 2 };
export const UP = new THREE.Vector3(0, 1, 0);
export const FONTS = {
  SIGN: 'bold 64px Georgia, "Times New Roman", "DejaVu Serif", serif',
  STENCIL: '900 96px Impact, "Arial Black", "DejaVu Sans", sans-serif',
  MONO: 'bold 48px "Courier New", "DejaVu Sans Mono", monospace',
};
