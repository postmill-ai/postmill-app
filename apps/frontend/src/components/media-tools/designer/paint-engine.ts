/**
 * The paint engine behind the Brush, Pencil, Eraser, Clone Stamp, Paint Bucket,
 * Blur/Sharpen/Smudge and Dodge/Burn/Sponge tools.
 *
 * Everything here operates on a raster layer's 2D context in LAYER pixel space.
 * Effect tools (clone, blur, smudge, dodge…) additionally read a "backdrop"
 * canvas — a flattened snapshot of everything beneath the active layer, taken
 * once per stroke — because painting is non-destructive: strokes land on their
 * own layer, so sampling the layer itself would read empty pixels.
 */

export type PaintToolId =
  | 'brush' | 'pencil' | 'eraser' | 'clone-stamp' | 'paint-bucket'
  | 'blur' | 'sharpen' | 'smudge' | 'dodge' | 'burn' | 'sponge';

export interface PaintSettings {
  size: number;
  /** 0–1. Hard-edged tools ignore this. */
  hardness: number;
  /** 0–1 overall strength/opacity of the stroke. */
  opacity: number;
  color: string;
  /** Clone Stamp source offset, in layer pixels. */
  cloneOffset?: { x: number; y: number };
  /** Sponge direction. */
  desaturate?: boolean;
}

export const DEFAULT_PAINT: PaintSettings = {
  size: 24,
  hardness: 0.8,
  opacity: 1,
  color: '#000000',
};

/** Spacing between stamps as a fraction of brush size — Photoshop's default. */
const STAMP_SPACING = 0.25;

/**
 * Interpolate a segment into evenly spaced stamp positions. Pointer events are
 * far too sparse to paint with directly: at speed they arrive tens of pixels
 * apart and a naive implementation draws a dotted line.
 */
export const stampPositions = (
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number
): { x: number; y: number }[] => {
  const step = Math.max(1, size * STAMP_SPACING);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < step) return [to];

  const count = Math.floor(distance / step);
  const out: { x: number; y: number }[] = [];
  for (let i = 1; i <= count; i++) {
    const t = (i * step) / distance;
    out.push({ x: from.x + dx * t, y: from.y + dy * t });
  }
  return out;
};

/** A soft round brush as a radial gradient; hardness controls the falloff. */
const brushGradient = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  hardness: number
): CanvasGradient => {
  const g = ctx.createRadialGradient(x, y, radius * Math.min(0.99, hardness), x, y, radius);
  g.addColorStop(0, color);
  // Fade to fully transparent at the rim. Parsing the colour would be needed
  // for named colours, so rely on the 8-digit hex form for the stop.
  g.addColorStop(1, toTransparent(color));
  return g;
};

/** `#rrggbb` → `#rrggbb00`, leaving other formats to the browser. */
export const toTransparent = (color: string): string => {
  if (/^#[0-9a-f]{6}$/i.test(color)) return `${color}00`;
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    const [, r, g, b] = /^#(.)(.)(.)$/.exec(color) as RegExpExecArray;
    return `#${r}${r}${g}${g}${b}${b}00`;
  }
  return 'rgba(0,0,0,0)';
};

export interface StampContext {
  ctx: CanvasRenderingContext2D;
  /** Flattened pixels beneath this layer, for tools that sample. */
  backdrop?: CanvasImageSource | null;
  settings: PaintSettings;
}

/** Paint one stamp of the given tool at a point. */
export const stamp = (
  tool: PaintToolId,
  { ctx, backdrop, settings }: StampContext,
  x: number,
  y: number
): void => {
  const r = Math.max(0.5, settings.size / 2);
  ctx.save();
  ctx.globalAlpha = settings.opacity;

  switch (tool) {
    case 'pencil':
      // Hard-edged and aliased by definition — no falloff, no smoothing.
      ctx.fillStyle = settings.color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      break;

    case 'brush':
      ctx.fillStyle = brushGradient(ctx, x, y, r, settings.color, settings.hardness);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      break;

    case 'eraser':
      // Erasing is a composite mode, not a colour.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      break;

    case 'clone-stamp': {
      if (!backdrop || !settings.cloneOffset) break;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(
        backdrop,
        -settings.cloneOffset.x,
        -settings.cloneOffset.y
      );
      break;
    }

    case 'blur':
    case 'sharpen':
    case 'smudge':
    case 'dodge':
    case 'burn':
    case 'sponge':
      applyEffectStamp(tool, ctx, backdrop, settings, x, y, r);
      break;

    default:
      break;
  }

  ctx.restore();
};

/**
 * Effect tools read the composite under the cursor, transform those pixels and
 * write them back inside the brush circle.
 */
