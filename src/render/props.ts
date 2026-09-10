import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../sim/rng';

/** Every prop in the game is generated here. No model files, ever. */

function faceted(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const f = g.index ? g.toNonIndexed() : g;
  f.computeVertexNormals();
  return f;
}

function place(g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1): THREE.BufferGeometry {
  g.scale(sx, sy, sz);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

/** A faceted layered-canopy tree. detail 0 = near, 2 = far ridge silhouette. */
export function makeTree(rng: Rng, detail: 0 | 1 | 2): THREE.BufferGeometry {
  const h = rng.range(5.5, 9.8);
  const parts: THREE.BufferGeometry[] = [];
  const trunkSeg = detail === 0 ? 7 : detail === 1 ? 5 : 3;
  parts.push(place(new THREE.CylinderGeometry(h * 0.022, h * 0.055, h * 0.52, trunkSeg, 1), 0, h * 0.26, 0));
  const layers = detail === 0 ? 4 : detail === 1 ? 2 : 1;
  const sides = detail === 0 ? 7 : detail === 1 ? 5 : 4;
  for (let i = 0; i < layers; i++) {
    const t = i / Math.max(1, layers - 1 || 1);
    const r = h * (0.34 - 0.17 * t) * rng.range(0.85, 1.15);
    const ch = h * (0.30 - 0.08 * t);
    const y = h * (0.42 + 0.44 * t);
    const g = new THREE.ConeGeometry(r, ch, sides, 1);
    place(g, 0, y, 0, rng.range(0, Math.PI));
    parts.push(g);
  }
  return faceted(mergeGeometries(parts, false)!);
}

/** One bamboo culm plus a handful of leaf blades. */
export function makeBamboo(rng: Rng, detail: 0 | 1): THREE.BufferGeometry {
  const h = rng.range(7, 13);
  const r = rng.range(0.075, 0.125);
  const parts: THREE.BufferGeometry[] = [];
  const nodes = detail === 0 ? 5 : 3;
  for (let i = 0; i < nodes; i++) {
    const y0 = (i / nodes) * h;
    const seg = h / nodes;
    const g = new THREE.CylinderGeometry(r * (1 - i * 0.08), r * (1 - (i - 1) * 0.08), seg * 0.97, detail === 0 ? 6 : 4, 1);
    place(g, 0, y0 + seg * 0.5, 0);
    parts.push(g);
  }
  const leaves = detail === 0 ? 5 : 2;
  for (let i = 0; i < leaves; i++) {
    const g = new THREE.PlaneGeometry(rng.range(0.34, 0.72), rng.range(0.05, 0.09));
    g.rotateZ(rng.range(-1.25, -0.55));
    g.rotateY(rng.range(0, Math.PI * 2));
    g.translate(0, h * rng.range(0.55, 0.98), 0);
    parts.push(g);
  }
  return faceted(mergeGeometries(parts, false)!);
}

/** Noise-displaced icosahedron: a boulder. */
export function makeBoulder(rng: Rng, detail: 0 | 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail === 0 ? 1 : 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const k = 1 + rng.gauss(0, 0.10);
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.74, pos.getZ(i) * k);
  }
  pos.needsUpdate = true;
  g.scale(rng.range(0.7, 1.6), rng.range(0.6, 1.2), rng.range(0.7, 1.6));
  return faceted(g);
}

/** A tuft of 芒草 silvergrass: crossed blades that sway. uv.y carries the sway weight. */
export function makeGrassTuft(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const blades = rng.int(3, 6);
  for (let i = 0; i < blades; i++) {
    const h = rng.range(0.55, 1.15);
    const g = new THREE.PlaneGeometry(rng.range(0.05, 0.10), h, 1, 2);
    g.translate(0, h * 0.5, 0);
    g.rotateZ(rng.range(-0.28, 0.28));
    g.rotateY(rng.range(0, Math.PI));
    g.translate(rng.gauss(0, 0.16), 0, rng.gauss(0, 0.16));
    parts.push(g);
  }
  const merged = mergeGeometries(parts, false)!;
  // Rebuild uv.y as height above the ground so the sway is anchored at the root.
  const pos = merged.attributes.position as THREE.BufferAttribute;
  const uv = merged.attributes.uv as THREE.BufferAttribute;
  let maxY = 0.001;
  for (let i = 0; i < pos.count; i++) maxY = Math.max(maxY, pos.getY(i));
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), pos.getY(i) / maxY);
  uv.needsUpdate = true;
  merged.computeVertexNormals();
  return merged;
}

/** 大帽山 radar station: apron, drum, white radome. */
export function makeRadome(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(place(new THREE.CylinderGeometry(9.5, 10.5, 1.2, 16, 1), 0, 0.6, 0));
  parts.push(place(new THREE.CylinderGeometry(6.2, 6.6, 6.5, 14, 1), 0, 4.4, 0));
  const dome = new THREE.SphereGeometry(6.4, 16, 9, 0, Math.PI * 2, 0, Math.PI * 0.52);
  parts.push(place(dome, 0, 7.6, 0));
  parts.push(place(new THREE.BoxGeometry(1.1, 3.4, 1.1), 7.4, 1.7, 3.2));
  return faceted(mergeGeometries(parts, false)!);
}

