// Audio: everything synthesized with WebAudio at unlock; no files. Bus-driven.
// Headless-safe: disable() never creates an AudioContext. See Plan.txt §7.
import { WEAPONS } from './constants.js';

const SURFACE_SFX = {
  wood: 'impactWood', adobe: 'impactAdobe', sand: 'impactSand',
  metal: 'impactMetal', glass: 'impactGlass',
};

export class Audio {
  constructor(G) {
    this.G = G;
    this.enabled = G.opts.audio;
    this.ctx = null;
    this.state = this.enabled ? 'locked' : 'disabled';
    this.voicesActive = 0;
    this._master = null; this._sfx = null; this._amb = null; this._ui = null;
    this._duck = null; this._comp = null; this._convolver = null; this._reverbReturn = null;
    this._noise = {};
    this._lastPlay = new Map();
    this._loops = new Map();
    this._off = [];
    this._voiceCap = 32;
    this._pannerPool = [];
  }

  init() {
    const bus = this.G.bus;
    const on = (n, f) => this._off.push(bus.on(n, f));
    on('shot-fired', (p) => this._onShotFired(p));
    on('weapon-empty', () => this.play('dryFire'));
    on('weapon-reload-start', (p) => this._onReloadStart(p));
    on('weapon-switch', () => { this.play('holster'); this.play('drawRevolver', { delay: 0.12 }); });
    on('shot-hit-world', (p) => { const n = SURFACE_SFX[p.surface]; if (n) this.play(n, { pos: p.pos }); });
    on('enemy-hit', (p) => { this.play(p.headshot ? 'headshot' : 'hitFlesh', { pos: p.pos }); this.play('hitMarker'); });
    on('enemy-killed', (p) => { this.play('deathMoan', { pos: p.pos }); this.play('bodyThud', { pos: p.pos, delay: 0.7 }); });
    on('enemy-vocal', (p) => { const n = { window: 'whoop', roof: 'holler', barricade: 'growl' }[p.type] || 'whoop'; this.play(n, { pos: p.pos }); });
    on('enemy-peek', (p) => this.play('whoop', { pos: p.pos, gain: 0.6 }));
    on('enemy-duck', (p) => this.play('growl', { pos: p.pos, gain: 0.5 }));
    on('player-hit', (p) => this.play('playerHurt'));
    on('player-footstep', (p) => this.play('footstep'));
    on('player-death', () => { this.play('gameOver'); this._stopAllLoops(0.5); });
    on('game-over', () => { this.play('gameOver'); this._stopAllLoops(0.5); });
    on('game-win', () => this.play('gameWin'));
    on('game-start', () => this._startAmbience());
    on('sector-enter', () => this.play('sectorSting'));
    on('sector-clear', () => this.play('sectorClear'));
    on('showdown-start', () => this.play('showdownSting'));
    on('key-pickup', () => this.play('keyPickup'));
    on('cell-unlocked', () => this.play('cellUnlock'));
    on('prisoner-freed', () => this.play('prisonerFree'));
  }

  disable() {
    this.enabled = false;
    this.state = 'disabled';
    if (this.ctx) { try { this.ctx.close(); } catch (e) {} this.ctx = null; }
  }

  enable() {
    this.enabled = true;
    this.state = 'locked';
  }

