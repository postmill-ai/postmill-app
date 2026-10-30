import { computeCoverCrop, computeMediaDraw, mediaGeometrySource } from './media-geometry';

const input = {
  sourceWidth: 800,
  sourceHeight: 600,
  targetWidth: 200,
  targetHeight: 400,
};

describe('computeMediaDraw', () => {
  it('cover-crops toward an off-center focal point without distorting', () => {
    const result = computeMediaDraw({
      ...input,
      fitMode: 'cover',
      focalPoint: { x: 0.75, y: 0.25 },
    });
    expect(result.source).toEqual({ x: 375, y: 0, width: 300, height: 600 });
    expect(result.destination).toEqual({ x: 0, y: 0, width: 200, height: 400 });
    expect(result.source.width / result.source.height).toBeCloseTo(200 / 400, 10);
  });

  it('contains with one uniform scale and centered letterboxing', () => {
    expect(computeMediaDraw({ ...input, fitMode: 'contain' })).toEqual({
      source: { x: 0, y: 0, width: 800, height: 600 },
      destination: { x: 0, y: 125, width: 200, height: 150 },
    });
  });

  it('stretches only for fill, including the static-media default', () => {
    const destination = { x: 0, y: 0, width: 200, height: 400 };
    expect(computeMediaDraw({ ...input, fitMode: 'fill' }).destination).toEqual(destination);
    expect(computeMediaDraw(input).destination).toEqual(destination);
  });

  it('gives an explicit crop precedence without stretching a legacy mismatched box', () => {
    const crop = { x: 40, y: 60, width: 200, height: 100 };
    for (const fitMode of ['cover', 'contain', 'fill', undefined] as const) {
      expect(computeMediaDraw({ ...input, crop, fitMode })).toEqual({
        source: crop,
        destination: { x: 0, y: 150, width: 200, height: 100 },
      });
    }
  });

  it('serializes the exact same geometry for the injected frame renderer', () => {
    const injected = new Function(
      `${mediaGeometrySource()}; return { computeCoverCrop, computeMediaDraw };`
    )() as { computeCoverCrop: typeof computeCoverCrop; computeMediaDraw: typeof computeMediaDraw };
    const cases = [
      input,
      { ...input, fitMode: 'cover' as const, focalPoint: { x: 0.8, y: 0.1 } },
      { ...input, fitMode: 'contain' as const },
      { ...input, fitMode: 'fill' as const },
      { ...input, crop: { x: 20, y: 30, width: 300, height: 200 } },
    ];
    for (const testCase of cases) {
      expect(injected.computeMediaDraw(testCase)).toEqual(computeMediaDraw(testCase));
    }
  });
});
