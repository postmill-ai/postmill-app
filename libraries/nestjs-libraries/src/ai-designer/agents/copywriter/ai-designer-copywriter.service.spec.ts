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

  it('does no billable work when the dispatch signal is already aborted', async () => {
    await expect(
      (service as any)._handler({
        raw_input: JSON.stringify({
          type: 'copy-request',
          plan: makePlan(),
          brand: null,
        }),
        metadata: { orgId: 'org1', signal: AbortSignal.abort() },
      })
    ).rejects.toThrow('Cancelled');
    expect(model.generateText).not.toHaveBeenCalled();
  });

  it('threads the dispatch signal into the generateText call', async () => {
    model.generateText.mockResolvedValue('{"headline":"Hi","cta":"Go"}');
    const controller = new AbortController();

    await (service as any)._handler({
      raw_input: JSON.stringify({
        type: 'copy-request',
        plan: makePlan(),
        brand: null,
      }),
      metadata: { orgId: 'org1', signal: controller.signal },
    });

    expect(model.generateText.mock.calls[0][2].signal).toBe(controller.signal);
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

  it('omits text slots the model did not write (no empty-string backfill)', async () => {
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
    });
  });

  it('returns an error envelope for malformed input', async () => {
    const res = await handler('not-json', 'org1');
    const content = JSON.parse(res.content);
    expect(content.type).toBe('error');
    expect(content.message).toContain('Malformed agent input');
  });

  it('returns locked texts verbatim and only writes the open slots', async () => {
    // The model even "rewrites" the locked headline — it must not win.
    model.generateText.mockResolvedValue(
      '{"headline":"Model rewrite","cta":"Shop now"}'
    );

    const res = await handler(
      JSON.stringify({
        type: 'copy-request',
        plan: makePlan(),
        brand: null,
        lockedTexts: { headline: 'Labor Day Sale' },
      }),
      'org1'
    );

    const content = JSON.parse(res.content);
    expect(content.texts).toEqual({
      headline: 'Labor Day Sale',
      cta: 'Shop now',
    });

    // The locked slot is not part of the writing prompt at all.
    const prompt = model.generateText.mock.calls[0][1] as string;
    expect(prompt).toContain('- cta (role: cta)');
    expect(prompt).not.toContain('- headline (role: headline)');
  });

  it('never calls the model when every copy slot is locked', async () => {
    const res = await handler(
      JSON.stringify({
        type: 'copy-request',
        plan: makePlan(),
        brand: null,
        lockedTexts: { headline: 'Labor Day Sale', cta: 'Shop now' },
      }),
      'org1'
    );

    const content = JSON.parse(res.content);
    expect(content.texts).toEqual({
      headline: 'Labor Day Sale',
      cta: 'Shop now',
    });
    expect(model.generateText).not.toHaveBeenCalled();
  });

  it('keeps an https:// URL in the copy — the repair layer no longer shadows an intact parse', async () => {
    // repair() strips `//…` comments string-unaware, so it returned a MANGLED
    // partial map ("Shop now at https:" losing the host) and — because it ran
    // first and succeeded — returned early, shadowing the intact JSON.parse at
    // Layer 2. Parse-first is the fix.
    model.generateText.mockResolvedValue(
      '{"headline":"Summer Sale","cta":"Shop now at https://northbean.shop"}'
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
    expect(content.texts).toEqual({
      headline: 'Summer Sale',
      cta: 'Shop now at https://northbean.shop',
    });
  });

  it('ignores locked texts for slots the plan does not have', async () => {
    model.generateText.mockResolvedValue('{"cta":"Shop now"}');

    const res = await handler(
      JSON.stringify({
        type: 'copy-request',
        plan: makePlan(),
        brand: null,
        lockedTexts: { headline: 'Labor Day Sale', ghost: 'no such slot' },
      }),
      'org1'
    );

    const content = JSON.parse(res.content);
    expect(content.texts).toEqual({
      headline: 'Labor Day Sale',
      cta: 'Shop now',
    });
  });
});
