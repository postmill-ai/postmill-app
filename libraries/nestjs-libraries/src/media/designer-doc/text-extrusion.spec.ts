import { describe, expect, it } from 'vitest';
import { extrusionOffsets, MAX_EXTRUSION_DEPTH, textExtrusionSource } from './text-extrusion';

describe('text extrusion', () => {
  it('returns far-to-near integer-stepped offsets', () => {
    const offsets = extrusionOffsets({ depth: 3, angle: 0 }, 1);
    expect(offsets).toHaveLength(3);
    expect(offsets[0].x).toBeCloseTo(-3);
    expect(offsets[2].x).toBeCloseTo(-1);
    expect(offsets.every((offset) => offset.y === 0)).toBe(true);
  });

  it('scales with render ratio and caps depth to bound render cost', () => {
    expect(extrusionOffsets({ depth: 3, angle: 0 }, 2)).toHaveLength(6);
    expect(extrusionOffsets({ depth: 1000, angle: 0 }, 1)).toHaveLength(MAX_EXTRUSION_DEPTH);
    expect(extrusionOffsets({ depth: 0, angle: 0 }, 1)).toEqual([]);
  });

  it('injects the shared offset math without imported namespaces', () => {
    const source = textExtrusionSource();
    expect(source).toContain('const extrusionOffsets');
    expect(source).toContain('const styleOffset');
    expect(source).not.toContain('layer-styles');
  });
});
