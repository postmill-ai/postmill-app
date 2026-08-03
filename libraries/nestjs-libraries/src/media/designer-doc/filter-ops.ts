import {
  boxBlur,
  gaussianBlur,
  convolve,
  remap,
  rankFilter,
  cloneBuffer,
  sampleClamped,
  sampleBilinear,
  hashRandom,
  hashGaussian,
  nearestCellMap,
  cellField,
  luminance,
  clamp,
  type PixelBuffer,
} from './filter-primitives';
import { filterById } from './filter-descriptors';

/**
 * The Filter menu, as pure pixel operations.
 *
 * Same contract as `applyAdjustment` in `pixel-ops`: mutate the buffer in place,
 * no DOM, no randomness that isn't seeded. That is what lets these run in a Web
 * Worker, be unit-tested without a canvas, and produce the same pixels every
 * time — a filter that drifted between runs would make an export disagree with
 * the canvas that produced it.
 *
 * Nearly all of the actual maths lives in `filter-primitives`; this module is
 * mostly about which primitive each Photoshop filter is, and with what numbers.
 */

export type FilterParams = Record<string, number | string | boolean>;

const num = (p: FilterParams, key: string, fallback: number): number => {
  const v = p[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};
const str = (p: FilterParams, key: string, fallback: string): string => {
  const v = p[key];
  return typeof v === 'string' ? v : fallback;
};
const bool = (p: FilterParams, key: string, fallback = false): boolean => {
  const v = p[key];
  return typeof v === 'boolean' ? v : fallback;
};

// ── Blur ────────────────────────────────────────────────────────────────────

/** Directional blur: average along a line through each pixel. */
const motionBlur = (buf: PixelBuffer, angleDeg: number, distance: number): void => {
  const src = cloneBuffer(buf);
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = -Math.sin(rad);
  const steps = Math.max(1, Math.round(distance));
  const half = steps / 2;
  const px: number[] = [0, 0, 0, 0];

  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let s = 0; s < steps; s++) {
        const t = s - half;
        sampleBilinear(src, x + dx * t, y + dy * t, px);
        r += px[0]; g += px[1]; b += px[2]; a += px[3];
      }
      const i = (y * buf.width + x) * 4;
      buf.data[i] = r / steps;
      buf.data[i + 1] = g / steps;
      buf.data[i + 2] = b / steps;
      buf.data[i + 3] = a / steps;
    }
  }
};

/** Spin or zoom about the centre, by averaging along the motion arc/ray. */
const radialBlur = (buf: PixelBuffer, amount: number, method: string): void => {
  const src = cloneBuffer(buf);
  const cx = buf.width / 2;
  const cy = buf.height / 2;
  const steps = Math.max(2, Math.round(amount / 2) + 2);
  const px: number[] = [0, 0, 0, 0];

  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      const ox = x - cx;
      const oy = y - cy;
      let r = 0, g = 0, b = 0, a = 0;
      for (let s = 0; s < steps; s++) {
        const t = s / (steps - 1) - 0.5;
        let sx: number;
        let sy: number;
        if (method === 'zoom') {
          const scale = 1 + (t * amount) / 200;
          sx = cx + ox * scale;
          sy = cy + oy * scale;
        } else {
          const theta = (t * amount * Math.PI) / 180;
          const cos = Math.cos(theta);
          const sin = Math.sin(theta);
          sx = cx + ox * cos - oy * sin;
          sy = cy + ox * sin + oy * cos;
        }
        sampleBilinear(src, sx, sy, px);
        r += px[0]; g += px[1]; b += px[2]; a += px[3];
      }
      const i = (y * buf.width + x) * 4;
      buf.data[i] = r / steps;
      buf.data[i + 1] = g / steps;
      buf.data[i + 2] = b / steps;
      buf.data[i + 3] = a / steps;
    }
  }
};

/** Offsets forming the requested kernel shape, for Shape and Lens blur. */
const shapeOffsets = (shape: string, radius: number): { dx: number; dy: number }[] => {
  const r = Math.max(1, Math.round(radius));
  const out: { dx: number; dy: number }[] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = dx / r;
      const ny = dy / r;
      let inside: boolean;
      switch (shape) {
        case 'circle':
          inside = nx * nx + ny * ny <= 1;
          break;
        case 'diamond':
          inside = Math.abs(nx) + Math.abs(ny) <= 1;
          break;
        case 'cross':
          inside = Math.abs(dx) <= 1 || Math.abs(dy) <= 1;
          break;
        case 'hexagon': {
          const ax = Math.abs(nx);
          const ay = Math.abs(ny);
          inside = ay <= 0.866 && ax * 0.5 + ay * 0.866 <= 0.866 && ax <= 1;
          break;
        }
        case 'octagon':
          inside = Math.abs(nx) <= 1 && Math.abs(ny) <= 1 && Math.abs(nx) + Math.abs(ny) <= 1.4;
          break;
        default:
          inside = true; // square
      }
      if (inside) out.push({ dx, dy });
    }
  }
  return out;
};

