import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiDesignerCopywriterService } from './ai-designer-copywriter.service';
import type { DesignPlan } from '../../ai-designer.types';

const makePlan = (): DesignPlan => ({
  variantId: 'v1',
  skill: 'social-post',
  concept: 'A clean summer promo',
  palette: ['#fff', '#000'],
  typeScale: { headline: 48 },
  background: { kind: 'solid', value: '#fff' },
  slots: [
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'cta', role: 'cta', kind: 'text' },
    { id: 'image', role: 'image', kind: 'image' },
  ],
  assetNeeds: [],
});

describe('AiDesignerCopywriterService', () => {
  let model: { generateText: ReturnType<typeof vi.fn> };
  let service: AiDesignerCopywriterService;

  beforeEach(() => {
    model = { generateText: vi.fn() };
    service = new AiDesignerCopywriterService(model as any);
  });

  const handler = (raw_input: string, orgId?: string) =>
    (service as any)._handler({
      raw_input,
      metadata: orgId ? { orgId } : {},
    });

  it('parses fenced JSON and returns copy for each text slot', async () => {
    model.generateText.mockResolvedValue(
      '```json\n{"headline":"Summer Sale","cta":"Shop Now"}\n```'
    );

    const res = await handler(
      JSON.stringify({
        type: 'copy-request',
        plan: makePlan(),
        brand: null,
      }),
      'org1'
    );

    const content = JSON.parse(res.content);
    expect(content.type).toBe('copy');
    expect(content.texts).toEqual({
      headline: 'Summer Sale',
      cta: 'Shop Now',
    });
  });

  it('parses a quoted-key line fallback', async () => {
    model.generateText.mockResolvedValue('"headline": "Summer Sale",');

    const res = await handler(
      JSON.stringify({
        type: 'copy-request',
        plan: makePlan(),
        brand: null,
      }),
      'org1'
    );

    const content = JSON.parse(res.content);
    expect(content.texts.headline).toBe('Summer Sale');
  });

  it('returns an empty string for text slots the model omitted', async () => {
    model.generateText.mockResolvedValue('{"headline":"Only headline"}');

    const res = await handler(
      JSON.stringify({
        type: 'copy-request',
        plan: makePlan(),
        brand: null,
      }),
      'org1'
    );

    const content = JSON.parse(res.content);
    expect(content.texts).toEqual({
      headline: 'Only headline',
      cta: '',
    });
  });

  it('returns an error envelope for malformed input', async () => {
    const res = await handler('not-json', 'org1');
    const content = JSON.parse(res.content);
    expect(content.type).toBe('error');
    expect(content.message).toContain('Malformed agent input');
  });
});
