// Boot, context (G), fixed-timestep loop, restart, resize, error capture.
// See Plan.txt §1.7, §2.1, §2.3. Systems are imported dynamically with a
// NullSystem fallback so a missing/broken module never bricks the boot.
import * as THREE from 'three';
import {
  FIXED_DT, MAX_SUBSTEPS, DEFAULT_SEED, VERSION, PLAYER, POST, LAYERS,
} from './constants.js';
import { Bus } from './bus.js';
import { Colliders } from './collision.js';
import { mulberry32 } from './utils.js';

// ---- Options ----
export function parseOpts(search) {
  const p = new URLSearchParams(search);
  const headless = p.get('headless') === '1' ||
    (typeof navigator !== 'undefined' && navigator.webdriver === true && p.get('headless') !== '0');
  const manual = headless;
  const lowfx = p.get('lowfx') === '1';
  const nopost = p.get('nopost') === '1' || p.get('post') === '0';
  const audio = p.get('audio') === '0' ? false : !headless;
  const debug = p.get('debug') === '1';
  const seed = Number.parseInt(p.get('seed'), 10) || DEFAULT_SEED;
  const viewer = p.get('viewer') === '1';
  return { headless, manual, lowfx, nopost, audio, debug, seed, viewer, post: p.get('post') === '1' };
}

export function createRenderer(canvas, opts) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, powerPreference: 'high-performance',
    alpha: false, stencil: false,
  });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = POST.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;
  const pr = (opts.lowfx || opts.headless) ? 1 : Math.min(window.devicePixelRatio || 1, POST.maxPixelRatio);
  renderer.setPixelRatio(pr);
  return renderer;
}

// A no-op system used when a module fails to load.
function NullSystem(G, name) {
  return {
    __null: true, name,
    init() {}, update() {}, render() {}, reset() {}, dispose() {},
  };
}

// ---- Context ----
export function createContext(canvas, opts) {
  const renderer = createRenderer(canvas, opts);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(PLAYER.fov, 1, PLAYER.near, PLAYER.far);
  camera.rotation.order = 'YXZ';
  camera.layers.enable(LAYERS.VIEWMODEL);
  camera.layers.enable(LAYERS.NO_ENV);
  scene.add(camera);

  const G = {
    opts,
    bus: new Bus(),
    rng: mulberry32(opts.seed),
    rngBuild: mulberry32(opts.seed),
    time: 0, frame: 0,
    renderer, scene, camera, canvas,
    hudRoot: document.getElementById('hud'),
    overlayRoot: document.getElementById('overlay'),
    colliders: null, envMap: null,
    stats: {
      shotsFired: 0, shotsHit: 0, headshots: 0, kills: 0, killsByType: { window: 0, roof: 0, barricade: 0 },
      damageDealt: 0, damageTaken: 0, sectorsCleared: 0, timeSurvived: 0,
      get accuracy() { return this.shotsFired ? this.shotsHit / this.shotsFired : 0; },
    },
    started: false, paused: false, gameOver: false, manual: false, lowHealth: 0,
    renderDirty: false,
    hooks: {},
    input: null, town: null, props: null, particles: null, decals: null,
    lighting: null, post: null, nav: null, player: null, weapons: null,
    enemies: null, mission: null, prisoner: null, audio: null, hud: null,
    _perf: { fps: 0, stepMs: 0, renderMs: 0, renders: 0, initMs: 0, programsBaseline: 0, _emaFps: 0, _emaStep: 0 },
    _initTimings: { total: 0, textures: {}, aoBake: 0, envCapture: 0, compile: 0 },
    _warmupDone: false,
  };

  G.colliders = new Colliders(G);

  G.hooks.start = (o) => start(G, o);
  G.hooks.restart = () => restart(G);
  G.hooks.stepOnce = () => stepOnce(G);
  G.hooks.renderOnce = () => renderOnce(G);

  return G;
}

// ---- System module table (phase order) ----
const SYSTEM_MODULES = [
  ['input', './input.js', 'Input'],
  ['town', './town.js', 'Town'],
  ['props', './props.js', 'Props'],
  ['particles', './particles.js', 'Particles'],
  ['decals', './decals.js', 'Decals'],
  ['lighting', './lighting.js', 'Lighting'],
  ['post', './post.js', 'Post'],
  ['nav', './nav.js', 'Nav'],
  ['player', './player.js', 'Player'],
  ['weapons', './weapons.js', 'Weapons'],
  ['enemies', './enemies.js', 'Enemies'],
  ['mission', './mission.js', 'Mission'],
  ['prisoner', './prisoner.js', 'Prisoner'],
  ['audio', './audio.js', 'Audio'],
  ['hud', './hud.js', 'Hud'],
];

