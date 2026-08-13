import { describe, it, expect } from 'vitest';
import { subjectPointToFocalPoint } from './focal-point';

// The renderer's own cover-crop, replicated so a test can assert what the
// painted window actually contains — a focal point is the crop WINDOW's
// position within the slack, NOT "put this point at the centre", so an
// assertion on the raw number alone can pass while cropping the wrong way.
const cropWindow = (
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number,
  fp: { x: number; y: number }
) => {
  const targetRatio = targetW / targetH;
  const wider = srcW / srcH > targetRatio;
  const sw = wider ? srcH * targetRatio : srcW;
  const sh = wider ? srcH : srcW / targetRatio;
  return { sx: (srcW - sw) * fp.x, sy: (srcH - sh) * fp.y, sw, sh };
};

describe('subjectPointToFocalPoint', () => {
  it('crops toward a right-of-centre subject in a narrow left-hand column', () => {
    // 1600×900 hero painted into a split-panel image column (583×1080 of a
    // 1080² canvas) with the subject at 0.75.
    const fp = subjectPointToFocalPoint({ x: 0.75, y: 0.5 }, 1600, 900, 583, 1080);

    expect(fp.x).toBeGreaterThan(0.5);

    const subjectX = 0.75 * 1600;
    const good = cropWindow(1600, 900, 583, 1080, fp);
    expect(subjectX).toBeGreaterThan(good.sx);
    expect(subjectX).toBeLessThan(good.sx + good.sw);

    // The centre crop provably misses it — without this the assertion above
    // could pass for the wrong reason.
    const centred = cropWindow(1600, 900, 583, 1080, { x: 0.5, y: 0.5 });
    expect(subjectX).toBeGreaterThan(centred.sx + centred.sw);
  });

  it('mirrors the same source into a wider box with a smaller offset', () => {
    // Same source and subject, a box that needs less of a crop — the focal
    // point is box-aspect-dependent, so it must move.
    const narrow = subjectPointToFocalPoint({ x: 0.75, y: 0.5 }, 1600, 900, 583, 1080);
    const wide = subjectPointToFocalPoint({ x: 0.75, y: 0.5 }, 1600, 900, 1200, 675);
    expect(wide.x).not.toBeCloseTo(narrow.x, 6);
  });

  it('rails a centroid that would clamp back to dead centre', () => {
    // Live V2 asset: 1024² source, correctly normalized centroid 0.1875, into
    // the 583×1080 column. Raw conversion is −0.179; clamping shipped a
    // hard-left 0 and sliced the subject off.
    expect(
      subjectPointToFocalPoint({ x: 0.1875, y: 0.5 }, 1024, 1024, 583, 1080)
    ).toEqual({ x: 0.5, y: 0.5 });

    // …and over the other rail too (the live V1 asset's 0.9375).
    expect(
      subjectPointToFocalPoint({ x: 0.9375, y: 0.5 }, 1024, 1024, 583, 1080)
    ).toEqual({ x: 0.5, y: 0.5 });
  });

  it('leaves an in-range conversion alone', () => {
    // 0.517 — what both live assets actually measured once normalized.
    const fp = subjectPointToFocalPoint({ x: 0.517, y: 0.5 }, 1024, 1024, 583, 1080);
    expect(fp.x).toBeGreaterThan(0.5);
    expect(fp.x).toBeLessThan(1);
  });

  it('returns 0.5 on an axis with no slack', () => {
    // A square source in a portrait box is never cropped vertically, so y is
    // arithmetically inert whatever the centroid claims.
    const fp = subjectPointToFocalPoint({ x: 0.517, y: 0.1 }, 1024, 1024, 583, 1080);
    expect(fp.y).toBe(0.5);
  });

  it('falls back to the raw centroid when a geometry is unknown', () => {
    expect(subjectPointToFocalPoint({ x: 0.7, y: 0.3 }, 0, 0, 583, 1080)).toEqual({
      x: 0.7,
      y: 0.3,
    });
    expect(
      subjectPointToFocalPoint({ x: 1.4, y: -0.2 }, 1024, 1024, 0, 0)
    ).toEqual({ x: 1, y: 0 });
  });
});