  unlock() {
    if (!this.enabled || this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; this.state = 'disabled'; return; }
      this.ctx = new AC({ latencyHint: 'interactive' });
      this._buildGraph();
      this._buildNoise();
      this._buildImpulse();
      this.state = 'enabled';
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) {
      this.enabled = false;
      this.state = 'disabled';
    }
  }

  _buildGraph() {
    const ctx = this.ctx;
    this._master = ctx.createGain(); this._master.gain.value = 0.8;
    this._comp = ctx.createDynamicsCompressor();
    this._duck = ctx.createBiquadFilter(); this._duck.type = 'lowpass'; this._duck.frequency.value = 20000;
    this._sfx = ctx.createGain(); this._sfx.gain.value = 1.0;
    this._amb = ctx.createGain(); this._amb.gain.value = 0.7;
    this._ui = ctx.createGain(); this._ui.gain.value = 0.6;
    this._sfx.connect(this._duck);
    this._ui.connect(this._master);
    this._amb.connect(this._master);
    this._duck.connect(this._master);
    this._master.connect(this._comp);
    this._comp.connect(ctx.destination);
    // reverb send
    this._convolver = ctx.createConvolver();
    this._reverbReturn = ctx.createGain(); this._reverbReturn.gain.value = 1.0;
    const send = ctx.createGain(); send.gain.value = 0.25;
    this._sfx.connect(send);
    send.connect(this._convolver);
    this._convolver.connect(this._reverbReturn);
    this._reverbReturn.connect(this._master);
    this._reverbSend = send;
    // panner pool
    for (let i = 0; i < 24; i++) {
      const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
      p.refDistance = 1; p.maxDistance = 80; p.rolloffFactor = 1.2;
      p.connect(this._sfx);
      this._pannerPool.push({ node: p, busy: false });
    }
  }

  _buildNoise() {
    const ctx = this.ctx;
    const dur = 2, sr = ctx.sampleRate;
    for (const kind of ['white', 'pink', 'brown']) {
      const buf = ctx.createBuffer(1, sr * dur, sr);
      const d = buf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, lastOut = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'white') d[i] = w;
        else if (kind === 'pink') {
          b0 = 0.99765 * b0 + w * 0.0990460;
          b1 = 0.96300 * b1 + w * 0.2965164;
          b2 = 0.57000 * b2 + w * 1.0526913;
          d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
        } else { b0 = (b0 + 0.02 * w) / 1.02; d[i] = b0 * 3.5; }
      }
      this._noise[kind] = buf;
    }
  }

  _buildImpulse() {
    const ctx = this.ctx;
    const sr = ctx.sampleRate, dur = 2.2;
    const len = Math.floor(sr * dur);
    const ir = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      const preDelay = Math.floor(0.015 * sr);
      for (let i = 0; i < len; i++) {
        if (i < preDelay) { d[i] = 0; continue; }
        const t = (i - preDelay) / sr;
        const env = Math.exp(-3.2 * t);
        const cutoff = 7000 * Math.exp(-t * 1.4) + 900;
        const k = 1 - Math.exp(-2 * Math.PI * cutoff / sr);
        lp += k * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * env;
      }
      // early reflections
      const refl = [0.021, 0.037, 0.051, 0.073, 0.091, 0.117];
      for (let r = 0; r < refl.length; r++) {
        const idx = Math.floor(refl[r] * sr);
        if (idx < len) d[idx] += (r % 2 ? -1 : 1) * 0.4 / (r + 1);
      }
    }
    this._convolver.buffer = ir;
  }

  // ---- voice helpers ----
  _noiseSrc(kind) {
    const s = this.ctx.createBufferSource();
    s.buffer = this._noise[kind]; s.loop = true;
    return s;
  }
  _env(g, t0, peak, dur) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }
  _bq(type, freq, q) { const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q != null) f.Q.value = q; return f; }
  _osc(type, freq) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq; return o; }

  _acquirePanner(pos) {
    // Accept both Vector3-like ({x,y,z}) and array ([x,y,z]) positions.
    const x = pos.x !== undefined ? pos.x : pos[0];
    const y = pos.y !== undefined ? pos.y : pos[1];
    const z = pos.z !== undefined ? pos.z : pos[2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    for (const p of this._pannerPool) {
      if (!p.busy) {
        p.busy = true;
        p.node.positionX.value = x; p.node.positionY.value = y; p.node.positionZ.value = z;
        return p;
      }
    }
    return null;
  }

  setListener(pos, forward) {
    if (!this.ctx) return;
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
      if (forward && Number.isFinite(forward.x) && Number.isFinite(forward.y) && Number.isFinite(forward.z)) {
        l.forwardX.value = forward.x; l.forwardY.value = forward.y; l.forwardZ.value = forward.z;
        l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
      }
    } else if (l.setPosition) {
      l.setPosition(pos.x, pos.y, pos.z);
      if (forward) l.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  setDuck(hz) { if (this._duck) this._duck.frequency.value = hz || 20000; }
  setMasterGain(v) { if (this._master) this._master.gain.value = v; }

  // ---- public play ----
  play(name, opts = {}) {
    if (this.state !== 'enabled' || !this.ctx) return null;
    const now = this.ctx.currentTime;
    const last = this._lastPlay.get(name) || -1;
    if (now - last < 0.025) return null; // per-name rate limit
    this._lastPlay.set(name, now);
    if (this.voicesActive >= this._voiceCap) return null;
    const recipe = RECIPES[name];
    if (!recipe) return null;
    let dest = this._sfx;
    let panner = null;
    if (opts.pos) {
      panner = this._acquirePanner(opts.pos);
      if (panner) dest = panner.node;
    }
    this.voicesActive++;
    const voice = { name, nodes: [], start: now + (opts.delay || 0), panner, gain: opts.gain ?? 1 };
    try {
      recipe(this, dest, voice, opts);
    } catch (e) {
      this.voicesActive--;
      return null;
    }
    // schedule cleanup
    const stopAt = voice.end || (now + (opts.delay || 0) + 1.5);
    const cleanup = () => {
      this.voicesActive = Math.max(0, this.voicesActive - 1);
      if (voice.panner) voice.panner.busy = false;
    };
    // use a single silent timer source to avoid setTimeout in game systems
    const t = this.ctx.createBufferSource();
    t.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    t.connect(this.ctx.destination);
    t.onended = cleanup;
    t.start(stopAt + 0.05);
    return voice;
  }

  _onShotFired(p) {
    if (p.weapon && p.weapon !== 'enemy' && WEAPONS[p.weapon]) {
      this.play(WEAPONS[p.weapon].sfx, { pos: p.muzzle });
    } else if (p.weapon === 'enemy') {
      this.play('rifleShot', { pos: p.muzzle, gain: 0.7 });
    }
    this.play('casingBounce', { pos: p.muzzle, delay: 0.35, gain: 0.4 });
  }

  _onReloadStart(p) {
    const id = p.id || p.weapon;
    this.play('reloadStart');
    if (id === 'revolver') { this.play('cylinderOut', { delay: 0.4 }); this.play('roundsIn', { delay: 1.8 }); }
    else if (id === 'rifle') { this.play('leverRack', { delay: 0.4 }); this.play('roundsIn', { delay: 1.9 }); }
    else if (id === 'shotgun') { this.play('shellInsert', { delay: 0.5 }); }
  }

  _startAmbience() {
    if (this.state !== 'enabled' || !this.ctx || this._loops.has('ambience')) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = ctx.createGain(); g.gain.value = 0.0; g.connect(this._amb);
    g.gain.linearRampToValueAtTime(1.0, t + 2);
    // wind: pink through lowpass + slow LFO
    const wind = this._noiseSrc('pink');
    const lp = this._bq('lowpass', 380);
    const wg = ctx.createGain(); wg.gain.value = 0.05;
    wind.connect(lp); lp.connect(wg); wg.connect(g);
    const lfo = this._osc('sine', 0.08);
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain); lfoGain.connect(wg.gain);
    // low hum
    const hum = this._osc('sine', 120);
    const hg = ctx.createGain(); hg.gain.value = 0.04;
    hum.connect(hg); hg.connect(g);
    wind.start(t); lfo.start(t); hum.start(t);
    this._loops.set('ambience', { nodes: [wind, lfo, hum, g], gain: g });
  }

  _stopAllLoops(fade = 0.3) {
    const t = this.ctx ? this.ctx.currentTime : 0;
    for (const [, loop] of this._loops) {
      if (loop.gain) loop.gain.gain.linearRampToValueAtTime(0.0001, t + fade);
      for (const n of loop.nodes) { try { n.stop(t + fade + 0.05); } catch (e) {} }
    }
    this._loops.clear();
  }

  startLoop(name, opts = {}) { return this._loops.get(name) || null; }
  stopLoop(handle, fadeTime = 0.3) { /* loops managed internally */ }
  setLoopParam(handle, param, value) {}

  update(dt) {
    if (this.state !== 'enabled' || !this.ctx) return;
    const p = this.G.player;
    if (p) {
      const fwd = p.getForward ? p.getForward() : null;
      this.setListener(p.eye || p.pos, fwd);
    }
  }

  reset() {
    this._stopAllLoops(0.1);
    this._lastPlay.clear();
    for (const p of this._pannerPool) p.busy = false;
    this.voicesActive = 0;
  }

  dispose() {
    for (const off of this._off) off();
    this._off.length = 0;
    this._stopAllLoops(0);
    if (this.ctx) { try { this.ctx.close(); } catch (e) {} this.ctx = null; }
  }
}

