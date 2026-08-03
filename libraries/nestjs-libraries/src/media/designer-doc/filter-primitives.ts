/**
 * The handful of pixel routines every Photoshop-style filter is built from.
 *
 * 47 filters share maybe six algorithms between them — a separable blur, a
 * convolution, a displacement remap, a rank window, a cell field and a
 * deterministic noise source. Writing those once here is what keeps the filter
 * module itself readable, and it means a bug in (say) edge handling is fixed in
 * one place rather than forty.
 *
 * Everything is pure and DOM-free so it can run in a Web Worker, in Node tests,
 * and on the main thread as a fallback without changing.
 */

export interface PixelBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export const cloneBuffer = (buf: PixelBuffer): PixelBuffer => ({
  width: buf.width,
  height: buf.height,
  data: new Uint8ClampedArray(buf.data),
});

export const emptyBuffer = (width: number, height: number): PixelBuffer => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height * 4),
});

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * Sample with edge CLAMPING.
 *
 * Every spatial filter needs a rule for reading outside the image; clamping
 * (repeat the edge pixel) is what Photoshop does and it avoids the dark halo
 * that treating outside as transparent would produce.
 */
export const sampleClamped = (
  buf: PixelBuffer,
  x: number,
  y: number,
  out: number[]
): void => {
  const sx = clamp(x | 0, 0, buf.width - 1);
  const sy = clamp(y | 0, 0, buf.height - 1);
  const i = (sy * buf.width + sx) * 4;
  out[0] = buf.data[i];
  out[1] = buf.data[i + 1];
  out[2] = buf.data[i + 2];
  out[3] = buf.data[i + 3];
};

/** Bilinear sample at fractional coordinates — the basis of every distortion. */
export const sampleBilinear = (
  buf: PixelBuffer,
  x: number,
  y: number,
  out: number[]
): void => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;

  const a: number[] = [0, 0, 0, 0];
  const b: number[] = [0, 0, 0, 0];
  const c: number[] = [0, 0, 0, 0];
  const d: number[] = [0, 0, 0, 0];
  sampleClamped(buf, x0, y0, a);
  sampleClamped(buf, x0 + 1, y0, b);
  sampleClamped(buf, x0, y0 + 1, c);
  sampleClamped(buf, x0 + 1, y0 + 1, d);

  for (let k = 0; k < 4; k++) {
    const top = a[k] + (b[k] - a[k]) * fx;
    const bottom = c[k] + (d[k] - c[k]) * fx;
    out[k] = top + (bottom - top) * fy;
  }
};

/**
 * One-dimensional box blur, run in place over a scratch buffer.
 *
 * Three box passes approximate a Gaussian closely enough that Photoshop itself
 * does the same thing, and a box pass is O(1) per pixel via a running sum —
 * which is what makes a 200px radius blur feasible at all.
 *
 * RGB is accumulated PREMULTIPLIED: a fully transparent pixel's (often stale)
 * colour must not bleed into its neighbours, or every blurred logo on
 * transparency grows a dark halo. For opaque pixels the weighted mean reduces
 * to the plain average, so opaque renders are unchanged.
 */
const boxPass = (
  src: PixelBuffer,
  dst: PixelBuffer,
  radius: number,
  horizontal: boolean
): void => {
  const { width: w, height: h } = src;
  const r = Math.max(0, Math.round(radius));
  if (r === 0) {
    dst.data.set(src.data);
    return;
  }
  const span = r * 2 + 1;
  const outer = horizontal ? h : w;
  const inner = horizontal ? w : h;

  for (let o = 0; o < outer; o++) {
    const at = (i: number) =>
      ((horizontal ? o * w + clamp(i, 0, inner - 1) : clamp(i, 0, inner - 1) * w + o)) * 4;

    let sr = 0, sg = 0, sb = 0, sa = 0;
    // Seed the window, clamping at the leading edge.
    for (let i = -r; i <= r; i++) {
      const p = at(i);
      const a = src.data[p + 3];
      sr += src.data[p] * a;
      sg += src.data[p + 1] * a;
      sb += src.data[p + 2] * a;
      sa += a;
    }

    for (let i = 0; i < inner; i++) {
      const p = at(i);
      // sr/sa is the alpha-weighted mean colour (sa > 0 whenever any pixel in
      // the window is visible); alpha itself averages normally.
      dst.data[p] = sa > 0 ? sr / sa : 0;
      dst.data[p + 1] = sa > 0 ? sg / sa : 0;
      dst.data[p + 2] = sa > 0 ? sb / sa : 0;
      dst.data[p + 3] = sa / span;

      const leaving = at(i - r);
      const entering = at(i + r + 1);
      const aIn = src.data[entering + 3];
      const aOut = src.data[leaving + 3];
      sr += src.data[entering] * aIn - src.data[leaving] * aOut;
      sg += src.data[entering + 1] * aIn - src.data[leaving + 1] * aOut;
      sb += src.data[entering + 2] * aIn - src.data[leaving + 2] * aOut;
      sa += aIn - aOut;
    }
  }
};