let _materialsMod = null;
async function loadMaterials() {
  try { _materialsMod = await import('./materials.js'); }
  catch (e) { console.error('materials.js failed to load', e); _materialsMod = null; }
}

// ---- Boot ----
export async function boot() {
  const canvas = document.getElementById('c');
  const opts = parseOpts(typeof location !== 'undefined' ? location.search : '');
  const G = createContext(canvas, opts);
  G.__game = null;

  // Debug API installed early (ready=false) before asset generation.
  let debugMod = null;
  try { debugMod = await import('./debug.js'); } catch (e) { console.error('debug.js failed', e); }
  if (debugMod && debugMod.installDebugApi) {
    try { G.__game = debugMod.installDebugApi(G); } catch (e) { console.error('installDebugApi failed', e); }
  }

  await loadMaterials();
  if (_materialsMod && _materialsMod.initMaterials) {
    try { _materialsMod.initMaterials(G.renderer, opts.seed); } catch (e) { console.error('initMaterials failed', e); }
  }

  // Phase 1: construct every system.
  G.nullSystems = [];
  for (const [key, path, cls] of SYSTEM_MODULES) {
    let Sys = null;
    try {
      const mod = await import(path);
      Sys = mod[cls];
    } catch (e) {
      console.error(`system ${key} (${path}) failed to load`, e);
    }
    if (Sys) {
      try { G[key] = new Sys(G); }
      catch (e) { console.error(`system ${key} construct failed`, e); G[key] = NullSystem(G, key); G.nullSystems.push(key); }
    } else {
      G[key] = NullSystem(G, key);
      G.nullSystems.push(key);
    }
  }

  // Phase 2: init in order.
  for (const [key] of SYSTEM_MODULES) {
    try { G[key].init(); }
    catch (e) { console.error(`system ${key} init failed`, e); }
  }

  // Warm-up: one real render + luminance sample, then hide placeholders.
  const t0 = performance.now();
  try {
    renderOnce(G);
    if (G.post && G.post.sampleLuminance) G.post.sampleLuminance();
  } catch (e) { console.error('warmup render failed', e); }
  G._warmupDone = true;
  if (G.post && G.post.warmupDone) G.post.warmupDone();
  // Empty effect pools after warm-up.
  for (const key of ['particles', 'decals', 'enemies']) {
    if (G[key] && G[key].warmupDone) { try { G[key].warmupDone(); } catch (e) { /* ignore */ } }
  }
  G._perf.initMs = performance.now() - t0 + (G._perf.initMs || 0);
  G._perf.programsBaseline = G.renderer.info.programs ? G.renderer.info.programs.length : 0;

  // Resize + start RAF.
  setupResize(G);
  G._lastMs = performance.now();
  G._raf = requestAnimationFrame((now) => frame(G, now));

  if (G.__game) { G.__game.ready = true; G.__game.nullSystems = G.nullSystems; }
  return G;
}

// ---- Loop ----
function frame(G, nowMs) {
  G._raf = requestAnimationFrame((now) => frame(G, now));
  const dtReal = Math.min(Math.max((nowMs - G._lastMs) / 1000, 0), 0.1);
  G._lastMs = nowMs;

  if (!G.manual) {
    if (!G.paused && G.started) {
      G._acc = (G._acc || 0) + dtReal;
      let n = 0;
      while (G._acc >= FIXED_DT && n < MAX_SUBSTEPS) { stepOnce(G); G._acc -= FIXED_DT; n++; }
      if (n === MAX_SUBSTEPS) G._acc = 0;
    }
    renderOnce(G);
    // EMA fps over real frames
    const inst = dtReal > 0 ? 1 / dtReal : 0;
    G._perf._emaFps = G._perf._emaFps ? G._perf._emaFps + (inst - G._perf._emaFps) * 0.1 : inst;
    G._perf.fps = G._perf._emaFps;
  } else if (G.renderDirty) {
    renderOnce(G);
  }
}

