import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiDesignerArtDirectorService } from './ai-designer-art-director.service';
import { DesignPlanSchema } from '../../ai-designer.schemas';
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
    getLayoutHints: ReturnType<typeof vi.fn>;
  };
  let brands: { getBrand: ReturnType<typeof vi.fn> };
  let model: { generateObject: ReturnType<typeof vi.fn> };
  let service: AiDesignerArtDirectorService;

  beforeEach(() => {
    skillRouter = {
      route: vi.fn(() => ({ skillId: 'social-post' })),
      getSkillPrompt: vi.fn(() => 'skill prompt'),
      getLayoutHints: vi.fn(() => undefined),
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

  it('does no billable work when the dispatch signal is already aborted', async () => {
    await expect(
      (service as any)._handler({
        raw_input: makeRequest(),
        metadata: { orgId: 'org1', signal: AbortSignal.abort() },
      })
    ).rejects.toThrow('Cancelled');
    expect(model.generateObject).not.toHaveBeenCalled();
  });

  it('threads the dispatch signal into the plan-generation generateObject call', async () => {
    model.generateObject.mockResolvedValue({
      type: 'plans',
      plans: [{ concept: 'x' }],
    });
    const controller = new AbortController();

    await (service as any)._handler({
      raw_input: makeRequest(),
      metadata: { orgId: 'org1', signal: controller.signal },
    });

    expect(model.generateObject.mock.calls[0][3].signal).toBe(controller.signal);
  });

  it('falls back to a single plan when every plan item is invalid', async () => {
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
    expect(plan.fallback).toBe(true);
    expect(Array.isArray(plan.slots)).toBe(true);
    expect(plan.slots.length).toBeGreaterThan(0);
    expect(plan.slots.every((s) => typeof s.id === 'string')).toBe(true);
  });

  it('drops invalid plan items instead of replacing them with fallbacks', async () => {
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
      plans: [validPlan, { concept: 'missing slots' }],
    });

    const res = await handler(makeRequest(), 'org1');
    const content = JSON.parse(res.content);

    expect(content.plans).toHaveLength(1);
    expect(content.plans[0].concept).toBe('A valid plan');
  });

  it('never pads the response with duplicate plans when fewer than requested validate', async () => {
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

    const request = JSON.stringify({
      ...JSON.parse(makeRequest()),
      config: { channels: ['ig-square'], variants: 3 },
    });
    const res = await handler(request, 'org1');
    const content = JSON.parse(res.content);

    expect(content.plans).toHaveLength(1);
    expect(content.plans[0].concept).toBe('A valid plan');
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

  it('keys custom sizes with the conductor formatId scheme (custom-WxH) and returns only the primary', () => {
    const sizes = (service as any)._resolveSizes({
      channels: [],
      customSizes: [
        { width: 1080, height: 1350, name: '1080×1350' },
        { width: 300, height: 250 },
      ],
    });

    // One original only: the first custom size is the primary format.
    expect(sizes.map((s: any) => s.formatId)).toEqual(['custom-1080x1350']);
  });

  it('resolves the first channel as the one primary format', () => {
    const sizes = (service as any)._resolveSizes({
      channels: ['ig-post', 'ig-story'],
      customSizes: [{ width: 300, height: 250 }],
    });

    expect(sizes).toHaveLength(1);
    expect(sizes[0].formatId).toBe('ig-post');
  });

  it('prompts the planner for the primary format only', async () => {
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
    model.generateObject.mockResolvedValue({ type: 'plans', plans: [validPlan] });

    const request = JSON.stringify({
      ...JSON.parse(makeRequest()),
      config: { channels: ['ig-post', 'ig-story'], variants: 1 },
    });
    await handler(request, 'org1');

    const prompt = model.generateObject.mock.calls[0][1] as string;
    expect(prompt).toContain('## Output format (design for this ONE format only)');
    expect(prompt).toContain('"ig-post"');
    // The other formats are deliberately hidden from the planner.
    expect(prompt).not.toContain('ig-story');
    expect(prompt).not.toContain('channelLayouts');
    expect(prompt).not.toContain('perChannel');
  });

  it('teaches the plan prompt the style presets when the user picked none', async () => {
    const validPlan: DesignPlan = {
      variantId: 'orig',
      skill: 'social-post',
      concept: 'A valid plan',
      styleId: 'bold',
      palette: ['#fff'],
      typeScale: { headline: 48 },
      background: { kind: 'solid', value: '#fff' },
      slots: [{ id: 'headline', role: 'headline', kind: 'text' }],
      assetNeeds: [],
    };
    model.generateObject.mockResolvedValue({ type: 'plans', plans: [validPlan] });

    await handler(makeRequest(), 'org1');

    const prompt = model.generateObject.mock.calls[0][1] as string;
    expect(prompt).toContain('## Available style presets');
    expect(prompt).toContain('"bold"');
    expect(prompt).toContain('MUST set "styleId"');
    expect(prompt).toContain('cta-button');
  });

  it('pins the prompt and every plan to the user-selected style', async () => {
    const validPlan: DesignPlan = {
      variantId: 'orig',
      skill: 'social-post',
      concept: 'A valid plan',
      styleId: 'bold',
      palette: ['#fff'],
      typeScale: { headline: 48 },
      background: { kind: 'solid', value: '#fff' },
      slots: [{ id: 'headline', role: 'headline', kind: 'text' }],
      assetNeeds: [],
    };
    model.generateObject.mockResolvedValue({ type: 'plans', plans: [validPlan] });

    const request = JSON.stringify({
      ...JSON.parse(makeRequest()),
      brief: {
        intent: 'A bold product launch graphic',
        styleId: 'neon',
      },
    });
    const res = await handler(request, 'org1');
    const content = JSON.parse(res.content);

    const prompt = model.generateObject.mock.calls[0][1] as string;
    expect(prompt).toContain('user-selected');
    expect(prompt).toContain('"styleId": "neon"');
    // The model's own styleId choice is overridden by the user's pick.
    expect(content.plans[0].styleId).toBe('neon');
  });

  it('drops a plan whose styleId is not in the registry', async () => {
    model.generateObject.mockResolvedValue({
      type: 'plans',
      plans: [
        {
          variantId: 'orig',
          skill: 'social-post',
          concept: 'A plan with a bogus style',
          styleId: 'grunge-core',
          palette: ['#fff'],
          typeScale: { headline: 48 },
          background: { kind: 'solid', value: '#fff' },
          slots: [{ id: 'headline', role: 'headline', kind: 'text' }],
          assetNeeds: [],
        },
      ],
    });

    const res = await handler(makeRequest(), 'org1');
    const content = JSON.parse(res.content);

    expect(content.plans).toHaveLength(1);
    expect(content.plans[0].fallback).toBe(true);
    expect(content.plans[0].styleId).toBe('bold');
  });

  it('drops a plan with a malformed slot style override', async () => {
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
      plans: [
        {
          ...validPlan,
          concept: 'A plan with a bad slot style',
          slots: [
            {
              id: 'headline',
              role: 'headline',
              kind: 'text',
              style: { align: 'justify' },
            },
          ],
        },
        validPlan,
      ],
    });

    const res = await handler(makeRequest(), 'org1');
    const content = JSON.parse(res.content);

    expect(content.plans).toHaveLength(1);
    expect(content.plans[0].concept).toBe('A valid plan');
  });

  it('forbids invented offers, discounts, and codes in the plan prompt', async () => {
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
    model.generateObject.mockResolvedValue({ type: 'plans', plans: [validPlan] });

    await handler(makeRequest(), 'org1');

    const prompt = model.generateObject.mock.calls[0][1] as string;
    // The S6 hallucination guard: no fabricated -30% / invented coupon codes.
    expect(prompt).toContain('come from the brief verbatim');
    expect(prompt).toContain('invent none');
  });

  it('forbids invented times, dates, hours, and locations too', async () => {
    // Round 8 B3: the anti-invention rule was scoped to PROMOTIONS only, so
    // six delivered assets asserted "Open 9-5, Monday through Friday" and
    // badges reading "Effective Monday" for a brief that said 8am, September.
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
    model.generateObject.mockResolvedValue({ type: 'plans', plans: [validPlan] });

    await handler(makeRequest(), 'org1');

    const prompt = model.generateObject.mock.calls[0][1] as string;
    expect(prompt).toContain('Fact fidelity');
    for (const fact of [
      'Opening times',
      'dates',
      'hours',
      'locations',
      'phone numbers',
    ]) {
      expect(prompt).toContain(fact);
    }
    // And the escape hatch: omit the slot rather than fill it with filler.
    expect(prompt).toContain('OMIT THAT SLOT rather');
  });

  it('tells the planner an image background IS the imagery (no duplicate image slot)', async () => {
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
    model.generateObject.mockResolvedValue({ type: 'plans', plans: [validPlan] });

    await handler(makeRequest(), 'org1');

    const prompt = model.generateObject.mock.calls[0][1] as string;
    // A plan with an image background must not also carry an image slot for
    // the same subject — the conductor dedupes them into one asset, which
    // then rendered twice (full-bleed bg + centered inset).
    expect(prompt).toContain('background IS the imagery');
    expect(prompt).toContain('do NOT also add an');
    expect(prompt).toContain('distinct subjects');
  });

  it('steers dark-mood concepts to a darkening treatment in the plan prompt', async () => {
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
    model.generateObject.mockResolvedValue({ type: 'plans', plans: [validPlan] });

    await handler(makeRequest(), 'org1');

    const prompt = model.generateObject.mock.calls[0][1] as string;
    // Live failure: a "moody, dark wood" concept shipped a daylight stock
    // photo graded with warm-tint — a tint changes hue, not brightness.
    expect(prompt).toContain('moody-dark');
    expect(prompt).toContain('barely darkens');
  });

  it('demands per-slot texts and verbatim fixedCopy in the plan prompt', async () => {
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
    model.generateObject.mockResolvedValue({ type: 'plans', plans: [validPlan] });

    const request = JSON.stringify({
      ...JSON.parse(makeRequest()),
      brief: {
        intent: 'Labor Day Sale social media post',
        audience: 'followers',
        tone: 'patriotic',
        fixedCopy: 'LABOR26',
      },
    });
    await handler(request, 'org1');

    const prompt = model.generateObject.mock.calls[0][1] as string;
    // Every copy slot must carry final copy at plan time…
    expect(prompt).toContain('"texts" object mapping EVERY copy slot id');
    // …grounded in the actual offer, not generic slogans…
    expect(prompt).toContain('reference the actual event/offer/product');
    // …with fixedCopy VERBATIM in an appropriate slot.
    expect(prompt).toContain('VERBATIM');
    expect(prompt).toContain('fixedCopy');
    // The brief (and its coupon code) is part of the prompt, and the schema
    // the planner answers against declares the texts map.
    expect(prompt).toContain('LABOR26');
    expect(prompt).toContain('final copy for every copy slot');
  });

  it('round-trips plan texts through the stored-plan schema', () => {
    const plan = {
      variantId: 'v1',
      skill: 'social-post',
      concept: 'c',
      palette: ['#fff'],
      typeScale: { headline: 48 },
      background: { kind: 'solid' },
      slots: [{ id: 'headline', role: 'headline', kind: 'text' }],
      assetNeeds: [],
      texts: { headline: 'Labor Day Sale' },
    };

    const parsed = DesignPlanSchema.parse(plan);
    expect(parsed.texts).toEqual({ headline: 'Labor Day Sale' });

    const without = { ...plan };
    delete (without as any).texts;
    expect(DesignPlanSchema.parse(without).texts).toBeUndefined();

    // Values are bounded — oversized copy never persists.
    expect(() =>
      DesignPlanSchema.parse({
        ...plan,
        texts: { headline: 'x'.repeat(501) },
      })
    ).toThrow();
  });
});

