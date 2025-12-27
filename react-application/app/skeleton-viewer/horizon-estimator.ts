export type RollEstimateOptions = {
  /** Histogram bin size in degrees. Smaller = more precise but noisier. */
  binSizeDeg?: number; // default 1
  /** Smooth histogram with a moving average window (in bins). Must be odd. */
  smoothBins?: number; // default 7
  /** Sample every N pixels (stride) to speed up. */
  sampleStep?: number; // default 2
  /** Ignore weak edges (based on |gx|+|gy|). */
  magThreshold?: number; // default 40
  /** Minimum number of contributing samples; otherwise returns null. */
  minSamples?: number; // default 2000

  /**
   * Region of interest in normalized coords [0..1], useful indoors to
   * de-emphasize floor clutter (e.g. yMin=0, yMax=0.7).
   */
  roi?: { xMin?: number; xMax?: number; yMin?: number; yMax?: number };

  /**
   * If true, try to use the Manhattan-world idea: find two dominant peaks
   * roughly 90° apart, and choose the one closer to 0° as "horizontal".
   */
  useManhattanPair?: boolean; // default true

  /** Refinement window (degrees) around peak for weighted averaging. */
  refineWindowDeg?: number; // default 8
};

export type RollEstimator = (frame: VideoFrame, opts?: RollEstimateOptions) => number | null;

/**
 * Create an estimator that reuses canvas + buffers across calls (recommended for video).
 */
export function createRollEstimator(): RollEstimator {
  // Reusable drawing surface
  let canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;

  // Scratch buffers (reused)
  let gray: Uint8Array | null = null;
  let lastW = 0;
  let lastH = 0;

  function ensureSurface(w: number, h: number) {
    const needNew = !canvas || w !== lastW || h !== lastH;
    if (!needNew) return;

    lastW = w;
    lastH = h;

    // Prefer OffscreenCanvas (works in Workers)
    if (typeof OffscreenCanvas !== "undefined") {
      canvas = new OffscreenCanvas(w, h);
      ctx = canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    } else {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      canvas = c;
      ctx = c.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    }

    gray = new Uint8Array(w * h);
  }

  return function estimateRoll(frame: VideoFrame, opts?: RollEstimateOptions): number | null {
    const binSizeDeg = opts?.binSizeDeg ?? 1;
    const smoothBins = makeOdd(opts?.smoothBins ?? 7);
    const sampleStep = opts?.sampleStep ?? 2;
    const magThreshold = opts?.magThreshold ?? 40;
    const minSamples = opts?.minSamples ?? 2000;
    const useManhattanPair = opts?.useManhattanPair ?? true;
    const refineWindowDeg = opts?.refineWindowDeg ?? 8;

    const w = frame.displayWidth;
    const h = frame.displayHeight;
    ensureSurface(w, h);
    if (!ctx || !canvas || !gray) return null;

    // Draw VideoFrame to canvas. (Supported in modern browsers.)
    // Note: Do NOT close the frame here unless you own it (in a TransformStream you often do).
    ctx.drawImage(frame as any, 0, 0, w, h);

    const img = ctx.getImageData(0, 0, w, h);
    const data = img.data;

    // Convert RGBA -> grayscale (luma)
    // gray[i] = 0.299R + 0.587G + 0.114B (integer approx)
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      gray[i] = (r * 77 + g * 150 + b * 29) >> 8; // 77/256≈0.30, 150/256≈0.59, 29/256≈0.11
    }

    // ROI in pixel coords
    const roi = opts?.roi ?? {};
    const xMin = clampInt(Math.floor((roi.xMin ?? 0) * w), 0, w - 1);
    const xMax = clampInt(Math.floor((roi.xMax ?? 1) * w), 0, w - 1);
    const yMin = clampInt(Math.floor((roi.yMin ?? 0) * h), 0, h - 1);
    const yMax = clampInt(Math.floor((roi.yMax ?? 1) * h), 0, h - 1);

    // Histogram over undirected line angles in [-90, +90]
    const bins = Math.floor(180 / binSizeDeg) + 1;
    const hist = new Float32Array(bins);

    // Sobel on grayscale; we compute gradient (gx, gy), then convert to *line* angle:
    // gradient angle θ = atan2(gy, gx) is normal to edge; line direction = θ + 90°
    let samples = 0;

    // Avoid borders
    const startY = Math.max(1, yMin);
    const endY = Math.min(h - 2, yMax);
    const startX = Math.max(1, xMin);
    const endX = Math.min(w - 2, xMax);

    for (let y = startY; y <= endY; y += sampleStep) {
      const row = y * w;
      for (let x = startX; x <= endX; x += sampleStep) {
        const i = row + x;

        // Sobel kernels:
        // gx = (p(x+1,y-1)+2p(x+1,y)+p(x+1,y+1)) - (p(x-1,y-1)+2p(x-1,y)+p(x-1,y+1))
        // gy = (p(x-1,y+1)+2p(x,y+1)+p(x+1,y+1)) - (p(x-1,y-1)+2p(x,y-1)+p(x+1,y-1))
        const p00 = gray[i - w - 1];
        const p01 = gray[i - w];
        const p02 = gray[i - w + 1];

        const p10 = gray[i - 1];
        const p12 = gray[i + 1];

        const p20 = gray[i + w - 1];
        const p21 = gray[i + w];
        const p22 = gray[i + w + 1];

        const gx = (p02 + 2 * p12 + p22) - (p00 + 2 * p10 + p20);
        const gy = (p20 + 2 * p21 + p22) - (p00 + 2 * p01 + p02);

        const mag = Math.abs(gx) + Math.abs(gy);
        if (mag < magThreshold) continue;

        // Edge normal angle in radians
        const theta = Math.atan2(gy, gx);

        // Convert to line (tangent) direction: +90°
        let lineRad = theta + Math.PI / 2;

        // Normalize to [-pi/2, +pi/2] (undirected line)
        lineRad = normalizeUndirectedHalfPi(lineRad);

        const lineDeg = (lineRad * 180) / Math.PI; // [-90, 90]
        const b = clampInt(Math.round((lineDeg + 90) / binSizeDeg), 0, bins - 1);

        // Weight by magnitude (stronger edges vote more)
        hist[b] += mag;
        samples++;
      }
    }

    if (samples < minSamples) return null;

    // Smooth histogram
    const smoothed = smoothMovingAverage(hist, smoothBins);

    // Peak 1
    let peak1 = 0;
    for (let i = 1; i < bins; i++) if (smoothed[i] > smoothed[peak1]) peak1 = i;

    // Optionally find an orthogonal-ish peak 2 and choose the peak closer to 0°
    let peakAngleDeg = peakIndexToAngleDeg(peak1, binSizeDeg);

    if (useManhattanPair) {
      const suppressed = smoothed.slice() as Float32Array;
      const suppressRadiusBins = Math.max(1, Math.round(10 / binSizeDeg)); // suppress ±10°
      for (let i = Math.max(0, peak1 - suppressRadiusBins); i <= Math.min(bins - 1, peak1 + suppressRadiusBins); i++) {
        suppressed[i] = 0;
      }

      let peak2 = 0;
      for (let i = 1; i < bins; i++) if (suppressed[i] > suppressed[peak2]) peak2 = i;

      const a1 = peakIndexToAngleDeg(peak1, binSizeDeg);
      const a2 = peakIndexToAngleDeg(peak2, binSizeDeg);

      // Choose the one closer to horizontal (0°)
      peakAngleDeg = Math.abs(a1) <= Math.abs(a2) ? a1 : a2;
    }

    // Refine by weighted mean of angles near the chosen peak
    const refineBins = Math.max(1, Math.round(refineWindowDeg / binSizeDeg));
    const peakBin = clampInt(Math.round((peakAngleDeg + 90) / binSizeDeg), 0, bins - 1);

    let wSum = 0;
    let aSum = 0;
    for (let bi = Math.max(0, peakBin - refineBins); bi <= Math.min(bins - 1, peakBin + refineBins); bi++) {
      const wgt = smoothed[bi];
      if (wgt <= 0) continue;
      const a = peakIndexToAngleDeg(bi, binSizeDeg);
      wSum += wgt;
      aSum += a * wgt;
    }

    const refined = wSum > 0 ? aSum / wSum : peakAngleDeg;
    return refined;
  };
}

