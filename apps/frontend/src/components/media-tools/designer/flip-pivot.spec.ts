import { describe, it, expect } from 'vitest';
import Konva from 'konva';

/**
 * Flip offsets and the rotation pivot (suspected residual, EXONERATED).
 *
 * A flipped leaf renders with `scaleX: -1, offsetX: width` (and likewise for
 * Y). The suspicion was that the offset displaces the rotation centre, so a
 * flipped element would rotate about a different pivot than an unflipped one
 * and read as jump/skew.
 *
 * It does not: Konva composes the node transform as
 * T(x, y) · R(θ) · S(±1) · T(−offset), so the offset sits INSIDE the mirror
 * and only re-centres it on the element's own box. Rotation happens about the
 * same stage-space point (x, y) whether or not the element is flipped, and
 * the rotated FRAME occupies the same stage rect. These specs pin that, so
 * the offset is never "simplified" away.
 *
 * (The frame — not a shape's points bbox — is what has to agree: mirroring an
 * asymmetric point set like a 5-point star legitimately changes its points
 * bbox, because the flipped star genuinely points the other way.)
 */

const rectNode = (over: Partial<Konva.RectConfig>): Konva.Rect =>
  new Konva.Rect({
    x: 40,
    y: 24,
    width: 200,
    height: 100,
    ...over,
  });

const clientBox = (node: Konva.Rect) => {
  const r = node.getClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
};

const expectSameBox = (a: Konva.Rect, b: Konva.Rect) => {
  const ra = clientBox(a);
  const rb = clientBox(b);
  expect(rb.x).toBeCloseTo(ra.x, 6);
  expect(rb.y).toBeCloseTo(ra.y, 6);
  expect(rb.width).toBeCloseTo(ra.width, 6);
  expect(rb.height).toBeCloseTo(ra.height, 6);
};

describe('flip offsets and the rotation pivot', () => {
  it('an unrotated flipped element occupies exactly the unflipped box', () => {
    expectSameBox(rectNode({}), rectNode({ scaleX: -1, offsetX: 200 }));
    expectSameBox(rectNode({}), rectNode({ scaleY: -1, offsetY: 100 }));
  });

  it.each([30, 90, 137])(
    'a flipX element rotated %i° occupies the same stage rect as the unflipped one',
    (rotation) => {
      expectSameBox(
        rectNode({ rotation }),
        rectNode({ rotation, scaleX: -1, offsetX: 200 })
      );
    }
  );

  it.each([30, 90, 137])(
    'a flipY element rotated %i° occupies the same stage rect as the unflipped one',
    (rotation) => {
      expectSameBox(
        rectNode({ rotation }),
        rectNode({ rotation, scaleY: -1, offsetY: 100 })
      );
    }
  );

  it('flipX + flipY together also keep the rotated box', () => {
    expectSameBox(
      rectNode({ rotation: 60 }),
      rectNode({ rotation: 60, scaleX: -1, scaleY: -1, offsetX: 200, offsetY: 100 })
    );
  });
});
