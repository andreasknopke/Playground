// Lighting: exactly 12 real lights (created in init, never re-parented), fog,
// background, street-lamp globes, glow batches, light shafts, env capture.
// See Plan.txt §2.14, §3.6. No shadow maps.
import * as THREE from 'three';
import { MAT } from './materials.js';
import { captureEnvironment } from './materials.js';
import { LIGHTS, FOG, LAYERS } from './constants.js';

export class Lighting {
  constructor(G) {
    this.G = G;
    this.lights = { hemi: null, street: [], saloon: null, sheriff: [], muzzle: null, jail: null };
    this.glowBatches = [];
    this._muzzle = { intensity: 0, ticks: 0 };
    this._flicker = [];
    this._shaftMeshes = [];
    this._lampGlobes = [];
  }

  init() {
    const G = this.G;
    const scene = G.scene;
    scene.background = new THREE.Color(FOG.color);
    scene.fog = new THREE.FogExp2(FOG.color, FOG.density);

    // 1. Hemisphere
    const hemi = new THREE.HemisphereLight(LIGHTS.hemi.sky, LIGHTS.hemi.ground, LIGHTS.hemi.intensity);
    scene.add(hemi);
    this.lights.hemi = hemi;

    // 1b. Sun (directional, no shadow map — cheap daytime key light)
    const sun = new THREE.DirectionalLight(LIGHTS.sun.color, LIGHTS.sun.intensity);
    const sd = LIGHTS.sun.dir;
    sun.position.set(sd[0], sd[1], sd[2]).multiplyScalar(100);
    sun.castShadow = false;
    scene.add(sun);
    this.lights.sun = sun;

    // 2-7. Six street point lights (subset of the 9 lamp x positions)
    const lampXs = LIGHTS.street.xs;
    const streetXs = [-50, -26, -2, 22, 38, 50];
    for (const x of streetXs) {
      const l = new THREE.PointLight(LIGHTS.street.color, LIGHTS.street.intensity, LIGHTS.street.distance, LIGHTS.street.decay);
      l.position.set(x, LIGHTS.street.y, LIGHTS.street.z);
      l.castShadow = false;
      scene.add(l);
      this.lights.street.push(l);
      this._flicker.push({ light: l, base: LIGHTS.street.intensity, phase: G.rngBuild() * 10, rate: 0.7 + G.rngBuild() * 0.6 });
    }

    // 8. Saloon interior
    const sal = new THREE.PointLight(LIGHTS.saloon.color, LIGHTS.saloon.intensity, LIGHTS.saloon.distance, LIGHTS.saloon.decay);
    sal.position.set(LIGHTS.saloon.x, LIGHTS.saloon.y, LIGHTS.saloon.z);
    sal.castShadow = false;
    scene.add(sal);
    this.lights.saloon = sal;

    // 9-10. Sheriff forecourt
    for (const [x, z] of [[56, -11], [56, -9]]) {
      const l = new THREE.PointLight(LIGHTS.sheriff.color, LIGHTS.sheriff.intensity, LIGHTS.sheriff.distance, LIGHTS.sheriff.decay);
      l.position.set(x, LIGHTS.sheriff.y, z);
      l.castShadow = false;
      scene.add(l);
      this.lights.sheriff.push(l);
    }

    // 11. Muzzle (intensity 0 at rest)
    const muz = new THREE.PointLight(LIGHTS.muzzle.color, 0, LIGHTS.muzzle.distance, LIGHTS.muzzle.decay);
    muz.position.set(0, 1.6, 0);
    muz.castShadow = false;
    scene.add(muz);
    this.lights.muzzle = muz;

    // 12. Jail interior
    const jail = new THREE.PointLight(0xffe2b8, 15, 8, 2);
    jail.position.set(56, 2.5, -11);
    jail.castShadow = false;
    scene.add(jail);
    this.lights.jail = jail;

    G._perf.lights = 13;

    // Street lamp globes + glow (billboard batch 0)
    const anchors = G.town.getLightAnchors();
    const globeGeo = new THREE.SphereGeometry(0.07, 8, 6);
    const globeMat = new THREE.MeshBasicMaterial({ color: 0xfff1d0, toneMapped: false });
    for (const lp of anchors.streetLamps) {
      const globe = new THREE.Mesh(globeGeo, globeMat);
      globe.position.copy(lp);
      globe.layers.set(LAYERS.NO_ENV);
      scene.add(globe);
      this._lampGlobes.push(globe);
      // lamp post
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 4, 6), MAT.woodWorn);
      post.position.set(lp.x, 2, lp.z);
      post.matrixAutoUpdate = false; post.updateMatrix();
      scene.add(post);
    }

    // Glow billboard batches (instanced)
    const glowGeo = new THREE.PlaneGeometry(1, 1);
    const glowMat = MAT.glowRadial;
    const batch0 = new THREE.InstancedMesh(glowGeo, glowMat, anchors.streetLamps.length);
    batch0.frustumCulled = false;
    batch0.layers.set(LAYERS.NO_ENV);
    const mtx = new THREE.Matrix4();
    anchors.streetLamps.forEach((lp, i) => {
      mtx.makeScale(0.6, 0.6, 0.6); mtx.setPosition(lp.x, lp.y, lp.z);
      batch0.setMatrixAt(i, mtx);
    });
    batch0.instanceMatrix.needsUpdate = true;
    scene.add(batch0);
    this.glowBatches.push(batch0);

    // Light shafts (truncated cones, additive)
    for (const sh of anchors.shafts) {
      const h = sh.top.distanceTo(sh.bottom);
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(sh.rTop, sh.rBottom, h, 12, 1, true), MAT.shaft);
      cone.position.copy(sh.top).lerp(sh.bottom, 0.5);
      cone.layers.set(LAYERS.NO_ENV);
      cone.matrixAutoUpdate = false; cone.updateMatrix();
      scene.add(cone);
      this._shaftMeshes.push(cone);
    }

    // Environment capture (once, after town/props/lights exist)
    try { captureEnvironment(G); } catch (e) { console.error('env capture failed', e); }
  }

  flashMuzzle(worldPos, intensity) {
    const m = this.lights.muzzle;
    m.position.copy(worldPos);
    this._muzzle.intensity = intensity;
    this._muzzle.ticks = 4;
  }

  setGlow(batch, i, pos, size, color, alpha) {
    const b = this.glowBatches[batch];
    if (!b) return;
    const mtx = new THREE.Matrix4();
    mtx.makeScale(size, size, size); mtx.setPosition(pos.x, pos.y, pos.z);
    b.setMatrixAt(i, mtx);
    if (color != null) b.setColorAt(i, color);
    b.instanceMatrix.needsUpdate = true;
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
  }

  update(dt) {
    const t = this.G.time;
    // street lamp breathing/flicker
    for (const f of this._flicker) {
      const flick = 0.9 + 0.1 * Math.sin(t * f.rate * Math.PI * 2 + f.phase);
      f.light.intensity = f.base * flick;
    }
    // muzzle decay
    if (this._muzzle.ticks > 0) {
      this._muzzle.ticks--;
      const frac = this._muzzle.ticks / 4;
      this.lights.muzzle.intensity = this._muzzle.intensity * frac;
    } else {
      this.lights.muzzle.intensity = 0;
    }
  }

  render() {}

  reset() {
    this._muzzle.intensity = 0; this._muzzle.ticks = 0;
    this.lights.muzzle.intensity = 0;
  }

  dispose() {
    for (const g of this._lampGlobes) g.geometry.dispose();
  }
}
