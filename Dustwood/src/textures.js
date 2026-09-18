// Procedural canvas textures. See Plan.txt §2.8, §3.1. All generators use a
// per-name seeded RNG (rngFor) so builds are deterministic; colour maps are
// sRGB, data maps (normal/rough) are NoColorSpace. Tiling textures are made
// seamless by sampling pre-baked noise tiles.
import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { FONTS } from './constants.js';
import { mulberry32 } from './utils.js';

let _renderer = null;
let _seed = 1337;
const _registry = new Map(); // name|variant -> TextureSet
const _timings = {};
const _noiseTiles = new Map();
const _simplex = new SimplexNoise();

export function initTextures(renderer, seed) {
  _renderer = renderer;
  _seed = seed >>> 0;
}

function rngFor(name) {
  // stable hash of name -> seed
  let h = 2166136261 >>> 0;
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
  return mulberry32((h ^ _seed) >>> 0);
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// ---- Noise ----
function noise2(x, y) { return _simplex.noise(x, y); }
function fbm(x, y, oct = 4) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += amp * noise2(x * f, y * f); amp *= 0.5; f *= 2; }
  return v;
}

// Pre-baked seamless noise tile (Float32Array in [-1,1]) sampled with wrap.
function noiseTile(seed, octaves, size = 256) {
  const key = `${seed}|${octaves}|${size}`;
  if (_noiseTiles.has(key)) return _noiseTiles.get(key);
  const rng = mulberry32(seed);
  const data = new Float32Array(size * size);
  const scale = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * scale, v = (y / size) * scale;
      data[y * size + x] = fbm(u + rng() * 10, v + rng() * 10, octaves);
    }
  }
  const tile = { data, size };
  _noiseTiles.set(key, tile);
  return tile;
}

function sampleTile(tile, u, v) {
  const s = tile.size;
  const x = ((u % 1) + 1) % 1, y = ((v % 1) + 1) % 1;
  const fx = x * s, fy = y * s;
  const x0 = Math.floor(fx) % s, y0 = Math.floor(fy) % s;
  const x1 = (x0 + 1) % s, y1 = (y0 + 1) % s;
  const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
  const a = tile.data[y0 * s + x0], b = tile.data[y0 * s + x1];
  const c = tile.data[y1 * s + x0], d = tile.data[y1 * s + x1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

// Fill an ImageData with a seamless fbm from a tile, scaled.
function fillNoise(img, tile, scale, offset = 0, gain = 1) {
  const w = img.width, h = img.height, d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = sampleTile(tile, (x / w) * scale, (y / h) * scale);
      d[(y * w + x) * 4] = 255; d[(y * w + x) * 4 + 1] = 255; d[(y * w + x) * 4 + 2] = 255;
      d[(y * w + x) * 4 + 3] = Math.max(0, Math.min(255, (n * 0.5 + 0.5) * 255 * gain + offset));
    }
  }
}

