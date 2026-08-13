import type { DesignerAdjustment, DesignerBlendMode } from './designer-doc.schema';
import { BLEND_MODES } from './designer-doc.schema';

/**
 * Pixel maths shared by the Designer canvas and the server renderer.
 *
 * Everything here is a pure `ImageData` transform, so the client can run it as
 * a custom `Konva.Filter` and the server can run it over `getImageData` output
 * and both produce identical pixels. That parity is the whole point — a blend
 * mode or adjustment implemented twice would drift, and the PNG export (client
 * Konva) and the PDF export (server node-canvas) would stop matching.
 *
 * Same pattern as `fit-text`, `shape-geometry` and `path-geometry`.
 */

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Rec. 709 luma, the weighting Photoshop uses for Luminosity/B&W defaults. */
export const luma = (r: number, g: number, b: number) =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

// ---------------------------------------------------------------------------
// Blend modes
// ---------------------------------------------------------------------------

/**
 * The blend modes canvas composites natively. Anything here can be handed
 * straight to `globalCompositeOperation`; the rest need `blendPixels`.
 */
export const NATIVE_BLEND_ORDER = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
] as const;

export const NATIVE_BLEND_MODES: ReadonlySet<string> = new Set(NATIVE_BLEND_ORDER);

/**
 * The modes the Designer offers in its UI: all of them.
 *
 * This was the native set alone, because `blendPixels` needs the BACKDROP and
 * "the Konva canvas has no backdrop to hand a node" — so offering the other
 * eleven would have meant the editor showing `normal` while the PDF and video
 * showed the real blend, which is worse than not offering them.
 *
 * That is no longer true. A Konva `sceneFunc` runs with the layer canvas
 * already holding everything drawn beneath it, so the canvas can capture the
 * backdrop before a layer paints and blend against it after — through this
 * same `blendPixels`, which is what makes the two agree. See
 * `layer-render.tsx`'s `CustomBlendLayer`.
 */
export const SELECTABLE_BLEND_MODES = BLEND_MODES;

export const isNativeBlend = (mode?: DesignerBlendMode): boolean =>
  !mode || NATIVE_BLEND_MODES.has(mode);

/** Canvas spells `normal` as `source-over`; the rest match one-to-one. */
export const canvasCompositeFor = (mode?: DesignerBlendMode): string =>
  !mode || mode === 'normal' ? 'source-over' : mode;

/**
 * Per-channel blend for every separable mode — including the ones canvas
 * composites natively, because `blendPixels` is also called where there is no
 * canvas (Edit ▸ Fill/Stroke), and those must not fall through to `normal`.
 * Formulas per the W3C compositing spec, channels in 0..255.
 */
const separableBlend = (
  mode: DesignerBlendMode,
  b: number,
  s: number
): number => {
  const bn = b / 255;
  const sn = s / 255;
  switch (mode) {
    case 'multiply':
      return clamp255(bn * sn * 255);
    case 'screen':
      return clamp255((bn + sn - bn * sn) * 255);
    case 'overlay':
      return clamp255(
        (bn <= 0.5 ? 2 * bn * sn : 1 - 2 * (1 - bn) * (1 - sn)) * 255
      );
    case 'darken':
      return Math.min(b, s);
    case 'lighten':
      return Math.max(b, s);
    case 'color-dodge':
      return clamp255((sn === 1 ? 1 : Math.min(1, bn / (1 - sn))) * 255);
    case 'color-burn':
      return clamp255((sn === 0 ? 0 : 1 - Math.min(1, (1 - bn) / sn)) * 255);
    case 'hard-light':
      return clamp255(
        (sn <= 0.5 ? 2 * bn * sn : 1 - 2 * (1 - bn) * (1 - sn)) * 255
      );
    case 'soft-light': {
      const d = bn <= 0.25 ? ((16 * bn - 12) * bn + 4) * bn : Math.sqrt(bn);
      return clamp255(
        (sn <= 0.5
          ? bn - (1 - 2 * sn) * bn * (1 - bn)
          : bn + (2 * sn - 1) * (d - bn)) * 255
      );
    }
    case 'difference':
      return Math.abs(b - s);
    case 'exclusion':
      return clamp255((bn + sn - 2 * bn * sn) * 255);
    case 'linear-burn':
      return clamp255((bn + sn - 1) * 255);
    case 'linear-dodge':
      return clamp255((bn + sn) * 255);
    case 'vivid-light':
      return clamp255(
        (sn <= 0.5
          ? sn === 0 ? 0 : 1 - Math.min(1, (1 - bn) / (2 * sn))
          : sn === 1 ? 1 : Math.min(1, bn / (2 * (1 - sn)))) * 255
      );
    case 'linear-light':
      return clamp255((bn + 2 * sn - 1) * 255);
    case 'pin-light':
      return clamp255(
        (sn <= 0.5 ? Math.min(bn, 2 * sn) : Math.max(bn, 2 * sn - 1)) * 255
      );
    case 'hard-mix': {
      // Vivid Light thresholded to 0 or 1 — the classic posterising blend.
      const vivid =
        sn <= 0.5
          ? sn === 0 ? 0 : 1 - Math.min(1, (1 - bn) / (2 * sn))
          : sn === 1 ? 1 : Math.min(1, bn / (2 * (1 - sn)));
      return vivid >= 0.5 ? 255 : 0;
    }
    case 'subtract':
      return clamp255((bn - sn) * 255);
    case 'divide':
      return clamp255((sn === 0 ? 1 : Math.min(1, bn / sn)) * 255);
    default:
      return s;
  }
};

