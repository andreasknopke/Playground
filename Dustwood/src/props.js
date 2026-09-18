// Props: barricade-adjacent clutter, tumbleweeds (rolling), sign sway, wanted
// posters, hay bales, horse stalls, piano, bottles, wooden crosses. Registers
// colliders for bumpable items. See Plan.txt §2.13, §3.5.
import * as THREE from 'three';
import { MAT } from './materials.js';
import { MASK } from './collision.js';
import { ensureColorAttr } from './utils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

export class Props {
  constructor(G) {
    this.G = G;
    this.group = new THREE.Group();
    this.tumbleweeds = [];
    this.swaySigns = [];
    this._rng = null;
  }

  init() {
    const G = this.G;
    G.scene.add(this.group);
    this._rng = G.rngBuild;
    const rng = this._rng;

    // Hay bales near livery (x=8, z=11)
    for (let i = 0; i < 6; i++) {
      const x = 2 + rng() * 12, z = 8 + rng() * 3;
      _p.set(x, 0.5, z); _q.setFromEuler(_e.set(Math.PI / 2, rng(), 0)); _s.set(1, 1, 1); _m.compose(_p, _q, _s);
      const bale = new THREE.CylinderGeometry(0.6, 0.6, 1.0, 10);
      ensureColorAttr(bale, 0xffffff); bale.applyMatrix4(_m);
      const mesh = new THREE.Mesh(bale, MAT.hay);
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      this.group.add(mesh);
      G.colliders.addStaticCyl(x, z, 0.6, 0, 1.0, 'haybale', 'wood', MASK.SOLID);
    }

    // Wooden crosses (graveyard near church x=22..30, z=11..14)
    for (let i = 0; i < 6; i++) {
      const x = 22 + (i % 3) * 3, z = 11 + Math.floor(i / 3) * 2;
      const cross = new THREE.Group();
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.2, 0.12), MAT.crossWood);
      v.position.y = 0.6;
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.15, 0.12), MAT.crossWood);
      h.position.y = 0.85;
      cross.add(v, h);
      cross.position.set(x, 0, z);
      cross.rotation.y = rng() * 0.3 - 0.15;
      this.group.add(cross);
    }

    // Tumbleweeds (rolling, scripted)
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0), MAT.tumbleweed);
      mesh.material = MAT.tumbleweed;
      const start = -60 + rng() * 100;
      mesh.position.set(start, 0.4, (rng() * 12 - 6));
      mesh.userData = { speed: 2 + rng() * 3, phase: rng() * 6, baseZ: mesh.position.z };
      this.group.add(mesh);
      this.tumbleweeds.push(mesh);
    }

    // Bottles on saloon bar (decorative, near saloon front porch)
    for (let i = 0; i < 12; i++) {
      const x = -10 + i * 0.7, z = -6.5;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.25, 6), MAT.glass);
      b.position.set(x, 1.0, z);
      b.matrixAutoUpdate = false; b.updateMatrix();
      this.group.add(b);
    }

    // Piano near saloon porch
    const piano = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 1.0), MAT.woodWorn);
    piano.position.set(-12, 0.5, -7);
    piano.matrixAutoUpdate = false; piano.updateMatrix();
    this.group.add(piano);
    G.colliders.addStaticBox([-13, 0, -7.5], [-11, 1.0, -6.5], 'piano', 'wood', MASK.SOLID);

    // Extra wanted posters on sheriff forecourt wall
    for (let i = 0; i < 2; i++) {
      const poster = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.2), MAT.wantedPoster);
      poster.position.set(52 + i * 2, 1.6, -6.2);
      poster.rotation.y = Math.PI;
      poster.matrixAutoUpdate = false; poster.updateMatrix();
      this.group.add(poster);
    }

    // Sign posts (freestanding) with sway
    const signDefs = [
      { x: -30, z: -7, tex: 'signLivery' },
      { x: 40, z: -7, tex: 'signSaloon' },
    ];
    for (const sd of signDefs) {
      const g = new THREE.Group();
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3, 0.15), MAT.woodWorn);
      post.position.y = 1.5;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), MAT[sd.tex]);
      board.position.y = 2.6;
      g.add(post, board);
      g.position.set(sd.x, 0, sd.z);
      g.userData = { phase: rng() * 6 };
      this.group.add(g);
      this.swaySigns.push(g);
      G.colliders.addStaticCyl(sd.x, sd.z, 0.2, 0, 3, 'sign', 'wood', MASK.SOLID);
    }
  }

  update(dt) {
    const t = this.G.time;
    // tumbleweeds roll along +X, wrap around
    for (const tw of this.tumbleweeds) {
      tw.position.x += tw.userData.speed * dt;
      if (tw.position.x > 62) tw.position.x = -62;
      tw.rotation.z -= tw.userData.speed * dt * 1.5;
      tw.position.y = 0.4 + Math.abs(Math.sin(t * 3 + tw.userData.phase)) * 0.15;
    }
    // sign sway
    for (const s of this.swaySigns) {
      s.rotation.z = Math.sin(t * 1.2 + s.userData.phase) * 0.02;
    }
  }

  reset() {
    for (const tw of this.tumbleweeds) tw.position.x = -60 + (tw.userData.phase / 6) * 100;
  }

  dispose() {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}
