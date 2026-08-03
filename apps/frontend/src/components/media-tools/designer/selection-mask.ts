/**
 * Pixel selections for the Marquee, Lasso and Object/Quick Selection tools.
 *
 * A selection is an 8-bit alpha mask at document resolution, held in editor
 * state — never in the document. It constrains every paint operation and drives
 * the marching-ants outline; it is not itself a thing that gets exported.
 */

export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect';

export interface SelectionMask {
  width: number;
  height: number;
  /** 0 = outside, 255 = fully selected. */
  data: Uint8ClampedArray;
}

export const createMask = (width: number, height: number): SelectionMask => ({
  width: Math.max(1, Math.round(width)),
  height: Math.max(1, Math.round(height)),
  data: new Uint8ClampedArray(Math.max(1, Math.round(width)) * Math.max(1, Math.round(height))),
});

export const isEmptyMask = (mask: SelectionMask | null): boolean => {
  if (!mask) return true;
  for (let i = 0; i < mask.data.length; i++) if (mask.data[i]) return false;
  return true;
};

/** Combine a freshly drawn region into the existing selection. */
export const combineMasks = (
  base: SelectionMask | null,
  addition: SelectionMask,
  mode: SelectionMode
): SelectionMask => {
  if (!base || mode === 'replace') return addition;
  const out = createMask(base.width, base.height);
  for (let i = 0; i < out.data.length; i++) {
    const a = base.data[i];
    const b = addition.data[i];
    out.data[i] =
      mode === 'add' ? Math.max(a, b)
      : mode === 'subtract' ? Math.max(0, a - b)
      : Math.min(a, b); // intersect
  }
  return out;
};