const applyEffectStamp = (
  tool: PaintToolId,
  ctx: CanvasRenderingContext2D,
  backdrop: CanvasImageSource | null | undefined,
  settings: PaintSettings,
  x: number,
  y: number,
  r: number
): void => {
  const size = Math.ceil(r * 2);
  const sx = Math.floor(x - r);
  const sy = Math.floor(y - r);
  if (size <= 0) return;

  // Compose what is visible here: the backdrop plus anything already painted.
  const scratch = document.createElement('canvas');
  scratch.width = size;
  scratch.height = size;
  const sctx = scratch.getContext('2d');
  if (!sctx) return;
  if (backdrop) sctx.drawImage(backdrop, -sx, -sy);
  sctx.drawImage(ctx.canvas, sx, sy, size, size, 0, 0, size, size);

  let data: ImageData;
  try {
    data = sctx.getImageData(0, 0, size, size);
  } catch {
    // A cross-origin backdrop taints the canvas; skip rather than throw.
    return;
  }

  const strength = Math.max(0, Math.min(1, settings.opacity));
  switch (tool) {
    case 'blur':
      boxBlur(data, Math.max(1, Math.round(r / 3)));
      break;
    case 'sharpen':
      sharpen(data, strength);
      break;
    case 'smudge':
      // Smudge is a directional blur; a symmetric one reads close enough at
      // brush scale and avoids tracking per-stamp velocity.
      boxBlur(data, Math.max(1, Math.round(r / 4)));
      break;
    case 'dodge':
      adjustLuminance(data, 1 + 0.35 * strength);
      break;
    case 'burn':
      adjustLuminance(data, 1 - 0.35 * strength);
      break;
    case 'sponge':
      adjustSaturation(data, settings.desaturate ? 1 - 0.4 * strength : 1 + 0.4 * strength);
      break;
    default:
      return;
  }

  sctx.putImageData(data, 0, 0);

  // Write back through a circular clip so the effect has a round brush edge.
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(scratch, sx, sy);
  ctx.restore();
};

/** Separable box blur — cheap and good enough at brush scale. */
export const boxBlur = (data: ImageData, radius: number): void => {
  const { width: w, height: h } = data;
  const src = data.data;
  const tmp = new Uint8ClampedArray(src);

  const pass = (input: Uint8ClampedArray, output: Uint8ClampedArray, horizontal: boolean) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let k = -radius; k <= radius; k++) {
          const nx = horizontal ? x + k : x;
          const ny = horizontal ? y : y + k;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const i = (ny * w + nx) * 4;
          r += input[i]; g += input[i + 1]; b += input[i + 2]; a += input[i + 3];
          n++;
        }
        const o = (y * w + x) * 4;
        output[o] = r / n; output[o + 1] = g / n; output[o + 2] = b / n; output[o + 3] = a / n;
      }
    }
  };

  pass(src, tmp, true);
  pass(tmp, src, false);
};

/** Unsharp-style sharpen: push each pixel away from its blurred self. */
export const sharpen = (data: ImageData, amount: number): void => {
  const original = new Uint8ClampedArray(data.data);
  boxBlur(data, 1);
  const blurred = data.data;
  const k = 1 + amount;
  for (let i = 0; i < blurred.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      blurred[i + c] = original[i + c] * k - blurred[i + c] * (k - 1);
    }
    blurred[i + 3] = original[i + 3];
  }
};

/** Scale luminance, preserving alpha. Used by Dodge and Burn. */
export const adjustLuminance = (data: ImageData, factor: number): void => {
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i] * factor;
    d[i + 1] = d[i + 1] * factor;
    d[i + 2] = d[i + 2] * factor;
  }
};

/** Scale saturation about each pixel's own luma. Used by Sponge. */
export const adjustSaturation = (data: ImageData, factor: number): void => {
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const luma = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    d[i] = luma + (d[i] - luma) * factor;
    d[i + 1] = luma + (d[i + 1] - luma) * factor;
    d[i + 2] = luma + (d[i + 2] - luma) * factor;
  }
};

/** `#rrggbb` → `[r, g, b]`. */
export const hexToRgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
};

/**
 * Scanline flood fill for the Paint Bucket.
 *
 * `mask`, when supplied, is the active pixel selection: fill never escapes it,
 * which is how selections constrain painting.
 */
export const floodFill = (
  data: ImageData,
  startX: number,
  startY: number,
  color: [number, number, number],
  tolerance = 32,
  mask?: Uint8ClampedArray
): number => {
  const { width: w, height: h } = data;
  const d = data.data;
  const sx = Math.floor(startX);
  const sy = Math.floor(startY);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return 0;

  const startIdx = (sy * w + sx) * 4;
  const target = [d[startIdx], d[startIdx + 1], d[startIdx + 2], d[startIdx + 3]];
  const tol = tolerance * tolerance * 3;

  const matches = (i: number) => {
    const dr = d[i] - target[0];
    const dg = d[i + 1] - target[1];
    const db = d[i + 2] - target[2];
    const da = d[i + 3] - target[3];
    return dr * dr + dg * dg + db * db + da * da <= tol;
  };

  const seen = new Uint8Array(w * h);
  const stack: number[] = [sx, sy];
  let filled = 0;

  while (stack.length) {
    const y = stack.pop() as number;
    const x = stack.pop() as number;
    let left = x;
    while (left > 0 && !seen[y * w + (left - 1)] && matches((y * w + (left - 1)) * 4)) left--;
    let right = x;
    while (right < w - 1 && !seen[y * w + right + 1] && matches((y * w + right + 1) * 4)) right++;

    for (let i = left; i <= right; i++) {
      const p = y * w + i;
      if (seen[p]) continue;
      seen[p] = 1;
      if (mask && mask[p] === 0) continue;
      const o = p * 4;
      d[o] = color[0]; d[o + 1] = color[1]; d[o + 2] = color[2]; d[o + 3] = 255;
      filled++;
      if (y > 0 && !seen[(y - 1) * w + i] && matches(((y - 1) * w + i) * 4)) stack.push(i, y - 1);
      if (y < h - 1 && !seen[(y + 1) * w + i] && matches(((y + 1) * w + i) * 4)) stack.push(i, y + 1);
    }
  }
  return filled;
};
