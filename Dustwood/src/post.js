// Post-processing chain: Render -> Bloom -> Output -> SMAA -> Grade.
// See Plan.txt §2.15, §3.8. ?nopost bypasses the composer.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { POST } from './constants.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    time: { value: 0 },
    hurt: { value: 0 },
    lowHealth: { value: 0 },
    dead: { value: 0 },
    vignette: { value: POST.vignette },
    grain: { value: POST.grain },
    ca: { value: POST.ca },
    saturation: { value: POST.saturation },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float time, hurt, lowHealth, dead, vignette, grain, ca, saturation;
    varying vec2 vUv;
    float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      vec2 dir = uv - 0.5;
      float d = length(dir);
      // chromatic aberration
      float caAmt = ca * (1.0 + hurt * 3.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir * caAmt).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir * caAmt).b;
      // saturation
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(lum), col, saturation);
      // low health desaturation
      col = mix(col, vec3(lum) * vec3(1.1, 0.6, 0.5), lowHealth * 0.5);
      // dead grey
      float deadLum = dot(col, vec3(0.299,0.587,0.114));
      col = mix(col, vec3(deadLum) * 0.7, dead);
      // hurt red lift
      col += vec3(hurt * 0.35, -hurt * 0.1, -hurt * 0.1);
      // vignette
      float vig = smoothstep(0.9, 0.35, d);
      col *= mix(1.0, vig, vignette);
      // grain
      float g = rand(uv * resolution + fract(time)) - 0.5;
      col += g * grain;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Post {
  constructor(G) {
    this.G = G;
    this.composer = null;
    this.grade = null;
    this.bloom = null;
    this._quality = 'high';
    this._lumaRT = null;
    this._lumaBuf = null;
  }

  init() {
    const G = this.G;
    if (G.opts.nopost) { this.composer = null; return; }
    const w = window.innerWidth, h = window.innerHeight;
    const scale = (G.opts.lowfx || G.opts.headless) && !G.opts.post ? 0.5 : 1;
    this.composer = new EffectComposer(G.renderer);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(G.scene, G.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w * scale, h * scale), POST.bloomStrength, POST.bloomRadius, POST.bloomThreshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    if (!G.opts.lowfx && !G.opts.headless) {
      this.smaa = new SMAAPass(w, h);
      this.composer.addPass(this.smaa);
    }
    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.resolution.value.set(w, h);
    this.composer.addPass(this.grade);

    // luminance sample RT
    this._lumaRT = new THREE.WebGLRenderTarget(1, 1);
    this._lumaBuf = new Uint8Array(4);
  }

  setQuality(q) {
    this._quality = q;
    if (!this.composer) return;
    const w = window.innerWidth, h = window.innerHeight;
    if (q === 'low') {
      if (this.bloom) this.bloom.resolution.set(w / 2, h / 2);
    } else {
      if (this.bloom) this.bloom.resolution.set(w, h);
    }
  }

  setHurt(v) { if (this.grade) this.grade.uniforms.hurt.value = v; }
  setLowHealth(v) { if (this.grade) this.grade.uniforms.lowHealth.value = v; }
  setDead(v) { if (this.grade) this.grade.uniforms.dead.value = v; }

  render() {
    const G = this.G;
    if (this.grade) this.grade.uniforms.time.value = G.time;
    if (this.composer) {
      this.composer.render();
    } else {
      G.renderer.render(G.scene, G.camera);
    }
  }

  resize(w, h) {
    if (!this.composer) return;
    this.composer.setSize(w, h);
    if (this.grade) this.grade.uniforms.resolution.value.set(w, h);
    const scale = this._quality === 'low' ? 0.5 : 1;
    if (this.bloom) this.bloom.resolution.set(w * scale, h * scale);
  }

  // Sample the centre of the last frame's luminance.
  sampleLuminance() {
    const G = this.G;
    try {
      const w = G.renderer.domElement.width, h = G.renderer.domElement.height;
      const x = Math.floor(w / 2), y = Math.floor(h / 2);
      const buf = new Uint8Array(4);
      G.renderer.readRenderTargetPixels ? null : null;
      // read from default framebuffer via a tiny render target copy
      const rt = new THREE.WebGLRenderTarget(1, 1);
      // Simpler: read pixels from canvas using a 1x1 readback is not directly
      // available; instead render scene luminance estimate from a small RT.
      rt.dispose();
      // Fallback: use a 1x1 read of the drawing buffer.
      const gl = G.renderer.getContext();
      const px = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const lum = (0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2]) / 255;
      return lum;
    } catch (e) {
      return 0.3;
    }
  }

  renderInfo() {
    const info = this.G.renderer.info;
    return {
      calls: info.render.calls, triangles: info.render.triangles, points: info.render.points,
      lines: info.render.lines, geometries: info.memory.geometries, textures: info.memory.textures,
      programs: info.programs ? info.programs.length : 0,
    };
  }

  warmupDone() {}
  reset() { if (this.grade) { this.grade.uniforms.hurt.value = 0; this.grade.uniforms.dead.value = 0; this.grade.uniforms.lowHealth.value = 0; } }
  dispose() { if (this.composer) this.composer.dispose(); }
}
