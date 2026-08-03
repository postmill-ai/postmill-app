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
