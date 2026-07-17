import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiDesignerArtDirectorService } from './ai-designer-art-director.service';
import type { DesignPlan } from '../../ai-designer.types';

const makeRequest = () =>
  JSON.stringify({
    type: 'plan-request',
    brief: {
      intent: 'A bold product launch graphic',
      audience: 'mobile users',
      tone: 'energetic',
    },
    config: {
      channels: ['ig-square'],
      variants: 1,
    },
    mode: 'prompt',
  });

describe('AiDesignerArtDirectorService', () => {
  let skillRouter: {
    route: ReturnType<typeof vi.fn>;
    getSkillPrompt: ReturnType<typeof vi.fn>;
  };
  let brands: { getBrand: ReturnType<typeof vi.fn> };
  let model: { generateObject: ReturnType<typeof vi.fn> };
  let service: AiDesignerArtDirectorService;

  beforeEach(() => {
    skillRouter = {
      route: vi.fn(() => ({ skillId: 'social-post' })),
      getSkillPrompt: vi.fn(() => 'skill prompt'),
    };
    brands = { getBrand: vi.fn() };
    model = { generateObject: vi.fn() };
    service = new AiDesignerArtDirectorService(
      skillRouter as any,
      brands as any,
      model as any
    );
  });

  const handler = (raw_input: string, orgId?: string) =>
    (service as any)._handler({
      raw_input,
      metadata: orgId ? { orgId } : {},
    });

  it('replaces an invalid plan item with a fallback plan', async () => {
    model.generateObject.mockResolvedValue({
      type: 'plans',
      plans: [{ concept: 'x' }],
    });

    const res = await handler(makeRequest(), 'org1');
    const content = JSON.parse(res.content);

    expect(content.type).toBe('plans');
    expect(content.plans).toHaveLength(1);
    const plan: DesignPlan = content.plans[0];
    expect(plan.concept).toBe('A bold product launch graphic');
    expect(Array.isArray(plan.slots)).toBe(true);
    expect(plan.slots.length).toBeGreaterThan(0);
    expect(plan.slots.every((s) => typeof s.id === 'string')).toBe(true);
  });

  it('keeps valid plan items unchanged', async () => {
    const validPlan: DesignPlan = {
      variantId: 'orig',
      skill: 'social-post',
      concept: 'A valid plan',
      palette: ['#fff'],
      typeScale: { headline: 48 },
      background: { kind: 'solid', value: '#fff' },
      slots: [{ id: 'headline', role: 'headline', kind: 'text' }],
      assetNeeds: [],
    };
    model.generateObject.mockResolvedValue({
      type: 'plans',
      plans: [validPlan],
    });

    const res = await handler(makeRequest(), 'org1');
    const content = JSON.parse(res.content);

    expect(content.plans[0].concept).toBe('A valid plan');
    expect(content.plans[0].slots).toEqual(validPlan.slots);
  });

  it('returns an error envelope for malformed input', async () => {
    const res = await handler('not-json', 'org1');
    const content = JSON.parse(res.content);
    expect(content.type).toBe('error');
    expect(content.message).toContain('Malformed agent input');
  });
});
