// Mission director: sector progression, Saloon Showdown, final push, win/lose.
// See Plan.txt §2.23, §4.6, §6.
import { SECTORS, MISSION, ENEMY_POP } from './constants.js';

// Sector composition (spec §6): sector 1 = 2 window + 1 barricade,
// sector 2 = 2 window + 1 roof, sector 3 = saloon 4 window + 1 balcony roof,
// sector 4 = sheriff 2 barricade + 2 window.
const SECTOR_PLAN = [
  [
    { type: 'window', building: 'house0' }, { type: 'window', building: 'house1' },
    { type: 'barricade', building: 'barricade0' },
  ],
  [
    { type: 'window', building: 'house2' }, { type: 'window', building: 'house3' },
    { type: 'roof', building: 'house1' },
  ],
  [
    { type: 'window', building: 'saloon' }, { type: 'window', building: 'saloon' },
    { type: 'window', building: 'saloon' }, { type: 'window', building: 'saloon' },
    { type: 'roof', building: 'saloon' },
  ],
  [
    { type: 'barricade', building: 'sheriff' }, { type: 'barricade', building: 'sheriff' },
    { type: 'window', building: 'sheriff' }, { type: 'window', building: 'sheriff' },
  ],
];

export class Mission {
  constructor(G) {
    this.G = G;
    this.sector = 1;
    this.state = 'idle';
    this.timer = 0;
    this.queue = [];
    this.spawnedThisSector = 0;
    this.totalThisSector = 0;
    this.killsThisSector = 0;
    this.score = 0;
    this.maxAlive = 6;
    this.spawnTimer = 0;
    this._off = [];
    this._usedAnchors = new Set();
  }

  init() {
    const bus = this.G.bus;
    const on = (n, f) => this._off.push(bus.on(n, f));
    on('enemy-killed', (p) => this._onKill(p));
    on('player-death', () => this._lose('killed'));
    on('prisoner-death', () => this._lose('prisoner'));
    on('prisoner-freed', () => this._win());
  }

  begin() {
    this.sector = 1;
    this.state = 'intro';
    this.timer = 0;
    this.queue = [];
    this.spawnedThisSector = 0;
    this.totalThisSector = 0;
    this.killsThisSector = 0;
    this.score = 0;
    this.spawnTimer = 0;
    this._usedAnchors.clear();
    this.G.bus.emit('sector-enter', { sector: 1, name: SECTORS[0].name });
  }

  reset() {
    this.begin();
    this.state = 'idle';
  }

  skipToSector(n) {
    this.G.enemies.killAll({ silent: true });
    this.queue.length = 0;
    this.sector = Math.max(1, Math.min(SECTORS.length, n | 0));
    this.state = n <= 1 ? 'intro' : 'active';
    this.timer = 0;
    this.spawnedThisSector = 0;
    this.totalThisSector = 0;
    this.killsThisSector = 0;
    this.spawnTimer = 0;
    if (n >= 2) this._buildQueue(this.sector);
    this.G.bus.emit('sector-enter', { sector: this.sector, name: SECTORS[this.sector - 1].name });
    return this.G.__game ? this.G.__game.getState() : null;
  }

  _buildQueue(n) {
    const plan = SECTOR_PLAN[n - 1] || [];
    // constrained shuffle with gameplay rng
    const rng = this.G.rng;
    const q = plan.slice();
    for (let i = q.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      const t = q[i]; q[i] = q[j]; q[j] = t;
    }
    this.queue = q;
    this.totalThisSector = q.length;
    this.spawnedThisSector = 0;
    this.killsThisSector = 0;
  }

  _onKill(p) {
    const def = this.G.enemies.defs ? null : null;
    const pts = ({ window: 1, roof: 2, barricade: 3 })[p.type] || 1;
    this.score += pts * (p.headshot ? 2 : 1);
    this.killsThisSector++;
  }

  _lose(reason) {
    if (this.G.gameOver) return;
    this.G.gameOver = true;
    this.G._gameOverReason = reason;
    this.G.stats.timeSurvived = this.G.time;
    this.G.bus.emit('game-over', { reason });
  }

  _win() {
    if (this.G.gameOver) return;
    this.G.gameOver = true;
    this.G._win = true;
    this.G.stats.timeSurvived = this.G.time;
    this.G.bus.emit('game-win', { time: this.G.time, kills: this.G.stats.kills });
  }

  update(dt) {
    const G = this.G;
    if (!G.started || G.gameOver) return;
    this.timer += dt;

    switch (this.state) {
      case 'intro': {
        if (this.timer >= MISSION.introTime) {
          this.state = 'active';
          this.timer = 0;
          this._buildQueue(this.sector);
          if (this.sector === 3) G.bus.emit('showdown-start', {});
          if (this.sector === 4) G.bus.emit('final-push', {});
        }
        break;
      }
      case 'active': {
        this._spawnStep(dt);
        if (this.queue.length === 0 && this.spawnedThisSector > 0 && G.enemies.aliveCount === 0) {
          this.state = 'sectorClear';
          this.timer = 0;
          G.stats.sectorsCleared++;
          G.bus.emit('sector-clear', { sector: this.sector, kills: this.killsThisSector });
        }
        break;
      }
      case 'sectorClear': {
        if (this.timer >= MISSION.sectorClearTime) {
          if (this.sector >= SECTORS.length) {
            // all sectors cleared: final push done, prisoner phase open
            this.state = 'finalPush';
            G.hud.banner('THE JAIL', 'FIND THE KEY', 2.5);
          } else {
            this.sector++;
            this.state = 'intro';
            this.timer = 0;
            G.bus.emit('sector-enter', { sector: this.sector, name: SECTORS[this.sector - 1].name });
          }
        }
        break;
      }
      case 'finalPush': {
        // after all sectors cleared, prisoner phase; nothing to spawn
        break;
      }
      default: break;
    }
  }

  _spawnStep(dt) {
    const G = this.G;
    if (this.queue.length === 0) return;
    if (G.enemies.aliveCount >= this.maxAlive) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = 3.5;
    const item = this.queue.shift();
    const anchor = this._pickAnchor(item);
    const e = G.enemies.spawn(item.type, anchor);
    if (e) {
      this.spawnedThisSector++;
    } else {
      // pool full: put it back
      this.queue.unshift(item);
      this.spawnTimer = 1;
    }
  }

  _pickAnchor(item) {
    const anchors = this.G.town.anchors;
    if (!anchors || anchors.length === 0) return null;
    // prefer anchors of the right kind on the right building, unused
    const kind = item.type;
    let candidates = anchors.filter((a) => a.kind === kind && a.building === item.building && !this._usedAnchors.has(a.id));
    if (candidates.length === 0) candidates = anchors.filter((a) => a.kind === kind && !this._usedAnchors.has(a.id));
    if (candidates.length === 0) candidates = anchors.filter((a) => a.kind === kind);
    if (candidates.length === 0) return null;
    const a = candidates[this.G.rng.int(candidates.length)];
    this._usedAnchors.add(a.id);
    return a;
  }

  // F interact: delegate to prisoner
  tryInteract() {
    if (this.G.prisoner && this.G.prisoner.interact) this.G.prisoner.interact();
  }

  dispose() { for (const off of this._off) off(); this._off.length = 0; }
}
