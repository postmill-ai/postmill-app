import { describe, expect, it } from 'vitest';
import { findEqualSpacing } from '@postmill-ai/nestjs-libraries/media/designer-doc/align-distribute';
import {
  boundsForSnapBoxes,
  EQUAL_SPACING_DOCUMENT_PX,
  nearestSnap,
  selectionIncludesDraggedNode,
  snapToleranceForZoom,
} from './canvas-snap';

describe('canvas snapping', () => {
  it('uses a consistent six-screen-pixel tolerance at low zoom', () => {
    expect(snapToleranceForZoom(1)).toBe(6);
    expect(snapToleranceForZoom(0.1)).toBe(60);
    const box = { x: 9000, y: 8000, width: 500, height: 400 };

    expect(nearestSnap(box, [9060, 10000], [8000], 0.1)).toMatchObject({
      dx: 60,
      verticalGuide: 9060,
    });
    expect(nearestSnap(box, [9061], [8000], 0.1).dx).toBe(0);
    expect(nearestSnap(box, [9012], [8000], 0.5).dx).toBe(12);
    expect(nearestSnap(box, [9013], [8000], 0.5).dx).toBe(0);
  });

  it('chooses only the nearest guide', () => {
    const result = nearestSnap(
      { x: 100, y: 100, width: 100, height: 100 },
      [105, 103, 112],
      [110, 104],
      1
    );

    expect(result).toEqual({
      dx: 3,
      dy: 4,
      verticalGuide: 103,
      horizontalGuide: 104,
    });
  });

  it('snaps the combined multi-select bounds instead of one member', () => {
    const bounds = boundsForSnapBoxes([
      { x: 1000, y: 1000, width: 200, height: 100 },
      { x: 1400, y: 1200, width: 200, height: 100 },
    ]);
    expect(bounds).toEqual({ x: 1000, y: 1000, width: 600, height: 300 });

    const result = nearestSnap(bounds, [1624, 1700], [1300], 0.25);
    expect(result.dx).toBe(24);
    expect(result.verticalGuide).toBe(1624);
    expect(result.dy).toBe(0);
  });

  it('uses multi-selection bounds only when the dragged node is attached', () => {
    expect(selectionIncludesDraggedNode(['one', 'two'], 'one')).toBe(true);
    expect(selectionIncludesDraggedNode(['one', 'two'], 'unselected')).toBe(false);
    expect(selectionIncludesDraggedNode(['one'], 'one')).toBe(false);
    expect(selectionIncludesDraggedNode([], 'guide')).toBe(false);
  });

  it('classifies equal spacing with fixed document-space tolerance at low zoom', () => {
    const others = [
      { id: 'a', x: 0, y: 0, width: 100, height: 100 },
      { id: 'b', x: 160, y: 0, width: 100, height: 100 },
    ];
    const equal = { id: 'moving', x: 320, y: 0, width: 100, height: 100 };
    const sixtyPixelsOff = { ...equal, x: 380 };

    expect(findEqualSpacing(equal, others, EQUAL_SPACING_DOCUMENT_PX)).not.toBeNull();
    expect(findEqualSpacing(sixtyPixelsOff, others, EQUAL_SPACING_DOCUMENT_PX)).toBeNull();
    expect(findEqualSpacing(sixtyPixelsOff, others, snapToleranceForZoom(0.1))).not.toBeNull();
  });
});