/** Convenience one-shot function (creates a reusable estimator internally if you don’t want to manage it). */
export function estimateRollFromVideoFrame(frame: VideoFrame, opts?: RollEstimateOptions): number | null {
  return createRollEstimator()(frame, opts);
}

// -------------------- helpers --------------------

function makeOdd(n: number): number {
  const k = Math.max(1, Math.floor(n));
  return k % 2 === 1 ? k : k + 1;
}

function clampInt(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x | 0));
}

/** Map any angle to an undirected line angle in [-pi/2, +pi/2]. */
function normalizeUndirectedHalfPi(rad: number): number {
  // First wrap to [-pi, +pi]
  rad = ((rad + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

  // Undirected: angles separated by pi are equivalent -> fold into [-pi/2, +pi/2]
  if (rad > Math.PI / 2) rad -= Math.PI;
  if (rad < -Math.PI / 2) rad += Math.PI;
  return rad;
}

function peakIndexToAngleDeg(idx: number, binSizeDeg: number): number {
  return idx * binSizeDeg - 90;
}

function smoothMovingAverage(src: Float32Array, windowBins: number): Float32Array {
  const n = src.length;
  const w = Math.max(1, windowBins | 0);
  if (w === 1) return src.slice() as Float32Array;

  const half = (w / 2) | 0;
  const out = new Float32Array(n);

  // prefix sum for O(n)
  const pref = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) pref[i + 1] = pref[i] + src[i];

  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n - 1, i + half);
    const sum = pref[b + 1] - pref[a];
    out[i] = sum / (b - a + 1);
  }
  return out;
}