describe('AiDesignerArtDirectorService offer fidelity (workstream 5)', () => {
  let skillRouter: {
    route: ReturnType<typeof vi.fn>;
    getSkillPrompt: ReturnType<typeof vi.fn>;
    getLayoutHints: ReturnType<typeof vi.fn>;
  };
  let brands: { getBrand: ReturnType<typeof vi.fn> };
  let model: { generateObject: ReturnType<typeof vi.fn> };
  let service: AiDesignerArtDirectorService;

  beforeEach(() => {
    skillRouter = {
      route: vi.fn(() => ({ skillId: 'social-post' })),
      getSkillPrompt: vi.fn(() => 'skill prompt'),
      getLayoutHints: vi.fn(() => undefined),
    };
    brands = { getBrand: vi.fn() };
    model = { generateObject: vi.fn() };
    service = new AiDesignerArtDirectorService(
      skillRouter as any,
      brands as any,
      model as any
    );
  });

  const planWithTexts = (texts: Record<string, string>): DesignPlan => ({
    variantId: 'orig',
    skill: 'social-post',
    concept: 'A valid plan',
    palette: ['#fff'],
    typeScale: { headline: 48 },
    background: { kind: 'solid', value: '#fff' },
    slots: [{ id: 'headline', role: 'headline', kind: 'text' }],
    assetNeeds: [],
    texts,
  });

  const offerRequest = (intent: string) =>
    JSON.stringify({
      type: 'plan-request',
      brief: { intent },
      config: { channels: ['ig-square'], variants: 1 },
      mode: 'prompt',
    });

  const handler = (raw_input: string, orgId?: string) =>
    (service as any)._handler({
      raw_input,
      metadata: orgId ? { orgId } : {},
    });

  it('retries plan generation once when every plan drops the brief offer tokens', async () => {
    model.generateObject
      .mockResolvedValueOnce({
        type: 'plans',
        plans: [planWithTexts({ headline: 'Big news everyone' })],
      })
      .mockResolvedValueOnce({
        type: 'plans',
        plans: [planWithTexts({ headline: 'First box 30% off' })],
      });

    const res = await handler(
      offerRequest('Subscription launch — first box 30% off at glowlab.shop'),
      'org1'
    );
    const content = JSON.parse(res.content);

    expect(model.generateObject).toHaveBeenCalledTimes(2);
    const retryPrompt = model.generateObject.mock.calls[1][1] as string;
    expect(retryPrompt).toContain('OFFER FIDELITY REPAIR');
    expect(retryPrompt).toContain('30%');
    expect(content.plans[0].texts.headline).toContain('30%');
  });

  it('injects the offer token when the retry still drops it — never keep+warn', async () => {
    model.generateObject.mockResolvedValue({
      type: 'plans',
      plans: [planWithTexts({ headline: 'Big news everyone' })],
    });

    const res = await handler(
      offerRequest('Subscription launch — first box 30% off'),
      'org1'
    );
    const content = JSON.parse(res.content);

    expect(model.generateObject).toHaveBeenCalledTimes(2);
    expect(content.plans).toHaveLength(1);
    // No badge/subhead slot — the token lands in the existing text slot.
    expect(content.plans[0].texts.headline).toBe('Big news everyone • 30%');
  });

  it('does not retry when the brief states no offer tokens', async () => {
    model.generateObject.mockResolvedValue({
      type: 'plans',
      plans: [planWithTexts({ headline: 'A bold product launch' })],
    });

    const res = await handler(
      offerRequest('A bold product launch graphic'),
      'org1'
    );
    const content = JSON.parse(res.content);

    expect(model.generateObject).toHaveBeenCalledTimes(1);
    expect(content.plans).toHaveLength(1);
  });

  it('does not retry only when the plan copy carries EVERY offer token', async () => {
    model.generateObject.mockResolvedValue({
      type: 'plans',
      plans: [
        planWithTexts({ headline: 'First box 30% off at glowlab.shop' }),
      ],
    });

    await handler(offerRequest('first box 30% off at glowlab.shop'), 'org1');

    expect(model.generateObject).toHaveBeenCalledTimes(1);
  });

  it('retries when the plan keeps one token but drops the rest, naming ONLY the missing ones', async () => {
    model.generateObject
      .mockResolvedValueOnce({
        type: 'plans',
        plans: [planWithTexts({ headline: '30% off tonight' })],
      })
      .mockResolvedValueOnce({
        type: 'plans',
        plans: [
          planWithTexts({
            headline: '30% off with code NIGHT40',
            subhead: 'nightmarket.co',
          }),
        ],
      });

    const res = await handler(
      offerRequest('Night market flash sale — 30% off with code NIGHT40 at nightmarket.co'),
      'org1'
    );
    const content = JSON.parse(res.content);

    // A plan keeping "30%" while dropping the code and the URL must retry
    // (the old .some() coverage let it pass).
    expect(model.generateObject).toHaveBeenCalledTimes(2);
    const repair = (model.generateObject.mock.calls[1][1] as string).split(
      'OFFER FIDELITY REPAIR'
    )[1];
    expect(repair).toContain('NIGHT40');
    expect(repair).toContain('nightmarket.co');
    // The token the plan already covered is not re-demanded.
    expect(repair).not.toContain('30%');
    expect(content.plans[0].texts.subhead).toBe('nightmarket.co');
  });

  it('keeps passing plans untouched and only replaces the failing ones on retry', async () => {
    const passing = planWithTexts({
      headline: '30% off with code NIGHT40 at nightmarket.co',
    });
    const failing = planWithTexts({ headline: 'Big vibes only' });
    const repaired = planWithTexts({
      headline: '30% off — code NIGHT40 — nightmarket.co',
    });
    model.generateObject
      .mockResolvedValueOnce({ type: 'plans', plans: [passing, failing] })
      .mockResolvedValueOnce({ type: 'plans', plans: [repaired] });

    const request = JSON.stringify({
      type: 'plan-request',
      brief: {
        intent: 'Night market flash sale — 30% off with code NIGHT40 at nightmarket.co',
      },
      config: { channels: ['ig-square'], variants: 2 },
      mode: 'prompt',
    });
    const res = await handler(request, 'org1');
    const content = JSON.parse(res.content);

    expect(content.plans).toHaveLength(2);
    // The plan that already passed coverage survives with its verified copy;
    // only the failing plan was swapped for the retry output.
    expect(content.plans[0].texts).toEqual(passing.texts);
    expect(content.plans[1].texts).toEqual(repaired.texts);
  });

  it('injects still-missing tokens deterministically: code → badge, URL → subhead', async () => {
    const stubborn = () => ({
      ...planWithTexts({ headline: '30% off everything' }),
      slots: [
        { id: 'headline', role: 'headline', kind: 'text' },
        { id: 'subhead', role: 'subhead', kind: 'text' },
        { id: 'badge', role: 'offer-badge', kind: 'badge' },
      ],
    });
    model.generateObject
      .mockResolvedValueOnce({ type: 'plans', plans: [stubborn()] })
      .mockResolvedValueOnce({ type: 'plans', plans: [stubborn()] });
    const warn = vi.spyOn((service as any)._logger, 'warn');

    const res = await handler(
      offerRequest('Night market flash sale — 30% off with code NIGHT40 at nightmarket.co'),
      'org1'
    );
    const content = JSON.parse(res.content);

    expect(content.plans[0].texts.headline).toBe('30% off everything');
    expect(content.plans[0].texts.badge).toBe('NIGHT40');
    expect(content.plans[0].texts.subhead).toBe('nightmarket.co');
    expect(
      warn.mock.calls.some((call) => String(call[0]).includes('injected:'))
    ).toBe(true);
  });

  it('injects into the original plans when the retry itself throws', async () => {
    model.generateObject
      .mockResolvedValueOnce({
        type: 'plans',
        plans: [planWithTexts({ headline: 'Big news everyone' })],
      })
      .mockRejectedValueOnce(new Error('model down'));

    const res = await handler(
      offerRequest('Subscription launch — first box 30% off'),
      'org1'
    );
    const content = JSON.parse(res.content);

    expect(content.plans).toHaveLength(1);
    expect(content.plans[0].texts.headline).toBe('Big news everyone • 30%');
  });

  it('does not treat shouted plain ALL-CAPS words as offer tokens', async () => {
    model.generateObject.mockResolvedValue({
      type: 'plans',
      plans: [planWithTexts({ headline: 'Everything must go' })],
    });

    await handler(offerRequest('HUGE SALE TODAY, everything must go'), 'org1');

    expect(model.generateObject).toHaveBeenCalledTimes(1);
  });

  it('splits offer tokens into verbatim and offer classes', () => {
    const tokens = (service as any)._extractOfferTokens({
      intent:
        '30% off and $5 shipping with code NIGHT40 at nightmarket.co, ends 5/1',
      fixedCopy: 'Join now | BEAN30',
    });

    expect([...tokens.verbatim].sort()).toEqual([
      'BEAN30',
      'Join now',
      'NIGHT40',
    ]);
    expect([...tokens.offer].sort()).toEqual([
      '$5',
      '30%',
      '5/1',
      'nightmarket.co',
    ]);
  });

  it('does not treat ranges, versions, or "24/7" as date offer tokens', () => {
    // The numeric date pattern matched any `\d{1,2}[/.-]\d{1,2}` pair, so
    // "24/7 support" or "sizes 8-10" became REQUIRED tokens — a plan that
    // correctly omitted them burned a repair retry and then had the token
    // deterministically injected into a badge/subhead.
    const tokens = (service as any)._extractOfferTokens({
      intent: '24/7 support, sizes 8-10, now on v17.2 — sale ends 12/25',
      fixedCopy: '',
    });
    expect(tokens.offer).toEqual(['12/25']);
  });

  it('moves a >5-word badge to the subhead, keeping the shortest offer token — coverage still passes', async () => {
    // The live round-4 defect: the planner placed the whole compound offer in
    // the badge, the burst auto-shrank the label to the font floor, and it was
    // unreadable at 25% feed scale.
    model.generateObject.mockResolvedValue({
      type: 'plans',
      plans: [
        {
          ...planWithTexts({
            headline: 'Coffee, perfected',
            badge: 'First box 30% off with code BEAN30 northbean.shop',
          }),
          slots: [
            { id: 'headline', role: 'headline', kind: 'text' },
            { id: 'subhead', role: 'subhead', kind: 'text' },
            { id: 'badge', role: 'offer-badge', kind: 'badge' },
          ],
        },
      ],
    });

    const intent =
      'Subscription launch — first box 30% off with code BEAN30 at northbean.shop';
    const res = await handler(offerRequest(intent), 'org1');
    const plan = JSON.parse(res.content).plans[0];

    // The plan already covered every token, so no repair retry fired.
    expect(model.generateObject).toHaveBeenCalledTimes(1);
    expect(plan.texts.badge).toBe('30%');
    expect(plan.texts.subhead).toBe(
      'First box 30% off with code BEAN30 northbean.shop'
    );
    // Coverage is SLOT-AGNOSTIC — relocating a whole token keeps it covered.
    const tokens = (service as any)._extractOfferTokens({ intent });
    expect(
      (service as any)._planMissingTokens(plan, [
        ...tokens.verbatim,
        ...tokens.offer,
      ])
    ).toEqual([]);
  });

  it('trims a >3-word CTA at the offer-token boundary, relocating the tail', async () => {
    model.generateObject.mockResolvedValue({
      type: 'plans',
      plans: [
        {
          ...planWithTexts({
            headline: 'Coffee, perfected',
            cta: 'Shop now at northbean.shop with code BEAN30',
          }),
          slots: [
            { id: 'headline', role: 'headline', kind: 'text' },
            { id: 'subhead', role: 'subhead', kind: 'text' },
            { id: 'cta', role: 'cta', kind: 'cta-button' },
          ],
        },
      ],
    });

    const intent =
      'Subscription launch — shop at northbean.shop with code BEAN30';
    const res = await handler(offerRequest(intent), 'org1');
    const plan = JSON.parse(res.content).plans[0];

    // Verb-first phrase stays; the connector ("at") is dropped with the tail.
    expect(plan.texts.cta).toBe('Shop now');
    expect(plan.texts.subhead).toBe('northbean.shop with code BEAN30');
    const tokens = (service as any)._extractOfferTokens({ intent });
    expect(
      (service as any)._planMissingTokens(plan, [
        ...tokens.verbatim,
        ...tokens.offer,
      ])
    ).toEqual([]);
  });

  it('leaves a badge alone when it carries no offer token to keep', async () => {
    model.generateObject.mockResolvedValue({
      type: 'plans',
      plans: [
        {
          ...planWithTexts({
            headline: 'Hello',
            badge: 'the best coffee you will ever drink',
          }),
          slots: [
            { id: 'headline', role: 'headline', kind: 'text' },
            { id: 'subhead', role: 'subhead', kind: 'text' },
            { id: 'badge', role: 'offer-badge', kind: 'badge' },
          ],
        },
      ],
    });

    const res = await handler(offerRequest('A bold product launch'), 'org1');
    const plan = JSON.parse(res.content).plans[0];

    // No safe cut exists — mangling prose would risk dropping required copy.
    expect(plan.texts.badge).toBe('the best coffee you will ever drink');
    expect(plan.texts.subhead).toBeUndefined();
  });

  it('does not make a compound fixedCopy unit a required token, but keeps its parts', () => {
    const tokens = (service as any)._extractOfferTokens({
      intent: 'Subscription launch',
      fixedCopy: 'First box 30% off with code BEAN30 | Join now',
    });

    // The compound blob would force the planner to place a whole sentence in
    // one slot (live: the badge). Its parts stay independently required, so
    // offer fidelity is unchanged.
    expect(tokens.verbatim).not.toContain('First box 30% off with code BEAN30');
    expect(tokens.verbatim).toContain('Join now');
    expect(tokens.verbatim).toContain('BEAN30');
    expect(tokens.offer).toContain('30%');
  });

  it('never injects a URL into the badge when the plan has no subhead slot', async () => {
    const stubborn = () => ({
      ...planWithTexts({ badge: 'SALE' }),
      slots: [
        { id: 'badge', role: 'offer-badge', kind: 'badge' },
        { id: 'headline', role: 'headline', kind: 'text' },
      ],
    });
    model.generateObject
      .mockResolvedValueOnce({ type: 'plans', plans: [stubborn()] })
      .mockResolvedValueOnce({ type: 'plans', plans: [stubborn()] });

    const res = await handler(offerRequest('Flash sale at nightmarket.co'), 'org1');
    const plan = JSON.parse(res.content).plans[0];

    // The badge is the only text-bearing slot, so the old fallback landed the
    // URL there — unreadable in a burst.
    expect(plan.texts.badge).toBe('SALE');
    expect(plan.texts.headline).toBe('nightmarket.co');
  });

  it('teaches the planner to emit panelSide for side-by-side concepts', async () => {
    model.generateObject.mockResolvedValue({
      type: 'plans',
      plans: [planWithTexts({ headline: 'Hello' })],
    });

    await handler(offerRequest('A bold product launch graphic'), 'org1');

    const prompt = model.generateObject.mock.calls[0][1] as string;
    expect(prompt).toContain('"panelSide"');
    expect(prompt).toContain('photo left, text right');
  });
});