// ---- recipes: (a: Audio, dest, voice, opts) => void ----
const RECIPES = {
  revolverShot(a, dest, v) {
    const ctx = a.ctx, t = v.start;
    const n = a._noiseSrc('white');
    const bp = a._bq('bandpass', 1800, 0.8);
    const g = ctx.createGain();
    n.connect(bp); bp.connect(g); g.connect(dest);
    a._env(g, t, 1.0 * v.gain, 0.13);
    const sub = a._osc('sine', 180); sub.frequency.exponentialRampToValueAtTime(55, t + 0.09);
    const sg = ctx.createGain(); sub.connect(sg); sg.connect(dest);
    a._env(sg, t, 0.7 * v.gain, 0.09);
    const click = a._osc('square', 3000);
    const cg = ctx.createGain(); click.connect(cg); cg.connect(dest);
    a._env(cg, t, 0.3 * v.gain, 0.002);
    n.start(t); n.stop(t + 0.15); sub.start(t); sub.stop(t + 0.1); click.start(t); click.stop(t + 0.01);
    v.end = t + 0.15;
  },
  rifleShot(a, dest, v) {
    const ctx = a.ctx, t = v.start;
    const n = a._noiseSrc('white');
    const bp = a._bq('bandpass', 1300, 0.9);
    const g = ctx.createGain(); n.connect(bp); bp.connect(g); g.connect(dest);
    a._env(g, t, 0.85 * v.gain, 0.10);
    const sub = a._osc('sine', 140); sub.frequency.exponentialRampToValueAtTime(45, t + 0.1);
    const sg = ctx.createGain(); sub.connect(sg); sg.connect(dest);
    a._env(sg, t, 0.6 * v.gain, 0.1);
    n.start(t); n.stop(t + 0.12); sub.start(t); sub.stop(t + 0.12);
    v.end = t + 0.12;
  },
  shotgunShot(a, dest, v) {
    const ctx = a.ctx, t = v.start;
    const brown = a._noiseSrc('brown');
    const lp = a._bq('lowpass', 900);
    const g = ctx.createGain(); brown.connect(lp); lp.connect(g); g.connect(dest);
    a._env(g, t, 1.0 * v.gain, 0.28);
    const sub = a._osc('sine', 110); sub.frequency.exponentialRampToValueAtTime(35, t + 0.18);
    const sg = ctx.createGain(); sub.connect(sg); sg.connect(dest);
    a._env(sg, t, 0.8 * v.gain, 0.18);
    brown.start(t); brown.stop(t + 0.3); sub.start(t); sub.stop(t + 0.2);
    v.end = t + 0.3;
  },
  dryFire(a, dest, v) {
    const ctx = a.ctx, t = v.start;
    const n = a._noiseSrc('white');
    const hp = a._bq('highpass', 3000);
    const g = ctx.createGain(); n.connect(hp); hp.connect(g); g.connect(dest);
    a._env(g, t, 0.35 * v.gain, 0.006);
    n.start(t); n.stop(t + 0.02);
    v.end = t + 0.02;
  },
  reloadStart(a, dest, v) { clickRecipe(a, dest, v, 900, 0.04, 0.25); },
  cylinderOut(a, dest, v) { clickRecipe(a, dest, v, 1400, 0.03, 0.3); },
  roundsIn(a, dest, v) { clickRecipe(a, dest, v, 2000, 0.05, 0.3); },
  hammerRack(a, dest, v) { clickRecipe(a, dest, v, 1100, 0.04, 0.3); },
  leverRack(a, dest, v) { clickRecipe(a, dest, v, 800, 0.05, 0.3); },
  shellInsert(a, dest, v) { clickRecipe(a, dest, v, 1600, 0.03, 0.28); },
  breakOpen(a, dest, v) { clickRecipe(a, dest, v, 700, 0.05, 0.3); },
  breakClose(a, dest, v) { clickRecipe(a, dest, v, 900, 0.05, 0.3); },
  breakShort(a, dest, v) { clickRecipe(a, dest, v, 1000, 0.04, 0.25); },
  holster(a, dest, v) { clickRecipe(a, dest, v, 1000, 0.12, 0.2); },
  drawRevolver(a, dest, v) { clickRecipe(a, dest, v, 1200, 0.12, 0.2); },
  drawRifle(a, dest, v) { clickRecipe(a, dest, v, 1100, 0.12, 0.2); },
  drawShotgun(a, dest, v) { clickRecipe(a, dest, v, 900, 0.12, 0.2); },
  casingBounce(a, dest, v) {
    const ctx = a.ctx, t = v.start;
    const o = a._osc('sine', 3500);
    const g = ctx.createGain(); o.connect(g); g.connect(dest);
    a._env(g, t, 0.25 * v.gain, 0.05);
    o.start(t); o.stop(t + 0.06); v.end = t + 0.06;
  },
  hullBounce(a, dest, v) { clickRecipe(a, dest, v, 400, 0.03, 0.2); },
  footstep(a, dest, v) {
    const ctx = a.ctx, t = v.start;
    const n = a._noiseSrc('pink');
    const lp = a._bq('lowpass', 450);
    const g = ctx.createGain(); n.connect(lp); lp.connect(g); g.connect(dest);
    a._env(g, t, 0.25 * v.gain, 0.045);
    n.start(t); n.stop(t + 0.06); v.end = t + 0.06;
  },
  footstepWood(a, dest, v) { RECIPES.footstep(a, dest, v); },
  enemyStepLight(a, dest, v) { clickRecipe(a, dest, v, 250, 0.06, 0.18); },
  enemyStepHeavy(a, dest, v) { clickRecipe(a, dest, v, 200, 0.06, 0.2); },
  whoop(a, dest, v) { vocalRecipe(a, dest, v, 240, 1.0); },
  holler(a, dest, v) { vocalRecipe(a, dest, v, 290, 1.2); },
  growl(a, dest, v) { vocalRecipe(a, dest, v, 120, 0.8); },
  hurtGrunt(a, dest, v) { vocalRecipe(a, dest, v, 160, 0.6, 0.2); },
  deathMoan(a, dest, v) { vocalRecipe(a, dest, v, 150, 0.8, 0.8, true); },
  bodyThud(a, dest, v) {
    const ctx = a.ctx, t = v.start;
    const o = a._osc('sine', 70);
    const g = ctx.createGain(); o.connect(g); g.connect(dest);
    a._env(g, t, 0.5 * v.gain, 0.15);
    o.start(t); o.stop(t + 0.16); v.end = t + 0.16;
  },
  hitFlesh(a, dest, v) {
    const ctx = a.ctx, t = v.start;
    const n = a._noiseSrc('brown');
    const lp = a._bq('lowpass', 350);
    const g = ctx.createGain(); n.connect(lp); lp.connect(g); g.connect(dest);
    a._env(g, t, 0.6 * v.gain, 0.07);
    n.start(t); n.stop(t + 0.08); v.end = t + 0.08;
  },
  headshot(a, dest, v) {
    RECIPES.hitFlesh(a, dest, v);
    const ctx = a.ctx, t = v.start;
    const n = a._noiseSrc('white');
    const hp = a._bq('highpass', 2500);
    const g = ctx.createGain(); n.connect(hp); hp.connect(g); g.connect(dest);
    a._env(g, t, 0.4 * v.gain, 0.02);
    n.start(t); n.stop(t + 0.03);
  },
  hitMarker(a, dest, v) { markerRecipe(a, dest, v, 1800); },
  killMarker(a, dest, v) { markerRecipe(a, dest, v, 2200); },
  impactWood(a, dest, v) { impactRecipe(a, dest, v, 'wood'); },
  impactAdobe(a, dest, v) { impactRecipe(a, dest, v, 'adobe'); },
  impactSand(a, dest, v) { impactRecipe(a, dest, v, 'sand'); },
  impactMetal(a, dest, v) { impactRecipe(a, dest, v, 'metal'); },
  impactGlass(a, dest, v) { impactRecipe(a, dest, v, 'glass'); },
  ricochet(a, dest, v) { impactRecipe(a, dest, v, 'metal'); },
  playerHurt(a, dest, v) {
    const ctx = a.ctx, t = v.start;
    const n = a._noiseSrc('brown');
    const lp = a._bq('lowpass', 500);
    const g = ctx.createGain(); n.connect(lp); lp.connect(g); g.connect(dest);
    a._env(g, t, 0.7 * v.gain, 0.12);
    const sub = a._osc('sine', 55);
    const sg = ctx.createGain(); sub.connect(sg); sg.connect(dest);
    a._env(sg, t, 0.5 * v.gain, 0.25);
    n.start(t); n.stop(t + 0.14); sub.start(t); sub.stop(t + 0.26); v.end = t + 0.26;
  },
  keyPickup(a, dest, v) { clickRecipe(a, dest, v, 2400, 0.03, 0.3); },
  cellUnlock(a, dest, v) {
    const ctx = a.ctx, t = v.start;
    const o1 = a._osc('sine', 880), o2 = a._osc('sine', 1320);
    const g = ctx.createGain(); o1.connect(g); o2.connect(g); g.connect(dest);
    a._env(g, t, 0.3 * v.gain, 0.3);
    o1.start(t); o2.start(t); o1.stop(t + 0.32); o2.stop(t + 0.32); v.end = t + 0.32;
  },
  prisonerFree(a, dest, v) {
    const ctx = a.ctx, t = v.start;
    [261, 329, 392].forEach((f, i) => {
      const o = a._osc('sine', f);
      const g = ctx.createGain(); o.connect(g); g.connect(dest);
      a._env(g, t + i * 0.12, 0.3 * v.gain, 0.3);
      o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.32);
    });
    v.end = t + 0.7;
  },
  sectorSting(a, dest, v) { stingRecipe(a, dest, v, 55, 0.8); },
  sectorClear(a, dest, v) {
    const ctx = a.ctx, t = v.start;
    [440, 554, 659].forEach((f, i) => {
      const o = a._osc('sine', f);
      const g = ctx.createGain(); o.connect(g); g.connect(dest);
      a._env(g, t + i * 0.1, 0.25 * v.gain, 0.25);
      o.start(t + i * 0.1); o.stop(t + i * 0.1 + 0.27);
    });
    v.end = t + 0.6;
  },
  showdownSting(a, dest, v) { stingRecipe(a, dest, v, 82, 1.2); },
  gameOver(a, dest, v) {
    const ctx = a.ctx, t = v.start;
    const o = a._osc('sawtooth', 110); o.frequency.exponentialRampToValueAtTime(55, t + 2.5);
    const lp = a._bq('lowpass', 800);
    const g = ctx.createGain(); o.connect(lp); lp.connect(g); g.connect(dest);
    a._env(g, t, 0.4 * v.gain, 2.5);
    o.start(t); o.stop(t + 2.5); v.end = t + 2.5;
  },
  gameWin(a, dest, v) {
    const ctx = a.ctx, t = v.start;
    [261, 329, 392, 523].forEach((f, i) => {
      const o = a._osc('sawtooth', f);
      const lp = a._bq('lowpass', 2000);
      const g = ctx.createGain(); o.connect(lp); lp.connect(g); g.connect(dest);
      a._env(g, t + i * 0.15, 0.25 * v.gain, 0.4);
      o.start(t + i * 0.15); o.stop(t + i * 0.15 + 0.42);
    });
    v.end = t + 1.1;
  },
};

