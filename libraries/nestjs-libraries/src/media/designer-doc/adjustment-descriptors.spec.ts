import { describe, it, expect } from 'vitest';
import {
  ADJUSTMENT_DESCRIPTORS,
  ADJUSTMENT_DESCRIPTOR_BY_TYPE,
  IDENTITY_CURVE,
} from './adjustment-descriptors';
import { applyAdjustment, defaultAdjustmentValues } from './pixel-ops';
import { DesignerDocStrictSchema } from './designer-doc.schema';
import type { DesignerAdjustment } from './designer-doc.schema';

/**
 * The descriptor table is what the inspector renders, `defaultAdjustmentValues`
 * is what a new layer is born with, and `applyAdjustment` is what actually
 * moves pixels. Three lists that must not drift.
 */

/**
 * Whether each adjustment is neutral at its defaults. Typed as a total record,
 * so adding a case to the union stops compiling until it is classified — the
 * compile-time half of the drift guard.
 */
const NEUTRAL_AT_DEFAULTS: Record<DesignerAdjustment['type'], boolean> = {
  'brightness-contrast': true,
  levels: true,
  curves: true,
  exposure: true,
  'hue-saturation': true,
  'color-balance': true,
  'channel-mixer': true,
  'selective-color': true,
  vibrance: true,
  'clarity-dehaze': true,
  // These four are their own effect — there is no "off" setting to land on.
  invert: false,
  'black-white': false,
  posterize: false,
  threshold: false,
  // Both are born configured: a 25% warming filter, and a black→white ramp.
  'photo-filter': false,
  'gradient-map': false,
};

const ALL_TYPES = Object.keys(NEUTRAL_AT_DEFAULTS) as DesignerAdjustment['type'][];

const image = (w: number, h: number, rgb: [number, number, number]) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
  }
  return { width: w, height: h, data, colorSpace: 'srgb' } as unknown as ImageData;
};

describe('ADJUSTMENT_DESCRIPTORS', () => {
  it('describes every adjustment there is', () => {
    for (const type of ALL_TYPES) {
      expect(ADJUSTMENT_DESCRIPTOR_BY_TYPE[type], `no descriptor for ${type}`).toBeTruthy();
    }
    expect(ADJUSTMENT_DESCRIPTORS).toHaveLength(ALL_TYPES.length);
  });

  it('describes no adjustment that does not exist', () => {
    for (const d of ADJUSTMENT_DESCRIPTORS) {
      expect(ALL_TYPES).toContain(d.type);
    }
  });

  it('covers every scalar a new layer is born with', () => {
    for (const d of ADJUSTMENT_DESCRIPTORS) {
      const keys = Object.keys(defaultAdjustmentValues(d.type));
      const described = d.params.map((p) => p.key);
      for (const key of keys) {
        expect(described, `${d.type}.${key} has no slider`).toContain(key);
      }
    }
  });

  it('describes no parameter the op would ignore', () => {
    for (const d of ADJUSTMENT_DESCRIPTORS) {
      const keys = Object.keys(defaultAdjustmentValues(d.type));
      for (const p of d.params) {
        expect(keys, `${d.type}.${p.key} is not a real value`).toContain(p.key);
      }
    }
  });

  it('takes its defaults from defaultAdjustmentValues, never a second copy', () => {
    for (const d of ADJUSTMENT_DESCRIPTORS) {
      const defaults = defaultAdjustmentValues(d.type);
      for (const p of d.params) {
        expect(p.default, `${d.type}.${p.key}`).toBe(defaults[p.key]);
      }
    }
  });

  it('brackets each default inside its own range', () => {
    for (const d of ADJUSTMENT_DESCRIPTORS) {
      for (const p of d.params) {
        expect(p.min, `${d.type}.${p.key}`).toBeLessThanOrEqual(p.default);
        expect(p.max, `${d.type}.${p.key}`).toBeGreaterThanOrEqual(p.default);
        expect(p.step).toBeGreaterThan(0);
      }
    }
  });

  it('gives every adjustment something to configure, except Invert', () => {
    for (const d of ADJUSTMENT_DESCRIPTORS) {
      const configurable = d.params.length > 0 || d.curves || d.gradient || d.color;
      if (!configurable) expect(d.type).toBe('invert');
    }
  });
});

describe('neutral defaults', () => {
  const run = (type: DesignerAdjustment['type']) => {
    const data = image(4, 4, [90, 140, 200]);
    const before = [...data.data];
    const d = ADJUSTMENT_DESCRIPTOR_BY_TYPE[type];
    applyAdjustment(data, {
      type,
      values: defaultAdjustmentValues(type),
      ...(d.curves ? { curves: { rgb: IDENTITY_CURVE } } : {}),
      ...(d.color ? { color: d.color } : {}),
      ...(d.gradient ? { gradient: d.gradient } : {}),
    });
    return { before, after: [...data.data] };
  };

  it('leaves pixels where they were for every neutral adjustment', () => {
    for (const type of ALL_TYPES) {
      if (!NEUTRAL_AT_DEFAULTS[type]) continue;
      const { before, after } = run(type);
      for (let i = 0; i < before.length; i++) {
        // HSL round-trips cost at most a unit; anything larger is a real shift.
        expect(Math.abs(after[i] - before[i]), `${type} moved channel ${i}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('and genuinely changes them for the ones that are their own effect', () => {
    for (const type of ALL_TYPES) {
      if (NEUTRAL_AT_DEFAULTS[type]) continue;
      const { before, after } = run(type);
      expect(after, `${type} did nothing`).not.toEqual(before);
    }
  });
});

describe('IDENTITY_CURVE', () => {
  it('leaves an image untouched', () => {
    const data = image(2, 2, [10, 128, 250]);
    const before = [...data.data];
    applyAdjustment(data, { type: 'curves', curves: { rgb: IDENTITY_CURVE } });
    expect([...data.data]).toEqual(before);
  });
});

describe('photo-filter colour', () => {
  it('survives a document round-trip', () => {
    const doc = {
      version: 5,
      mode: 'image',
      outputs: [
        {
          id: 'o',
          formatId: 'square',
          name: 'S',
          width: 100,
          height: 100,
          background: '#ffffff',
          children: [
            {
              id: 'a',
              type: 'adjustment',
              x: 0, y: 0, width: 100, height: 100,
              rotation: 0, opacity: 1, locked: false, hidden: false,
              adjustment: {
                type: 'photo-filter',
                color: '#ff0000',
                values: { density: 50, preserveLuminosity: 1 },
              },
            },
          ],
        },
      ],
    };

    const parsed = DesignerDocStrictSchema.safeParse(doc);
    expect(parsed.success, JSON.stringify((parsed as { error?: unknown }).error)).toBe(true);
    const el = (
      parsed as unknown as {
        data: { outputs: { children: { adjustment?: { color?: string } }[] }[] };
      }
    ).data.outputs[0].children[0];
    expect(el.adjustment?.color).toBe('#ff0000');
  });

  it('tints towards the stored colour', () => {
    const data = image(2, 2, [128, 128, 128]);
    applyAdjustment(data, {
      type: 'photo-filter',
      color: '#0000ff',
      values: { density: 100, preserveLuminosity: 0 },
    });
    expect(data.data[2]).toBeGreaterThan(data.data[0]);
  });
});
