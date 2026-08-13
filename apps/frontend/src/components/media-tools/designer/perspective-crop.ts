/**
 * Perspective Crop: map an arbitrary quadrilateral in the source image onto an
 * upright rectangle.
 *
 * This is the one crop that cannot be expressed as a `DesignerCrop` (which is
 * an axis-aligned source rect), so it rasterises: the warped result is written
 * to a canvas, uploaded, and becomes the element's new `src`. That is exactly
 * why it had to wait for the raster pipeline.
 */

export interface Quad {
  /** Four corners in source-image pixel space, clockwise from top-left. */
  points: [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];
}

/** 3×3 homography, row-major. */
export type Homography = number[];

/**
 * Solve the homography taking the unit square (0,0)-(1,1) to `quad`, then
 * invert the problem so we can sample the source for each destination pixel.
 *
 * Uses the standard projective-mapping formulation rather than a generic 8×8
 * solve — closed form, no pivoting, no failure modes beyond a degenerate quad.
 */
export const unitSquareToQuad = (quad: Quad): Homography | null => {
  const [p0, p1, p2, p3] = quad.points;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;

  let a13: number;
  let a23: number;

  if (Math.abs(dx3) < 1e-10 && Math.abs(dy3) < 1e-10) {
    // Affine case — the quad is a parallelogram.
    a13 = 0;
    a23 = 0;
  } else {
    const det = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(det) < 1e-10) return null;
    a13 = (dx3 * dy2 - dx2 * dy3) / det;
    a23 = (dx1 * dy3 - dx3 * dy1) / det;
  }

  const a11 = p1.x - p0.x + a13 * p1.x;
  const a21 = p3.x - p0.x + a23 * p3.x;
  const a31 = p0.x;
  const a12 = p1.y - p0.y + a13 * p1.y;
  const a22 = p3.y - p0.y + a23 * p3.y;
  const a32 = p0.y;

  // A collapsed quad (all corners equal, or three collinear) reaches here with
  // a singular linear part. Warping through it would sample a single point and
  // smear it across the output, so reject instead.
  if (Math.abs(a11 * a22 - a21 * a12) < 1e-10) return null;

  return [a11, a21, a31, a12, a22, a32, a13, a23, 1];
};

/** Apply a homography to a point in unit space. */
export const applyHomography = (
  h: Homography,
  x: number,
  y: number
): { x: number; y: number } => {
  const denom = h[6] * x + h[7] * y + h[8];
  const safe = Math.abs(denom) < 1e-12 ? 1e-12 : denom;
  return {
    x: (h[0] * x + h[1] * y + h[2]) / safe,
    y: (h[3] * x + h[4] * y + h[5]) / safe,
  };
};

/** A sensible output size for a warped quad: its longest opposing edges. */
export const quadOutputSize = (quad: Quad): { width: number; height: number } => {
  const [p0, p1, p2, p3] = quad.points;
  const d = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);
  return {
    width: Math.max(1, Math.round(Math.max(d(p0, p1), d(p3, p2)))),
    height: Math.max(1, Math.round(Math.max(d(p0, p3), d(p1, p2)))),
  };
};

/**
 * Warp `source` so that `quad` fills a new upright canvas.
 *
 * Nearest-neighbour sampling: at the scale these crops run, the visible
 * difference from bilinear is small and the loop stays fast enough to feel
 * instant on a large photo.
 */
export const warpQuadToCanvas = (
  source: CanvasImageSource & { width?: number; height?: number },
  sourceWidth: number,
  sourceHeight: number,
  quad: Quad
): HTMLCanvasElement | null => {
  const h = unitSquareToQuad(quad);
  if (!h) return null;

  const { width, height } = quadOutputSize(quad);

  const src = document.createElement('canvas');
  src.width = sourceWidth;
  src.height = sourceHeight;
  const sctx = src.getContext('2d');
  if (!sctx) return null;
  sctx.drawImage(source, 0, 0, sourceWidth, sourceHeight);

  let srcData: ImageData;
  try {
    srcData = sctx.getImageData(0, 0, sourceWidth, sourceHeight);
  } catch {
    // Cross-origin source without CORS headers — cannot read pixels.
    return null;
  }

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const octx = out.getContext('2d');
  if (!octx) return null;
  const outData = octx.createImageData(width, height);

  const sd = srcData.data;
  const od = outData.data;

  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const p = applyHomography(h, u, v);
      const sx = Math.round(p.x);
      const sy = Math.round(p.y);
      const o = (y * width + x) * 4;
      if (sx < 0 || sy < 0 || sx >= sourceWidth || sy >= sourceHeight) {
        od[o + 3] = 0;
        continue;
      }
      const i = (sy * sourceWidth + sx) * 4;
      od[o] = sd[i];
      od[o + 1] = sd[i + 1];
      od[o + 2] = sd[i + 2];
      od[o + 3] = sd[i + 3];
    }
  }

  octx.putImageData(outData, 0, 0);
  return out;
};
