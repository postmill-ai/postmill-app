import { describe, expect, it } from 'vitest';
import { canvasZoomAtPoint, clampCanvasZoom, measureCanvasPinch } from './canvas-pinch';

describe('canvas pinch geometry', () => {
  it('measures the centroid and finger separation', () => {
    expect(measureCanvasPinch([{ x: 10, y: 20 }, { x: 40, y: 60 }])).toEqual({
      center: { x: 25, y: 40 },
      distance: 50,
    });
  });

  it('keeps the document point under the zoom centroid', () => {
    const before = { scale: 1, viewport: { x: 20, y: 30 } };
    const point = { x: 220, y: 230 };
    const result = canvasZoomAtPoint({ ...before, point, nextScale: 2 });
    expect(result.scale).toBe(2);
    const documentPoint = {
      x: (point.x - before.viewport.x) / before.scale,
      y: (point.y - before.viewport.y) / before.scale,
    };
    expect(result.viewport.x).toBe(point.x - documentPoint.x * 2);
    expect(result.viewport.y).toBe(point.y - documentPoint.y * 2);
    expect(result.viewport).toEqual({ x: -180, y: -170 });
  });

  it('clamps zoom to the existing canvas limits', () => {
    expect(clampCanvasZoom(0.01)).toBe(0.1);
    expect(clampCanvasZoom(20)).toBe(5);
  });
});
