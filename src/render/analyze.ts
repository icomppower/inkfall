/** Frame analysis used by the kill gates: cel banding and ink-line coverage. */

export interface FrameAnalysis {
  width: number;
  height: number;
  peaks: number;
  peakBins: number[];
  edgeRatio: number;
  meanLuma: number;
  distinctLevels: number;
}

export function analyzeCanvas(src: HTMLCanvasElement, maxDim = 640): FrameAnalysis {
  const scale = Math.min(1, maxDim / Math.max(src.width, src.height));
  const w = Math.max(2, Math.round(src.width * scale));
  const h = Math.max(2, Math.round(src.height * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h).data;

  const luma = new Float32Array(w * h);
  const hist = new Float64Array(64);
  let sum = 0;
  for (let i = 0; i < w * h; i++) {
    const l = (0.2126 * img[i * 4] + 0.7152 * img[i * 4 + 1] + 0.0722 * img[i * 4 + 2]) / 255;
    luma[i] = l;
    hist[Math.min(63, Math.floor(l * 64))]++;
    sum += l;
  }

  // Light smoothing, then strict local maxima carrying real weight.
  const sm = new Float64Array(64);
  for (let i = 0; i < 64; i++) {
    sm[i] = (hist[Math.max(0, i - 1)] + 2 * hist[i] + hist[Math.min(63, i + 1)]) / 4;
  }
  const total = w * h;
  const peakBins: number[] = [];
  for (let i = 1; i < 63; i++) {
    if (sm[i] < total * 0.012) continue;
    if (sm[i] > sm[i - 1] && sm[i] >= sm[i + 1]) {
      if (peakBins.length && i - peakBins[peakBins.length - 1] < 2) continue;
      peakBins.push(i);
    }
  }
  let distinctLevels = 0;
  for (let i = 0; i < 64; i++) if (sm[i] > total * 0.008) distinctLevels++;

  // Sobel over luminance.
  let edges = 0;
  const at = (x: number, y: number) => luma[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx = -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)
                 + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
      const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)
                 + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      if (Math.hypot(gx, gy) > 0.28) edges++;
    }
  }

  return {
    width: w, height: h,
    peaks: peakBins.length,
    peakBins,
    edgeRatio: edges / ((w - 2) * (h - 2)),
    meanLuma: sum / total,
    distinctLevels,
  };
}
