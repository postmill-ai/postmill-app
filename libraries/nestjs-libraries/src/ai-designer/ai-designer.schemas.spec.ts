import { describe, expect, it } from 'vitest';
import {
  AiDesignerConfigSchema,
  DesignBriefSchema,
  DesignPlanSchema,
} from './ai-designer.schemas';
import { STYLE_PRESET_IDS } from './styles';

// v1 shape: what stored briefs/plans looked like before schema v2 — these must
// keep validating (backward compat with persisted session state).
const makeV1Plan = () => ({
  variantId: 'v1',
  skill: 'social-post',
  concept: 'A clean launch post',
  palette: ['#ffffff', '#000000', '#2B5CD3'],
  typeScale: { headline: 48, body: 24 },
  background: { kind: 'solid', value: '#ffffff' },
  slots: [
    { id: 'image', role: 'image', kind: 'image' },
    { id: 'headline', role: 'headline', kind: 'text' },
  ],
  assetNeeds: [
    { slotId: 'image', brief: 'product shot', prefer: 'either' },
  ],
});

describe('DesignPlanSchema v2', () => {
  it('validates a legacy v1 plan (backward compat)', () => {
    const res = DesignPlanSchema.safeParse(makeV1Plan());
    expect(res.success).toBe(true);
  });

  it('validates a v2 plan with styleId, styled slots and channelLayouts', () => {
    const plan = {
      ...makeV1Plan(),
      styleId: 'bold',
      slots: [
        { id: 'image', role: 'image', kind: 'image' },
        {
          id: 'headline',
          role: 'headline',
          kind: 'text',
          style: {
            fontFamily: 'Anton',
            fontWeight: 700,
            fill: '#FFFFFF',
            gradient: ['#FF4D00', '#FFD400'],
            stroke: { color: '#000000', width: 2 },
            shadow: true,
            align: 'center',
          },
        },
        { id: 'cta', role: 'cta', kind: 'cta-button' },
        { id: 'promo', role: 'badge', kind: 'badge' },
        { id: 'deco', role: 'accent', kind: 'accent-shape' },
      ],
      channelLayouts: {
        'ig-square': 'stacked',
        'x-post': 'side-by-side',
        'custom-1080x1350': 'hero-top',
      },
    };
    const res = DesignPlanSchema.safeParse(plan);
    expect(res.success).toBe(true);
  });

  it('tolerates an unknown styleId instead of sinking the persisted plan', () => {
    // Plans persist inside sessions; a preset retired by a future release must
    // not fail the parse — it falls back to the first preset.
    const res = DesignPlanSchema.safeParse({
      ...makeV1Plan(),
      styleId: 'grunge-core',
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.styleId).toBe(STYLE_PRESET_IDS[0]);
    }
  });

  it('rejects a malformed slot style override', () => {
    const badAlign = DesignPlanSchema.safeParse({
      ...makeV1Plan(),
      slots: [
        {
          id: 'headline',
          role: 'headline',
          kind: 'text',
          style: { align: 'justify' },
        },
      ],
    });
    expect(badAlign.success).toBe(false);

    const badGradient = DesignPlanSchema.safeParse({
      ...makeV1Plan(),
      slots: [
        {
          id: 'headline',
          role: 'headline',
          kind: 'text',
          style: { gradient: ['#fff'] },
        },
      ],
    });
    expect(badGradient.success).toBe(false);
  });

  it('tolerates an unknown channelLayouts value instead of sinking the plan', () => {
    const res = DesignPlanSchema.safeParse({
      ...makeV1Plan(),
      channelLayouts: { 'ig-square': 'masonry' },
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.channelLayouts?.['ig-square']).toBe('stacked');
    }
  });
});