/** Separable box blur — one horizontal pass, one vertical. */
export const boxBlur = (buf: PixelBuffer, radiusX: number, radiusY = radiusX): void => {
  const scratch = emptyBuffer(buf.width, buf.height);
  boxPass(buf, scratch, radiusX, true);
  boxPass(scratch, buf, radiusY, false);
};

/**
 * Gaussian blur, as three box passes.
 *
 * The box radius for a given sigma comes from the standard approximation
 * (Wells' method); three passes get within ~3% of a true Gaussian, which is
 * indistinguishable by eye and orders of magnitude faster than a real kernel at
 * large radii.
 */
export const gaussianBlur = (buf: PixelBuffer, sigma: number): void => {
  if (sigma <= 0) return;
  const boxRadius = Math.max(1, Math.round((sigma * 3 * Math.sqrt(2 * Math.PI)) / 4 - 0.5) >> 1);
  for (let pass = 0; pass < 3; pass++) boxBlur(buf, boxRadius);
};

/**
 * Convolve with an arbitrary kernel.
 *
 * `divisor`/`bias` follow Photoshop's Custom filter convention so the sharpen
 * and emboss kernels read exactly as they are documented.
 */
export const convolve = (
  buf: PixelBuffer,
  kernel: number[],
  size: number,
  divisor = 0,
  bias = 0,
  /** Emboss-style kernels want alpha left alone. */
  preserveAlpha = true
): void => {
  const src = cloneBuffer(buf);
  const half = (size - 1) / 2;
  const div = divisor || kernel.reduce((a, b) => a + b, 0) || 1;
  const px: number[] = [0, 0, 0, 0];

  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let ky = 0; ky < size; ky++) {
        for (let kx = 0; kx < size; kx++) {
          const weight = kernel[ky * size + kx];
          if (!weight) continue;
          sampleClamped(src, x + kx - half, y + ky - half, px);
          r += px[0] * weight;
          g += px[1] * weight;
          b += px[2] * weight;
          a += px[3] * weight;
        }
      }
      const i = (y * buf.width + x) * 4;
      buf.data[i] = r / div + bias;
      buf.data[i + 1] = g / div + bias;
      buf.data[i + 2] = b / div + bias;
      buf.data[i + 3] = preserveAlpha ? src.data[i + 3] : a / div + bias;
    }
  }
};

/**
 * Remap every pixel through a coordinate function — the whole Distort family.
 *
 * `map` receives destination coordinates and returns where to READ from, which
 * is the direction that avoids holes: pulling from the source always fills every
 * destination pixel, pushing to the destination does not.
 */
export const remap = (
  buf: PixelBuffer,
  map: (x: number, y: number) => { x: number; y: number },
  /** Wrap instead of clamping at the edges (Polar Coordinates wants this). */
  wrap = false
): void => {
  const src = cloneBuffer(buf);
  const px: number[] = [0, 0, 0, 0];

  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      const p = map(x, y);
      let sx = p.x;
      let sy = p.y;
      if (wrap) {
        sx = ((sx % buf.width) + buf.width) % buf.width;
        sy = ((sy % buf.height) + buf.height) % buf.height;
      }
      sampleBilinear(src, sx, sy, px);
      const i = (y * buf.width + x) * 4;
      buf.data[i] = px[0];
      buf.data[i + 1] = px[1];
      buf.data[i + 2] = px[2];
      buf.data[i + 3] = px[3];
    }
  }
};