const shapedBlur = (buf: PixelBuffer, shape: string, radius: number, brightness = 0): void => {
  const offsets = shapeOffsets(shape, radius);
  if (offsets.length <= 1) return;
  const src = cloneBuffer(buf);
  // Specular highlights: weight brighter samples more, so points of light bloom
  // into the iris shape the way a real lens renders them.
  const gain = 1 + brightness / 25;

  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (const o of offsets) {
        const sx = clamp(x + o.dx, 0, buf.width - 1);
        const sy = clamp(y + o.dy, 0, buf.height - 1);
        const p = (sy * buf.width + sx) * 4;
        const w =
          brightness > 0
            ? Math.pow(luminance(src.data[p], src.data[p + 1], src.data[p + 2]) / 255 + 0.01, gain)
            : 1;
        r += src.data[p] * w;
        g += src.data[p + 1] * w;
        b += src.data[p + 2] * w;
        a += src.data[p + 3] * w;
        wsum += w;
      }
      const i = (y * buf.width + x) * 4;
      buf.data[i] = r / wsum;
      buf.data[i + 1] = g / wsum;
      buf.data[i + 2] = b / wsum;
      buf.data[i + 3] = a / wsum;
    }
  }
};

/**
 * Edge-preserving blur — the shared engine behind Surface Blur and Smart Blur.
 *
 * A neighbour only contributes if it is within `threshold` of the centre pixel,
 * so flat areas smooth out while edges stay put.
 */
const bilateralBlur = (buf: PixelBuffer, radius: number, threshold: number): void => {
  const r = Math.max(1, Math.round(radius));
  const src = cloneBuffer(buf);

  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      const ci = (y * buf.width + x) * 4;
      const cl = luminance(src.data[ci], src.data[ci + 1], src.data[ci + 2]);
      let r0 = 0, g0 = 0, b0 = 0, w = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const sx = clamp(x + dx, 0, buf.width - 1);
          const sy = clamp(y + dy, 0, buf.height - 1);
          const p = (sy * buf.width + sx) * 4;
          const l = luminance(src.data[p], src.data[p + 1], src.data[p + 2]);
          if (Math.abs(l - cl) > threshold) continue;
          r0 += src.data[p];
          g0 += src.data[p + 1];
          b0 += src.data[p + 2];
          w++;
        }
      }
      if (!w) continue;
      buf.data[ci] = r0 / w;
      buf.data[ci + 1] = g0 / w;
      buf.data[ci + 2] = b0 / w;
    }
  }
};

// ── Distort ─────────────────────────────────────────────────────────────────

/** Procedural stand-ins for Photoshop's displacement-map files. */
const displacementAt = (
  map: string,
  x: number,
  y: number,
  w: number,
  h: number
): { dx: number; dy: number } => {
  switch (map) {
    case 'ripples': {
      const cx = w / 2;
      const cy = h / 2;
      const d = Math.hypot(x - cx, y - cy);
      const wave = Math.sin(d / 8);
      return { dx: wave, dy: wave };
    }
    case 'noise':
      return {
        dx: hashRandom((y * w + x) * 2) * 2 - 1,
        dy: hashRandom((y * w + x) * 2 + 1) * 2 - 1,
      };
    case 'grid':
      return {
        dx: (x % 32) / 16 - 1,
        dy: (y % 32) / 16 - 1,
      };
    default: // waves
      return { dx: Math.sin(y / 12), dy: Math.cos(x / 12) };
  }
};

const RIPPLE_SIZES: Record<string, number> = { small: 6, medium: 14, large: 32 };

// ── Pixelate ────────────────────────────────────────────────────────────────

/** Average colour per cell — Crystallize, Mosaic and Pointillize all need it. */
const cellAverages = (
  buf: PixelBuffer,
  map: Int32Array
): Map<number, [number, number, number, number]> => {
  const sums = new Map<number, [number, number, number, number, number]>();
  for (let i = 0, px = 0; i < buf.data.length; i += 4, px++) {
    const cell = map[px];
    let acc = sums.get(cell);
    if (!acc) {
      acc = [0, 0, 0, 0, 0];
      sums.set(cell, acc);
    }
    acc[0] += buf.data[i];
    acc[1] += buf.data[i + 1];
    acc[2] += buf.data[i + 2];
    acc[3] += buf.data[i + 3];
    acc[4]++;
  }
  const out = new Map<number, [number, number, number, number]>();
  sums.forEach((acc, cell) => {
    out.set(cell, [acc[0] / acc[4], acc[1] / acc[4], acc[2] / acc[4], acc[3] / acc[4]]);
  });
  return out;
};

/** One screened halftone channel, rotated by its own angle. */
const halftoneChannel = (
  src: PixelBuffer,
  dst: PixelBuffer,
  channel: number,
  radius: number,
  angleDeg: number
): void => {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cell = Math.max(2, radius);

  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      // Rotate into screen space, find the nearest screen dot, and shade by how
      // far inside it this pixel falls.
      const rx = x * cos + y * sin;
      const ry = -x * sin + y * cos;
      const gx = Math.round(rx / cell) * cell;
      const gy = Math.round(ry / cell) * cell;
      const ox = gx * cos - gy * sin;
      const oy = gx * sin + gy * cos;

      const si = ((clamp(Math.round(oy), 0, src.height - 1)) * src.width +
        clamp(Math.round(ox), 0, src.width - 1)) * 4;
      const level = src.data[si + channel] / 255;
      const dotRadius = Math.sqrt(level) * (cell / 2) * 1.4;
      const dist = Math.hypot(rx - gx, ry - gy);

      const i = (y * src.width + x) * 4;
      dst.data[i + channel] = dist <= dotRadius ? 255 : 0;
    }
  }
};

// ── Stylize ─────────────────────────────────────────────────────────────────