function clickRecipe(a, dest, v, freq, dur, gain) {
  const ctx = a.ctx, t = v.start;
  const n = a._noiseSrc('white');
  const bp = a._bq('bandpass', freq, 4);
  const g = ctx.createGain(); n.connect(bp); bp.connect(g); g.connect(dest);
  a._env(g, t, gain * v.gain, dur);
  n.start(t); n.stop(t + dur + 0.02); v.end = t + dur + 0.02;
}

function markerRecipe(a, dest, v, freq) {
  const ctx = a.ctx, t = v.start;
  const o = a._osc('sine', freq);
  const g = ctx.createGain(); o.connect(g); g.connect(a._ui);
  a._env(g, t, 0.2 * v.gain, 0.02);
  o.start(t); o.stop(t + 0.03); v.end = t + 0.03;
}

function vocalRecipe(a, dest, v, f0, pitch, dur = 0.5, glide = false) {
  const ctx = a.ctx, t = v.start;
  const o = a._osc('sawtooth', f0 * pitch);
  if (glide) o.frequency.exponentialRampToValueAtTime(f0 * pitch * 0.7, t + dur);
  const lp = a._bq('lowpass', 1200 * pitch);
  const vib = a._osc('sine', 6);
  const vg = ctx.createGain(); vg.gain.value = 8;
  vib.connect(vg); vg.connect(o.frequency);
  const g = ctx.createGain(); o.connect(lp); lp.connect(g); g.connect(dest);
  a._env(g, t, 0.3 * v.gain, dur);
  o.start(t); vib.start(t); o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
  v.end = t + dur + 0.05;
}