// ---------------------------------------------------------------------------
// Non-separable blends (hue / saturation / color / luminosity), W3C helpers.
// These use the spec's 0.3/0.59/0.11 luma — NOT the Rec. 709 `luma` above —
// so the result matches what canvas does when the same mode goes through
// `globalCompositeOperation`.
// ---------------------------------------------------------------------------

const specLum = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;

const clipColor = (c: [number, number, number]): [number, number, number] => {
  let [r, g, b] = c;
  const l = specLum(r, g, b);
  const n = Math.min(r, g, b);
  const x = Math.max(r, g, b);
  if (n < 0) {
    r = l + ((r - l) * l) / (l - n);
    g = l + ((g - l) * l) / (l - n);
    b = l + ((b - l) * l) / (l - n);
  }
  if (x > 1) {
    r = l + ((r - l) * (1 - l)) / (x - l);
    g = l + ((g - l) * (1 - l)) / (x - l);
    b = l + ((b - l) * (1 - l)) / (x - l);
  }
  return [r, g, b];
};

const setLum = (
  c: [number, number, number],
  l: number
): [number, number, number] => {
  const d = l - specLum(c[0], c[1], c[2]);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
};

const setSat = (
  c: [number, number, number],
  s: number
): [number, number, number] => {
  // Sort channel values, rescale the spread to `s`, unsort.
  const pairs: [number, number][] = [
    [c[0], 0],
    [c[1], 1],
    [c[2], 2],
  ];
  const order = pairs.sort((p, q) => p[0] - q[0]);
  const out = [0, 0, 0];
  const [mn, md, mx] = order;
  if (mx[0] > mn[0]) {
    out[md[1]] = ((md[0] - mn[0]) * s) / (mx[0] - mn[0]);
    out[mx[1]] = s;
  }
  return out as [number, number, number];
};

const specSat = (c: [number, number, number]) =>
  Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);

/** Whole-colour blend for the four non-separable modes, channels 0..255. */
const nonSeparableBlend = (
  mode: DesignerBlendMode,
  b: [number, number, number],
  s: [number, number, number]
): [number, number, number] => {
  const bn: [number, number, number] = [b[0] / 255, b[1] / 255, b[2] / 255];
  const sn: [number, number, number] = [s[0] / 255, s[1] / 255, s[2] / 255];
  let out: [number, number, number];
  if (mode === 'hue') out = setLum(setSat(sn, specSat(bn)), specLum(...bn));
  else if (mode === 'saturation') out = setLum(setSat(bn, specSat(sn)), specLum(...bn));
  else if (mode === 'color') out = setLum(sn, specLum(...bn));
  else out = setLum(bn, specLum(...sn)); // luminosity
  return [
    clamp255(out[0] * 255),
    clamp255(out[1] * 255),
    clamp255(out[2] * 255),
  ];
};

