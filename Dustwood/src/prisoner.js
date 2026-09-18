// Prisoner: key pickup, cell lock, free/dead states, win/lose trigger.
// See Plan.txt §2.24, §4.6.4.
import * as THREE from 'three';
import { PRISONER } from './constants.js';
import { MASK } from './collision.js';

const _v = new THREE.Vector3();

export class Prisoner {
  constructor(G) {
    this.G = G;
    this.state = 'locked'; // locked | free | dead
    this.keyHeld = false;
    this.cellUnlocked = false;
    this.keyPos = new THREE.Vector3(...PRISONER.keyPos);
    this.cellPos = new THREE.Vector3(...PRISONER.cellPos);
    this._prompt = null;
    this._off = [];
    this._group = new THREE.Group();
    this._keyMesh = null;
    this._prisonerMesh = null;
  }

  init() {
    const G = this.G;
    G.scene.add(this._group);
    // simple key marker (brass) on the sheriff desk
    const keyGeo = new THREE.TorusGeometry(0.06, 0.02, 6, 12);
    const keyMat = new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 0.9, roughness: 0.3 });
    this._keyMesh = new THREE.Mesh(keyGeo, keyMat);
    this._keyMesh.position.copy(this.keyPos);
    this._keyMesh.rotation.x = Math.PI / 2;
    this._group.add(this._keyMesh);

    // prisoner figure (simple capsule stand-in) in cell 1
    const bodyGeo = new THREE.CapsuleGeometry(0.3, 0.9, 4, 8);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.9 });
    this._prisonerMesh = new THREE.Mesh(bodyGeo, bodyMat);
    this._prisonerMesh.position.set(this.cellPos.x, 0.75, this.cellPos.z + 1.5);
    this._group.add(this._prisonerMesh);

    const on = (n, f) => this._off.push(G.bus.on(n, f));
    // enemy fire can kill the prisoner: a shot that hits near the cell
    on('shot-hit-world', (e) => this._maybeHitPrisoner(e));
  }

  _maybeHitPrisoner(e) {
    if (this.state !== 'locked') return;
    if (!e.pos) return;
    const dx = e.pos[0] - this._prisonerMesh.position.x;
    const dz = e.pos[2] - this._prisonerMesh.position.z;
    if (dx * dx + dz * dz < 0.5) {
      this.state = 'dead';
      this.G.bus.emit('prisoner-death', {});
    }
  }

  // F interact: pick up key / unlock cell / free prisoner.
  interact() {
    const G = this.G;
    const p = G.player;
    if (!p || !p.alive) return false;
    const px = p.pos.x, pz = p.pos.z;

    // 1. key pickup (near the desk / key)
    if (!this.keyHeld) {
      const kd = Math.hypot(px - this.keyPos.x, pz - this.keyPos.z);
      if (kd <= PRISONER.interactDist + 1.5) {
        this.keyHeld = true;
        if (this._keyMesh) this._keyMesh.visible = false;
        G.bus.emit('key-pickup', { pos: this.keyPos });
        return true;
      }
    }

    // 2. unlock cell (needs key)
    if (this.keyHeld && !this.cellUnlocked) {
      const cd = Math.hypot(px - this.cellPos.x, pz - this.cellPos.z);
      if (cd <= PRISONER.interactDist + 2.0) {
        this.cellUnlocked = true;
        G.bus.emit('cell-unlocked', {});
        return true;
      }
    }

    // 3. free prisoner (needs cell unlocked)
    if (this.cellUnlocked && this.state === 'locked') {
      const pd = Math.hypot(px - this._prisonerMesh.position.x, pz - this._prisonerMesh.position.z);
      if (pd <= PRISONER.interactDist + 2.5) {
        this.state = 'free';
        G.bus.emit('prisoner-freed', {});
        return true;
      }
    }
    return false;
  }

  // Shooting the cell lock also unlocks (called from weapons on cell-door hit).
  shootLock() {
    if (this.cellUnlocked || this.state !== 'locked') return false;
    this.cellUnlocked = true;
    this.G.bus.emit('cell-unlocked', {});
    return true;
  }

  // debug helpers
  unlockCell() { if (!this.cellUnlocked) { this.cellUnlocked = true; this.G.bus.emit('cell-unlocked', {}); } }
  freePrisoner() {
    if (this.state === 'locked') {
      this.cellUnlocked = true;
      this.keyHeld = true;
      this.state = 'free';
      this.G.bus.emit('prisoner-freed', {});
    }
  }

  // HUD prompt: what F would do right now.
  currentPrompt() {
    const G = this.G;
    const p = G.player;
    if (!p || !p.alive) return null;
    const px = p.pos.x, pz = p.pos.z;
    if (!this.keyHeld && Math.hypot(px - this.keyPos.x, pz - this.keyPos.z) <= PRISONER.interactDist + 1.5) return 'F — TAKE KEY';
    if (this.keyHeld && !this.cellUnlocked && Math.hypot(px - this.cellPos.x, pz - this.cellPos.z) <= PRISONER.interactDist + 2.0) return 'F — UNLOCK CELL';
    if (this.cellUnlocked && this.state === 'locked' && Math.hypot(px - this._prisonerMesh.position.x, pz - this._prisonerMesh.position.z) <= PRISONER.interactDist + 2.5) return 'F — FREE PRISONER';
    return null;
  }

  update(dt) {
    if (this._keyMesh && this._keyMesh.visible) {
      this._keyMesh.rotation.z = this.G.time * 2;
    }
    const prompt = this.currentPrompt();
    if (prompt !== this._prompt) {
      this._prompt = prompt;
      if (this.G.hud && this.G.hud.prompt) this.G.hud.prompt(prompt);
    }
  }

  reset() {
    this.state = 'locked';
    this.keyHeld = false;
    this.cellUnlocked = false;
    this._prompt = null;
    if (this._keyMesh) this._keyMesh.visible = true;
  }

  dispose() {
    for (const off of this._off) off();
    this._off.length = 0;
    if (this._keyMesh) this._keyMesh.geometry.dispose();
    if (this._prisonerMesh) this._prisonerMesh.geometry.dispose();
  }
}
