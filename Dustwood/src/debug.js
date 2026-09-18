// window.__game debug/control API. See Plan.txt §9. Installed early in boot()
// with ready=false; lifecycle calls go through G.hooks. Every call is
// synchronous and returns JSON-able data. Angles radians, positions [x,y,z].
import { VERSION, FIXED_DT, BUDGET, PLAYER } from './constants.js';
import * as THREE from 'three';

function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
function arr3(v) { return v ? [num(v.x), num(v.y), num(v.z)] : [0, 0, 0]; }

export function installDebugApi(G) {
  const api = {
    ready: false,
    version: VERSION,
    errors: [],
    nullSystems: [],
    G,
    _recordTick() { /* hook point; main calls this each tick */ },
  };

  // ---- Lifecycle ----
  api.disableAudio = () => { if (G.audio) { G.audio.disable && G.audio.disable(); G.opts.audio = false; } };
  api.enableAudio = () => { if (G.audio) { G.opts.audio = true; G.audio.enable && G.audio.enable(); } };
  api.seed = (n) => { G.rng.seed(n >>> 0); };
  api.start = (opts = {}) => { G.hooks.start(opts); return api.getState(); };
  api.restart = () => { G.hooks.restart(); return api.getState(); };
  api.pause = () => { G.paused = true; };
  api.resume = () => { G.paused = false; };
  api.setManualStepping = (b) => { G.manual = !!b; };

  api.step = (dt = FIXED_DT, n = 1) => {
    const d = Math.min(Math.max(dt, 1 / 240), 0.1);
    const count = Math.max(1, n | 0);
    for (let i = 0; i < count; i++) {
      stepTick(G, d);
    }
    G.hooks.renderOnce();
    return api.getState();
  };

  api.setTime = (t) => {
    if (t <= G.time) { G.hooks.renderOnce(); return api.getState(); }
    let ticks = Math.min(Math.ceil((t - G.time) / FIXED_DT), 36000);
    for (let i = 0; i < ticks; i++) { stepTick(G, FIXED_DT); }
    G.hooks.renderOnce();
    return api.getState();
  };
  api.fastForward = (seconds) => api.setTime(G.time + seconds);
  api.renderOnce = () => { G.hooks.renderOnce(); };

  // ---- Input injection ----
  api.setLook = (yaw, pitch) => { G.player.setLook(num(yaw), num(pitch)); };
  api.look = (dYaw, dPitch) => { const s = PLAYER.mouseSens; G.input.addLook(num(dYaw) / s, num(dPitch) / s); };
  api.lookAt = (x, y, z) => { G.player.aimAt(num(x), num(y), num(z)); };
  api.aimAt = (x, y, z) => { G.player.aimAt(num(x), num(y), num(z)); };
  api.aimAtEnemy = (id, group = 'torso') => {
    const e = G.enemies.byId(id);
    if (!e) return false;
    const c = G.enemies.hitVolumeCenter(e, group, new THREE.Vector3());
    if (!c) return false;
    G.player.aimAt(c.x, c.y, c.z);
    return true;
  };
  api.move = (a, b) => {
    let dx = 0, dz = 0;
    if (a == null) { G.input.setMoveWorld(null); return; }
    if (Array.isArray(a)) { dx = a[0]; dz = a.length > 2 ? a[2] : a[1]; }
    else if (typeof a === 'object') { dx = a.x || 0; dz = a.z != null ? a.z : (a.y || 0); }
    else { dx = a; dz = b || 0; }
    G.input.setMoveWorld(dx, dz);
  };
  api.moveWorld = (dx, dz) => { G.input.setMoveWorld(dx, dz); };
  api.moveLocal = (strafe, forward) => { G.input.setMove(strafe || 0, forward || 0); };
  api.setSprint = (b) => { G.input.setSprint(b); };
  api.fire = () => {
    G.input.pressFire();
    // fire synchronously this tick
    const fired = G.weapons.fire();
    G.input.holdFire(false);
    return !!fired;
  };
  api.setTrigger = (b) => { G.weapons.setTrigger(!!b); };
  api.reload = () => !!G.weapons.reload();
  api.switchWeapon = (n) => {
    if (!(n >= 1 && n <= 3)) return null;
    return G.weapons.switchTo(n - 1);
  };
  api.interact = () => { G.input.pressInteract(); if (G.mission) G.mission.tryInteract && G.mission.tryInteract(); };
  api.teleport = (x, z, yaw, pitch) => { G.player.teleport(num(x), num(z), yaw, pitch); };

  // ---- Game manipulation ----
  api.killAllEnemies = () => G.enemies.killAll({ silent: false });
  api.killEnemy = (id) => { const e = G.enemies.byId(id); if (e) G.enemies.kill(e); };
  api.spawnEnemy = (type, x, z, opts = {}) => {
    const e = G.enemies.spawn(type, null, { pos: { x: num(x), y: 0, z: num(z) }, ...opts });
    return e ? e.id : null;
  };
  api.skipToSector = (n) => {
    if (G.gameOver) G.hooks.restart();
    const r = G.mission.skipToSector(n);
    return api.getState();
  };
  api.skipShowdown = () => api.skipToSector(3);
  api.setGodMode = (b) => { G.player.god = !!b; };
  api.setInfiniteAmmo = (b) => { G.weapons.infiniteAmmo = !!b; };
  api.setEnemySpeedScale = (k) => { G.enemies.speedScale = num(k); };
  api.setEnemyAI = (b) => { G.enemies.aiEnabled = !!b; };
  api.setHealth = (h) => G.player.setHealth(h);
  api.giveAmmo = () => G.weapons.resupplyAll();
  api.unlockCell = () => { if (G.prisoner.unlockCell) G.prisoner.unlockCell(); };
  api.winGame = () => { if (G.prisoner.freePrisoner) G.prisoner.freePrisoner(); };
  api.setQuality = (q) => { if (G.post.setQuality) G.post.setQuality(q); };
  api.hideHud = (b) => { if (G.hud.setHidden) G.hud.setHidden(!!b); };
  api.showFps = (b) => { if (G.hud.setFpsVisible) G.hud.setFpsVisible(!!b); };
  api.screenshotHint = () => { api.teleport(-24, 0.4); api.setLook(-Math.PI / 2, -0.05); return 'S1'; };
  api.setTuning = (path, value) => {
    const parts = path.split('.');
    let obj = _tuningRoot;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    if (obj) obj[parts[parts.length - 1]] = value;
  };
  api.getTuning = () => ({ weapons: _tuningRoot.WEAPONS });

  // ---- State inspection ----
  api.getState = () => {
    const p = G.player || {}, w = G.weapons || {}, m = G.mission || {}, pr = G.prisoner || {};
    const ammo = w.getAmmo ? w.getAmmo() : { mag: 0, reserve: 0 };
    const rec = p.recoil || { pitch: 0, yaw: 0 };
    return {
      mode: G.gameOver ? (G._win ? 'win' : 'gameover') : (G.started ? 'playing' : 'menu'),
      started: G.started, paused: G.paused, manual: G.manual,
      audio: G.audio && G.audio.state ? G.audio.state : 'disabled',
      time: G.time, frame: G.frame,
      fps: Math.round(G._perf.fps), renders: G._perf.renders, stepMs: G._perf.stepMs, renderMs: G._perf.renderMs,
      sector: m ? m.sector : 0, sectorState: m ? m.state : 'idle',
      enemiesAlive: G.enemies && G.enemies.aliveCount ? G.enemies.aliveCount : 0,
      enemiesQueued: m && m.queue ? m.queue.length : 0,
      enemiesTotalThisSector: m ? m.totalThisSector || 0 : 0,
      enemiesSpawned: m ? m.spawnedThisSector || 0 : 0,
      corpses: G.enemies && G.enemies.corpseCount ? G.enemies.corpseCount : 0,
      playerHealth: Math.round(p.health != null ? p.health : 100), playerPos: arr3(p.pos), playerYaw: p.yaw || 0, playerPitch: p.pitch || 0, playerAlive: p.alive != null ? p.alive : true,
      weapon: w.current ? w.current.id : null, weaponState: w.getState ? w.getState() : null,
      ammo, ammoAll: w.getAmmoAll ? w.getAmmoAll() : {},
      spread: w.getSpreadDeg ? w.getSpreadDeg() : 0,
      recoil: [rec.pitch || 0, rec.yaw || 0],
      prisoner: pr.state || 'locked', keyHeld: !!pr.keyHeld, cellUnlocked: !!pr.cellUnlocked,
      gameOver: G.gameOver, gameOverReason: G._gameOverReason || null,
      kills: G.stats.kills, score: m && m.score != null ? m.score : 0, lowHealth: G.lowHealth,
      drawCalls: G.renderer.info.render.calls, errors: api.errors.length,
    };
  };

  api.getEnemies = () => G.enemies.getAll().map(enemyEntry);
  api.getEnemy = (id) => { const e = G.enemies.byId(id); return e ? enemyEntry(e) : null; };
  api.getStats = () => ({ ...G.stats, accuracy: G.stats.accuracy });
  api.getEvents = (since = 0) => {
    const events = G.bus.since(since);
    return { next: G.bus.nextIndex(), events };
  };
  api.getRenderInfo = () => {
    const info = G.renderer.info;
    return {
      calls: info.render.calls, triangles: info.render.triangles, points: info.render.points,
      lines: info.render.lines, geometries: info.memory.geometries, textures: info.memory.textures,
    };
  };
  api.getPerf = () => {
    const info = G.renderer.info;
    return {
      calls: info.render.calls, triangles: info.render.triangles, points: info.render.points,
      lines: info.render.lines, geometries: info.memory.geometries, textures: info.memory.textures,
      canvasTextures: G._perf.canvasTextures || 0, textureMB: G._perf.textureMB || 0,
      programs: info.programs ? info.programs.length : 0, lights: G._perf.lights || 0,
      fps: Math.round(G._perf.fps), stepMs: G._perf.stepMs, renderMs: G._perf.renderMs,
      renders: G._perf.renders, initMs: G._perf.initMs,
    };
  };
  api.getInitTimings = () => G._initTimings;
  api.getPools = () => (G.particles && G.particles.getPools) ? G.particles.getPools() : {
    tracers: { live: 0, cap: 0 }, casings: { live: 0, cap: 0 }, particles: { live: 0, cap: 0 },
    smoke: { live: 0, cap: 0 }, decals: { holes: 0, splats: 0, pools: 0 },
    enemies: { alive: G.enemies.aliveCount || 0, corpses: G.enemies.corpseCount || 0, free: 0 }, voices: 0,
  };
  api.getLevelInfo = () => ({
    bounds: { xMin: -60, xMax: 60, zMin: -14, zMax: 14 },
    playerSpawn: G.town.playerSpawn, anchors: G.town.anchors,
    sectors: G.town.sectors, buildings: G.town.buildings, api: Object.keys(api),
  });
  api.floorHeightAt = (x, z) => G.town.floorHeightAt(x, z);
  api.navDistanceAt = (x, z) => G.nav.distanceAt ? G.nav.distanceAt(x, z) : -1;
  api.sampleLuminance = () => G.post.sampleLuminance ? G.post.sampleLuminance() : 0;

  window.__game = api;
  return api;
}

function enemyEntry(e) {
  const head = e.headPos ? [e.headPos.x, e.headPos.y, e.headPos.z] : [0, 0, 0];
  return {
    id: e.id, type: e.type, variant: e.variant || 0, state: e.state,
    hp: Math.round(e.hp), maxHp: e.maxHp, pos: [e.pos.x, e.pos.y, e.pos.z], yaw: e.yaw,
    headPos: head, distToPlayer: e.distToPlayer || 0, alive: e.alive, anchorId: e.anchorId || null,
  };
}

// A single sim tick at a given dt (used by step/setTime which may use dt != FIXED_DT).
function stepTick(G, dt) {
  G.time += dt; G.frame++;
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
  } catch (e) {
    apiPushError(G, 'stepTick: ' + (e && e.message ? e.message : String(e)));
    throw e;
  }
}

function apiPushError(G, msg) { if (G.__game && G.__game.errors.length < 500) G.__game.errors.push(msg); }

// Live-tunable constants root (setTuning writes here).
import * as C from './constants.js';
const _tuningRoot = C;