function grimeOverlay(ctx, w, h, rng, strength = 0.3) {
  ctx.save();
  ctx.globalAlpha = strength;
  for (let i = 0; i < 40; i++) {
    const x = rng() * w, y = rng() * h, r = rng() * w * 0.3 + 20;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(20,12,6,0.5)');
    g.addColorStop(1, 'rgba(20,12,6,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
}

function scratches(ctx, w, h, rng, count = 30, color = 'rgba(0,0,0,0.25)') {
  ctx.strokeStyle = color; ctx.lineWidth = 1;
  for (let i = 0; i < count; i++) {
    ctx.beginPath();
    const x = rng() * w, y = rng() * h, len = rng() * w * 0.4 + 10, a = rng() * Math.PI * 2;
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
}

// Height (grayscale canvas) -> normal map canvas.
function heightToNormal(heightCanvas, strength = 2) {
  const w = heightCanvas.width, h = heightCanvas.height;
  const hctx = heightCanvas.getContext('2d');
  const src = hctx.getImageData(0, 0, w, h).data;
  const out = makeCanvas(w, h);
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x - 1, y) - H(x + 1, y)) * strength;
      const dy = (H(x, y - 1) - H(x, y + 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = ((dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function toTexture(canvas, { srgb = false, repeat = [1, 1], wrap = THREE.RepeatWrapping, aniso = 8, mipmaps = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = wrap;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = aniso;
  tex.generateMipmaps = mipmaps;
  tex.needsUpdate = true;
  return tex;
}

function textOnCanvas(ctx, text, opts = {}) {
  const { font = FONTS.SIGN, color = '#f2e6c8', x = 0.5, y = 0.5, align = 'center', baseline = 'middle', letterSpacing = 0, shadow = true } = opts;
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const px = x * w, py = y * h;
  if (shadow) { ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3; }
  if (letterSpacing) {
    // manual letter spacing
    const chars = [...text];
    const widths = chars.map((c) => ctx.measureText(c).width);
    const total = widths.reduce((a, b) => a + b, 0) + letterSpacing * (chars.length - 1);
    let cx = align === 'center' ? px - total / 2 : px;
    for (let i = 0; i < chars.length; i++) {
      ctx.textAlign = 'left';
      ctx.fillText(chars[i], cx, py);
      cx += widths[i] + letterSpacing;
    }
  } else {
    ctx.fillText(text, px, py);
  }
  ctx.restore();
}

// ---- Texture generators (return {map, normal, rough, ...}) ----
const GEN = {};

GEN.woodPlank = (rng, variant) => {
  const S = 1024;
  const map = makeCanvas(S, S), mctx = map.getContext('2d');
  const height = makeCanvas(S, S), hctx = height.getContext('2d');
  const rough = makeCanvas(S, S), rctx = rough.getContext('2d');
  const base = variant === 1 ? '#b89a72' : '#c8b088';
  mctx.fillStyle = base; mctx.fillRect(0, 0, S, S);
  rctx.fillStyle = '#b0b0b0'; rctx.fillRect(0, 0, S, S);
  hctx.fillStyle = '#808080'; hctx.fillRect(0, 0, S, S);
  const planks = 5;
  const ph = S / planks;
  for (let p = 0; p < planks; p++) {
    const y0 = p * ph;
    const tint = 0.85 + rng() * 0.3;
    mctx.fillStyle = shade(base, tint);
    mctx.fillRect(0, y0, S, ph - 2);
    // grain bezier lines
    for (let g = 0; g < 26; g++) {
      const gy = y0 + rng() * ph;
      mctx.strokeStyle = `rgba(60,40,20,${0.05 + rng() * 0.12})`;
      mctx.lineWidth = 1 + rng() * 2;
      mctx.beginPath();
      mctx.moveTo(0, gy);
      mctx.bezierCurveTo(S * 0.3, gy + rng() * 8 - 4, S * 0.6, gy + rng() * 8 - 4, S, gy + rng() * 6 - 3);
      mctx.stroke();
      hctx.strokeStyle = `rgba(120,120,120,${0.3})`;
      hctx.lineWidth = 1;
      hctx.beginPath(); hctx.moveTo(0, gy); hctx.lineTo(S, gy + rng() * 4 - 2); hctx.stroke();
    }
    // knots
    for (let k = 0; k < 2; k++) {
      const kx = rng() * S, ky = y0 + ph * 0.5;
      const kr = 6 + rng() * 10;
      const g = mctx.createRadialGradient(kx, ky, 0, kx, ky, kr);
      g.addColorStop(0, 'rgba(50,30,15,0.9)'); g.addColorStop(1, 'rgba(50,30,15,0)');
      mctx.fillStyle = g; mctx.beginPath(); mctx.arc(kx, ky, kr, 0, 7); mctx.fill();
    }
    // plank gap (dark line + height groove)
    mctx.fillStyle = 'rgba(20,12,6,0.8)'; mctx.fillRect(0, y0 + ph - 3, S, 3);
    hctx.fillStyle = '#202020'; hctx.fillRect(0, y0 + ph - 3, S, 3);
    // nail heads
    for (let n = 0; n < 4; n++) {
      const nx = (n + 0.5) * (S / 4), ny = y0 + 8;
      mctx.fillStyle = '#3a3a3a'; mctx.beginPath(); mctx.arc(nx, ny, 3, 0, 7); mctx.fill();
    }
  }
  grimeOverlay(mctx, S, S, rng, 0.25);
  // chipped edges near bottom of each plank
  scratches(mctx, S, S, rng, 40);
  return {
    map: toTexture(map, { srgb: true, repeat: [0.5, 0.5] }),
    normal: toTexture(heightToNormal(height, 2.5), { repeat: [0.5, 0.5] }),
    rough: toTexture(rough, { repeat: [0.5, 0.5] }),
  };
};

GEN.woodWorn = (rng) => {
  const S = 512;
  const map = makeCanvas(S, S), mctx = map.getContext('2d');
  mctx.fillStyle = '#8a6f4a'; mctx.fillRect(0, 0, S, S);
  for (let g = 0; g < 60; g++) {
    mctx.strokeStyle = `rgba(40,25,12,${0.1 + rng() * 0.2})`;
    mctx.lineWidth = 1 + rng() * 3;
    const y = rng() * S; mctx.beginPath(); mctx.moveTo(0, y); mctx.lineTo(S, y + rng() * 10 - 5); mctx.stroke();
  }
  for (let c = 0; c < 8; c++) {
    mctx.strokeStyle = 'rgba(15,8,4,0.6)'; mctx.lineWidth = 2;
    const x = rng() * S; mctx.beginPath(); mctx.moveTo(x, 0); mctx.lineTo(x + rng() * 20 - 10, S); mctx.stroke();
  }
  grimeOverlay(mctx, S, S, rng, 0.4);
  const rough = makeCanvas(S, S), rctx = rough.getContext('2d');
  const img = rctx.createImageData(S, S);
  const tile = noiseTile(11, 4);
  fillNoise(img, tile, 6, 120, 0.6);
  rctx.putImageData(img, 0, 0);
  return { map: toTexture(map, { srgb: true, repeat: [1, 1] }), rough: toTexture(rough, { repeat: [1, 1] }) };
};

GEN.adobe = (rng) => {
  const S = 1024;
  const map = makeCanvas(S, S), mctx = map.getContext('2d');
  const height = makeCanvas(S, S), hctx = height.getContext('2d');
  const rough = makeCanvas(S, S), rctx = rough.getContext('2d');
  const img = mctx.createImageData(S, S);
  const himg = hctx.createImageData(S, S);
  const rimg = rctx.createImageData(S, S);
  const tile = noiseTile(21, 5);
  const base = [176, 138, 90];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = sampleTile(tile, x / S * 4, y / S * 4);
      const m = n * 0.5 + 0.5;
      const i = (y * S + x) * 4;
      img.data[i] = base[0] * (0.8 + m * 0.35);
      img.data[i + 1] = base[1] * (0.8 + m * 0.35);
      img.data[i + 2] = base[2] * (0.8 + m * 0.35);
      img.data[i + 3] = 255;
      himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = m * 255; himg.data[i + 3] = 255;
      const r = 200 - m * 40;
      rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = r; rimg.data[i + 3] = 255;
    }
  }
  mctx.putImageData(img, 0, 0); hctx.putImageData(himg, 0, 0); rctx.putImageData(rimg, 0, 0);
  // peeling patches
  for (let p = 0; p < 10; p++) {
    const x = rng() * S, y = rng() * S, r = 20 + rng() * 60;
    mctx.fillStyle = `rgba(${base[0] * 0.7 | 0},${base[1] * 0.65 | 0},${base[2] * 0.6 | 0},0.6)`;
    mctx.beginPath(); mctx.ellipse(x, y, r, r * 0.7, rng() * 3, 0, 7); mctx.fill();
  }
  // cracks
  for (let c = 0; c < 6; c++) {
    mctx.strokeStyle = 'rgba(60,40,25,0.5)'; mctx.lineWidth = 1 + rng();
    let x = rng() * S, y = rng() * S;
    mctx.beginPath(); mctx.moveTo(x, y);
    for (let s = 0; s < 8; s++) { x += rng() * 60 - 30; y += rng() * 60; mctx.lineTo(x, y); }
    mctx.stroke();
  }
  return {
    map: toTexture(map, { srgb: true, repeat: [0.25, 0.25] }),
    normal: toTexture(heightToNormal(height, 1.5), { repeat: [0.25, 0.25] }),
    rough: toTexture(rough, { repeat: [0.25, 0.25] }),
  };
};

GEN.sand = (rng) => {
  const S = 1024;
  const map = makeCanvas(S, S), mctx = map.getContext('2d');
  const height = makeCanvas(S, S), hctx = height.getContext('2d');
  const rough = makeCanvas(S, S), rctx = rough.getContext('2d');
  const img = mctx.createImageData(S, S);
  const himg = hctx.createImageData(S, S);
  const rimg = rctx.createImageData(S, S);
  const tile = noiseTile(31, 5);
  const fine = noiseTile(32, 3);
  const base = [216, 200, 160];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = sampleTile(tile, x / S * 4, y / S * 4) * 0.5 + 0.5;
      const f = sampleTile(fine, x / S * 40, y / S * 40) * 0.5 + 0.5;
      const m = n * 0.7 + f * 0.3;
      const i = (y * S + x) * 4;
      img.data[i] = base[0] * (0.82 + m * 0.3);
      img.data[i + 1] = base[1] * (0.82 + m * 0.3);
      img.data[i + 2] = base[2] * (0.8 + m * 0.3);
      img.data[i + 3] = 255;
      himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = m * 255; himg.data[i + 3] = 255;
      rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = 230 - m * 20; rimg.data[i + 3] = 255;
    }
  }
  mctx.putImageData(img, 0, 0); hctx.putImageData(himg, 0, 0); rctx.putImageData(rimg, 0, 0);
  // pebbles
  for (let p = 0; p < 200; p++) {
    const x = rng() * S, y = rng() * S, r = 1 + rng() * 3;
    mctx.fillStyle = `rgba(${180 + rng() * 40 | 0},${160 + rng() * 40 | 0},${120 + rng() * 30 | 0},0.6)`;
    mctx.beginPath(); mctx.arc(x, y, r, 0, 7); mctx.fill();
  }
  return {
    map: toTexture(map, { srgb: true, repeat: [0.25, 0.25] }),
    normal: toTexture(heightToNormal(height, 1.2), { repeat: [0.25, 0.25] }),
    rough: toTexture(rough, { repeat: [0.25, 0.25] }),
  };
};

GEN.boardwalk = (rng) => {
  const W = 512, H = 128;
  const map = makeCanvas(W, H), mctx = map.getContext('2d');
  mctx.fillStyle = '#a8895f'; mctx.fillRect(0, 0, W, H);
  const planks = 4, pw = W / planks;
  for (let p = 0; p < planks; p++) {
    mctx.fillStyle = shade('#a8895f', 0.85 + rng() * 0.3);
    mctx.fillRect(p * pw, 0, pw - 2, H);
    for (let g = 0; g < 10; g++) {
      mctx.strokeStyle = `rgba(50,32,16,${0.1 + rng() * 0.15})`;
      const x = p * pw + rng() * pw; mctx.beginPath(); mctx.moveTo(x, 0); mctx.lineTo(x + rng() * 6 - 3, H); mctx.stroke();
    }
    mctx.fillStyle = 'rgba(15,8,4,0.8)'; mctx.fillRect(p * pw + pw - 2, 0, 2, H);
    mctx.fillStyle = '#3a3a3a';
    mctx.beginPath(); mctx.arc(p * pw + 6, 6, 2, 0, 7); mctx.fill();
    mctx.beginPath(); mctx.arc(p * pw + 6, H - 6, 2, 0, 7); mctx.fill();
  }
  grimeOverlay(mctx, W, H, rng, 0.2);
  const rough = makeCanvas(W, H), rctx = rough.getContext('2d');
  rctx.fillStyle = '#b8b8b8'; rctx.fillRect(0, 0, W, H);
  return { map: toTexture(map, { srgb: true, repeat: [1, 1] }), rough: toTexture(rough, { repeat: [1, 1] }) };
};

GEN.rust = (rng) => {
  const S = 512;
  const map = makeCanvas(S, S), mctx = map.getContext('2d');
  mctx.fillStyle = '#5a4632'; mctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 60; i++) {
    const x = rng() * S, y = rng() * S, r = 10 + rng() * 50;
    const g = mctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${120 + rng() * 60 | 0},${50 + rng() * 30 | 0},20,0.7)`);
    g.addColorStop(1, 'rgba(90,60,30,0)');
    mctx.fillStyle = g; mctx.beginPath(); mctx.arc(x, y, r, 0, 7); mctx.fill();
  }
  const height = makeCanvas(S, S), hctx = height.getContext('2d');
  const himg = hctx.createImageData(S, S);
  fillNoise(himg, noiseTile(41, 4), 8, 60, 0.8);
  hctx.putImageData(himg, 0, 0);
  // roughness+metal packed: rough in G, metal in B
  const rm = makeCanvas(S, S), rmctx = rm.getContext('2d');
  const rimg = rmctx.createImageData(S, S);
  const tile = noiseTile(42, 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = sampleTile(tile, x / S * 6, y / S * 6) * 0.5 + 0.5;
    const i = (y * S + x) * 4;
    rimg.data[i] = 255; rimg.data[i + 1] = 200 - n * 120; rimg.data[i + 2] = 60 + n * 120; rimg.data[i + 3] = 255;
  }
  rmctx.putImageData(rimg, 0, 0);
  return {
    map: toTexture(map, { srgb: true, repeat: [1, 1] }),
    normal: toTexture(heightToNormal(height, 2), { repeat: [1, 1] }),
    roughMetal: toTexture(rm, { repeat: [1, 1] }),
  };
};

GEN.saloonRed = (rng) => {
  const S = 512;
  const map = makeCanvas(S, S), mctx = map.getContext('2d');
  mctx.fillStyle = '#8a3a2a'; mctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 40; i++) {
    mctx.fillStyle = `rgba(${100 + rng() * 40 | 0},${40 + rng() * 20 | 0},30,${rng() * 0.3})`;
    mctx.fillRect(rng() * S, rng() * S, rng() * 80, rng() * 80);
  }
  // chipped paint
  for (let i = 0; i < 30; i++) {
    mctx.fillStyle = 'rgba(120,90,60,0.5)';
    mctx.beginPath(); mctx.arc(rng() * S, rng() * S, rng() * 8, 0, 7); mctx.fill();
  }
  grimeOverlay(mctx, S, S, rng, 0.2);
  const rough = makeCanvas(S, S), rctx = rough.getContext('2d');
  rctx.fillStyle = '#909090'; rctx.fillRect(0, 0, S, S);
  return { map: toTexture(map, { srgb: true, repeat: [1, 1] }), rough: toTexture(rough, { repeat: [1, 1] }) };
};

GEN.churchWhite = (rng) => {
  const S = 512;
  const map = makeCanvas(S, S), mctx = map.getContext('2d');
  mctx.fillStyle = '#e8e0d0'; mctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 30; i++) {
    mctx.fillStyle = `rgba(200,190,170,${rng() * 0.4})`;
    mctx.fillRect(rng() * S, rng() * S, rng() * 60, rng() * 60);
  }
  for (let c = 0; c < 5; c++) {
    mctx.strokeStyle = 'rgba(150,140,120,0.4)'; mctx.lineWidth = 1;
    let x = rng() * S, y = 0; mctx.beginPath(); mctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) { x += rng() * 30 - 15; y += S / 6; mctx.lineTo(x, y); }
    mctx.stroke();
  }
  const rough = makeCanvas(S, S), rctx = rough.getContext('2d');
  rctx.fillStyle = '#a0a0a0'; rctx.fillRect(0, 0, S, S);
  return { map: toTexture(map, { srgb: true, repeat: [1, 1] }), rough: toTexture(rough, { repeat: [1, 1] }) };
};

GEN.hay = (rng) => {
  const S = 512;
  const map = makeCanvas(S, S), mctx = map.getContext('2d');
  mctx.fillStyle = '#c8a850'; mctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 400; i++) {
    mctx.strokeStyle = `rgba(${180 + rng() * 60 | 0},${150 + rng() * 50 | 0},${60 + rng() * 40 | 0},0.6)`;
    mctx.lineWidth = 1;
    const x = rng() * S, y = rng() * S, a = rng() * Math.PI;
    mctx.beginPath(); mctx.moveTo(x, y); mctx.lineTo(x + Math.cos(a) * 20, y + Math.sin(a) * 20); mctx.stroke();
  }
  const rough = makeCanvas(S, S), rctx = rough.getContext('2d');
  rctx.fillStyle = '#c0c0c0'; rctx.fillRect(0, 0, S, S);
  return { map: toTexture(map, { srgb: true, repeat: [1, 1] }), rough: toTexture(rough, { repeat: [1, 1] }) };
};

function signTexture(text, bg, fg, font) {
  return (rng) => {
    const W = 512, H = 256;
    const map = makeCanvas(W, H), mctx = map.getContext('2d');
    mctx.fillStyle = bg; mctx.fillRect(0, 0, W, H);
    mctx.strokeStyle = fg; mctx.lineWidth = 6; mctx.strokeRect(12, 12, W - 24, H - 24);
    textOnCanvas(mctx, text, { font, color: fg, letterSpacing: 6 });
    grimeOverlay(mctx, W, H, rng, 0.25);
    scratches(mctx, W, H, rng, 15, 'rgba(0,0,0,0.2)');
    return { map: toTexture(map, { srgb: true, wrap: THREE.ClampToEdgeWrapping }) };
  };
}
GEN.signSaloon = signTexture('SALOON', '#2a1410', '#e8c86a', FONTS.SIGN);
GEN.signSheriff = signTexture('SHERIFF', '#1a2030', '#dfe6f0', FONTS.SIGN);
GEN.signLivery = signTexture('LIVERY STABLE', '#241a10', '#e0c080', FONTS.SIGN);
GEN.signChurch = signTexture('CHURCH', '#f0e8d8', '#3a2a18', FONTS.SIGN);

GEN.wantedPoster = (rng) => {
  const W = 512, H = 768;
  const map = makeCanvas(W, H), mctx = map.getContext('2d');
  mctx.fillStyle = '#d8c8a0'; mctx.fillRect(0, 0, W, H);
  textOnCanvas(mctx, 'WANTED', { font: FONTS.STENCIL, color: '#20140a', y: 0.12 });
  textOnCanvas(mctx, 'DEAD OR ALIVE', { font: FONTS.SIGN, color: '#40200f', y: 0.22 });
  // face silhouette
  mctx.fillStyle = '#3a2818';
  mctx.beginPath(); mctx.ellipse(W / 2, H * 0.5, 90, 110, 0, 0, 7); mctx.fill();
  mctx.fillStyle = '#d8c8a0';
  mctx.beginPath(); mctx.arc(W / 2 - 30, H * 0.47, 10, 0, 7); mctx.arc(W / 2 + 30, H * 0.47, 10, 0, 7); mctx.fill();
  textOnCanvas(mctx, '$500', { font: FONTS.STENCIL, color: '#7a1a10', y: 0.82 });
  grimeOverlay(mctx, W, H, rng, 0.3);
  return { map: toTexture(map, { srgb: true, wrap: THREE.ClampToEdgeWrapping }) };
};

GEN.crossWood = (rng) => {
  const S = 256;
  const map = makeCanvas(S, S), mctx = map.getContext('2d');
  mctx.clearRect(0, 0, S, S);
  mctx.fillStyle = '#6a4a2a';
  mctx.fillRect(S / 2 - 14, 20, 28, S - 40);
  mctx.fillRect(S / 2 - 60, 70, 120, 26);
  for (let g = 0; g < 20; g++) { mctx.strokeStyle = 'rgba(30,18,8,0.4)'; mctx.beginPath(); mctx.moveTo(rng() * S, 0); mctx.lineTo(rng() * S, S); mctx.stroke(); }
  return { map: toTexture(map, { srgb: true, wrap: THREE.ClampToEdgeWrapping }) };
};

function barrelCrateWagon(base) {
  return (rng) => {
    const S = 512;
    const map = makeCanvas(S, S), mctx = map.getContext('2d');
    mctx.fillStyle = base; mctx.fillRect(0, 0, S, S);
    for (let g = 0; g < 40; g++) { mctx.strokeStyle = `rgba(40,25,12,${0.1 + rng() * 0.2})`; mctx.lineWidth = 1 + rng() * 2; const y = rng() * S; mctx.beginPath(); mctx.moveTo(0, y); mctx.lineTo(S, y + rng() * 8 - 4); mctx.stroke(); }
    grimeOverlay(mctx, S, S, rng, 0.3);
    const rough = makeCanvas(S, S), rctx = rough.getContext('2d');
    rctx.fillStyle = '#b0b0b0'; rctx.fillRect(0, 0, S, S);
    return { map: toTexture(map, { srgb: true, repeat: [1, 1] }), rough: toTexture(rough, { repeat: [1, 1] }) };
  };
}
GEN.barrelWood = barrelCrateWagon('#7a5636');
GEN.crateWood = barrelCrateWagon('#9a7a4a');
GEN.wagonWood = barrelCrateWagon('#6a4a30');

function alphaPlant(colorFn, drawFn) {
  return (rng) => {
    const S = 256;
    const map = makeCanvas(S, S), mctx = map.getContext('2d');
    mctx.clearRect(0, 0, S, S);
    drawFn(mctx, S, rng, colorFn);
    return { map: toTexture(map, { srgb: true, wrap: THREE.ClampToEdgeWrapping }) };
  };
}
GEN.cactus = alphaPlant('#3a6a3a', (ctx, S, rng, c) => {
  ctx.fillStyle = c;
  ctx.fillRect(S / 2 - 20, 20, 40, S - 20);
  ctx.fillRect(S / 2 - 60, 90, 30, 20); ctx.fillRect(S / 2 - 60, 60, 20, 50);
  ctx.fillRect(S / 2 + 30, 120, 30, 20); ctx.fillRect(S / 2 + 40, 90, 20, 50);
  ctx.strokeStyle = 'rgba(20,40,20,0.5)';
  for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.moveTo(S / 2 - 15 + i * 4, 20); ctx.lineTo(S / 2 - 15 + i * 4, S); ctx.stroke(); }
});
GEN.shrub = alphaPlant('#7a6a3a', (ctx, S, rng, c) => {
  ctx.strokeStyle = c; ctx.lineWidth = 2;
  for (let i = 0; i < 80; i++) {
    const a = rng() * Math.PI - Math.PI, len = 30 + rng() * 60;
    ctx.beginPath(); ctx.moveTo(S / 2, S); ctx.lineTo(S / 2 + Math.cos(a) * len, S - Math.abs(Math.sin(a)) * len); ctx.stroke();
  }
});
GEN.deadTree = alphaPlant('#4a3420', (ctx, S, rng, c) => {
  ctx.strokeStyle = c; ctx.lineCap = 'round';
  ctx.lineWidth = 14; ctx.beginPath(); ctx.moveTo(S / 2, S); ctx.lineTo(S / 2, S * 0.3); ctx.stroke();
  ctx.lineWidth = 6;
  for (let i = 0; i < 8; i++) {
    const y = S * (0.2 + rng() * 0.4); const dir = rng() < 0.5 ? -1 : 1;
    ctx.beginPath(); ctx.moveTo(S / 2, y); ctx.lineTo(S / 2 + dir * (30 + rng() * 50), y - rng() * 40); ctx.stroke();
  }
});
GEN.tumbleweed = alphaPlant('#8a6a3a', (ctx, S, rng, c) => {
  // Loose, see-through tangle of twigs (NOT a solid ball): no filled disc, just
  // criss-cross strokes with gaps so you can see through it, plus a few rim
  // strands for silhouette.
  const cx = S / 2, cy = S / 2, R = S * 0.46;
  const tones = ['#8a6a3a', '#6f5228', '#a07c44', '#5c4322'];
  for (let i = 0; i < 110; i++) {
    ctx.strokeStyle = tones[(rng() * tones.length) | 0];
    ctx.lineWidth = 1.5 + rng() * 2.5;
    ctx.lineCap = 'round';
    const a = rng() * Math.PI * 2;
    const r = rng() * R;
    const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
    const a2 = a + (rng() - 0.5) * 2.4;
    const len = R * (0.35 + rng() * 0.6);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(a2) * len, py + Math.sin(a2) * len);
    ctx.stroke();
  }
  // a few long curved strands around the rim for silhouette
  ctx.lineWidth = 2;
  for (let i = 0; i < 22; i++) {
    ctx.strokeStyle = tones[(rng() * tones.length) | 0];
    const a = rng() * Math.PI * 2, r = R * (0.7 + rng() * 0.3);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8, r, a, a + 0.6 + rng() * 0.8);
    ctx.stroke();
  }
});

GEN.mesa = (rng) => {
  const W = 1024, H = 256;
  const map = makeCanvas(W, H), mctx = map.getContext('2d');
  mctx.clearRect(0, 0, W, H);
  // Build a canyon-wall silhouette from overlapping buttes.
  const rock = mctx.createLinearGradient(0, 0, 0, H);
  rock.addColorStop(0, '#c56a44');
  rock.addColorStop(0.5, '#a9502f');
  rock.addColorStop(1, '#7c3a24');
  mctx.fillStyle = rock;
  mctx.beginPath(); mctx.moveTo(0, H);
  let x = 0;
  while (x < W) {
    const w = 90 + rng() * 150, h = H * (0.45 + rng() * 0.5);
    mctx.lineTo(x, H - h);
    mctx.lineTo(x + w * 0.15, H - h - rng() * 18);
    mctx.lineTo(x + w * 0.5, H - h - rng() * 12);
    mctx.lineTo(x + w * 0.6, H - h * 0.72);
    mctx.lineTo(x + w, H - h * 0.72);
    x += w;
  }
  mctx.lineTo(W, H); mctx.closePath(); mctx.fill();
  // Horizontal sediment strata, clipped to the silhouette.
  mctx.save();
  mctx.clip();
  for (let y = H * 0.28; y < H; y += 6 + rng() * 8) {
    mctx.fillStyle = `rgba(${rng() < 0.5 ? '255,220,180' : '60,25,15'},${0.05 + rng() * 0.12})`;
    mctx.fillRect(0, y, W, 2 + rng() * 3);
  }
  // Vertical erosion streaks.
  for (let i = 0; i < 60; i++) {
    const sx = rng() * W;
    mctx.fillStyle = `rgba(40,18,10,${0.04 + rng() * 0.08})`;
    mctx.fillRect(sx, H * 0.3, 1 + rng() * 2, H);
  }
  mctx.restore();
  return { map: toTexture(map, { srgb: true, wrap: THREE.ClampToEdgeWrapping }) };
};

GEN.sky = (rng) => {
  const W = 1024, H = 512;
  const map = makeCanvas(W, H), mctx = map.getContext('2d');
  // Bright daytime sky: deep blue at zenith fading to warm haze at the horizon.
  const g = mctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0.0, '#3f74b0');
  g.addColorStop(0.45, '#7ba6d0');
  g.addColorStop(0.72, '#bcd4e6');
  g.addColorStop(0.9, '#e7d8bd');
  g.addColorStop(1.0, '#eaddc0');
  mctx.fillStyle = g; mctx.fillRect(0, 0, W, H);
  // Soft, dim sun glow (kept well below bloom threshold so it never blows out).
  const sg = mctx.createRadialGradient(W * 0.7, H * 0.22, 0, W * 0.7, H * 0.22, 150);
  sg.addColorStop(0, 'rgba(255,246,224,0.55)');
  sg.addColorStop(0.4, 'rgba(255,240,210,0.22)');
  sg.addColorStop(1, 'rgba(255,240,210,0)');
  mctx.fillStyle = sg; mctx.fillRect(0, 0, W, H);
  // A few faint high wisps for interest.
  mctx.globalAlpha = 0.10;
  for (let i = 0; i < 14; i++) {
    const cx = rng() * W, cy = H * (0.12 + rng() * 0.32), rw = 60 + rng() * 160, rh = 6 + rng() * 12;
    mctx.fillStyle = '#ffffff';
    mctx.beginPath(); mctx.ellipse(cx, cy, rw, rh, 0, 0, 7); mctx.fill();
  }
  mctx.globalAlpha = 1;
  return { map: toTexture(map, { srgb: true, wrap: THREE.ClampToEdgeWrapping }) };
};

GEN.gunMetalRough = (rng) => {
  const S = 512;
  const rough = makeCanvas(S, S), rctx = rough.getContext('2d');
  rctx.fillStyle = '#606060'; rctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 200; i++) { rctx.strokeStyle = `rgba(${rng() < 0.5 ? 255 : 0},${rng() < 0.5 ? 255 : 0},128,0.1)`; const y = rng() * S; rctx.beginPath(); rctx.moveTo(0, y); rctx.lineTo(S, y); rctx.stroke(); }
  return { rough: toTexture(rough, { repeat: [2, 2] }) };
};
GEN.gunWood = (rng) => {
  const S = 512;
  const map = makeCanvas(S, S), mctx = map.getContext('2d');
  mctx.fillStyle = '#4a2f1a'; mctx.fillRect(0, 0, S, S);
  for (let g = 0; g < 60; g++) { mctx.strokeStyle = `rgba(30,18,8,${0.1 + rng() * 0.2})`; mctx.lineWidth = 1 + rng() * 2; const y = rng() * S; mctx.beginPath(); mctx.moveTo(0, y); mctx.bezierCurveTo(S * 0.3, y + rng() * 10, S * 0.6, y - rng() * 10, S, y); mctx.stroke(); }
  return { map: toTexture(map, { srgb: true, repeat: [2, 2] }) };
};

GEN.muzzleFlash = (rng) => {
  const S = 512;
  const map = makeCanvas(S, S), mctx = map.getContext('2d');
  mctx.clearRect(0, 0, S, S);
  const cell = S / 2;
  for (let v = 0; v < 4; v++) {
    const cx = (v % 2) * cell + cell / 2, cy = Math.floor(v / 2) * cell + cell / 2;
    const g = mctx.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.45);
    g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(0.3, 'rgba(255,200,80,0.9)'); g.addColorStop(0.7, 'rgba(255,120,20,0.4)'); g.addColorStop(1, 'rgba(255,80,0,0)');
    mctx.fillStyle = g; mctx.beginPath(); mctx.arc(cx, cy, cell * 0.45, 0, 7); mctx.fill();
    // spikes
    mctx.strokeStyle = 'rgba(255,220,120,0.8)'; mctx.lineWidth = 4;
    for (let s = 0; s < 6; s++) { const a = (s / 6) * Math.PI * 2 + v; mctx.beginPath(); mctx.moveTo(cx, cy); mctx.lineTo(cx + Math.cos(a) * cell * 0.4, cy + Math.sin(a) * cell * 0.4); mctx.stroke(); }
  }
  return { map: toTexture(map, { srgb: true, wrap: THREE.ClampToEdgeWrapping }) };
};

GEN.spriteAtlas = (rng) => {
  const S = 512;
  const map = makeCanvas(S, S), mctx = map.getContext('2d');
  mctx.clearRect(0, 0, S, S);
  const cell = S / 4;
  const draw = (i, fn) => { const cx = (i % 4) * cell + cell / 2, cy = Math.floor(i / 4) * cell + cell / 2; fn(cx, cy, cell); };
  draw(0, (cx, cy, c) => { const g = mctx.createRadialGradient(cx, cy, 0, cx, cy, c * 0.45); g.addColorStop(0, 'rgba(180,180,180,0.6)'); g.addColorStop(1, 'rgba(120,120,120,0)'); mctx.fillStyle = g; mctx.beginPath(); mctx.arc(cx, cy, c * 0.45, 0, 7); mctx.fill(); }); // smoke
  draw(1, (cx, cy, c) => { mctx.fillStyle = 'rgba(255,220,120,1)'; mctx.beginPath(); mctx.arc(cx, cy, c * 0.1, 0, 7); mctx.fill(); }); // spark
  draw(2, (cx, cy, c) => { const g = mctx.createRadialGradient(cx, cy, 0, cx, cy, c * 0.4); g.addColorStop(0, 'rgba(74,10,10,0.9)'); g.addColorStop(1, 'rgba(74,10,10,0)'); mctx.fillStyle = g; mctx.beginPath(); mctx.arc(cx, cy, c * 0.4, 0, 7); mctx.fill(); }); // blood
  draw(3, (cx, cy, c) => { mctx.fillStyle = 'rgba(150,130,100,0.8)'; mctx.fillRect(cx - c * 0.1, cy - c * 0.1, c * 0.2, c * 0.2); }); // chip
  draw(4, (cx, cy, c) => { const g = mctx.createRadialGradient(cx, cy, 0, cx, cy, c * 0.4); g.addColorStop(0, 'rgba(216,200,160,0.5)'); g.addColorStop(1, 'rgba(216,200,160,0)'); mctx.fillStyle = g; mctx.beginPath(); mctx.arc(cx, cy, c * 0.4, 0, 7); mctx.fill(); }); // dust
  draw(5, (cx, cy, c) => { const g = mctx.createRadialGradient(cx, cy, 0, cx, cy, c * 0.45); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); mctx.fillStyle = g; mctx.beginPath(); mctx.arc(cx, cy, c * 0.45, 0, 7); mctx.fill(); }); // glow
  return { map: toTexture(map, { srgb: true, wrap: THREE.ClampToEdgeWrapping }) };
};

GEN.decalHoles = (rng) => {
  const S = 256;
  const map = makeCanvas(S, S), mctx = map.getContext('2d');
  mctx.clearRect(0, 0, S, S);
  const cell = S / 4;
  for (let i = 0; i < 16; i++) {
    const cx = (i % 4) * cell + cell / 2, cy = Math.floor(i / 4) * cell + cell / 2;
    mctx.fillStyle = 'rgba(10,6,3,0.9)'; mctx.beginPath(); mctx.arc(cx, cy, cell * 0.12 + rng() * 4, 0, 7); mctx.fill();
    mctx.strokeStyle = 'rgba(40,25,12,0.5)'; mctx.lineWidth = 2;
    for (let r = 0; r < 5; r++) { const a = rng() * 7; mctx.beginPath(); mctx.moveTo(cx, cy); mctx.lineTo(cx + Math.cos(a) * cell * 0.2, cy + Math.sin(a) * cell * 0.2); mctx.stroke(); }
  }
  return { map: toTexture(map, { srgb: true, wrap: THREE.ClampToEdgeWrapping }) };
};
GEN.decalBlood = (rng) => {
  const S = 1024;
  const map = makeCanvas(S, S), mctx = map.getContext('2d');
  mctx.clearRect(0, 0, S, S);
  const cell = S / 4;
  for (let i = 0; i < 16; i++) {
    const cx = (i % 4) * cell + cell / 2, cy = Math.floor(i / 4) * cell + cell / 2;
    mctx.fillStyle = 'rgba(74,10,10,0.85)';
    for (let b = 0; b < 8; b++) { const a = rng() * 7, d = rng() * cell * 0.3; mctx.beginPath(); mctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 6 + rng() * 20, 0, 7); mctx.fill(); }
  }
  return { map: toTexture(map, { srgb: true, wrap: THREE.ClampToEdgeWrapping }) };
};
GEN.decalPool = (rng) => {
  const S = 512;
  const map = makeCanvas(S, S), mctx = map.getContext('2d');
  mctx.clearRect(0, 0, S, S);
  const g = mctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(60,8,8,0.9)'); g.addColorStop(0.7, 'rgba(60,8,8,0.6)'); g.addColorStop(1, 'rgba(60,8,8,0)');
  mctx.fillStyle = g; mctx.beginPath(); mctx.arc(S / 2, S / 2, S / 2, 0, 7); mctx.fill();
  return { map: toTexture(map, { srgb: true, wrap: THREE.ClampToEdgeWrapping }) };
};

GEN.glowRadial = (rng) => {
  const S = 128;
  const map = makeCanvas(S, S), mctx = map.getContext('2d');
  const g = mctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.4)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  mctx.fillStyle = g; mctx.fillRect(0, 0, S, S);
  return { map: toTexture(map, { srgb: true, wrap: THREE.ClampToEdgeWrapping }) };
};
GEN.shaftGradient = (rng) => {
  const W = 64, H = 256;
  const map = makeCanvas(W, H), mctx = map.getContext('2d');
  const g = mctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(255,240,200,0.5)'); g.addColorStop(1, 'rgba(255,240,200,0)');
  mctx.fillStyle = g; mctx.fillRect(0, 0, W, H);
  return { map: toTexture(map, { srgb: true, wrap: THREE.ClampToEdgeWrapping }) };
};
GEN.lensStar = (rng) => {
  const S = 256;
  const map = makeCanvas(S, S), mctx = map.getContext('2d');
  mctx.strokeStyle = 'rgba(255,255,255,0.8)'; mctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI; mctx.beginPath(); mctx.moveTo(S / 2 - Math.cos(a) * S / 2, S / 2 - Math.sin(a) * S / 2); mctx.lineTo(S / 2 + Math.cos(a) * S / 2, S / 2 + Math.sin(a) * S / 2); mctx.stroke(); }
  return { map: toTexture(map, { srgb: true, wrap: THREE.ClampToEdgeWrapping }) };
};
GEN.blobShadow = (rng) => {
  const S = 128;
  const map = makeCanvas(S, S), mctx = map.getContext('2d');
  const g = mctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.7)'); g.addColorStop(0.6, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  mctx.fillStyle = g; mctx.fillRect(0, 0, S, S);
  return { map: toTexture(map, { srgb: true, wrap: THREE.ClampToEdgeWrapping }) };
};

// Enemy atlas: skin/cloth/face quadrants.
GEN.enemyAtlas = (rng) => {
  const S = 512;
  const map = makeCanvas(S, S), mctx = map.getContext('2d');
  mctx.fillStyle = '#6a5a44'; mctx.fillRect(0, 0, S, S); // cloth base
  // quadrant 0: skin
  mctx.fillStyle = '#b08058'; mctx.fillRect(0, 0, S / 2, S / 2);
  for (let i = 0; i < 200; i++) { mctx.fillStyle = `rgba(${140 + rng() * 40 | 0},${90 + rng() * 30 | 0},60,0.1)`; mctx.fillRect(rng() * S / 2, rng() * S / 2, 4, 4); }
  // quadrant 1: face
  mctx.fillStyle = '#b08058'; mctx.fillRect(S / 2, 0, S / 2, S / 2);
  mctx.fillStyle = '#20140a'; mctx.fillRect(S / 2 + 60, 80, 20, 8); mctx.fillRect(S / 2 + 140, 80, 20, 8);
  mctx.fillRect(S / 2 + 90, 140, 60, 6);
  // quadrant 2: bandana red
  mctx.fillStyle = '#8a2a2a'; mctx.fillRect(0, S / 2, S / 2, S / 2);
  for (let i = 0; i < 40; i++) { mctx.fillStyle = 'rgba(220,220,220,0.15)'; mctx.beginPath(); mctx.arc(rng() * S / 2, S / 2 + rng() * S / 2, 3, 0, 7); mctx.fill(); }
  // quadrant 3: dark hat/leather
  mctx.fillStyle = '#3a2818'; mctx.fillRect(S / 2, S / 2, S / 2, S / 2);
  return { map: toTexture(map, { srgb: true, wrap: THREE.ClampToEdgeWrapping }) };
};

// ---- Registry ----
export const TEXTURE_NAMES = Object.keys(GEN);

export function getTexture(name, variant = 0) {
  const key = `${name}|${variant}`;
  if (_registry.has(key)) return _registry.get(key);
  const gen = GEN[name];
  if (!gen) { console.warn('unknown texture', name); return null; }
  const t0 = performance.now();
  const rng = rngFor(name + '|' + variant);
  const set = gen(rng, variant);
  _registry.set(key, set);
  _timings[name] = (performance.now() - t0);
  return set;
}

export function getTextureStats() {
  return { count: _registry.size, timings: _timings };
}

export function disposeAllTextures() {
  for (const set of _registry.values()) {
    for (const k in set) if (set[k] && set[k].dispose) set[k].dispose();
  }
  _registry.clear();
}

// helper
function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return '#' + c.getHexString();
}
