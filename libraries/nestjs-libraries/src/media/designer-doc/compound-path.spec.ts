import { describe, expect, it, vi } from 'vitest';
import { tracePathContours } from './path-geometry';
import { warpedOutlines } from './warp';
import { applyElementPatch } from './apply-linked';
import { smartReflow } from './reflow';
import type { DesignerElement } from './designer-doc.schema';

const outer = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
const inner = [{ x: 25, y: 25 }, { x: 75, y: 25 }, { x: 75, y: 75 }, { x: 25, y: 75 }];

describe('compound paths', () => {
  it('traces every contour into one path', () => {
    const ctx = {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      bezierCurveTo: vi.fn(),
      closePath: vi.fn(),
    };

    tracePathContours(ctx, [outer, inner], true);

    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.moveTo).toHaveBeenCalledTimes(2);
    expect(ctx.closePath).toHaveBeenCalledTimes(2);
    expect(ctx.lineTo).toHaveBeenCalledTimes(8);
  });

  it('warps every contour instead of dropping holes', () => {
    const element = {
      type: 'path', shape: undefined, width: 100, height: 100,
      nodes: outer, subpaths: [outer, inner], closed: true,
      warp: { preset: 'arc', bend: 20 },
    } as const;

    const contours = warpedOutlines(element as unknown as DesignerElement);

    expect(contours).toHaveLength(2);
    expect(contours?.[0]).not.toEqual(contours?.[1]);
  });

  it('scales every contour with the element box', () => {
    const element = {
      id: 'path-1', type: 'path', x: 0, y: 0, width: 100, height: 100,
      nodes: outer, subpaths: [outer, inner], fillRule: 'evenodd', closed: true,
    } as DesignerElement;

    const patch = applyElementPatch(element, { width: 200, height: 50 });

    expect(patch.nodes?.[1]).toEqual({ x: 200, y: 0 });
    expect(patch.subpaths?.[1][0]).toEqual({ x: 50, y: 12.5 });
    expect(patch.fillRule).toBe('evenodd');
    expect(element.subpaths?.[1][0]).toEqual({ x: 25, y: 25 });
  });

  it('reflows every contour and handle with the element box', () => {
    const curvedInner = inner.map((node, index) =>
      index === 0 ? { ...node, inX: 20, inY: 20, outX: 30, outY: 30 } : node
    );
    const element = {
      id: 'path-1', type: 'path', x: 0, y: 0, width: 100, height: 100,
      nodes: outer, subpaths: [outer, curvedInner], fillRule: 'evenodd', closed: true,
    } as DesignerElement;

    const patch = smartReflow(
      element,
      { width: 100, height: 100 },
      { width: 200, height: 200 }
    );

    expect(patch).toMatchObject({ width: 200, height: 200 });
    expect(patch.nodes?.[1]).toEqual({ x: 200, y: 0 });
    expect(patch.subpaths?.[1][0]).toEqual({
      x: 50, y: 50, inX: 40, inY: 40, outX: 60, outY: 60,
    });
    expect(element.subpaths?.[1][0]).toEqual(curvedInner[0]);
  });
});
