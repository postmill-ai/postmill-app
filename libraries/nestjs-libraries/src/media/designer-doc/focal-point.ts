/**
 * Subject-centroid → cover-crop focal point conversion, shared by the AI
 * composer (first placement) and `smartReflow` (re-placement on aspect change)
 * so the two can never drift apart.
 *
 * The renderer's `computeCoverCrop` reads `focalPoint` as the crop WINDOW's
 * position within the leftover slack — NOT as "put this point at the centre".
 * That makes a focal point BOX-ASPECT-DEPENDENT: the same image in a 583×1080
 * column and a 648×675 tile needs two different values. The box-independent
 * quantity is the subject CENTROID in source-image space, which is what gets
 * stored on the element (`subjectPoint`) and re-converted here per target box.
 */

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * Saturation rail. The centroid is a saliency heuristic, not a subject
 * detector, and the conversion amplifies its error by `srcDim / slack` (≈2.2
 * for a 1024² source in a 583×1080 column) — a centroid off by ~0.12 is enough
 * to push the window hard against an edge. An edge crop is precisely the
 * failure being fixed (it slices the subject off), and a plain centre crop
 * beats every saturated value, so an axis that would clamp gives up and
 * centres instead.
 *
 * Only a value strictly outside [0,1] is "saturated": a raw 0 or 1 means the
 * window is edge-aligned AND the subject sits exactly at its centre, which is
 * the correct crop, not a slice.
 */
const railed = (raw: number): number => (raw < 0 || raw > 1 ? 0.5 : raw);

/**
 * Convert a subject centroid (0..1 in source-image space) into the focal point
 * for painting that source into a `boxW`×`boxH` cover box.
 *
 * With square sources (everything the image model generates) painted into
 * portrait or landscape boxes the slack on one axis is identically zero, so
 * that axis is arithmetically inert whatever the centroid says — see the
 * `slack <= 0` branch. Do not read a returned `y` of 0.5 as a measurement.
 */
export const subjectPointToFocalPoint = (
  subject: { x: number; y: number },
  srcW: number,
  srcH: number,
  boxW: number,
  boxH: number
): { x: number; y: number } => {
  if (!(srcW > 0) || !(srcH > 0) || !(boxW > 0) || !(boxH > 0)) {
    // Without both geometries the exact conversion is unavailable; the
    // centroid itself is still a strictly better guess than dead centre.
    return { x: clamp01(subject.x), y: clamp01(subject.y) };
  }

  // Mirror computeCoverCrop's window sizing, then invert it.
  const targetRatio = boxW / boxH;
  const wider = srcW / srcH > targetRatio;
  const cropW = wider ? srcH * targetRatio : srcW;
  const cropH = wider ? srcH : srcW / targetRatio;
  const axis = (c: number, srcDim: number, cropDim: number): number => {
    const slack = srcDim - cropDim;
    if (slack <= 0) return 0.5;
    return railed((clamp01(c) * srcDim - cropDim / 2) / slack);
  };
  return {
    x: axis(subject.x, srcW, cropW),
    y: axis(subject.y, srcH, cropH),
  };
};
