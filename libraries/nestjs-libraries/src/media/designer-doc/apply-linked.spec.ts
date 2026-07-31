import { describe, expect, it } from 'vitest';
import { applyLinked } from './apply-linked';
import type { DesignerDoc } from './designer-doc.schema';

const makeDoc = (): DesignerDoc =>
  ({
    mode: 'image',
    outputs: [
      {
        id: 'o1',
        formatId: 'ig-square',
        name: 'IG',
        width: 1080,
        height: 1080,
        background: '#ffffff',
        children: [
          {
            id: 'e1',
            originId: 'headline',
            type: 'text',
            x: 0,
            y: 100,
            width: 1080,
            height: 200,
            text: 'Hello',
            fontSize: 48,
          },
        ],
      },
      {
        id: 'o2',
        formatId: 'fb-wide',
        name: 'FB',
        width: 1200,
        height: 675,
        background: '#ffffff',
        children: [
          {
            id: 'e9',
            originId: 'headline',
            type: 'text',
            x: 0,
            y: 60,
            width: 1200,
            height: 112,
            text: 'Hello',
            fontSize: 30,
          },
        ],
      },
    ],
  } as any);

describe('applyLinked fontSize propagation', () => {
  it('scales a shared fontSize by each output\'s scale relative to the source', () => {
    const { outputs, affected } = applyLinked(
      makeDoc(),
      0,
      new Set(['e1']),
      { fontSize: 64 },
      false
    );

    expect((outputs[0] as any).children[0].fontSize).toBe(64);
    // 64 * min(1200/1080, 675/1080) = 64 * 0.625 = 40.
    expect((outputs[1] as any).children[0].fontSize).toBe(40);
    expect(affected).toEqual([1]);
  });

  it('propagates non-fontSize style updates raw', () => {
    const { outputs } = applyLinked(
      makeDoc(),
      0,
      new Set(['e1']),
      { fill: '#000000' },
      false
    );

    expect((outputs[0] as any).children[0].fill).toBe('#000000');
    expect((outputs[1] as any).children[0].fill).toBe('#000000');
  });

  it('keeps the edit on the current output when editFormatOnly is set', () => {
    const { outputs, affected } = applyLinked(
      makeDoc(),
      0,
      new Set(['e1']),
      { fontSize: 64 },
      true
    );

    expect((outputs[0] as any).children[0].fontSize).toBe(64);
    expect((outputs[1] as any).children[0].fontSize).toBe(30);
    expect(affected).toEqual([]);
  });
});
