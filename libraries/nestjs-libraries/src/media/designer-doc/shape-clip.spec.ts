import { describe, it, expect } from 'vitest';
import {
  DesignerDocStrictSchema,
  DesignerDocLenientSchema,
} from './designer-doc.schema';
import { shapeGeometrySource, pointsForShape } from './shape-geometry';
import { DESIGNER_DOC_VERSION } from './designer-doc.limits';

const shapeClipDoc = (over: Record<string, unknown> = {}) => ({
  version: DESIGNER_DOC_VERSION,
  mode: 'video',
  outputs: [
    {
      id: 'out-1',
      formatId: 'square',
      name: 'Square',
      width: 1080,
      height: 1080,
      fps: 30,
      durationMs: 10000,
      tracks: [
        {
          id: 'tr-1',
          type: 'shape',
          clips: [
            {
              id: 'c1',
              startMs: 0,
              endMs: 4000,
              x: 10,
              y: 20,
              width: 200,
              height: 100,
              shape: 'star',
              sides: 5,
              innerRatio: 0.5,
              fill: '#2B5CD3',
              stroke: '#000000',
              strokeWidth: 2,
              ...over,
            },
          ],
        },
      ],
    },
  ],
});

describe('shape clips (doc v5)', () => {
  it('validates through the strict schema', () => {
    const result = DesignerDocStrictSchema.safeParse(shapeClipDoc());
    expect(result.success).toBe(true);
  });

  it('validates through the lenient schema', () => {
    expect(DesignerDocLenientSchema.safeParse(shapeClipDoc()).success).toBe(true);
  });

  it('rejects a shape outside the enum', () => {
    const bad = shapeClipDoc({ shape: 'hexagram' });
    expect(DesignerDocStrictSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an out-of-range side count', () => {
    expect(DesignerDocStrictSchema.safeParse(shapeClipDoc({ sides: 2 })).success).toBe(false);
    expect(DesignerDocStrictSchema.safeParse(shapeClipDoc({ sides: 500 })).success).toBe(false);
  });

  it('still accepts a v4 document with no shape track', () => {
    const v4 = {
      version: 4,
      mode: 'image',
      outputs: [
        {
          id: 'o',
          formatId: 'square',
          name: 'S',
          width: 100,
          height: 100,
          background: '#fff',
          children: [],
        },
      ],
    };
    expect(DesignerDocStrictSchema.safeParse(v4).success).toBe(true);
  });
});

describe('crop and paint clips (doc v5)', () => {
  const withClip = ({ trackType = 'image', ...clip }: Record<string, unknown>) => ({
    version: DESIGNER_DOC_VERSION,
    mode: 'video',
    outputs: [
      {
        id: 'o', formatId: 'square', name: 'S',
        width: 1080, height: 1080, fps: 30, durationMs: 10000,
        // The strict schema rejects unknown keys, and an explicit `undefined`
        // still counts as a key — so trackType is destructured off, not blanked.
        tracks: [
          { id: 't', type: trackType, clips: [{ id: 'c', startMs: 0, endMs: 1000, ...clip }] },
        ],
      },
    ],
  });

  it('accepts an explicit source-pixel crop on a clip', () => {
    const doc = withClip({ src: 'https://x/y.png', crop: { x: 10, y: 20, width: 100, height: 80 } });
    expect(DesignerDocStrictSchema.safeParse(doc).success).toBe(true);
  });

  it('accepts a raster (paint) track', () => {
    const doc = withClip({ trackType: 'raster', src: 'https://x/paint.png', width: 1080, height: 1080 });
    expect(DesignerDocStrictSchema.safeParse(doc).success).toBe(true);
  });

  it('rejects a crop with a non-numeric edge', () => {
    const doc = withClip({ crop: { x: 'left', y: 0, width: 10, height: 10 } });
    expect(DesignerDocStrictSchema.safeParse(doc).success).toBe(false);
  });

  it('accepts fitMode on a clip, which the frame renderer already honours', () => {
    expect(DesignerDocStrictSchema.safeParse(withClip({ fitMode: 'cover' })).success).toBe(true);
    expect(DesignerDocStrictSchema.safeParse(withClip({ fitMode: 'sideways' })).success).toBe(false);
  });
});

describe('shapeGeometrySource', () => {
  // The frame renderer runs in a headless page and cannot import: it gets this
  // source injected. If it ever drifts from the real functions, exported video
  // silently stops matching the canvas.
  it('evaluates to functions that match the real ones', () => {
    const factory = new Function(
      `${shapeGeometrySource()}\nreturn { pointsForShape, flattenPoints };`
    );
    const injected = factory() as {
      pointsForShape: typeof pointsForShape;
      flattenPoints: (p: { x: number; y: number }[]) => number[];
    };

    for (const shape of ['triangle', 'polygon', 'star']) {
      expect(injected.pointsForShape(shape, 200, 100, 6, 0.4)).toEqual(
        pointsForShape(shape, 200, 100, 6, 0.4)
      );
    }
  });

  it('returns null for non-polygonal shapes, like the original', () => {
    const factory = new Function(
      `${shapeGeometrySource()}\nreturn { pointsForShape };`
    );
    const injected = factory() as { pointsForShape: typeof pointsForShape };
    expect(injected.pointsForShape('rect', 10, 10)).toBeNull();
    expect(injected.pointsForShape('ellipse', 10, 10)).toBeNull();
  });

  it('is self-contained — no free identifiers to resolve', () => {
    // Evaluating in strict mode with no scope would throw on any missing
    // dependency the extraction forgot to include.
    expect(() => new Function(`"use strict";${shapeGeometrySource()}`)()).not.toThrow();
  });
});
