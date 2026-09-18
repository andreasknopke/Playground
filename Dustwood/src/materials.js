// Material registry. See Plan.txt §2.9, §3.2. Every material is created once
// and cached; envMap is set per-material (r185 overwrites envMapIntensity for
// materials whose own envMap is null). MAT is a lazy proxy.
import * as THREE from 'three';
import { getTexture, initTextures } from './textures.js';
import { ENV } from './constants.js';

let _renderer = null;
const _mats = new Map();
let _envMap = null;
let _envRT = null;

function stdTex(name, variant = 0) {
  const set = getTexture(name, variant);
  return set;
}

const FACTORY = {
  woodPlank: () => stdMat('woodPlank', { roughness: 0.85, vertexColors: true }),
  woodWorn: () => stdMat('woodWorn', { roughness: 0.9, vertexColors: true }),
  adobe: () => stdMat('adobe', { roughness: 0.95, vertexColors: true }),
  sand: () => stdMat('sand', { roughness: 1.0, vertexColors: true }),
  boardwalk: () => stdMat('boardwalk', { roughness: 0.9, vertexColors: true }),
  rust: () => {
    const set = stdTex('rust');
    const m = new THREE.MeshStandardMaterial({ map: set.map, normalMap: set.normal, roughness: 0.7, metalness: 0.5, vertexColors: true });
    if (set.roughMetal) { m.roughnessMap = set.roughMetal; m.metalnessMap = set.roughMetal; }
    return m;
  },
  saloonRed: () => stdMat('saloonRed', { roughness: 0.7, vertexColors: true }),
  churchWhite: () => stdMat('churchWhite', { roughness: 0.85, vertexColors: true }),
  hay: () => stdMat('hay', { roughness: 0.95, vertexColors: true }),
  barrelWood: () => stdMat('barrelWood', { roughness: 0.85, vertexColors: true }),
  crateWood: () => stdMat('crateWood', { roughness: 0.85, vertexColors: true }),
  wagonWood: () => stdMat('wagonWood', { roughness: 0.85, vertexColors: true }),
  signBlack: () => new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.3 }),
  signEnamel: () => new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.4 }),
  paper: () => new THREE.MeshStandardMaterial({ color: 0xd8c8a0, roughness: 0.8 }),
  gunmetal: () => {
    const set = getTexture('gunMetalRough');
    return new THREE.MeshStandardMaterial({ color: 0x2a2d30, metalness: 0.85, roughness: 0.4, roughnessMap: set.rough });
  },
  brass: () => new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 0.9, roughness: 0.35 }),
  gunWood: () => {
    const set = getTexture('gunWood');
    return new THREE.MeshStandardMaterial({ map: set.map, roughness: 0.5 });
  },
  skinHands: () => new THREE.MeshStandardMaterial({ color: 0xb08058, roughness: 0.65 }),
  sightGlow: () => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff8a1a, emissiveIntensity: 2 }),
  glass: () => new THREE.MeshPhysicalMaterial({ color: 0x88aacc, roughness: 0.05, transparent: true, opacity: 0.25, envMapIntensity: 1.5, depthWrite: false }),
  puddle: () => new THREE.MeshPhysicalMaterial({ color: 0x202020, roughness: 0.04, clearcoat: 1, envMapIntensity: 2.0, transparent: true, opacity: 0.85 }),
  aoStrip: () => makeAoStripMaterial(),
  blobShadow: () => makeBlobShadowMaterial(),
  additive: () => new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }),
  tracer: () => new THREE.MeshBasicMaterial({ color: 0xffd9a0, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }),
  casingBrass: () => new THREE.MeshStandardMaterial({ color: 0xcc9944, metalness: 0.9, roughness: 0.35 }),
  casingHull: () => new THREE.MeshStandardMaterial({ color: 0x992222, roughness: 0.6 }),
  decalHole: () => decalMat('decalHoles'),
  decalBlood: () => decalMat('decalBlood'),
  decalPool: () => decalMat('decalPool'),
  eyeGlow: () => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xb7c95a, emissiveIntensity: 1.5 }),
  cactus: () => alphaMat('cactus'),
  shrub: () => alphaMat('shrub'),
  deadTree: () => alphaMat('deadTree'),
  tumbleweed: () => alphaMat('tumbleweed'),
  mesa: () => new THREE.MeshBasicMaterial({ map: getTexture('mesa').map, transparent: true, side: THREE.DoubleSide, fog: true }),
  sky: () => new THREE.MeshBasicMaterial({ map: getTexture('sky').map, side: THREE.BackSide, fog: false, depthWrite: false }),
  muzzleFlash: () => new THREE.MeshBasicMaterial({ map: getTexture('muzzleFlash').map, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }),
  sprite: () => new THREE.MeshBasicMaterial({ map: getTexture('spriteAtlas').map, transparent: true, depthWrite: false, toneMapped: false }),
  glowRadial: () => new THREE.MeshBasicMaterial({ map: getTexture('glowRadial').map, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }),
  shaft: () => new THREE.MeshBasicMaterial({ map: getTexture('shaftGradient').map, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
  signSaloon: () => signMat('signSaloon'),
  signSheriff: () => signMat('signSheriff'),
  signLivery: () => signMat('signLivery'),
  signChurch: () => signMat('signChurch'),
  wantedPoster: () => new THREE.MeshStandardMaterial({ map: getTexture('wantedPoster').map, roughness: 0.85 }),
  crossWood: () => new THREE.MeshStandardMaterial({ map: getTexture('crossWood').map, roughness: 0.9, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }),
  enemy: () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, vertexColors: true }),
  hatFelt: () => new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.95 }),
  hatBand: () => new THREE.MeshStandardMaterial({ color: 0x241608, roughness: 0.8 }),
};

