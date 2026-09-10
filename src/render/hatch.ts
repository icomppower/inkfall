import * as THREE from 'three';
import { Rng } from '../sim/rng';

/**
 * Procedural brush-hatch texture. Three densities of slightly irregular diagonal
 * strokes packed into R (fine) / G (medium) / B (coarse). Values are close to binary
 * so the cel bands stay readable as flat tone rather than smearing into a gradient.
 */
export function makeHatchTexture(seed: string, size = 512): THREE.DataTexture {
  const rng = new Rng(`hatch:${seed}`);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  const densities: { channel: number; spacing: number; width: number; angle: number; ink: number }[] = [
    { channel: 0, spacing: 26, width: 2.0, angle: -0.72, ink: 0.80 },
    { channel: 1, spacing: 15, width: 2.6, angle: -0.72, ink: 0.74 },
    { channel: 2, spacing: 9,  width: 3.2, angle: -0.66, ink: 0.64 },
  ];

  const layers: Uint8ClampedArray[] = [];
  for (const d of densities) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#000000';
    ctx.lineCap = 'round';
    const diag = size * 1.6;
    const cos = Math.cos(d.angle), sin = Math.sin(d.angle);
    for (let off = -diag; off < diag; off += d.spacing) {
      // A brush stroke: wobbling spine, tapered ends, broken mid-run.
      const segs = 14;
      ctx.beginPath();
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const along = -diag * 0.5 + t * diag;
        const wob = Math.sin(t * 7.3 + off * 0.11) * 2.1 + rng.gauss(0, 0.5);
        const px = size * 0.5 + along * cos - (off + wob) * sin;
        const py = size * 0.5 + along * sin + (off + wob) * cos;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.lineWidth = d.width * rng.range(0.7, 1.35);
      ctx.globalAlpha = rng.range(0.72, 1.0);
      ctx.stroke();
      // Dry-brush skips.
      if (rng.next() < 0.55) {
        ctx.globalCompositeOperation = 'destination-out';
        const gaps = rng.int(1, 4);
        for (let gI = 0; gI < gaps; gI++) {
          const t = rng.next();
          const along = -diag * 0.5 + t * diag;
          const px = size * 0.5 + along * cos - off * sin;
          const py = size * 0.5 + along * sin + off * cos;
          ctx.beginPath();
          ctx.arc(px, py, rng.range(4, 13), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = 1;
    }
    layers.push(ctx.getImageData(0, 0, size, size).data);
  }

  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    for (let c = 0; c < 3; c++) {
      const lum = layers[c][i * 4] / 255;            // 0 = full ink, 1 = paper
      const ink = densities[c].ink;
      data[i * 4 + c] = Math.round(255 * (ink + (1 - ink) * lum));
    }
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