/** Kuwahara: the quadrant with the least variance wins — Oil Paint's engine. */
const kuwahara = (buf: PixelBuffer, radius: number, levels: number): void => {
  const r = Math.max(1, Math.round(radius));
  const src = cloneBuffer(buf);
  const quantize = (v: number) => Math.round((v / 255) * (levels - 1)) * (255 / (levels - 1));

  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      let bestVar = Infinity;
      let best: [number, number, number] = [0, 0, 0];

      for (let q = 0; q < 4; q++) {
        const x0 = q % 2 === 0 ? x - r : x;
        const y0 = q < 2 ? y - r : y;
        let sr = 0, sg = 0, sb = 0, sl = 0, sl2 = 0, n = 0;
        for (let dy = 0; dy <= r; dy++) {
          for (let dx = 0; dx <= r; dx++) {
            const sx = clamp(x0 + dx, 0, buf.width - 1);
            const sy = clamp(y0 + dy, 0, buf.height - 1);
            const p = (sy * buf.width + sx) * 4;
            const l = luminance(src.data[p], src.data[p + 1], src.data[p + 2]);
            sr += src.data[p]; sg += src.data[p + 1]; sb += src.data[p + 2];
            sl += l; sl2 += l * l; n++;
          }
        }
        const variance = sl2 / n - (sl / n) ** 2;
        if (variance < bestVar) {
          bestVar = variance;
          best = [sr / n, sg / n, sb / n];
        }
      }

      const i = (y * buf.width + x) * 4;
      buf.data[i] = quantize(best[0]);
      buf.data[i + 1] = quantize(best[1]);
      buf.data[i + 2] = quantize(best[2]);
    }
  }
};

/** Smear pixels sideways from edges — Wind, Blast and Stagger. */
const wind = (buf: PixelBuffer, method: string, direction: string): void => {
  const src = cloneBuffer(buf);
  const rightward = direction === 'right';
  const maxLen = method === 'blast' ? 18 : method === 'stagger' ? 12 : 8;

  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      const i = (y * buf.width + x) * 4;
      const prevX = clamp(x + (rightward ? 1 : -1), 0, buf.width - 1);
      const p = (y * buf.width + prevX) * 4;
      // Streak away from a strong horizontal edge.
      const edge = Math.abs(
        luminance(src.data[i], src.data[i + 1], src.data[i + 2]) -
          luminance(src.data[p], src.data[p + 1], src.data[p + 2])
      );
      if (edge < 20) continue;

      const seed = method === 'stagger' ? y * 31 + x : y * 17;
      const len = 1 + Math.round(hashRandom(seed) * maxLen * (edge / 255) * 4);
      for (let s = 1; s <= len; s++) {
        const tx = rightward ? x - s : x + s;
        if (tx < 0 || tx >= buf.width) break;
        const ti = (y * buf.width + tx) * 4;
        const fade = 1 - s / (len + 1);
        // Carry the colour from ACROSS the edge — smearing a pixel's own colour
        // back over the region it already matches would change nothing.
        buf.data[ti] = buf.data[ti] * (1 - fade) + src.data[p] * fade;
        buf.data[ti + 1] = buf.data[ti + 1] * (1 - fade) + src.data[p + 1] * fade;
        buf.data[ti + 2] = buf.data[ti + 2] * (1 - fade) + src.data[p + 2] * fade;
      }
    }
  }
};

/**
 * Clamp stored numeric params to their descriptor's range.
 *
 * The schema bounds a param only to "a finite-ish number" — a saved document
 * can carry `radius: 1e9`, and an unclamped value is an availability bug, not
 * a cosmetic one: a blur's window seed is O(radius) per row, a motion blur is
 * O(distance) per pixel, a rank filter allocates (2r+1)² entries. Anything the
 * dialog produced is already inside its slider's range, so clamping only ever
 * bites hand-authored or corrupted documents.
 */