/**
 * Blend `source` onto `backdrop` in place (writing into `backdrop`). Both must
 * be the same size.
 *
 * Compositing follows the W3C formula — co = αs(1−αb)·Cs + αs·αb·B(Cb,Cs) +
 * αb(1−αs)·Cb, αo = αs + αb(1−αs) — which the old "lerp the colour, max the
 * alpha" shortcut only matched for a fully opaque backdrop: a 50% fill onto a
 * transparent pixel came out twice as dark and fully opaque. Over an opaque
 * backdrop the formula reduces to that same lerp, so page compositing (where
 * the backdrop is the painted canvas) is unchanged.
 *
 * `dissolve` is a per-pixel coin flip weighted by alpha rather than a blend,
 * so it's handled separately.
 */
export const blendPixels = (
  backdrop: ImageData,
  source: ImageData,
  mode: DesignerBlendMode,
  opacity = 1,
  /** Deterministic 0–1 source for `dissolve`; defaults to an index hash. */
  random?: (index: number) => number
): void => {
  const b = backdrop.data;
  const s = source.data;
  const alpha = clamp01(opacity);
  const nonSeparable =
    mode === 'hue' ||
    mode === 'saturation' ||
    mode === 'color' ||
    mode === 'luminosity';

  for (let i = 0; i < b.length; i += 4) {
    const sa = (s[i + 3] / 255) * alpha;
    if (sa === 0) continue;

    if (mode === 'dissolve') {
      // Dissolve is a per-pixel coin flip weighted by alpha — not a gradient.
      const r = random ? random(i >> 2) : hashUnit(i >> 2);
      if (r < sa) {
        b[i] = s[i];
        b[i + 1] = s[i + 1];
        b[i + 2] = s[i + 2];
        b[i + 3] = 255;
      }
      continue;
    }

    // The blended colour B(Cb, Cs), per channel.
    let br: number;
    let bg: number;
    let bb: number;
    if (mode === 'darker-color' || mode === 'lighter-color') {
      const lb = luma(b[i], b[i + 1], b[i + 2]);
      const ls = luma(s[i], s[i + 1], s[i + 2]);
      const takeSource = mode === 'darker-color' ? ls < lb : ls > lb;
      br = takeSource ? s[i] : b[i];
      bg = takeSource ? s[i + 1] : b[i + 1];
      bb = takeSource ? s[i + 2] : b[i + 2];
    } else if (nonSeparable) {
      [br, bg, bb] = nonSeparableBlend(
        mode,
        [b[i], b[i + 1], b[i + 2]],
        [s[i], s[i + 1], s[i + 2]]
      );
    } else {
      br = separableBlend(mode, b[i], s[i]);
      bg = separableBlend(mode, b[i + 1], s[i + 1]);
      bb = separableBlend(mode, b[i + 2], s[i + 2]);
    }

    const ba = b[i + 3] / 255;
    const ao = sa + ba * (1 - sa);
    if (ao <= 0) continue;
    b[i] = clamp255(
      (sa * (1 - ba) * s[i] + sa * ba * br + ba * (1 - sa) * b[i]) / ao
    );
    b[i + 1] = clamp255(
      (sa * (1 - ba) * s[i + 1] + sa * ba * bg + ba * (1 - sa) * b[i + 1]) / ao
    );
    b[i + 2] = clamp255(
      (sa * (1 - ba) * s[i + 2] + sa * ba * bb + ba * (1 - sa) * b[i + 2]) / ao
    );
    b[i + 3] = clamp255(ao * 255);
  }
};

/** Stable per-index pseudo-random in [0,1) so Dissolve renders the same twice. */
const hashUnit = (i: number): number => {
  let x = (i + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
};

// ---------------------------------------------------------------------------
// Adjustments
// ---------------------------------------------------------------------------

const num = (values: Record<string, number> | undefined, key: string, def: number) =>
  values && typeof values[key] === 'number' ? values[key] : def;

/** Build a 256-entry LUT and apply it to RGB, leaving alpha alone. */
const applyLut = (data: ImageData, lut: Uint8ClampedArray) => {
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]];
    d[i + 1] = lut[d[i + 1]];
    d[i + 2] = lut[d[i + 2]];
  }
};

