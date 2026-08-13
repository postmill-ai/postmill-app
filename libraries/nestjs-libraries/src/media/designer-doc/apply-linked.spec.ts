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
  it('re-fits a shared fontSize through the aspect-aware type basis', () => {
    const { outputs, affected } = applyLinked(
      makeDoc(),
      0,
      new Set(['e1']),
      { fontSize: 64 },
      false
    );

    expect((outputs[0] as any).children[0].fontSize).toBe(64);
    // 64 × (typeBasis(1200,675) / typeBasis(1080,1080)) = 64 × (900/1080) = 53.
    // The old min(scaleX, scaleY) = 0.625 gave 40 — short-edge typography
    // re-imposed on a canvas 11% WIDER than the one the value was authored on.
    expect((outputs[1] as any).children[0].fontSize).toBe(53);
    expect(affected).toEqual([1]);
  });

  it('never re-imposes short-edge type on a wider linked output', () => {
    const { outputs } = applyLinked(
      makeDoc(),
      0,
      new Set(['e1']),
      { fontSize: 64 },
      false
    );
    // The wider canvas gets MORE type than the min-axis scale would have
    // given it, not less — the whole point of the shared basis.
    const minAxisScale = Math.min(1200 / 1080, 675 / 1080);
    expect((outputs[1] as any).children[0].fontSize).toBeGreaterThan(
      Math.round(64 * minAxisScale)
    );
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

describe('applyLinked symbol overrides', () => {
  /** Two outputs whose CTA is a lockup instance at originId 'cta'. */
  const makeSymbolDoc = (): DesignerDoc =>
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
              originId: 'cta',
              type: 'symbol',
              symbolId: 'lockup-cta',
              x: 434,
              y: 856,
              width: 213,
              height: 59,
              symbolOverrides: { label: { text: 'Shop now' } },
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
              originId: 'cta',
              type: 'symbol',
              symbolId: 'lockup-cta',
              x: 500,
              y: 500,
              width: 180,
              height: 50,
              // A format-only fill fix this sibling already carries.
              symbolOverrides: {
                label: { text: 'Shop now' },
                plate: { fill: '#111111' },
              },
            },
          ],
        },
      ],
    } as any);

  it('propagates a CTA text edit to sibling instances, merging per child id', () => {
    const { outputs, affected } = applyLinked(
      makeSymbolDoc(),
      0,
      new Set(['e1']),
      { symbolOverrides: { label: { text: 'Shop the sale' } } },
      false
    );

    expect((outputs[0] as any).children[0].symbolOverrides).toEqual({
      label: { text: 'Shop the sale' },
    });
    // The sibling's own plate fill survives — a blind spread of the primary's
    // map would have clobbered it.
    expect((outputs[1] as any).children[0].symbolOverrides).toEqual({
      label: { text: 'Shop the sale' },
      plate: { fill: '#111111' },
    });
    expect(affected).toEqual([1]);
  });

  it('never propagates the instance box — geometry stays per-format', () => {
    const { outputs } = applyLinked(
      makeSymbolDoc(),
      0,
      new Set(['e1']),
      { x: 100, symbolOverrides: { label: { text: 'Shop the sale' } } },
      false
    );

    expect((outputs[0] as any).children[0].x).toBe(100);
    expect((outputs[1] as any).children[0].x).toBe(500);
    expect((outputs[1] as any).children[0].symbolOverrides.label).toEqual({
      text: 'Shop the sale',
    });
  });
});