describe('AssetNeed kind (icons, vectors, illustrator)', () => {
  it('round-trips a declared kind', () => {
    const plan = {
      ...makeV1Plan(),
      assetNeeds: [
        { slotId: 'image', brief: 'pizza slice icon', prefer: 'either', kind: 'icon' },
        { slotId: 'hero', brief: 'retro poster art', prefer: 'generate', kind: 'illustration' },
      ],
    };
    const res = DesignPlanSchema.safeParse(plan);
    expect(res.success).toBe(true);
    expect((res as any).data.assetNeeds[0].kind).toBe('icon');
    expect((res as any).data.assetNeeds[1].kind).toBe('illustration');
  });

  it('an unknown kind falls back instead of sinking the plan', () => {
    const plan = {
      ...makeV1Plan(),
      assetNeeds: [
        { slotId: 'image', brief: 'x', prefer: 'either', kind: 'hologram' },
      ],
    };
    const res = DesignPlanSchema.safeParse(plan);
    expect(res.success).toBe(true);
    expect((res as any).data.assetNeeds[0].kind).toBeUndefined();
  });

  it('an absent kind stays absent (legacy plans untouched)', () => {
    const res = DesignPlanSchema.safeParse(makeV1Plan());
    expect(res.success).toBe(true);
    expect((res as any).data.assetNeeds[0].kind).toBeUndefined();
  });
});

describe('DesignPlanSchema craft fields', () => {
  it('accepts the craft dials: tracking, leading, opacity, shadow object', () => {
    const res = DesignPlanSchema.safeParse({
      ...makeV1Plan(),
      slots: [
        {
          id: 'headline',
          role: 'headline',
          kind: 'text',
          style: {
            letterSpacing: 2.5,
            lineHeight: 1.05,
            opacity: 0.9,
            shadow: { color: 'rgba(0,0,0,0.6)', blur: 12, offsetX: 0, offsetY: 4 },
          },
        },
      ],
    });
    expect(res.success).toBe(true);
  });

  it('still accepts the legacy boolean shadow', () => {
    const res = DesignPlanSchema.safeParse({
      ...makeV1Plan(),
      slots: [
        { id: 'headline', role: 'headline', kind: 'text', style: { shadow: false } },
      ],
    });
    expect(res.success).toBe(true);
  });

  it('rejects out-of-range craft values', () => {
    const badTracking = DesignPlanSchema.safeParse({
      ...makeV1Plan(),
      slots: [
        { id: 'headline', role: 'headline', kind: 'text', style: { letterSpacing: 99 } },
      ],
    });
    expect(badTracking.success).toBe(false);

    const badLeading = DesignPlanSchema.safeParse({
      ...makeV1Plan(),
      slots: [
        { id: 'headline', role: 'headline', kind: 'text', style: { lineHeight: 2.5 } },
      ],
    });
    expect(badLeading.success).toBe(false);
  });

  it('accepts scrim and treatmentStrength on image slots', () => {
    const res = DesignPlanSchema.safeParse({
      ...makeV1Plan(),
      slots: [
        {
          id: 'image',
          role: 'image',
          kind: 'image',
          treatment: 'moody-dark',
          treatmentStrength: 0.7,
          scrim: { direction: 'left', strength: 0.6 },
        },
      ],
    });
    expect(res.success).toBe(true);
  });

  it('rejects a malformed scrim', () => {
    const res = DesignPlanSchema.safeParse({
      ...makeV1Plan(),
      slots: [
        {
          id: 'image',
          role: 'image',
          kind: 'image',
          scrim: { direction: 'diagonal', strength: 0.6 },
        },
      ],
    });
    expect(res.success).toBe(false);
  });
});

describe('DesignBriefSchema v2', () => {
  it('accepts a styleId from the registry', () => {
    const res = DesignBriefSchema.safeParse({
      intent: 'Launch post',
      styleId: STYLE_PRESET_IDS[0],
    });
    expect(res.success).toBe(true);
  });

  it('tolerates an unknown styleId instead of sinking the persisted brief', () => {
    const res = DesignBriefSchema.safeParse({
      intent: 'Launch post',
      styleId: 'not-a-style',
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.styleId).toBe(STYLE_PRESET_IDS[0]);
    }
  });
});