const buildLut = (fn: (v: number) => number): Uint8ClampedArray => {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = clamp255(fn(i));
  return lut;
};

/** Monotone-ish cubic through the control points, evaluated into a 256 LUT. */
export const curveLut = (points: { x: number; y: number }[]): Uint8ClampedArray => {
  const pts = [...points].sort((a, b) => a.x - b.x);
  if (pts.length < 2) return buildLut((v) => v);

  // Monotone cubic Hermite (Fritsch–Carlson). A plain spline overshoots and
  // smoothstep is not linear even between collinear points — which made the
  // default straight line crush shadows and blow highlights. This is linear
  // when the control points are collinear and never overshoots when they are
  // not, which is exactly what a curves editor promises.
  const n = pts.length;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = Math.max(1e-6, pts[i + 1].x - pts[i].x);
    slopes.push((pts[i + 1].y - pts[i].y) / dx);
  }
  const tangents: number[] = new Array(n);
  tangents[0] = slopes[0];
  tangents[n - 1] = slopes[n - 2];
  for (let i = 1; i < n - 1; i++) {
    tangents[i] =
      slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (slopes[i] === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = tangents[i] / slopes[i];
    const b = tangents[i + 1] / slopes[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      tangents[i] = tau * a * slopes[i];
      tangents[i + 1] = tau * b * slopes[i];
    }
  }

  return buildLut((v) => {
    if (v <= pts[0].x) return pts[0].y;
    if (v >= pts[n - 1].x) return pts[n - 1].y;
    let i = 0;
    while (i < n - 2 && v > pts[i + 1].x) i++;
    const h = Math.max(1e-6, pts[i + 1].x - pts[i].x);
    const t = (v - pts[i].x) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * pts[i].y +
      (t3 - 2 * t2 + t) * h * tangents[i] +
      (-2 * t3 + 3 * t2) * pts[i + 1].y +
      (t3 - t2) * h * tangents[i + 1]
    );
  });
};

const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h, s, l];
};

const hue2rgb = (p: number, q: number, t: number) => {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
};

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    hue2rgb(p, q, h + 1 / 3) * 255,
    hue2rgb(p, q, h) * 255,
    hue2rgb(p, q, h - 1 / 3) * 255,
  ];
};

/** Sample a gradient's stops into a 256×RGB ramp, for Gradient Map. */
export const gradientRamp = (
  stops: { offset: number; color: string }[]
): Uint8ClampedArray => {
  const ramp = new Uint8ClampedArray(256 * 3);
  const parsed = [...stops]
    .map((s) => ({ offset: clamp01(s.offset), rgb: parseHex(s.color) }))
    .sort((a, b) => a.offset - b.offset);
  if (!parsed.length) return ramp;

  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a = parsed[0];
    let b = parsed[parsed.length - 1];
    for (let k = 0; k < parsed.length - 1; k++) {
      if (t >= parsed[k].offset && t <= parsed[k + 1].offset) {
        a = parsed[k];
        b = parsed[k + 1];
        break;
      }
    }
    const span = Math.max(1e-6, b.offset - a.offset);
    const f = clamp01((t - a.offset) / span);
    ramp[i * 3] = a.rgb[0] + (b.rgb[0] - a.rgb[0]) * f;
    ramp[i * 3 + 1] = a.rgb[1] + (b.rgb[1] - a.rgb[1]) * f;
    ramp[i * 3 + 2] = a.rgb[2] + (b.rgb[2] - a.rgb[2]) * f;
  }
  return ramp;
};

export const parseHex = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
};

/**
 * Apply an adjustment to `data` in place.
 *
 * Every op is a no-op at its neutral settings, so an adjustment layer added and
 * left alone never changes a pixel.
 */
