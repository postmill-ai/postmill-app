import type { DesignerAdjustment, DesignerBlendMode } from './designer-doc.schema';

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
 * The modes the Designer offers in its UI.
 *
 * Only the native set: `blendPixels` below can evaluate the other eleven, but
 * it needs the backdrop, and the Konva canvas has no backdrop to hand a node —
 * so offering them would mean the editor and PNG export showed `normal` while
 * the PDF and video export showed the real blend. A mode that renders one way
 * on screen and another in the file is worse than a mode that isn't offered.
 * `blendPixels` stays for documents authored elsewhere, which the server
 * renders faithfully.
 */
export const SELECTABLE_BLEND_MODES = NATIVE_BLEND_ORDER;

export const isNativeBlend = (mode?: DesignerBlendMode): boolean =>
  !mode || NATIVE_BLEND_MODES.has(mode);

/** Canvas spells `normal` as `source-over`; the rest match one-to-one. */
export const canvasCompositeFor = (mode?: DesignerBlendMode): string =>
  !mode || mode === 'normal' ? 'source-over' : mode;

/** Per-channel blend for the 9 separable modes canvas doesn't implement. */
const separableBlend = (
  mode: DesignerBlendMode,
  b: number,
  s: number
): number => {
  const bn = b / 255;
  const sn = s / 255;
  switch (mode) {
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

/**
 * Blend `source` onto `backdrop` in place (writing into `backdrop`) for the
 * modes canvas cannot do natively. Both must be the same size.
 *
 * `dissolve`, `darker-color` and `lighter-color` are whole-pixel decisions
 * rather than per-channel, so they're handled separately.
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

    if (mode === 'darker-color' || mode === 'lighter-color') {
      const lb = luma(b[i], b[i + 1], b[i + 2]);
      const ls = luma(s[i], s[i + 1], s[i + 2]);
      const takeSource = mode === 'darker-color' ? ls < lb : ls > lb;
      if (takeSource) {
        b[i] += (s[i] - b[i]) * sa;
        b[i + 1] += (s[i + 1] - b[i + 1]) * sa;
        b[i + 2] += (s[i + 2] - b[i + 2]) * sa;
      }
      b[i + 3] = Math.max(b[i + 3], s[i + 3]);
      continue;
    }

    for (let c = 0; c < 3; c++) {
      const blended = separableBlend(mode, b[i + c], s[i + c]);
      b[i + c] = clamp255(b[i + c] + (blended - b[i + c]) * sa);
    }
    b[i + 3] = Math.max(b[i + 3], s[i + 3]);
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
  return buildLut((v) => {
    if (v <= pts[0].x) return pts[0].y;
    if (v >= pts[pts.length - 1].x) return pts[pts.length - 1].y;
    let i = 0;
    while (i < pts.length - 2 && v > pts[i + 1].x) i++;
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const t = (v - p0.x) / Math.max(1e-6, p1.x - p0.x);
    // Smoothstep between control points — no overshoot, unlike a raw spline.
    return p0.y + (p1.y - p0.y) * (t * t * (3 - 2 * t));
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
        typeof (adjustment as { color?: string }).color === 'string'
          ? ((adjustment as { color?: string }).color as string)
          : '#ec8a00'
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
