import {
  parseDesignerFilterToken,
  type DesignerFilterToken,
} from '../design-render/filter-tokens';
import { blurCanvas } from './layer-style-render';

/**
 * The image filters, in pixel space.
 *
 * They used to be applied two different wrong ways. The server set
 * `ctx.filter = 'grayscale(100%) …'`, which node-canvas accepts and silently
 * ignores — so **every filter vanished from every export**, the same trap the
 * layer-style blur fell into. The client mapped the tokens onto Konva's own
 * filters, whose units are not CSS's: `Konva.Filters.Brighten` is neutral at 0
 * where `brightness` is neutral at 1, so a 0.5 "darken" *brightened* the image
 * and 1.5 blew it to white.
 *
 * One implementation of the CSS filter functions, run over ImageData, ends both
 * problems: the client uses it as a Konva filter (the same trick
 * `AdjustmentScope` uses to run the server's own adjustment code), and the
 * server runs it over the drawn buffer.
 *
 * The maths is the filter-effects spec's: a colour matrix per function, applied
 * in order, on non-premultiplied sRGB — which is what both `getImageData` and
 * Konva's filter contract hand us.
 */

/** Luminance coefficients the filter-effects spec uses for saturate/grayscale. */
const LUM_R = 0.213;
const LUM_G = 0.715;
const LUM_B = 0.072;

const clamp255 = (n: number): number => (n < 0 ? 0 : n > 255 ? 255 : n);

/** Amount clamps: a filter is defined for 0..1 but callers pass sliders. */
const amount = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const applyMatrix = (
  data: Uint8ClampedArray,
  m: [number, number, number, number, number, number, number, number, number]
): void => {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    data[i] = clamp255(m[0] * r + m[1] * g + m[2] * b);
    data[i + 1] = clamp255(m[3] * r + m[4] * g + m[5] * b);
    data[i + 2] = clamp255(m[6] * r + m[7] * g + m[8] * b);
  }
};

/** `sepia(a)` — the spec's sepia matrix, interpolated by amount. */
const sepia = (data: Uint8ClampedArray, a: number): void => {
  const t = Math.min(1, Math.max(0, a));
  const lerp = (from: number, to: number) => from + (to - from) * t;
  applyMatrix(data, [
    lerp(1, 0.393), lerp(0, 0.769), lerp(0, 0.189),
    lerp(0, 0.349), lerp(1, 0.686), lerp(0, 0.168),
    lerp(0, 0.272), lerp(0, 0.534), lerp(1, 0.131),
  ]);
};

/** `saturate(a)` — 0 is greyscale, 1 unchanged, >1 over-saturated. */
const saturate = (data: Uint8ClampedArray, a: number): void => {
  const s = Math.max(0, a);
  applyMatrix(data, [
    LUM_R + (1 - LUM_R) * s, LUM_G - LUM_G * s, LUM_B - LUM_B * s,
    LUM_R - LUM_R * s, LUM_G + (1 - LUM_G) * s, LUM_B - LUM_B * s,
    LUM_R - LUM_R * s, LUM_G - LUM_G * s, LUM_B + (1 - LUM_B) * s,
  ]);
};

/**
 * `grayscale(a)` is defined as exactly `saturate(1 - a)`, so it is expressed
 * that way rather than as a second hand-derived matrix that could drift from it.
 */
const grayscale = (data: Uint8ClampedArray, a: number): void =>
  saturate(data, 1 - Math.min(1, Math.max(0, a)));

/** `brightness(a)` — a straight multiply, 1 being unchanged. */
const brightness = (data: Uint8ClampedArray, a: number): void => {
  const k = Math.max(0, a);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp255(data[i] * k);
    data[i + 1] = clamp255(data[i + 1] * k);
    data[i + 2] = clamp255(data[i + 2] * k);
  }
};

/** `contrast(a)` — pivot around mid grey, 1 being unchanged. */
const contrast = (data: Uint8ClampedArray, a: number): void => {
  const k = Math.max(0, a);
  const offset = 127.5 * (1 - k);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp255(data[i] * k + offset);
    data[i + 1] = clamp255(data[i + 1] * k + offset);
    data[i + 2] = clamp255(data[i + 2] * k + offset);
  }
};

/**
 * Apply the colour filters in a token list to pixels, in order.
 *
 * Blur is NOT handled here: it needs neighbouring pixels and a canvas, so it is
 * returned to the caller instead — `blurFilterRadius` below — and applied with
 * `blurCanvas`. Keeping the split explicit stops a caller silently dropping it.
 */
export const applyFilterTokens = (
  data: Uint8ClampedArray,
  tokens: string[] | undefined
): void => {
  if (!tokens?.length) return;
  for (const token of tokens) {
    const parsed = parseDesignerFilterToken(token);
    if (!parsed) continue;
    switch (parsed.key as DesignerFilterToken) {
      case 'grayscale':
        grayscale(data, amount(parsed.value, 1));
        break;
      case 'sepia':
        sepia(data, amount(parsed.value, 1));
        break;
      case 'saturate':
        saturate(data, amount(parsed.value, 1));
        break;
      case 'brightness':
        brightness(data, amount(parsed.value, 1));
        break;
      case 'contrast':
        contrast(data, amount(parsed.value, 1));
        break;
      case 'blur':
        // Handled by the caller — see blurFilterRadius.
        break;
    }
  }
};

/**
 * Largest blur radius a token list may produce, in design px. The radius feeds
 * `blurCanvas`, whose cost is O(radius) per row per channel — an unclamped
 * `blur:1e8` is a DoS, not a style. Same precedent as `clampToDescriptor` in
 * `filter-ops.ts`, which clamps smart-filter radii for the same reason.
 */
export const MAX_BLUR_FILTER_RADIUS = 500;

/** Total blur radius in a token list, in px, clamped. Zero when there is none. */
export const blurFilterRadius = (tokens: string[] | undefined): number => {
  if (!tokens?.length) return 0;
  let radius = 0;
  for (const token of tokens) {
    const parsed = parseDesignerFilterToken(token);
    if (parsed?.key === 'blur') radius += amount(parsed.value, 0);
  }
  return Math.min(radius, MAX_BLUR_FILTER_RADIUS);
};

/** Whether a token list changes any pixels at all. */
export const hasFilterEffect = (tokens: string[] | undefined): boolean =>
  !!tokens?.length && tokens.some((t) => !!parseDesignerFilterToken(t));

/**
 * Run a whole token list over a canvas, blur included.
 *
 * The one entry point for callers that have a canvas rather than raw pixels —
 * which is both renderers.
 */
export const applyFilterTokensToCanvas = (
  canvas: { width: number; height: number; getContext(id: '2d'): any },
  tokens: string[] | undefined,
  /** Device pixels per design unit, so a blur radius means the same at any scale. */
  ratio = 1
): void => {
  if (!hasFilterEffect(tokens)) return;
  const radius = blurFilterRadius(tokens);
  if (radius > 0) blurCanvas(canvas, radius * ratio);

  const ctx = canvas.getContext('2d');
  if (!canvas.width || !canvas.height) return;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyFilterTokens(image.data, tokens);
  ctx.putImageData(image, 0, 0);
};