function stdMat(name, opts) {
  const set = stdTex(name);
  const m = new THREE.MeshStandardMaterial({ map: set.map, roughness: opts.roughness ?? 0.8, vertexColors: !!opts.vertexColors });
  if (set.normal) m.normalMap = set.normal;
  if (set.rough) m.roughnessMap = set.rough;
  return m;
}
function alphaMat(name) {
  const set = getTexture(name);
  return new THREE.MeshStandardMaterial({ map: set.map, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
}
function signMat(name) {
  const set = getTexture(name);
  return new THREE.MeshStandardMaterial({ map: set.map, roughness: 0.5, transparent: true });
}
function decalMat(name) {
  const set = getTexture(name);
  return new THREE.MeshStandardMaterial({ map: set.map, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false, roughness: 0.9 });
}

export function makeAoStripMaterial() {
  // gradient alpha map
  const c = document.createElement('canvas'); c.width = 4; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 64);
  const alpha = new THREE.CanvasTexture(c);
  return new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: alpha, transparent: true, depthWrite: false });
}

export function makeBlobShadowMaterial() {
  const set = getTexture('blobShadow');
  return new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: set.map, transparent: true, depthWrite: false });
}

export function getMaterial(name) {
  if (_mats.has(name)) return _mats.get(name);
  const f = FACTORY[name];
  if (!f) { console.warn('unknown material', name); return null; }
  const m = f();
  applyEnvironment(m);
  _mats.set(name, m);
  return m;
}

export function cloneMaterial(name, overrides = {}) {
  const base = getMaterial(name);
  if (!base) return null;
  const m = base.clone();
  Object.assign(m, overrides);
  applyEnvironment(m);
  return m;
}

// MAT lazy proxy
export const MAT = new Proxy({}, {
  get(_t, prop) {
    if (typeof prop === 'string' && prop.startsWith('enemy-')) return getMaterial('enemy');
    return getMaterial(prop);
  },
  has(_t, prop) { return prop in FACTORY || String(prop).startsWith('enemy-'); },
});

export function applyEnvironment(material) {
  if (_envMap && material && 'envMap' in material) {
    material.envMap = _envMap;
    if (material.envMapIntensity == null) material.envMapIntensity = ENV.intensity;
    material.needsUpdate = true;
  }
}

export function getEnvironment() { return _envMap; }

// Capture the built scene into a PMREM env map, once.
export function captureEnvironment(G) {
  const t0 = performance.now();
  const size = ENV.size;
  _envRT = new THREE.WebGLCubeRenderTarget(size, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cubeCam = new THREE.CubeCamera(0.1, 200, _envRT);
  cubeCam.position.set(ENV.capturePos[0], ENV.capturePos[1], ENV.capturePos[2]);
  cubeCam.update(G.renderer, G.scene);
  const pmrem = new THREE.PMREMGenerator(G.renderer);
  pmrem.compileCubemapShader();
  const env = pmrem.fromCubemap(_envRT.texture).texture;
  pmrem.dispose();
  _envMap = env;
  G.scene.environment = env;
  G.scene.environmentIntensity = ENV.intensity;
  // apply to already-created materials
  for (const m of _mats.values()) applyEnvironment(m);
  if (G._initTimings) G._initTimings.envCapture = performance.now() - t0;
  return env;
}

export function initMaterials(renderer, seed) {
  _renderer = renderer;
  initTextures(renderer, seed);
}

export function disposeAllMaterials() {
  for (const m of _mats.values()) m.dispose();
  _mats.clear();
  if (_envMap) { _envMap.dispose(); _envMap = null; }
  if (_envRT) { _envRT.dispose(); _envRT = null; }
}

export const MATERIAL_NAMES = Object.keys(FACTORY);