export const applyAdjustment = (
  data: ImageData,
  adjustment: DesignerAdjustment
): void => {
  const d = data.data;
  const v = adjustment.values;

  switch (adjustment.type) {
    case 'invert':
      for (let i = 0; i < d.length; i += 4) {
        d[i] = 255 - d[i];
        d[i + 1] = 255 - d[i + 1];
        d[i + 2] = 255 - d[i + 2];
      }
      return;

    case 'brightness-contrast': {
      const brightness = num(v, 'brightness', 0);
      const contrast = num(v, 'contrast', 0);
      const c = (contrast / 100) * 255;
      const f = (259 * (c + 255)) / (255 * (259 - c));
      applyLut(data, buildLut((x) => f * (x - 128) + 128 + (brightness / 100) * 255));
      return;
    }

    case 'levels': {
      const black = num(v, 'black', 0);
      const white = num(v, 'white', 255);
      const gamma = Math.max(0.01, num(v, 'gamma', 1));
      const span = Math.max(1, white - black);
      applyLut(data, buildLut((x) => Math.pow(clamp01((x - black) / span), 1 / gamma) * 255));
      return;
    }

    case 'exposure': {
      const stops = num(v, 'exposure', 0);
      const offset = num(v, 'offset', 0);
      const gain = Math.pow(2, stops);
      applyLut(data, buildLut((x) => x * gain + offset * 255));
      return;
    }

    case 'curves': {
      const master = adjustment.curves?.rgb;
      const lut = master ? curveLut(master) : null;
      const perChannel = ['r', 'g', 'b'].map((ch) =>
        adjustment.curves?.[ch] ? curveLut(adjustment.curves[ch]) : null
      );
      for (let i = 0; i < d.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          let val = d[i + c];
          if (lut) val = lut[val];
          const pc = perChannel[c];
          if (pc) val = pc[val];
          d[i + c] = val;
        }
      }
      return;
    }

    case 'posterize': {
      const levels = Math.max(2, Math.round(num(v, 'levels', 4)));
      const step = 255 / (levels - 1);
      applyLut(data, buildLut((x) => Math.round(Math.round(x / step) * step)));
      return;
    }

    case 'threshold': {
      const level = num(v, 'level', 128);
      for (let i = 0; i < d.length; i += 4) {
        const on = luma(d[i], d[i + 1], d[i + 2]) >= level ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = on;
      }
      return;
    }

    case 'black-white': {
      // Photoshop weights each source hue separately; defaults match its own.
      const wr = num(v, 'red', 0.3);
      const wg = num(v, 'green', 0.59);
      const wb = num(v, 'blue', 0.11);
      const total = wr + wg + wb || 1;
      for (let i = 0; i < d.length; i += 4) {
        const grey = clamp255((d[i] * wr + d[i + 1] * wg + d[i + 2] * wb) / total);
        d[i] = d[i + 1] = d[i + 2] = grey;
      }
      return;
    }

    case 'hue-saturation': {
      const hueShift = num(v, 'hue', 0) / 360;
      const satScale = 1 + num(v, 'saturation', 0) / 100;
      const lightScale = num(v, 'lightness', 0) / 100;
      for (let i = 0; i < d.length; i += 4) {
        const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        const [r, g, b] = hslToRgb(
          (h + hueShift + 1) % 1,
          clamp01(s * satScale),
          clamp01(l + lightScale)
        );
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
      }
      return;
    }

    case 'vibrance': {
      // Unlike saturation, vibrance protects already-saturated pixels.
      const amount = num(v, 'vibrance', 0) / 100;
      const satAmount = num(v, 'saturation', 0) / 100;
      for (let i = 0; i < d.length; i += 4) {
        const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        const boosted = clamp01(s + amount * (1 - s) * (1 - s) + satAmount * s);
        const [r, g, b] = hslToRgb(h, boosted, l);
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
      }
      return;
    }

    case 'color-balance': {
      const rShift = num(v, 'red', 0) / 100 * 255;
      const gShift = num(v, 'green', 0) / 100 * 255;
      const bShift = num(v, 'blue', 0) / 100 * 255;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = clamp255(d[i] + rShift);
        d[i + 1] = clamp255(d[i + 1] + gShift);
        d[i + 2] = clamp255(d[i + 2] + bShift);
      }
      return;
    }

    case 'photo-filter': {
      const [fr, fg, fb] = parseHex(
        typeof adjustment.color === 'string' ? adjustment.color : '#ec8a00'
      );
      const density = clamp01(num(v, 'density', 25) / 100);
      const preserve = num(v, 'preserveLuminosity', 1) >= 0.5;
      for (let i = 0; i < d.length; i += 4) {
        const before = luma(d[i], d[i + 1], d[i + 2]);
        let r = d[i] + (fr - d[i]) * density;
        let g = d[i + 1] + (fg - d[i + 1]) * density;
        let b = d[i + 2] + (fb - d[i + 2]) * density;
        if (preserve) {
          const after = luma(r, g, b) || 1;
          const k = before / after;
          r *= k; g *= k; b *= k;
        }
        d[i] = clamp255(r); d[i + 1] = clamp255(g); d[i + 2] = clamp255(b);
      }
      return;
    }

    case 'channel-mixer': {
      const rr = num(v, 'rr', 100) / 100, rg = num(v, 'rg', 0) / 100, rb = num(v, 'rb', 0) / 100;
      const gr = num(v, 'gr', 0) / 100, gg = num(v, 'gg', 100) / 100, gb = num(v, 'gb', 0) / 100;
      const br = num(v, 'br', 0) / 100, bg = num(v, 'bg', 0) / 100, bb = num(v, 'bb', 100) / 100;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        d[i] = clamp255(r * rr + g * rg + b * rb);
        d[i + 1] = clamp255(r * gr + g * gg + b * gb);
        d[i + 2] = clamp255(r * br + g * bg + b * bb);
      }
      return;
    }

    case 'selective-color': {
      // Simplified: shift the dominant channel family by cyan/magenta/yellow.
      const cyan = num(v, 'cyan', 0) / 100;
      const magenta = num(v, 'magenta', 0) / 100;
      const yellow = num(v, 'yellow', 0) / 100;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = clamp255(d[i] - cyan * 255);
        d[i + 1] = clamp255(d[i + 1] - magenta * 255);
        d[i + 2] = clamp255(d[i + 2] - yellow * 255);
      }
      return;
    }

    case 'gradient-map': {
      const ramp = gradientRamp(adjustment.gradient?.stops || []);
      if (!adjustment.gradient?.stops?.length) return;
      for (let i = 0; i < d.length; i += 4) {
        const l = Math.round(clamp255(luma(d[i], d[i + 1], d[i + 2])));
        d[i] = ramp[l * 3];
        d[i + 1] = ramp[l * 3 + 1];
        d[i + 2] = ramp[l * 3 + 2];
      }
      return;
    }

    case 'clarity-dehaze': {
      // Local-contrast lift plus a black-point pull — the two halves of what
      // Camera Raw's Clarity and Dehaze sliders do, without a full local
      // tone-mapping pass.
      const clarity = num(v, 'clarity', 0) / 100;
      const dehaze = num(v, 'dehaze', 0) / 100;
      if (clarity === 0 && dehaze === 0) return;
      const contrastF = 1 + clarity * 0.5;
      const black = dehaze * 40;
      applyLut(
        data,
        buildLut((x) => ((x - 128) * contrastF + 128 - black) * (1 + dehaze * 0.15))
      );
      return;
    }

    default:
      return;
  }
};

/** Neutral defaults per adjustment type, for newly created layers. */
export const defaultAdjustmentValues = (
  type: DesignerAdjustment['type']
): Record<string, number> => {
  switch (type) {
    case 'brightness-contrast': return { brightness: 0, contrast: 0 };
    case 'levels': return { black: 0, white: 255, gamma: 1 };
    case 'exposure': return { exposure: 0, offset: 0 };
    case 'hue-saturation': return { hue: 0, saturation: 0, lightness: 0 };
    case 'vibrance': return { vibrance: 0, saturation: 0 };
    case 'color-balance': return { red: 0, green: 0, blue: 0 };
    case 'black-white': return { red: 0.3, green: 0.59, blue: 0.11 };
    case 'photo-filter': return { density: 25, preserveLuminosity: 1 };
    case 'channel-mixer':
      return { rr: 100, rg: 0, rb: 0, gr: 0, gg: 100, gb: 0, br: 0, bg: 0, bb: 100 };
    case 'selective-color': return { cyan: 0, magenta: 0, yellow: 0 };
    case 'posterize': return { levels: 4 };
    case 'threshold': return { level: 128 };
    case 'clarity-dehaze': return { clarity: 0, dehaze: 0 };
    default: return {};
  }
};