/** Which combine mode the modifier keys request. */
export const modeFromModifiers = (shift: boolean, alt: boolean): SelectionMode => {
  if (shift && alt) return 'intersect';
  if (shift) return 'add';
  if (alt) return 'subtract';
  return 'replace';
};

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const rectMask = (width: number, height: number, rect: Rect): SelectionMask => {
  const mask = createMask(width, height);
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(mask.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(mask.height, Math.ceil(rect.y + rect.height));
  for (let y = y0; y < y1; y++) {
    mask.data.fill(255, y * mask.width + x0, y * mask.width + x1);
  }
  return mask;
};

export const ellipseMask = (width: number, height: number, rect: Rect): SelectionMask => {
  const mask = createMask(width, height);
  const rx = rect.width / 2;
  const ry = rect.height / 2;
  const cx = rect.x + rx;
  const cy = rect.y + ry;
  if (rx <= 0 || ry <= 0) return mask;

  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(mask.height, Math.ceil(cy + ry));
  for (let y = y0; y < y1; y++) {
    const dy = (y + 0.5 - cy) / ry;
    const inner = 1 - dy * dy;
    if (inner <= 0) continue;
    const halfSpan = rx * Math.sqrt(inner);
    const x0 = Math.max(0, Math.floor(cx - halfSpan));
    const x1 = Math.min(mask.width, Math.ceil(cx + halfSpan));
    mask.data.fill(255, y * mask.width + x0, y * mask.width + x1);
  }
  return mask;
};

/** Single Row Marquee: a full-width band one pixel tall. */
export const rowMask = (width: number, height: number, y: number): SelectionMask =>
  rectMask(width, height, { x: 0, y, width, height: 1 });

/** Single Column Marquee: a full-height band one pixel wide. */
export const columnMask = (width: number, height: number, x: number): SelectionMask =>
  rectMask(width, height, { x, y: 0, width: 1, height });

/**
 * Even-odd polygon fill, used by every lasso variant — the polygonal lasso's
 * clicked vertices, the free lasso's trail and the magnetic lasso's snapped
 * path all reduce to a point list.
 */
export const polygonMask = (
  width: number,
  height: number,
  points: { x: number; y: number }[]
): SelectionMask => {
  const mask = createMask(width, height);
  if (points.length < 3) return mask;

  let minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(mask.height, Math.ceil(maxY) + 1);

  for (let y = y0; y < y1; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[j];
      const b = points[i];
      if (a.y <= yc === b.y <= yc) continue;
      xs.push(a.x + ((yc - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const sx = Math.max(0, Math.ceil(xs[k] - 0.5));
      const ex = Math.min(mask.width, Math.ceil(xs[k + 1] - 0.5));
      if (ex > sx) mask.data.fill(255, y * mask.width + sx, y * mask.width + ex);
    }
  }
  return mask;
};

/** Stamp a soft circle into a mask — the Selection Brush. */
export const brushIntoMask = (
  mask: SelectionMask,
  x: number,
  y: number,
  radius: number
): void => {
  const r2 = radius * radius;
  const y0 = Math.max(0, Math.floor(y - radius));
  const y1 = Math.min(mask.height, Math.ceil(y + radius));
  const x0 = Math.max(0, Math.floor(x - radius));
  const x1 = Math.min(mask.width, Math.ceil(x + radius));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const dx = px + 0.5 - x;
      const dy = py + 0.5 - y;
      if (dx * dx + dy * dy <= r2) mask.data[py * mask.width + px] = 255;
    }
  }
};

/**
 * Quick Selection: region-grow from a seed over similar colours.
 *
 * Local and instant — deliberately not an AI call, so it works with no provider
 * configured. Object Selection is the AI-backed tool.
 */
export const regionGrow = (
  image: ImageData,
  seedX: number,
  seedY: number,
  tolerance = 32
): SelectionMask => {
  const { width: w, height: h } = image;
  const mask = createMask(w, h);
  const d = image.data;
  const sx = Math.floor(seedX);
  const sy = Math.floor(seedY);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return mask;

  const si = (sy * w + sx) * 4;
  const target = [d[si], d[si + 1], d[si + 2]];
  const tol = tolerance * tolerance * 3;
  const seen = new Uint8Array(w * h);
  const stack = [sx, sy];

  while (stack.length) {
    const y = stack.pop() as number;
    const x = stack.pop() as number;
    const p = y * w + x;
    if (seen[p]) continue;
    seen[p] = 1;

    const i = p * 4;
    const dr = d[i] - target[0];
    const dg = d[i + 1] - target[1];
    const db = d[i + 2] - target[2];
    if (dr * dr + dg * dg + db * db > tol) continue;

    mask.data[p] = 255;
    if (x > 0) stack.push(x - 1, y);
    if (x < w - 1) stack.push(x + 1, y);
    if (y > 0) stack.push(x, y - 1);
    if (y < h - 1) stack.push(x, y + 1);
  }
  return mask;
};

/** Build a mask from an image's alpha — how AI cutouts become selections. */
export const maskFromAlpha = (image: ImageData, threshold = 8): SelectionMask => {
  const mask = createMask(image.width, image.height);
  for (let p = 0; p < mask.data.length; p++) {
    mask.data[p] = image.data[p * 4 + 3] >= threshold ? 255 : 0;
  }
  return mask;
};

/**
 * Sobel edge magnitude, normalised to 0–255. The Magnetic Lasso snaps toward
 * the local maximum of this field.
 */
export const edgeMagnitude = (image: ImageData): Uint8ClampedArray => {
  const { width: w, height: h } = image;
  const d = image.data;
  const out = new Uint8ClampedArray(w * h);
  const lum = (i: number) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const gx =
        -lum(i - 4 - w * 4) - 2 * lum(i - 4) - lum(i - 4 + w * 4) +
        lum(i + 4 - w * 4) + 2 * lum(i + 4) + lum(i + 4 + w * 4);
      const gy =
        -lum(i - w * 4 - 4) - 2 * lum(i - w * 4) - lum(i - w * 4 + 4) +
        lum(i + w * 4 - 4) + 2 * lum(i + w * 4) + lum(i + w * 4 + 4);
      out[y * w + x] = Math.min(255, Math.hypot(gx, gy));
    }
  }
  return out;
};

/**
 * Pull a point toward the strongest nearby edge — the Magnetic Lasso's snap.
 * Searching a small window keeps it responsive while tracking a boundary.
 */
export const snapToEdge = (
  edges: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  radius = 6
): { x: number; y: number } => {
  let best = { x, y, score: -1 };
  const x0 = Math.max(0, Math.floor(x - radius));
  const x1 = Math.min(width - 1, Math.ceil(x + radius));
  const y0 = Math.max(0, Math.floor(y - radius));
  const y1 = Math.min(height - 1, Math.ceil(y + radius));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const score = edges[py * width + px];
      if (score > best.score) best = { x: px, y: py, score };
    }
  }
  return { x: best.x, y: best.y };
};

/**
 * Trace the selection boundary as line segments for the marching-ants overlay.
 * Emitting only edges where selected meets unselected keeps the outline crisp
 * without rasterising a second time.
 */
export const maskOutline = (mask: SelectionMask): number[][] => {
  const { width: w, height: h, data } = mask;
  const segments: number[][] = [];
  const on = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] > 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue;
      if (!on(x, y - 1)) segments.push([x, y, x + 1, y]);
      if (!on(x, y + 1)) segments.push([x, y + 1, x + 1, y + 1]);
      if (!on(x - 1, y)) segments.push([x, y, x, y + 1]);
      if (!on(x + 1, y)) segments.push([x + 1, y, x + 1, y + 1]);
    }
  }
  return segments;
};