/** Dry-stone terrace wall segment, length along local X. */
export function makeTerraceWall(rng: Rng, length: number, height: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const n = Math.max(3, Math.round(length / 1.1));
  for (let i = 0; i < n; i++) {
    const w = length / n;
    const g = new THREE.BoxGeometry(w * rng.range(0.86, 1.0), height * rng.range(0.82, 1.05), rng.range(0.5, 0.8));
    place(g, -length * 0.5 + (i + 0.5) * w, height * 0.5 + rng.gauss(0, height * 0.04), rng.gauss(0, 0.08));
    parts.push(g);
  }
  return faceted(mergeGeometries(parts, false)!);
}

/** Timber footbridge over the 竹林峽 stream. */
export function makeFootbridge(length: number, width: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const planks = Math.round(length / 0.42);
  for (let i = 0; i < planks; i++) {
    const g = new THREE.BoxGeometry(width, 0.09, 0.34);
    place(g, 0, 0, -length * 0.5 + (i + 0.5) * (length / planks));
    parts.push(g);
  }
  for (const side of [-1, 1]) {
    parts.push(place(new THREE.BoxGeometry(0.10, 0.10, length), side * width * 0.5, 0.92, 0));
    for (let i = 0; i <= 5; i++) {
      parts.push(place(new THREE.BoxGeometry(0.09, 0.95, 0.09), side * width * 0.5, 0.47, -length * 0.5 + (i / 5) * length));
    }
    parts.push(place(new THREE.BoxGeometry(0.14, 0.16, length), side * width * 0.5, -0.10, 0));
  }
  return faceted(mergeGeometries(parts, false)!);
}

/** Flat ink figure — a villager watching the finish. */
export function makeCrowdFigure(rng: Rng): THREE.BufferGeometry {
  const h = rng.range(1.55, 1.85);
  const shape = new THREE.Shape();
  const w = h * 0.17;
  shape.moveTo(-w, 0);
  shape.lineTo(-w * 0.85, h * 0.52);
  shape.lineTo(-w * 1.5, h * 0.60);
  shape.lineTo(-w * 0.72, h * 0.72);
  shape.lineTo(-w * 0.5, h * 0.80);
  shape.absarc(0, h * 0.88, w * 0.55, Math.PI, 0, true);
  shape.lineTo(w * 0.5, h * 0.80);
  shape.lineTo(w * 0.72, h * 0.72);
  shape.lineTo(w * 1.5, h * 0.60);
  shape.lineTo(w * 0.85, h * 0.52);
  shape.lineTo(w, 0);
  shape.lineTo(w * 0.28, 0);
  shape.lineTo(w * 0.24, h * 0.42);
  shape.lineTo(-w * 0.24, h * 0.42);
  shape.lineTo(-w * 0.28, 0);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false });
  g.translate(0, 0, -0.03);
  return faceted(g);
}

/** Signpost: two legs and a board that carries a drawn character texture. */
export function makeSignpost(boardW: number, boardH: number): { post: THREE.BufferGeometry; board: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) parts.push(place(new THREE.BoxGeometry(0.10, 2.2, 0.10), s * boardW * 0.32, 1.1, 0));
  const board = new THREE.PlaneGeometry(boardW, boardH);
  board.translate(0, 2.2 + boardH * 0.5 - 0.25, 0.055);
  return { post: faceted(mergeGeometries(parts, false)!), board };
}

/** Canvas-drawn Chinese characters → texture. Uses the system CJK font stack. */
export function makeTextTexture(text: string, opts: {
  width?: number; height?: number; ink?: string; paper?: string; vertical?: boolean;
  border?: boolean; alpha?: boolean;
} = {}): THREE.CanvasTexture {
  const w = opts.width ?? 256;
  const h = opts.height ?? 256;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  if (opts.alpha) ctx.clearRect(0, 0, w, h);
  else { ctx.fillStyle = opts.paper ?? '#efeade'; ctx.fillRect(0, 0, w, h); }
  ctx.fillStyle = opts.ink ?? '#1b1b1e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const chars = [...text];
  if (opts.vertical) {
    const size = Math.min(h / (chars.length + 0.4), w * 0.78);
    ctx.font = `700 ${size}px "PingFang HK", "Hiragino Sans", "Noto Sans CJK HK", "Heiti SC", serif`;
    chars.forEach((c, i) => ctx.fillText(c, w * 0.5, (h / chars.length) * (i + 0.5)));
  } else {
    const size = Math.min(w / (chars.length + 0.35), h * 0.7);
    ctx.font = `700 ${size}px "PingFang HK", "Hiragino Sans", "Noto Sans CJK HK", "Heiti SC", serif`;
    chars.forEach((c, i) => ctx.fillText(c, (w / chars.length) * (i + 0.5), h * 0.52));
  }
  if (opts.border) {
    ctx.strokeStyle = opts.ink ?? '#1b1b1e';
    ctx.lineWidth = Math.max(2, w * 0.012);
    ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, w - ctx.lineWidth * 2, h - ctx.lineWidth * 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}