describe('AiDesignerArtDirectorService brief constraints (workstream 3)', () => {
  let skillRouter: {
    route: ReturnType<typeof vi.fn>;
    getSkillPrompt: ReturnType<typeof vi.fn>;
    getLayoutHints: ReturnType<typeof vi.fn>;
  };
  let brands: { getBrand: ReturnType<typeof vi.fn> };
  let model: { generateObject: ReturnType<typeof vi.fn> };
  let service: AiDesignerArtDirectorService;

  beforeEach(() => {
    skillRouter = {
      route: vi.fn(() => ({ skillId: 'social-post' })),
      getSkillPrompt: vi.fn(() => 'skill prompt'),
      getLayoutHints: vi.fn(() => undefined),
    };
    brands = { getBrand: vi.fn() };
    model = { generateObject: vi.fn() };
    service = new AiDesignerArtDirectorService(
      skillRouter as any,
      brands as any,
      model as any
    );
  });

  const makePlan = (overrides: Partial<DesignPlan> = {}): DesignPlan => ({
    variantId: 'orig',
    skill: 'social-post',
    concept: 'A valid plan',
    palette: ['#fff'],
    typeScale: { headline: 48 },
    background: { kind: 'solid', value: '#fff' },
    slots: [{ id: 'headline', role: 'headline', kind: 'text' }],
    assetNeeds: [],
    texts: { headline: 'Hello' },
    ...overrides,
  });

  const request = (intent: string) =>
    JSON.stringify({
      type: 'plan-request',
      brief: { intent },
      config: { channels: ['ig-square'], variants: 1 },
      mode: 'prompt',
    });

  const handler = (raw_input: string, orgId?: string) =>
    (service as any)._handler({
      raw_input,
      metadata: orgId ? { orgId } : {},
    });

  it('normalizes pipe compounds in plan texts before returning them', async () => {
    model.generateObject.mockResolvedValue({
      type: 'plans',
      plans: [makePlan({ texts: { headline: 'Join now | Fresh roast' } })],
    });

    const res = await handler(request('A coffee promo'), 'org1');
    const content = JSON.parse(res.content);

    expect(content.plans[0].texts.headline).toBe('Join now • Fresh roast');
  });

  it('overrides panelSide on split layouts when the brief states explicit side language', async () => {
    model.generateObject.mockResolvedValue({
      type: 'plans',
      plans: [
        makePlan({ formatTemplate: 'split-panel', panelSide: 'right' }),
      ],
    });

    const res = await handler(
      request(
        "Left side: bold headline 'COFFEE, PERFECTED' on cream. Right side: studio product photo of the bag."
      ),
      'org1'
    );
    const content = JSON.parse(res.content);

    expect(content.plans[0].panelSide).toBe('left');
  });

  it('does not touch panelSide on ambiguous side language or non-split layouts', async () => {
    // Conflicting side language: both readings fire, so the model's own
    // choice stands.
    model.generateObject.mockResolvedValue({
      type: 'plans',
      plans: [
        makePlan({ formatTemplate: 'split-panel', panelSide: 'right' }),
      ],
    });
    let res = await handler(
      request('Something with text on the left and the photo on the left'),
      'org1'
    );
    expect(JSON.parse(res.content).plans[0].panelSide).toBe('right');

    // Explicit side language but not a split layout: no override.
    model.generateObject.mockResolvedValue({
      type: 'plans',
      plans: [makePlan({ formatTemplate: 'hero-fullbleed' })],
    });
    res = await handler(
      request('Left side: bold headline over the imagery'),
      'org1'
    );
    expect(JSON.parse(res.content).plans[0].panelSide).toBeUndefined();
  });

  it('overrides badgePosition when the brief names the badge corner', async () => {
    model.generateObject.mockResolvedValue({
      type: 'plans',
      plans: [makePlan({ formatTemplate: 'split-panel' })],
    });

    const res = await handler(
      request('Flash sale poster with the offer badge in the lower left corner'),
      'org1'
    );

    expect(JSON.parse(res.content).plans[0].badgePosition).toBe('bottom-left');
  });

  it('leaves badgePosition alone when the corner is not about the badge', async () => {
    model.generateObject.mockResolvedValue({
      type: 'plans',
      plans: [makePlan({ formatTemplate: 'split-panel' })],
    });

    const res = await handler(
      request('Product shot in the top right, calm copy, small badge somewhere'),
      'org1'
    );

    expect(JSON.parse(res.content).plans[0].badgePosition).toBeUndefined();
  });

  it('teaches the planner to emit badgePosition', async () => {
    model.generateObject.mockResolvedValue({ type: 'plans', plans: [makePlan()] });
    await handler(request('A promo'), 'org1');

    const prompt = model.generateObject.mock.calls[0][1];
    expect(prompt).toContain('"badgePosition"');
  });

  it('sets badgeStyle burst on badge slots for starburst briefs', async () => {
    model.generateObject.mockResolvedValue({
      type: 'plans',
      plans: [
        makePlan({
          slots: [
            { id: 'headline', role: 'headline', kind: 'text' },
            { id: 'badge', role: 'badge', kind: 'badge' },
          ],
          texts: { headline: 'Hello', badge: 'New' },
        }),
      ],
    });

    const res = await handler(
      request('Flash sale with a big starburst badge'),
      'org1'
    );
    const content = JSON.parse(res.content);

    const badge = content.plans[0].slots.find((s: any) => s.kind === 'badge');
    expect(badge.style).toMatchObject({ badgeStyle: 'burst' });
    // Text slots stay untouched.
    const headline = content.plans[0].slots.find((s: any) => s.id === 'headline');
    expect(headline.style?.badgeStyle).toBeUndefined();
  });

  it('adds the palette constraint to the repair retry for a warm brief with an all-cool palette', async () => {
    model.generateObject
      .mockResolvedValueOnce({
        type: 'plans',
        plans: [makePlan({ palette: ['#1d4ed8', '#ffffff', '#0ea5e9'] })],
      })
      .mockResolvedValueOnce({
        type: 'plans',
        plans: [makePlan({ palette: ['#f5e6d3', '#3a2618', '#c96f2f'] })],
      });

    const res = await handler(
      request('Cozy coffee promo in warm cream and espresso tones'),
      'org1'
    );
    const content = JSON.parse(res.content);

    expect(model.generateObject).toHaveBeenCalledTimes(2);
    const retryPrompt = model.generateObject.mock.calls[1][1] as string;
    expect(retryPrompt).toContain('PALETTE REPAIR');
    expect(content.plans[0].palette).toEqual(['#f5e6d3', '#3a2618', '#c96f2f']);
  });

  it('stays silent when the palette already honors the warm brief — and for cool briefs', async () => {
    // Warm brief, warm surface: no retry.
    model.generateObject.mockResolvedValue({
      type: 'plans',
      plans: [makePlan({ palette: ['#f5e6d3', '#3a2618', '#c96f2f'] })],
    });
    await handler(
      request('Cozy coffee promo in warm cream and espresso tones'),
      'org1'
    );
    expect(model.generateObject).toHaveBeenCalledTimes(1);

    // No warm words: an all-cool palette is a free choice.
    model.generateObject.mockClear();
    model.generateObject.mockResolvedValue({
      type: 'plans',
      plans: [makePlan({ palette: ['#1d4ed8', '#ffffff', '#0ea5e9'] })],
    });
    await handler(request('A crisp tech launch promo'), 'org1');
    expect(model.generateObject).toHaveBeenCalledTimes(1);
  });

  it('round-trips panelSide and slot badgeStyle through the stored-plan schema', () => {
    const plan = {
      variantId: 'v1',
      skill: 'social-post',
      concept: 'c',
      palette: ['#fff'],
      typeScale: { headline: 48 },
      background: { kind: 'solid' },
      slots: [
        {
          id: 'badge',
          role: 'badge',
          kind: 'badge',
          style: { badgeStyle: 'burst' },
        },
      ],
      assetNeeds: [],
      panelSide: 'left',
    };

    const parsed = DesignPlanSchema.parse({
      ...plan,
      badgePosition: 'bottom-right',
    });
    expect(parsed.panelSide).toBe('left');
    expect(parsed.badgePosition).toBe('bottom-right');
    expect(() =>
      DesignPlanSchema.parse({ ...plan, badgePosition: 'middle-left' })
    ).toThrow();
    expect(parsed.slots[0].style?.badgeStyle).toBe('burst');

    expect(() =>
      DesignPlanSchema.parse({ ...plan, panelSide: 'center' })
    ).toThrow();
    expect(() =>
      DesignPlanSchema.parse({
        ...plan,
        slots: [
          { id: 'b', role: 'badge', kind: 'badge', style: { badgeStyle: 'star' } },
        ],
      })
    ).toThrow();
  });
});