function impactRecipe(a, dest, v, surface) {
  const ctx = a.ctx, t = v.start;
  const n = a._noiseSrc('white');
  const bp = a._bq('bandpass', 2800, 1.2);
  bp.frequency.exponentialRampToValueAtTime(1100, t + 0.06);
  const g = ctx.createGain(); n.connect(bp); bp.connect(g); g.connect(dest);
  a._env(g, t, 0.4 * v.gain, 0.06);
  n.start(t); n.stop(t + 0.08);
  if (surface === 'metal') {
    [1700, 2300, 3100].forEach((f) => {
      const o = a._osc('sine', f);
      const og = ctx.createGain(); o.connect(og); og.connect(dest);
      a._env(og, t, 0.12 * v.gain, 0.08);
      o.start(t); o.stop(t + 0.1);
    });
  } else if (surface === 'glass') {
    const hp = a._bq('highpass', 4000);
    const gn = a._noiseSrc('white');
    const gg = ctx.createGain(); gn.connect(hp); hp.connect(gg); gg.connect(dest);
    a._env(gg, t, 0.3 * v.gain, 0.1);
    gn.start(t); gn.stop(t + 0.12);
  }
  v.end = t + 0.12;
}

function stingRecipe(a, dest, v, f0, dur) {
  const ctx = a.ctx, t = v.start;
  const o = a._osc('sawtooth', f0);
  const o2 = a._osc('sawtooth', f0 * 1.5);
  const lp = a._bq('lowpass', 500);
  lp.frequency.exponentialRampToValueAtTime(2000, t + dur);
  const g = ctx.createGain(); o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(dest);
  a._env(g, t, 0.3 * v.gain, dur);
  o.start(t); o2.start(t); o.stop(t + dur); o2.stop(t + dur); v.end = t + dur;
}
