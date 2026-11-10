import { describe, expect, it } from 'vitest';
import {
  canvasPanViewport,
  canvasWheelAction,
  canvasZoomAtPoint,
  clampCanvasZoom,
  measureCanvasPinch,
  normalizeCanvasWheel,
} from './canvas-pinch';

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

describe('touchpad wheel behavior', () => {
  it('keeps ordinary scroll zooming by default', () => {
    expect(canvasWheelAction({ touchpadMode: false, ctrlKey: false, metaKey: false })).toBe('zoom');
  });

  it('pans on an unmodified touchpad scroll and zooms on pinch modifiers', () => {
    expect(canvasWheelAction({ touchpadMode: true, ctrlKey: false, metaKey: false })).toBe('pan');
    expect(canvasWheelAction({ touchpadMode: true, ctrlKey: true, metaKey: false })).toBe('zoom');
    expect(canvasWheelAction({ touchpadMode: true, ctrlKey: false, metaKey: true })).toBe('zoom');
  });

  it('normalizes line and page deltas and pans in both axes', () => {
    expect(normalizeCanvasWheel({ deltaX: 2, deltaY: -3, deltaMode: 0 })).toEqual({ x: 2, y: -3 });
    expect(normalizeCanvasWheel({ deltaX: 2, deltaY: -3, deltaMode: 1 })).toEqual({ x: 32, y: -48 });
    expect(normalizeCanvasWheel({ deltaX: 1, deltaY: 1, deltaMode: 2 })).toEqual({ x: 800, y: 800 });
    expect(canvasPanViewport({ x: 100, y: 50 }, { x: 32, y: -48 })).toEqual({ x: 68, y: 98 });
  });
});