/**
 * Rank filter over a square window — median at rank 0.5, min at 0, max at 1.
 *
 * Median, Despeckle and Dust & Scratches are all this with different radii and
 * thresholds.
 */
export const rankFilter = (
  buf: PixelBuffer,
  radius: number,
  rank = 0.5,
  /** Only replace a pixel when it differs from the rank by more than this. */
  threshold = 0
): void => {
  const r = Math.max(1, Math.round(radius));
  const src = cloneBuffer(buf);
  const span = r * 2 + 1;
  const count = span * span;
  const window = [new Uint8Array(count), new Uint8Array(count), new Uint8Array(count)];
  const index = clamp(Math.round(rank * (count - 1)), 0, count - 1);

  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const sx = clamp(x + dx, 0, buf.width - 1);
          const sy = clamp(y + dy, 0, buf.height - 1);
          const p = (sy * buf.width + sx) * 4;
          window[0][n] = src.data[p];
          window[1][n] = src.data[p + 1];
          window[2][n] = src.data[p + 2];
          n++;
        }
      }
      const i = (y * buf.width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const sorted = window[c].slice(0, n).sort();
        const value = sorted[index];
        // Below the threshold the original pixel is kept, which is what makes
        // Dust & Scratches remove specks without softening everything else.
        buf.data[i + c] =
          threshold > 0 && Math.abs(value - src.data[i + c]) <= threshold
            ? src.data[i + c]
            : value;
      }
    }
  }
};

/**
 * Deterministic pseudo-random in [0,1) from an integer.
 *
 * Filters must be reproducible: the same document filtered twice has to give
 * the same pixels, or an export would never match the canvas. `Math.random` is
 * banned here for that reason.
 */
export const hashRandom = (seed: number): number => {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Gaussian-distributed noise from the same deterministic source. */
export const hashGaussian = (seed: number): number => {
  const u = Math.max(1e-9, hashRandom(seed));
  const v = hashRandom(seed ^ 0x5f356495);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

export interface Cell {
  x: number;
  y: number;
}

/**
 * A jittered grid of cell centres — the basis of Crystallize, Pointillize and
 * Mosaic.
 *
 * Jittered rather than Poisson-disc: the visual difference is slight and this
 * is deterministic and O(cells) rather than O(cells · attempts).
 */
export const cellField = (
  width: number,
  height: number,
  cellSize: number,
  seed = 0
): Cell[] => {
  const size = Math.max(2, Math.round(cellSize));
  const cols = Math.ceil(width / size) + 1;
  const rows = Math.ceil(height / size) + 1;
  const cells: Cell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const id = row * cols + col + seed * 7919;
      cells.push({
        x: (col + hashRandom(id)) * size - size / 2,
        y: (row + hashRandom(id ^ 0x1234)) * size - size / 2,
      });
    }
  }
  return cells;
};

/**
 * For each pixel, the nearest cell centre.
 *
 * Only the 3×3 block of grid cells around a pixel can contain its nearest
 * centre, so this stays linear instead of comparing against every cell.
 */
export const nearestCellMap = (
  width: number,
  height: number,
  cellSize: number,
  seed = 0
): Int32Array => {
  const size = Math.max(2, Math.round(cellSize));
  const cols = Math.ceil(width / size) + 1;
  const cells = cellField(width, height, cellSize, seed);
  const out = new Int32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const col = Math.floor(x / size);
      const row = Math.floor(y / size);
      let best = -1;
      let bestDist = Infinity;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const idx = (row + dr) * cols + (col + dc);
          const cell = cells[idx];
          if (!cell) continue;
          const dist = (cell.x - x) ** 2 + (cell.y - y) ** 2;
          if (dist < bestDist) {
            bestDist = dist;
            best = idx;
          }
        }
      }
      out[y * width + x] = best;
    }
  }
  return out;
};

/** Per-channel luminance, matching `pixel-ops`' weighting. */
export const luminance = (r: number, g: number, b: number): number =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;