// Round 7 C2: a plan whose `background.ref` names a slot that no assetNeed
// produces is as dead as no ref at all — `_backgroundToDesignerBg` resolves
// nothing and ships a flat #1f2937, and the conductor's `_replaceSlotImagery`
// (which compares `plan.background.ref === 'asset:${slotId}'`) never matches
// on a regeneration either. Observed live: `ref: 'asset:image-bg-01'` next to
// an assetNeed for slot `image`.
describe('AiDesignerArtDirectorService background ref coherence (round 7 C2)', () => {
  const makeService = (plans: unknown[]) => {
    const skillRouter = {
      route: vi.fn(() => ({ skillId: 'social-post' })),
      getSkillPrompt: vi.fn(() => 'skill prompt'),
      getLayoutHints: vi.fn(() => undefined),
    };
    const brands = { getBrand: vi.fn() };
    const model = {
      generateObject: vi.fn().mockResolvedValue({ type: 'plans', plans }),
    };
    const service = new AiDesignerArtDirectorService(
      skillRouter as any,
      brands as any,
      model as any
    );
    return {
      service,
      run: () =>
        (service as any)._handler({
          raw_input: makeRequest(),
          metadata: { orgId: 'org1' },
        }),
    };
  };

  const basePlan = (overrides: Record<string, unknown>) => ({
    variantId: 'orig',
    skill: 'social-post',
    concept: 'Espresso on a warm counter',
    palette: ['#2b1b12', '#f6efe6', '#c98b4b'],
    typeScale: { headline: 48 },
    slots: [{ id: 'headline', role: 'headline', kind: 'text' }],
    assetNeeds: [],
    ...overrides,
  });

  it('repoints a dangling background ref at an assetNeed that exists', async () => {
    const { run } = makeService([
      basePlan({
        background: { kind: 'image', ref: 'asset:image-bg-01' },
        assetNeeds: [{ slotId: 'image', brief: 'espresso pour', prefer: 'either' }],
      }),
    ]);

    const plan = JSON.parse((await run()).content).plans[0];

    expect(plan.background.ref).toBe('asset:image');
    // No second need invented — the plan already asked for imagery.
    expect(plan.assetNeeds).toHaveLength(1);
  });

  it('synthesizes the need AND sets the ref when the plan asked for nothing', async () => {
    const { run } = makeService([
      basePlan({ background: { kind: 'image' } }),
    ]);

    const plan = JSON.parse((await run()).content).plans[0];

    expect(plan.assetNeeds).toHaveLength(1);
    expect(plan.assetNeeds[0].slotId).toBe('background');
    // The pre-fix backstop pushed the need but left `ref` undefined, so the
    // background still resolved to nothing and shipped a solid.
    expect(plan.background.ref).toBe('asset:background');
  });

  it('leaves a ref that already names a real assetNeed alone', async () => {
    const { run } = makeService([
      basePlan({
        background: { kind: 'image', ref: 'asset:background' },
        assetNeeds: [
          { slotId: 'background', brief: 'warm counter', prefer: 'either' },
          { slotId: 'image', brief: 'a cup', prefer: 'either' },
        ],
      }),
    ]);

    const plan = JSON.parse((await run()).content).plans[0];

    expect(plan.background.ref).toBe('asset:background');
    expect(plan.assetNeeds).toHaveLength(2);
  });

  it('never touches a non-image background', async () => {
    const { run } = makeService([
      basePlan({ background: { kind: 'solid', value: '#2b1b12' } }),
    ]);

    const plan = JSON.parse((await run()).content).plans[0];

    expect(plan.background).toEqual({ kind: 'solid', value: '#2b1b12' });
    expect(plan.assetNeeds).toEqual([]);
  });
});