describe('AiDesignerConfigSchema v2', () => {
  const baseConfig = { channels: ['ig-post'], variants: 3 };

  it('accepts a valid styleId', () => {
    const res = AiDesignerConfigSchema.safeParse({
      ...baseConfig,
      styleId: 'editorial',
    });
    expect(res.success).toBe(true);
  });

  it('rejects an unknown styleId (strict config object)', () => {
    const res = AiDesignerConfigSchema.safeParse({
      ...baseConfig,
      styleId: 'vaporwave',
    });
    expect(res.success).toBe(false);
  });

  it('still accepts a config without styleId', () => {
    const res = AiDesignerConfigSchema.safeParse(baseConfig);
    expect(res.success).toBe(true);
  });

  it('accepts a custom-sizes-only config (channels may be empty)', () => {
    const res = AiDesignerConfigSchema.safeParse({
      channels: [],
      customSizes: [{ width: 1080, height: 1350 }],
      variants: 1,
    });
    expect(res.success).toBe(true);
  });

  it('rejects a config with neither channels nor custom sizes', () => {
    const res = AiDesignerConfigSchema.safeParse({ channels: [], variants: 1 });
    expect(res.success).toBe(false);
  });
});

describe('badgePosition — never fatal', () => {
  it('accepts the centred positions a poster actually uses', () => {
    for (const position of ['top-center', 'bottom-center', 'center', 'top-left']) {
      const parsed = DesignPlanSchema.safeParse({
        variantId: 'v1',
        skill: 's',
        concept: 'c',
        styleId: 'bold',
        palette: [],
        typeScale: {},
        background: { kind: 'solid' },
        slots: [],
        assetNeeds: [],
        badgePosition: position,
      });
      expect(parsed.success, position).toBe(true);
      if (parsed.success) expect(parsed.data.badgePosition).toBe(position);
    }
  });

  it('degrades an unknown position instead of failing the plan', () => {
    // A stored plan outlives the build that wrote it. This threw before, and
    // because the brief is re-validated on every write the whole SESSION died
    // with "I hit a problem" — for a badge that would have landed a few pixels
    // off.
    const parsed = DesignPlanSchema.safeParse({
      variantId: 'v1',
      skill: 's',
      concept: 'c',
      styleId: 'bold',
      palette: [],
      typeScale: {},
      background: { kind: 'solid' },
      slots: [],
      assetNeeds: [],
      badgePosition: 'middle-nowhere',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.badgePosition).toBeUndefined();
  });
});

describe('slot geometry + reference layout (spatial control)', () => {
  const planWithGeometry = (geometry: unknown) => ({
    ...makeV1Plan(),
    slots: [
      { id: 'headline', role: 'headline', kind: 'text', geometry },
    ],
  });

  it('accepts a stamped slot geometry', () => {
    const res = DesignPlanSchema.safeParse(
      planWithGeometry({ yBand: [0.08, 0.2], xAnchor: 'left', heightRatio: 0.11 })
    );
    expect(res.success).toBe(true);
    if (res.success) {
      expect((res.data.slots[0] as any).geometry.yBand).toEqual([0.08, 0.2]);
    }
  });

  it('rejects out-of-range geometry values', () => {
    expect(
      DesignPlanSchema.safeParse(planWithGeometry({ yBand: [0.1, 7] })).success
    ).toBe(false);
    expect(
      DesignPlanSchema.safeParse(planWithGeometry({ heightRatio: 0.9 })).success
    ).toBe(false);
  });

  it('round-trips a brief carrying referenceLayout + referenceCueFileIds', () => {
    const res = DesignBriefSchema.safeParse({
      intent: 'clone this',
      referenceCues: ['COMPOSITION: type stack top-left'],
      referenceCueFileIds: ['file-1'],
      referenceLayout: {
        lines: [
          {
            text: 'PIZZA',
            yBand: [0.08, 0.2],
            xAnchor: 'left',
            heightRatio: 0.11,
            fontClass: 'condensed slab serif',
            case: 'caps',
          },
        ],
        badge: { yBand: [0.6, 0.66], shape: 'ribbon' },
        image: { coverage: 'full-bleed' },
        ornaments: [{ kind: 'wavy rule', nearLineIndex: 0 }],
      },
    });
    expect(res.success).toBe(true);
  });

  it('rejects a malformed referenceLayout so a bad measurement can never poison the session row', () => {
    const res = DesignBriefSchema.safeParse({
      intent: 'clone this',
      referenceLayout: { lines: [{ text: 'x', yBand: [0, 'bottom'] }] },
    });
    expect(res.success).toBe(false);
  });
});
