import { describe, expect, it } from 'vitest';
import { buildBadgePlate } from './badge-plate';

const BOX = { x: 100, y: 200, width: 300, height: 60 };
const CANVAS = { w: 1080, h: 1080 };

describe('buildBadgePlate', () => {
  it('builds a pill as a rect with a half-height radius', () => {
    const plate = buildBadgePlate(BOX, 'pill', '#C0392B', CANVAS, 'badge') as any;
    expect(plate.type).toBe('shape');
    expect(plate.shape).toBe('rect');
    expect(plate.x).toBe(100);
    expect(plate.width).toBe(300);
    expect(plate.borderRadius).toBe(30);
    expect(plate.originId).toBe('badge-bg');
    expect(plate.groupId).toBe('badge');
  });

  it('honors a plan-authored borderRadius over the pill default', () => {
    const plate = buildBadgePlate(BOX, 'pill', '#C0392B', CANVAS, 'badge', {
      borderRadius: 8,
    }) as any;
    expect(plate.borderRadius).toBe(8);
  });

  it('builds a ribbon as a closed canvas-box path whose edges bow the SAME way', () => {
    const plate = buildBadgePlate(BOX, 'ribbon', '#C0392B', CANVAS, 'badge') as any;
    expect(plate.type).toBe('path');
    expect(plate.closed).toBe(true);
    // Canvas box + absolute nodes — the emit-decor contract.
    expect(plate.x).toBe(0);
    expect(plate.width).toBe(CANVAS.w);
    expect(plate.originId).toBe('badge-bg');
    // The "1893 barrel" regression: both long edges must bow in the same
    // direction (control points above their anchors on top AND bottom), or
    // the band fattens into a lens instead of arching.
    const [topLeft, topRight, bottomRight, bottomLeft] = plate.nodes;
    expect(topLeft.outY).toBeLessThan(topLeft.y);
    expect(topRight.inY).toBeLessThan(topRight.y);
    expect(bottomRight.outY).toBeLessThan(bottomRight.y);
    expect(bottomLeft.inY).toBeLessThan(bottomLeft.y);
  });
});