export function stepOnce(G) {
  const t0 = performance.now();
  G.time += FIXED_DT;
  G.frame++;
  const dt = FIXED_DT;
  try {
    G.input.update();
    G.player.update(dt);
    G.nav.update(dt);
    G.weapons.update(dt);
    G.enemies.update(dt);
    G.mission.update(dt);
    G.prisoner.update(dt);
    G.particles.update(dt);
    G.decals.update(dt);
    G.lighting.update(dt);
    G.props.update(dt);
    G.audio.update(dt);
    G.hud.update(dt);
    G.input.consume();
    if (G.__game && G.__game._recordTick) G.__game._recordTick();
  } catch (e) {
    if (G.__game) { G.__game.errors.push('stepOnce: ' + (e && e.message ? e.message : String(e))); }
    throw e;
  }
  const cost = performance.now() - t0;
  G._perf._emaStep = G._perf._emaStep ? G._perf._emaStep + (cost - G._perf._emaStep) * 0.05 : cost;
  G._perf.stepMs = G._perf._emaStep;
}

export function renderOnce(G) {
  const t0 = performance.now();
  try {
    G.player.render();
    G.enemies.render();
    G.weapons.render();
    G.particles.render();
    G.lighting.render();
    G.post.render();
  } catch (e) {
    if (G.__game) G.__game.errors.push('renderOnce: ' + (e && e.message ? e.message : String(e)));
    throw e;
  }
  G._perf.renderMs = performance.now() - t0;
  G._perf.renders++;
  if (G.manual) G._perf.fps = G._perf.renderMs > 0 ? 1000 / G._perf.renderMs : 0;
  G.renderDirty = false;
}

// ---- Start / restart ----
export function start(G, o = {}) {
  if (G.started) return;
  const manual = o.manual != null ? o.manual : G.opts.manual;
  G.started = true;
  G.manual = manual;
  if (G.hud && G.hud.hideStart) G.hud.hideStart();
  if (!manual && !G.opts.headless) {
    try { G.canvas.requestPointerLock && G.canvas.requestPointerLock(); } catch (e) { /* ignore */ }
  }
  if (G.audio && G.audio.unlock) G.audio.unlock();
  G.bus.emit('game-start', {});
  if (G.mission && G.mission.begin) G.mission.begin();
}

export function restart(G) {
  G.time = 0; G.frame = 0;
  G.bus.ring.length = 0; G.bus.ringHead = 0; G.bus._seq = 0;
  G.gameOver = false; G.paused = false; G.lowHealth = 0;
  G.stats.shotsFired = 0; G.stats.shotsHit = 0; G.stats.headshots = 0; G.stats.kills = 0;
  G.stats.damageDealt = 0; G.stats.damageTaken = 0; G.stats.sectorsCleared = 0; G.stats.timeSurvived = 0;
  G.stats.killsByType = { window: 0, roof: 0, barricade: 0 };
  for (const [key] of SYSTEM_MODULES) {
    try { G[key].reset(); } catch (e) { console.error(`system ${key} reset failed`, e); }
  }
  G.bus.emit('game-restart', {});
  if (G.mission && G.mission.begin) G.mission.begin();
}

// ---- Resize ----
function setupResize(G) {
  const onResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    G.renderer.setSize(w, h, false);
    G.camera.aspect = w / h;
    G.camera.updateProjectionMatrix();
    if (G.post && G.post.resize) G.post.resize(w, h);
    G.renderDirty = true;
  };
  window.addEventListener('resize', onResize);
  onResize();
  G._onResize = onResize;
}

// ---- Error capture ----
export function installErrorCapture(api) {
  const push = (msg) => { if (api && api.errors.length < 500) api.errors.push(msg); };
  window.addEventListener('error', (e) => push('error: ' + (e.message || e.error)));
  window.addEventListener('unhandledrejection', (e) => push('rejection: ' + (e.reason && e.reason.message ? e.reason.message : e.reason)));
  const origError = console.error;
  console.error = (...args) => { push('console.error: ' + args.map(String).join(' ')); origError.apply(console, args); };
}

// ---- Auto-boot ----
if (typeof window !== 'undefined' && !window.__NO_AUTOBOOT) {
  const api = { errors: [], ready: false };
  installErrorCapture(api);
  boot().catch((e) => { api.errors.push('boot: ' + (e && e.message ? e.message : String(e))); });
}