const clampToDescriptor = (id: string, params: FilterParams): FilterParams => {
  const descriptor = filterById(id);
  if (!descriptor) return params;
  let out: FilterParams | null = null;
  for (const p of descriptor.params) {
    const v = params[p.key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const lo = typeof p.min === 'number' ? p.min : -Infinity;
    const hi = typeof p.max === 'number' ? p.max : Infinity;
    const clamped = Math.min(hi, Math.max(lo, v));
    if (clamped !== v) {
      out = out || { ...params };
      out[p.key] = clamped;
    }
  }
  return out || params;
};

// ── Dispatch ────────────────────────────────────────────────────────────────

/**
 * Apply `id` to `buf` in place.
 *
 * Unknown ids are a no-op rather than a throw: a document saved by a newer
 * build naming a filter this one doesn't have should render, not explode.
 */
export const applyFilter = (
  buf: PixelBuffer,
  id: string,
  params: FilterParams = {}
): void => {
  params = clampToDescriptor(id, params);
  switch (id) {
    // ── Blur ────────────────────────────────────────────────────────────────
    case 'blur':
      convolve(buf, [1, 1, 1, 1, 2, 1, 1, 1, 1], 3);
      return;
    case 'blur-more':
      convolve(buf, [1, 1, 1, 1, 1, 1, 1, 1, 1], 3);
      convolve(buf, [1, 1, 1, 1, 1, 1, 1, 1, 1], 3);
      return;
    case 'box-blur':
      boxBlur(buf, num(params, 'radius', 8));
      return;
    case 'gaussian-blur':
      gaussianBlur(buf, num(params, 'radius', 4));
      return;
    case 'lens-blur':
      shapedBlur(
        buf,
        str(params, 'shape', 'hexagon'),
        num(params, 'radius', 12),
        num(params, 'brightness', 0)
      );
      return;
    case 'motion-blur':
      motionBlur(buf, num(params, 'angle', 0), num(params, 'distance', 20));
      return;
    case 'radial-blur':
      radialBlur(buf, num(params, 'amount', 10), str(params, 'method', 'spin'));
      return;
    case 'shape-blur':
      shapedBlur(buf, str(params, 'shape', 'square'), num(params, 'radius', 10));
      return;
    case 'smart-blur':
      bilateralBlur(buf, num(params, 'radius', 5), num(params, 'threshold', 25));
      return;
    case 'surface-blur':
      bilateralBlur(buf, num(params, 'radius', 5), num(params, 'threshold', 15));
      return;

    // ── Distort ─────────────────────────────────────────────────────────────
    case 'displace': {
      const map = str(params, 'map', 'waves');
      const hx = num(params, 'horizontal', 10) / 4;
      const vy = num(params, 'vertical', 10) / 4;
      remap(buf, (x, y) => {
        const d = displacementAt(map, x, y, buf.width, buf.height);
        return { x: x + d.dx * hx, y: y + d.dy * vy };
      });
      return;
    }
    case 'pinch': {
      const amt = num(params, 'amount', 50) / 100;
      const cx = buf.width / 2;
      const cy = buf.height / 2;
      const max = Math.min(cx, cy);
      remap(buf, (x, y) => {
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.hypot(dx, dy);
        if (d === 0 || d > max) return { x, y };
        // Curve the radius. This is a PULL map (a destination pixel reads the
        // source), so Photoshop's positive Pinch — content squeezed TOWARD the
        // centre — needs scale > 1 (read from further out), i.e. an exponent
        // BELOW 1. `1 + amt` bulged, the exact inverse of the label.
        const t = Math.pow(d / max, 1 - amt);
        const scale = (t * max) / d;
        return { x: cx + dx * scale, y: cy + dy * scale };
      });
      return;
    }
    case 'polar-coordinates': {
      const toPolar = str(params, 'mode', 'rect-to-polar') === 'rect-to-polar';
      const cx = buf.width / 2;
      const cy = buf.height / 2;
      const maxR = Math.hypot(cx, cy);
      remap(
        buf,
        (x, y) => {
          if (toPolar) {
            const dx = x - cx;
            const dy = y - cy;
            const theta = Math.atan2(dy, dx);
            const r = Math.hypot(dx, dy);
            return {
              x: ((theta + Math.PI) / (2 * Math.PI)) * buf.width,
              y: (r / maxR) * buf.height,
            };
          }
          const theta = (x / buf.width) * 2 * Math.PI - Math.PI;
          const r = (y / buf.height) * maxR;
          return { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) };
        },
        true
      );
      return;
    }
    case 'ripple': {
      const amt = num(params, 'amount', 100) / 100;
      const size = RIPPLE_SIZES[str(params, 'size', 'medium')] || 14;
      remap(buf, (x, y) => ({
        x: x + Math.sin(y / size) * amt * 4,
        y: y + Math.sin(x / size) * amt * 4,
      }));
      return;
    }
    case 'shear': {
      const amt = num(params, 'amount', 20);
      const periods = num(params, 'periods', 1);
      remap(buf, (x, y) => ({
        x: x + Math.sin((y / buf.height) * Math.PI * 2 * periods) * amt,
        y,
      }));
      return;
    }
    case 'spherize': {
      const amt = num(params, 'amount', 50) / 100;
      const cx = buf.width / 2;
      const cy = buf.height / 2;
      const max = Math.min(cx, cy);
      remap(buf, (x, y) => {
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.hypot(dx, dy);
        if (d === 0 || d > max) return { x, y };
        const nd = d / max;
        // Project through a sphere: the classic bulge. Again a pull map —
        // near the centre sin(nd·π/2)/nd → π/2, so this reads from a SMALLER
        // radius (scale < 1) for a positive amount, which is what pushes
        // features outward. The subtracted form pinched, the label's inverse.
        const scale = 1 + amt * (1 - Math.sin((nd * Math.PI) / 2) / Math.max(1e-6, nd));
        return { x: cx + dx * scale, y: cy + dy * scale };
      });
      return;
    }
    case 'twirl': {
      const maxAngle = (num(params, 'angle', 90) * Math.PI) / 180;
      const cx = buf.width / 2;
      const cy = buf.height / 2;
      const max = Math.min(cx, cy);
      remap(buf, (x, y) => {
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.hypot(dx, dy);
        if (d > max) return { x, y };
        // Rotation falls off to zero at the edge of the affected circle.
        const theta = maxAngle * (1 - d / max);
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
      });
      return;
    }
    case 'wave': {
      const wavelength = Math.max(1, num(params, 'wavelength', 60));
      const amplitude = num(params, 'amplitude', 12);
      const type = str(params, 'type', 'sine');
      const shape = (t: number): number => {
        const phase = ((t % wavelength) / wavelength) * 2 * Math.PI;
        if (type === 'square') return Math.sin(phase) >= 0 ? 1 : -1;
        if (type === 'triangle') return 2 * Math.abs(2 * (phase / (2 * Math.PI) - 0.5)) - 1;
        return Math.sin(phase);
      };
      remap(buf, (x, y) => ({
        x: x + shape(y) * amplitude,
        y: y + shape(x) * amplitude,
      }));
      return;
    }
    case 'zigzag': {
      const amt = num(params, 'amount', 30) / 100;
      const ridges = num(params, 'ridges', 5);
      const style = str(params, 'style', 'pond');
      const cx = buf.width / 2;
      const cy = buf.height / 2;
      const max = Math.min(cx, cy);
      remap(buf, (x, y) => {
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.hypot(dx, dy);
        if (d === 0 || d > max) return { x, y };
        const wave = Math.sin((d / max) * Math.PI * ridges);
        if (style === 'around') {
          const theta = wave * amt * 0.5;
          const cos = Math.cos(theta);
          const sin = Math.sin(theta);
          return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
        }
        const shift = style === 'out' ? wave * amt * max * 0.2 : wave * amt * 10;
        const scale = (d + shift) / d;
        return { x: cx + dx * scale, y: cy + dy * scale };
      });
      return;
    }

    // ── Noise ───────────────────────────────────────────────────────────────
    case 'add-noise': {
      const amt = num(params, 'amount', 12) / 100;
      const gaussian = str(params, 'distribution', 'gaussian') === 'gaussian';
      const mono = bool(params, 'monochromatic');
      for (let i = 0, px = 0; i < buf.data.length; i += 4, px++) {
        const base = gaussian ? hashGaussian(px) : hashRandom(px) * 2 - 1;
        const shift = base * amt * 255;
        if (mono) {
          buf.data[i] += shift;
          buf.data[i + 1] += shift;
          buf.data[i + 2] += shift;
        } else {
          buf.data[i] += shift;
          buf.data[i + 1] +=
            (gaussian ? hashGaussian(px ^ 0x55) : hashRandom(px ^ 0x55) * 2 - 1) * amt * 255;
          buf.data[i + 2] +=
            (gaussian ? hashGaussian(px ^ 0xaa) : hashRandom(px ^ 0xaa) * 2 - 1) * amt * 255;
        }
      }
      return;
    }
    case 'despeckle':
      // Photoshop's Despeckle is a median that leaves edges alone.
      rankFilter(buf, 1, 0.5, 12);
      return;
    case 'dust-and-scratches':
      rankFilter(buf, num(params, 'radius', 2), 0.5, num(params, 'threshold', 32));
      return;
    case 'median':
      rankFilter(buf, num(params, 'radius', 2), 0.5);
      return;
    case 'reduce-noise': {
      const strength = num(params, 'strength', 5);
      const detail = num(params, 'preserveDetails', 60) / 100;
      const colorNoise = num(params, 'reduceColorNoise', 45) / 100;
      // Luminance noise: edge-preserving blur, weaker as detail rises.
      bilateralBlur(buf, Math.max(1, Math.round(strength / 2)), (1 - detail) * 60 + 5);
      if (colorNoise > 0) {
        // Chroma noise is far more visible than luma noise, so blur colour only
        // and put the original luminance back.
        const before = cloneBuffer(buf);
        gaussianBlur(buf, colorNoise * 3);
        for (let i = 0; i < buf.data.length; i += 4) {
          const targetL = luminance(before.data[i], before.data[i + 1], before.data[i + 2]);
          const gotL = luminance(buf.data[i], buf.data[i + 1], buf.data[i + 2]);
          const delta = targetL - gotL;
          buf.data[i] += delta;
          buf.data[i + 1] += delta;
          buf.data[i + 2] += delta;
        }
      }
      return;
    }

    // ── Pixelate ────────────────────────────────────────────────────────────
    case 'color-halftone': {
      const src = cloneBuffer(buf);
      const r = num(params, 'radius', 8);
      const base = num(params, 'angle', 108);
      // Photoshop's default screen angles, offset from the chosen base.
      const angles = [base + 0, base + 54, base + 18];
      for (let c = 0; c < 3; c++) halftoneChannel(src, buf, c, r, angles[c]);
      return;
    }
    case 'crystallize':
    case 'pointillize':
    case 'mosaic': {
      const size = num(params, 'size', 10);
      if (id === 'mosaic') {
        // A regular grid rather than a cell field — that is the difference.
        const src = cloneBuffer(buf);
        const s = Math.max(2, Math.round(size));
        for (let by = 0; by < buf.height; by += s) {
          for (let bx = 0; bx < buf.width; bx += s) {
            let r = 0, g = 0, b = 0, a = 0, n = 0;
            for (let y = by; y < Math.min(by + s, buf.height); y++) {
              for (let x = bx; x < Math.min(bx + s, buf.width); x++) {
                const p = (y * buf.width + x) * 4;
                r += src.data[p]; g += src.data[p + 1]; b += src.data[p + 2]; a += src.data[p + 3];
                n++;
              }
            }
            for (let y = by; y < Math.min(by + s, buf.height); y++) {
              for (let x = bx; x < Math.min(bx + s, buf.width); x++) {
                const p = (y * buf.width + x) * 4;
                buf.data[p] = r / n;
                buf.data[p + 1] = g / n;
                buf.data[p + 2] = b / n;
                buf.data[p + 3] = a / n;
              }
            }
          }
        }
        return;
      }

      const map = nearestCellMap(buf.width, buf.height, size);
      const averages = cellAverages(buf, map);
      const dotted = id === 'pointillize';
      // Pointillize needs the cell CENTRES; `nearestCellMap` returns only the
      // assignment map, but `cellField` is deterministic, so the same call
      // reproduces the exact centres the map was built from.
      const cells = dotted ? cellField(buf.width, buf.height, size) : null;
      const cellRadius = Math.max(1, size / 2);

      for (let y = 0; y < buf.height; y++) {
        for (let x = 0; x < buf.width; x++) {
          const px = y * buf.width + x;
          const avg = averages.get(map[px]);
          const i = px * 4;
          if (!avg) continue;
          if (dotted) {
            // Round dots of the cell's average colour: pixels past the dot
            // radius keep their original colour — the gap between the dots is
            // what separates Pointillize from Crystallize.
            const centre = cells?.[map[px]];
            if (!centre || Math.hypot(x - centre.x, y - centre.y) > cellRadius) {
              continue;
            }
          }
          buf.data[i] = avg[0];
          buf.data[i + 1] = avg[1];
          buf.data[i + 2] = avg[2];
          buf.data[i + 3] = avg[3];
        }
      }
      return;
    }
    case 'facet': {
      // Blocks of solid colour: each pixel takes the MOST COMMON colour in its
      // neighbourhood. (Taking the closest one instead resolves to the pixel
      // itself inside a flat area, which clumps nothing.)
      const src = cloneBuffer(buf);
      const n = [0, 0, 0, 0];
      for (let y = 0; y < buf.height; y++) {
        for (let x = 0; x < buf.width; x++) {
          const tally = new Map<number, { count: number; rgb: number[] }>();
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              sampleClamped(src, x + dx, y + dy, n);
              // Quantise before tallying, or near-identical shades never agree.
              const key =
                ((n[0] >> 3) << 10) | ((n[1] >> 3) << 5) | (n[2] >> 3);
              const hit = tally.get(key);
              if (hit) hit.count++;
              else tally.set(key, { count: 1, rgb: [n[0], n[1], n[2]] });
            }
          }
          let best = [0, 0, 0];
          let bestCount = -1;
          tally.forEach((v) => {
            if (v.count > bestCount) {
              bestCount = v.count;
              best = v.rgb;
            }
          });
          const i = (y * buf.width + x) * 4;
          buf.data[i] = best[0];
          buf.data[i + 1] = best[1];
          buf.data[i + 2] = best[2];
        }
      }
      return;
    }
    case 'fragment': {
      // Four offset copies averaged together — Photoshop's fixed 4-way shift.
      const src = cloneBuffer(buf);
      const off = 4;
      const shifts = [
        [-off, -off], [off, -off], [-off, off], [off, off],
      ];
      const px: number[] = [0, 0, 0, 0];
      for (let y = 0; y < buf.height; y++) {
        for (let x = 0; x < buf.width; x++) {
          let r = 0, g = 0, b = 0, a = 0;
          for (const [dx, dy] of shifts) {
            sampleClamped(src, x + dx, y + dy, px);
            r += px[0]; g += px[1]; b += px[2]; a += px[3];
          }
          const i = (y * buf.width + x) * 4;
          buf.data[i] = r / 4;
          buf.data[i + 1] = g / 4;
          buf.data[i + 2] = b / 4;
          buf.data[i + 3] = a / 4;
        }
      }
      return;
    }
    case 'mezzotint': {
      const type = str(params, 'type', 'fine-dots');
      const lines = type.includes('lines');
      const long = type === 'long-lines';
      const coarse = type === 'coarse-dots' || type === 'grainy-dots';
      const scale = coarse ? 3 : type === 'medium-dots' ? 2 : 1;

      for (let y = 0; y < buf.height; y++) {
        for (let x = 0; x < buf.width; x++) {
          const i = (y * buf.width + x) * 4;
          // Lines share a seed along the run, dots do not — that is the whole
          // difference between the two families.
          const seed = lines
            ? Math.floor(x / (long ? 24 : 8)) * 4096 + y
            : Math.floor(y / scale) * buf.width + Math.floor(x / scale);
          const noise = hashRandom(seed);
          for (let c = 0; c < 3; c++) {
            buf.data[i + c] = buf.data[i + c] / 255 > noise ? 255 : 0;
          }
        }
      }
      return;
    }

    // ── Sharpen ─────────────────────────────────────────────────────────────
    case 'sharpen':
      convolve(buf, [0, -1, 0, -1, 5, -1, 0, -1, 0], 3);
      return;
    case 'sharpen-more':
      convolve(buf, [-1, -1, -1, -1, 12, -1, -1, -1, -1], 3, 4);
      return;
    case 'sharpen-edges': {
      // Sharpen only where there is an edge, leaving flat areas untouched.
      const src = cloneBuffer(buf);
      const sharp = cloneBuffer(buf);
      convolve(sharp, [0, -1, 0, -1, 5, -1, 0, -1, 0], 3);
      const n = [0, 0, 0, 0];
      const c = [0, 0, 0, 0];
      for (let y = 0; y < buf.height; y++) {
        for (let x = 0; x < buf.width; x++) {
          sampleClamped(src, x, y, c);
          sampleClamped(src, x + 1, y, n);
          const gx = Math.abs(luminance(c[0], c[1], c[2]) - luminance(n[0], n[1], n[2]));
          sampleClamped(src, x, y + 1, n);
          const gy = Math.abs(luminance(c[0], c[1], c[2]) - luminance(n[0], n[1], n[2]));
          const edge = clamp((gx + gy) / 40, 0, 1);
          const i = (y * buf.width + x) * 4;
          for (let ch = 0; ch < 3; ch++) {
            buf.data[i + ch] = src.data[i + ch] * (1 - edge) + sharp.data[i + ch] * edge;
          }
        }
      }
      return;
    }
    case 'unsharp-mask':
    case 'smart-sharpen': {
      const amt = num(params, 'amount', 100) / 100;
      const r = num(params, 'radius', id === 'smart-sharpen' ? 1.5 : 1);
      const threshold = num(params, 'threshold', 0);
      const noise = num(params, 'reduceNoise', 0) / 100;

      const original = cloneBuffer(buf);
      const blurred = cloneBuffer(buf);
      gaussianBlur(blurred, r);

      for (let i = 0; i < buf.data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const diff = original.data[i + c] - blurred.data[i + c];
          // Below the threshold the difference is noise, not detail.
          if (Math.abs(diff) < threshold) continue;
          const damped = noise > 0 ? diff * (1 - noise * Math.exp(-Math.abs(diff) / 16)) : diff;
          buf.data[i + c] = original.data[i + c] + damped * amt;
        }
      }
      return;
    }

    // ── Stylize ─────────────────────────────────────────────────────────────
    case 'diffuse': {
      const r = Math.max(1, Math.round(num(params, 'radius', 4)));
      const mode = str(params, 'mode', 'normal');
      const src = cloneBuffer(buf);
      const px: number[] = [0, 0, 0, 0];
      for (let y = 0; y < buf.height; y++) {
        for (let x = 0; x < buf.width; x++) {
          const seed = y * buf.width + x;
          const dx = Math.round((hashRandom(seed) * 2 - 1) * r);
          const dy = Math.round((hashRandom(seed ^ 0x9e37) * 2 - 1) * r);
          sampleClamped(src, x + dx, y + dy, px);
          const i = (y * buf.width + x) * 4;
          const takeIt =
            mode === 'normal'
              ? true
              : mode === 'darken'
                ? luminance(px[0], px[1], px[2]) <
                  luminance(src.data[i], src.data[i + 1], src.data[i + 2])
                : luminance(px[0], px[1], px[2]) >
                  luminance(src.data[i], src.data[i + 1], src.data[i + 2]);
          if (!takeIt) continue;
          buf.data[i] = px[0];
          buf.data[i + 1] = px[1];
          buf.data[i + 2] = px[2];
          buf.data[i + 3] = px[3];
        }
      }
      return;
    }
    case 'emboss': {
      const rad = (num(params, 'angle', 135) * Math.PI) / 180;
      const height = num(params, 'height', 3);
      const amt = num(params, 'amount', 100) / 100;
      const dx = Math.cos(rad) * height;
      const dy = -Math.sin(rad) * height;
      const src = cloneBuffer(buf);
      const a: number[] = [0, 0, 0, 0];
      const b: number[] = [0, 0, 0, 0];
      for (let y = 0; y < buf.height; y++) {
        for (let x = 0; x < buf.width; x++) {
          sampleBilinear(src, x - dx, y - dy, a);
          sampleBilinear(src, x + dx, y + dy, b);
          const i = (y * buf.width + x) * 4;
          for (let c = 0; c < 3; c++) {
            // Grey plus the directional difference: the embossed look.
            buf.data[i + c] = 128 + (a[c] - b[c]) * amt;
          }
        }
      }
      return;
    }
    case 'extrude': {
      const size = Math.max(2, Math.round(num(params, 'size', 30)));
      const depth = num(params, 'depth', 30);
      const src = cloneBuffer(buf);
      for (let by = 0; by < buf.height; by += size) {
        for (let bx = 0; bx < buf.width; bx += size) {
          // Each block is flattened to its own colour and nudged by a
          // deterministic amount, giving the extruded-blocks look.
          const p = (Math.min(by + (size >> 1), buf.height - 1) * buf.width +
            Math.min(bx + (size >> 1), buf.width - 1)) * 4;
          const seed = (by / size) * 1000 + bx / size;
          const shift = Math.round((hashRandom(seed) - 0.5) * (depth / 255) * size);
          for (let y = by; y < Math.min(by + size, buf.height); y++) {
            for (let x = bx; x < Math.min(bx + size, buf.width); x++) {
              const inset = Math.min(x - bx, y - by, bx + size - x, by + size - y);
              if (inset < Math.abs(shift) / 2) continue;
              const i = (y * buf.width + x) * 4;
              buf.data[i] = src.data[p];
              buf.data[i + 1] = src.data[p + 1];
              buf.data[i + 2] = src.data[p + 2];
              buf.data[i + 3] = src.data[p + 3];
            }
          }
        }
      }
      return;
    }
    case 'find-edges': {
      const src = cloneBuffer(buf);
      const a: number[] = [0, 0, 0, 0];
      const b: number[] = [0, 0, 0, 0];
      const c: number[] = [0, 0, 0, 0];
      for (let y = 0; y < buf.height; y++) {
        for (let x = 0; x < buf.width; x++) {
          sampleClamped(src, x, y, a);
          sampleClamped(src, x + 1, y, b);
          sampleClamped(src, x, y + 1, c);
          const i = (y * buf.width + x) * 4;
          for (let ch = 0; ch < 3; ch++) {
            const g = Math.abs(a[ch] - b[ch]) + Math.abs(a[ch] - c[ch]);
            // Photoshop inverts: edges come out dark on white.
            buf.data[i + ch] = 255 - g;
          }
        }
      }
      return;
    }
    case 'oil-paint':
      kuwahara(buf, num(params, 'radius', 4), Math.max(2, num(params, 'levels', 8)));
      return;
    case 'solarize':
      for (let i = 0; i < buf.data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const v = buf.data[i + c];
          buf.data[i + c] = v < 128 ? v : 255 - v;
        }
      }
      return;
    case 'tiles': {
      const count = Math.max(1, Math.round(num(params, 'tiles', 10)));
      const offsetPct = num(params, 'offset', 10) / 100;
      const src = cloneBuffer(buf);
      const tileW = buf.width / count;
      const tileH = buf.height / count;
      // Clear first: the gaps between shifted tiles show the background.
      buf.data.fill(0);
      for (let ty = 0; ty < count; ty++) {
        for (let tx = 0; tx < count; tx++) {
          const seed = ty * count + tx;
          // At least a whole pixel of travel when an offset is asked for —
          // a percentage of a small tile otherwise rounds to zero and the
          // filter silently does nothing.
          const shift = (h: number, span: number) => {
            const raw = (hashRandom(h) - 0.5) * span * offsetPct * 2;
            if (offsetPct <= 0) return 0;
            return raw >= 0 ? Math.max(1, Math.round(raw)) : Math.min(-1, Math.round(raw));
          };
          const ox = shift(seed, tileW);
          const oy = shift(seed ^ 0x77, tileH);
          for (let y = Math.floor(ty * tileH); y < Math.floor((ty + 1) * tileH); y++) {
            for (let x = Math.floor(tx * tileW); x < Math.floor((tx + 1) * tileW); x++) {
              const dxp = x + ox;
              const dyp = y + oy;
              if (dxp < 0 || dyp < 0 || dxp >= buf.width || dyp >= buf.height) continue;
              const s = (y * buf.width + x) * 4;
              const d = (dyp * buf.width + dxp) * 4;
              buf.data[d] = src.data[s];
              buf.data[d + 1] = src.data[s + 1];
              buf.data[d + 2] = src.data[s + 2];
              buf.data[d + 3] = src.data[s + 3];
            }
          }
        }
      }
      return;
    }
    case 'trace-contour': {
      const level = num(params, 'level', 128);
      const upper = str(params, 'edge', 'lower') === 'upper';
      const src = cloneBuffer(buf);
      const a: number[] = [0, 0, 0, 0];
      const b: number[] = [0, 0, 0, 0];
      for (let y = 0; y < buf.height; y++) {
        for (let x = 0; x < buf.width; x++) {
          const i = (y * buf.width + x) * 4;
          sampleClamped(src, x, y, a);
          for (let c = 0; c < 3; c++) {
            // A contour is where a neighbour crosses the level and this pixel
            // does not — one-pixel outlines rather than filled regions.
            sampleClamped(src, x + 1, y, b);
            const crossedX = a[c] >= level !== b[c] >= level;
            sampleClamped(src, x, y + 1, b);
            const crossedY = a[c] >= level !== b[c] >= level;
            const on = upper ? a[c] >= level : a[c] < level;
            buf.data[i + c] = (crossedX || crossedY) && on ? 0 : 255;
          }
        }
      }
      return;
    }
    case 'wind':
      wind(buf, str(params, 'method', 'wind'), str(params, 'direction', 'right'));
      return;

    // ── Video ───────────────────────────────────────────────────────────────
    case 'de-interlace': {
      const dropOdd = str(params, 'eliminate', 'odd') === 'odd';
      const interpolate = str(params, 'create', 'interpolation') === 'interpolation';
      const src = cloneBuffer(buf);
      for (let y = 0; y < buf.height; y++) {
        const isOdd = y % 2 === 1;
        if (isOdd !== dropOdd) continue;
        for (let x = 0; x < buf.width; x++) {
          const i = (y * buf.width + x) * 4;
          const above = (clamp(y - 1, 0, buf.height - 1) * buf.width + x) * 4;
          const below = (clamp(y + 1, 0, buf.height - 1) * buf.width + x) * 4;
          for (let c = 0; c < 4; c++) {
            buf.data[i + c] = interpolate
              ? (src.data[above + c] + src.data[below + c]) / 2
              : src.data[above + c];
          }
        }
      }
      return;
    }
    case 'ntsc-colors':
      // Clamp into the broadcast-safe range — 16..235 luma, muted chroma.
      for (let i = 0; i < buf.data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          buf.data[i + c] = clamp(16 + (buf.data[i + c] / 255) * (235 - 16), 16, 235);
        }
      }
      return;

    default:
      return;
  }
};

/** Every id this module knows how to run — used to keep descriptors honest. */
export const IMPLEMENTED_FILTERS: string[] = [
  'blur', 'blur-more', 'box-blur', 'gaussian-blur', 'lens-blur', 'motion-blur',
  'radial-blur', 'shape-blur', 'smart-blur', 'surface-blur',
  'displace', 'pinch', 'polar-coordinates', 'ripple', 'shear', 'spherize',
  'twirl', 'wave', 'zigzag',
  'add-noise', 'despeckle', 'dust-and-scratches', 'median', 'reduce-noise',
  'color-halftone', 'crystallize', 'facet', 'fragment', 'mezzotint', 'mosaic',
  'pointillize',
  'sharpen', 'sharpen-edges', 'sharpen-more', 'smart-sharpen', 'unsharp-mask',
  'diffuse', 'emboss', 'extrude', 'find-edges', 'oil-paint', 'solarize',
  'tiles', 'trace-contour', 'wind',
  'de-interlace', 'ntsc-colors',
];
