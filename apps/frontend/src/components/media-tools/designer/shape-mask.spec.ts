import { describe, it, expect } from 'vitest';
import { shapeMaskClipFunc } from './elements';
import {
  starPoints,
  polygonPoints,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/shape-geometry';

/**
 * Shape-mask clip geometry on the canvas.
 *
 * The server renderer (`design-render.service.ts` traceMask) traces a star
 * mask with the SHARED `starPoints` generator — ellipse-inscribed, so the
 * mask stretches with the box. The canvas clipFunc hand-rolled a CIRCULAR
 * star from `min(w, h) / 2`, so a non-square image with a star mask clipped
 * to a different shape on screen than in the export.
 */

type Call = [string, ...number[]];

const record = () => {
  const calls: Call[] = [];
  const ctx = {
    beginPath: () => calls.push(['beginPath']),
    moveTo: (x: number, y: number) => calls.push(['moveTo', x, y]),
    lineTo: (x: number, y: number) => calls.push(['lineTo', x, y]),
    closePath: () => calls.push(['closePath']),
    arcTo: (...a: number[]) => calls.push(['arcTo', ...a]),
    ellipse: (...a: number[]) => calls.push(['ellipse', ...a]),
  };
  return { ctx, calls };
};

/** The traced path as a point list, moveTo first. */
const tracedPoints = (calls: Call[]): [number, number][] =>
  calls
    .filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo')
    .map((c) => [c[1], c[2]]);

describe('shapeMaskClipFunc', () => {
  it('traces a star mask with the shared generator, not a circular star', () => {
    const { ctx, calls } = record();
    shapeMaskClipFunc({ shape: 'star' }, 200, 100)(ctx);

    const expected = starPoints(200, 100);
    expect(tracedPoints(calls)).toEqual(expected.map((p) => [p.x, p.y]));
  });

  it('stretches the star mask into a non-square box, like the export does', () => {
    const { ctx, calls } = record();
    shapeMaskClipFunc({ shape: 'star' }, 200, 100)(ctx);

    const xs = tracedPoints(calls).map(([x]) => x);
    // Ellipse-inscribed: the right-pointing inner vertex pair reaches past
    // the circular mask's rightmost extent (cx + min(w,h)/2 = 150).
    expect(Math.max(...xs)).toBeGreaterThan(150);
  });

  it('matches the square-box star too (where circle and ellipse coincide)', () => {
    const { ctx, calls } = record();
    shapeMaskClipFunc({ shape: 'star' }, 100, 100)(ctx);
    expect(tracedPoints(calls)).toEqual(starPoints(100, 100).map((p) => [p.x, p.y]));
  });

  it('keeps the triangle mask on the corner-inscribed triangle the server traces', () => {
    const { ctx, calls } = record();
    shapeMaskClipFunc({ shape: 'triangle' }, 200, 100)(ctx);
    // The server's traceMask uses [[w/2, 0], [w, h], [0, h]] — deliberately
    // NOT polygonPoints, whose 3-gon is smaller. Both renderers agree on the
    // corner triangle; this pins the canvas side.
    expect(tracedPoints(calls)).toEqual([
      [100, 0],
      [200, 100],
      [0, 100],
    ]);
    // …and documents that it intentionally differs from the shape generator.
    expect(tracedPoints(calls)).not.toEqual(
      polygonPoints(200, 100, 3).map((p) => [p.x, p.y])
    );
  });

  it('traces an ellipse mask across the whole box', () => {
    const { ctx, calls } = record();
    shapeMaskClipFunc({ shape: 'ellipse' }, 200, 100)(ctx);
    expect(calls.find((c) => c[0] === 'ellipse')).toEqual([
      'ellipse',
      100,
      50,
      100,
      50,
      0,
      0,
      Math.PI * 2,
    ]);
  });
});
