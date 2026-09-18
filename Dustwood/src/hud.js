// DOM HUD + overlay screens. See Plan.txt §8. Reads weapons/player/mission/
// prisoner, subscribes to the bus, drives post grade via setHurt/etc.
import { PLAYER } from './constants.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(G) {
    this.G = G;
    this.hidden = false;
    this._els = {};
    this._last = {};
    this._bannerTimer = 0;
    this._promptText = null;
    this._promptPulse = false;
    this._hurtFlash = 0;
    this._arcs = [];
    this._toastTimer = 0;
    this._killsShown = 0;
    this._healthGhost = 100;
    this._off = [];
  }

  init() {
    const e = this._els;
    e.crosshair = $('crosshair');
    e.chBars = document.querySelectorAll('.ch-bar');
    e.hitmarker = $('hitmarker');
    e.sprint = $('sprint-glyph');
    e.prompt = $('prompt');
    e.banner = $('banner'); e.bannerText = $('banner-text'); e.bannerSub = $('banner-sub');
    e.sectorLabel = $('sector-label'); e.sectorSub = $('sector-sub');
    e.killsNum = $('kills-num');
    e.healthFill = $('health-fill'); e.healthGhost = $('health-ghost'); e.healthNum = $('health-num');
    e.ammoName = $('ammo-name'); e.ammoMag = $('ammo-mag'); e.ammoReserve = $('ammo-reserve');
    e.reloadBar = $('reload-bar'); e.reloadFill = $('reload-fill'); e.reloadLabel = $('reload-label');
    e.ammoPips = $('ammo-pips'); e.ammoLine = $('ammo-line');
    e.prisonerLabel = $('prisoner-label');
    e.damageArcs = $('damage-arcs');
    e.vignette = $('vignette');
    e.toast = $('toast');
    e.fps = $('fps');
    e.start = $('start'); e.pause = $('pause'); e.gameover = $('gameover'); e.win = $('win');
    e.goTitle = $('go-title'); e.goReason = $('go-reason'); e.goStats = $('go-stats');
    e.winSub = $('win-sub'); e.winStats = $('win-stats');

    const bus = this.G.bus;
    const on = (n, f) => this._off.push(bus.on(n, f));
    on('enemy-hit', (p) => this._onEnemyHit(p));
    on('player-hit', (p) => this._onPlayerHit(p));
    on('player-death', () => {});
    on('game-over', (p) => this._onGameOver(p));
    on('game-win', (p) => this._onWin(p));
    on('sector-enter', (p) => this._onSector(p));
    on('sector-clear', (p) => this._onSectorClear(p));
    on('showdown-start', () => this.banner('SALOON SHOWDOWN', '', 2.5));
    on('debug-message', (p) => this.toast(p.text));
    on('key-pickup', () => this._updatePrisoner());
    on('cell-unlocked', () => this._updatePrisoner());
    on('prisoner-freed', () => this._updatePrisoner());

    // click-to-enter / resume / restart on the overlay screens
    this.G.overlayRoot.addEventListener('click', () => {
      if (this.G.gameOver) this.G.hooks.restart();
      else if (this.G.started && this.G.paused) this.G.paused = false;
      else if (!this.G.started) this.G.hooks.start();
    });
  }

  _onEnemyHit(p) {
    if (p.killed) this.hitMarker('kill');
    else if (p.headshot) this.hitMarker('head');
    else this.hitMarker('hit');
  }

  _onPlayerHit(p) {
    this._hurtFlash = 0.55;
    if (p.from) this.damageFrom(p.from);
  }

  _onGameOver(p) {
    const stats = this.G.stats;
    if (this._els.goReason) this._els.goReason.textContent = p.reason === 'prisoner' ? 'THE PRISONER DIED' : 'THE TOWN TOOK YOU';
    this._fillStats(this._els.goStats, stats);
    this.showGameOver(stats, p.reason);
  }

  _onWin(p) {
    this._fillStats(this._els.winStats, this.G.stats);
    if (this._els.winSub) this._els.winSub.textContent = `in ${Math.round(p.time || this.G.time)}s`;
    this.showWin(this.G.stats);
  }

  _fillStats(table, s) {
    if (!table) return;
    const rows = [
      ['Sector reached', this.G.mission ? this.G.mission.sector : 1],
      ['Kills', s.kills],
      ['— Window', s.killsByType.window],
      ['— Roof', s.killsByType.roof],
      ['— Barricade', s.killsByType.barricade],
      ['Headshots', s.headshots],
      ['Accuracy', Math.round(s.accuracy * 100) + '%'],
      ['Damage dealt', Math.round(s.damageDealt)],
      ['Damage taken', Math.round(s.damageTaken)],
      ['Shots fired', s.shotsFired],
      ['Time survived', Math.round(s.timeSurvived) + 's'],
      ['Score', this.G.mission ? this.G.mission.score : 0],
    ];
    table.innerHTML = rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('');
  }

  _onSector(p) {
    this.banner(`SECTOR ${p.sector}`, p.name, 2.0);
  }
  _onSectorClear(p) {
    this.banner(`SECTOR ${p.sector} CLEARED`, '', 1.6);
  }

  update(dt) {
    const G = this.G;
    if (this.hidden) return;
    const e = this._els;
    const w = G.weapons, p = G.player, m = G.mission, pr = G.prisoner;

    // Crosshair gap from spread
    if (w.getSpreadDeg) {
      const spread = w.getSpreadDeg();
      const vh = window.innerHeight;
      const fovRad = (G.camera.fov * Math.PI) / 180;
      const gap = 6 + Math.tan((spread * Math.PI) / 180) * (vh / 2) / Math.tan(fovRad / 2);
      e.crosshair.style.setProperty('--gap', gap.toFixed(1) + 'px');
    }
    const sprinting = p.sprinting;
    e.crosshair.classList.toggle('hidden', sprinting);
    e.sprint.classList.toggle('hidden', !sprinting);

    // Health
    const hp = Math.max(0, Math.round(p.health));
    if (this._last.hp !== hp) {
      e.healthNum.textContent = hp;
      e.healthFill.style.width = (hp / PLAYER.maxHealth * 100) + '%';
      const col = hp <= 30 ? '#c0392b' : hp <= 50 ? '#e8b24a' : '#e8e0d0';
      e.healthFill.style.background = col;
      this._last.hp = hp;
    }
    // ghost lags behind
    this._healthGhost += (hp - this._healthGhost) * Math.min(1, dt / 0.6 * 3);
    if (this._healthGhost < hp) this._healthGhost = hp;
    e.healthGhost.style.width = (this._healthGhost / PLAYER.maxHealth * 100) + '%';

    // Ammo
    if (w.getAmmo) {
      const a = w.getAmmo();
      const name = w.getName ? w.getName() : '';
      const state = w.getState ? w.getState() : 'ready';
      if (this._last.name !== name) { e.ammoName.textContent = name; this._last.name = name; }
      const reloading = state === 'reloading';
      if (reloading) {
        e.ammoLine.classList.add('hidden');
        e.reloadBar.classList.remove('hidden');
        const prog = w.reloadProgress ? w.reloadProgress() : 0;
        e.reloadFill.style.width = (prog * 100) + '%';
      } else {
        e.ammoLine.classList.remove('hidden');
        e.reloadBar.classList.add('hidden');
        if (this._last.mag !== a.mag) { e.ammoMag.textContent = a.mag; this._last.mag = a.mag; }
        if (this._last.reserve !== a.reserve) { e.ammoReserve.textContent = a.reserve; this._last.reserve = a.reserve; }
        const magSize = w.current ? w.current.magSize : 6;
        e.ammoMag.classList.toggle('low', a.mag > 0 && a.mag <= magSize * 0.3);
        e.ammoMag.classList.toggle('empty', a.mag === 0);
        // pips
        const pipKey = a.mag + '/' + magSize;
        if (this._last.pips !== pipKey) {
          let html = '';
          for (let i = 0; i < Math.min(magSize, 8); i++) html += `<span class="pip${i < a.mag ? '' : ' off'}"></span>`;
          e.ammoPips.innerHTML = html;
          this._last.pips = pipKey;
        }
      }
      const showReloadLabel = a.mag === 0 && !reloading;
      e.reloadLabel.classList.toggle('hidden', !showReloadLabel);
      e.reloadLabel.classList.toggle('pulse', showReloadLabel);
    }

    // Kills
    if (this._last.kills !== G.stats.kills) {
      e.killsNum.textContent = G.stats.kills;
      e.killsNum.classList.remove('pop'); void e.killsNum.offsetWidth; e.killsNum.classList.add('pop');
      this._last.kills = G.stats.kills;
    }

    // Sector
    if (m) {
      const label = `SECTOR ${m.sector}` + (m.sector === 3 ? ' — SALOON SHOWDOWN' : m.sector === 4 ? ' — FINAL PUSH' : '');
      if (this._last.sectorLabel !== label) { e.sectorLabel.textContent = label; this._last.sectorLabel = label; }
      let sub = '';
      if (m.state === 'active' || m.state === 'showdown' || m.state === 'finalPush') sub = `${G.enemies.aliveCount + (m.queue ? m.queue.length : 0)} LEFT`;
      else if (m.state === 'sectorClear') sub = 'SECTOR CLEARED';
      if (this._last.sectorSub !== sub) { e.sectorSub.textContent = sub; e.sectorSub.classList.toggle('pulse', m.state === 'sectorClear'); this._last.sectorSub = sub; }
    }

    // Prisoner
    this._updatePrisoner();

    // Prompt
    let prompt = this._promptText;
    let pulse = this._promptPulse;
    if (m && m.currentPrompt != null) { prompt = m.currentPrompt; }
    if (prompt) { e.prompt.textContent = prompt; e.prompt.classList.add('show'); }
    else e.prompt.classList.remove('show');
    e.prompt.classList.toggle('pulse', pulse);

    // Banner timer
    if (this._bannerTimer > 0) {
      this._bannerTimer -= dt;
      if (this._bannerTimer <= 0) { e.banner.classList.remove('show'); e.banner.classList.add('hide'); }
    }

    // Toast timer
    if (this._toastTimer > 0) this._toastTimer -= dt;

    // Vignette + grade
    const lowHealth = G.lowHealth;
    let alpha = 0.15 + 0.30 * lowHealth;
    if (lowHealth > 0) alpha += 0.12 * (0.5 + 0.5 * Math.sin(G.time * 6));
    if (this._hurtFlash > 0) { alpha += this._hurtFlash; this._hurtFlash = Math.max(0, this._hurtFlash - dt * 1.1); }
    e.vignette.style.opacity = Math.min(0.85, alpha).toFixed(3);
    if (G.post.setHurt) G.post.setHurt(this._hurtFlash);
    if (G.post.setLowHealth) G.post.setLowHealth(lowHealth);
    if (G.post.setDead) G.post.setDead(p.dead ? 1 : 0);

    // Damage arcs
    for (let i = this._arcs.length - 1; i >= 0; i--) {
      const arc = this._arcs[i];
      arc.life -= dt;
      if (arc.life <= 0) { arc.el.remove(); this._arcs.splice(i, 1); continue; }
      const fade = arc.life < 0.4 ? arc.life / 0.4 : 1;
      arc.el.style.opacity = fade;
    }

    // FPS
    if (!e.fps.classList.contains('hidden')) e.fps.textContent = Math.round(G._perf.fps);
  }

  _updatePrisoner() {
    const pr = this.G.prisoner;
    if (!pr || !this._els.prisonerLabel) return;
    let label = 'PRISONER: LOCKED';
    if (pr.state === 'free') label = 'PRISONER FREED';
    else if (pr.state === 'dead') label = 'PRISONER DEAD';
    else if (pr.cellUnlocked) label = 'CELL UNLOCKED';
    else if (pr.keyHeld) label = 'KEY HELD';
    if (this._last.prisoner !== label) { this._els.prisonerLabel.textContent = label; this._last.prisoner = label; }
  }

  // ---- Public API ----
  showStart() { this._els.start.classList.remove('hidden'); }
  hideStart() { this._els.start.classList.add('hidden'); }
  showPause() { this._els.pause.classList.remove('hidden'); }
  hidePause() { this._els.pause.classList.add('hidden'); }
  showGameOver(stats, reason) { this.G.overlayRoot.classList.remove('hidden'); this._els.gameover.classList.remove('hidden'); this._els.win.classList.add('hidden'); }
  showWin(stats) { this.G.overlayRoot.classList.remove('hidden'); this._els.win.classList.remove('hidden'); this._els.gameover.classList.add('hidden'); }

  banner(text, sub = '', seconds = 2.0) {
    const e = this._els;
    e.bannerText.textContent = text;
    e.bannerSub.textContent = sub;
    e.banner.classList.remove('hide');
    e.banner.classList.remove('show'); void e.banner.offsetWidth; e.banner.classList.add('show');
    this._bannerTimer = seconds;
  }
  prompt(text) { this._promptText = text; }
  setHint(text) { this._promptText = text; }
  toast(text, seconds = 2) {
    const e = this._els.toast;
    e.textContent = text;
    e.classList.remove('show'); void e.offsetWidth; e.classList.add('show');
    this._toastTimer = seconds;
  }
  hitMarker(kind) {
    const e = this._els.hitmarker;
    e.classList.remove('hit', 'head', 'kill'); void e.offsetWidth;
    e.classList.add(kind);
  }
  damageFrom(worldPos) {
    const p = this.G.player;
    const dx = worldPos.x - p.pos.x, dz = worldPos.z - p.pos.z;
    const bearing = Math.atan2(dx, dz) - p.yaw;
    const el = document.createElement('div');
    el.className = 'arc';
    el.style.transform = `rotate(${-bearing}rad)`;
    this._els.damageArcs.appendChild(el);
    this._arcs.push({ el, life: 1.2 });
    if (this._arcs.length > 6) { const old = this._arcs.shift(); old.el.remove(); }
  }
  onShot() {
    // crosshair contract 15% for 100ms
    const e = this._els.crosshair;
    e.style.transform = 'scale(0.85)';
    this._contractT = 0.1;
  }
  setFps(fps) { if (this._els.fps) this._els.fps.textContent = Math.round(fps); }
  setFpsVisible(b) { if (this._els.fps) this._els.fps.classList.toggle('hidden', !b); }
  setHidden(b) { this.hidden = !!b; if (this._els.crosshair) this.G.hudRoot.style.display = b ? 'none' : ''; }

  reset() {
    this._last = {};
    this._bannerTimer = 0;
    this._hurtFlash = 0;
    this._healthGhost = 100;
    this._killsShown = 0;
    for (const a of this._arcs) a.el.remove();
    this._arcs.length = 0;
    if (this._els.gameover) this._els.gameover.classList.add('hidden');
    if (this._els.win) this._els.win.classList.add('hidden');
    if (this._els.start) this._els.start.classList.add('hidden');
  }

  dispose() { for (const off of this._off) off(); this._off.length = 0; }
}
