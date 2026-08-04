import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { AiDesignerVisionCriticService } from './ai-designer-vision-critic.service';

// 1x1 transparent PNG
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const makeRequest = (overrides?: {
  contactSheetUrl?: string;
  outputPreviews?: { formatId: string; url: string }[];
  plans?: unknown[];
  docSummary?: unknown[];
}) =>
  JSON.stringify({
    type: 'critique-request',
    contactSheetUrl: overrides?.contactSheetUrl ?? 'https://example.com/contact.png',
    outputs: [{ formatId: 'ig-square', width: 1080, height: 1080 }],
    rubric: {
      criteria: [
        { name: 'Legibility', description: 'Text is readable', weight: 1 },
      ],
    },
    plans: overrides?.plans,
    outputPreviews: overrides?.outputPreviews,
    docSummary: overrides?.docSummary,
  });

describe('AiDesignerVisionCriticService', () => {
  let aiDefaults: { vision: ReturnType<typeof vi.fn> };
  let fileService: { getFileById: ReturnType<typeof vi.fn> };
  let service: AiDesignerVisionCriticService;
  let tmpDir: string;

  beforeEach(() => {
    aiDefaults = { vision: vi.fn() };
    fileService = { getFileById: vi.fn() };
    service = new AiDesignerVisionCriticService(
      aiDefaults as any,
      fileService as any
    );
    tmpDir = path.join(os.tmpdir(), `vision-critic-test-${Date.now()}`);
    mkdirSync(path.join(tmpDir, '2026', '07', '06'), { recursive: true });
    vi.stubEnv('FRONTEND_URL', 'http://localhost:4200');
    vi.stubEnv('UPLOAD_DIRECTORY', tmpDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  });

  const handler = (raw_input: string, orgId?: string) =>
    (service as any)._handler({
      raw_input,
      metadata: orgId ? { orgId } : {},
    });

  it('returns an error envelope when orgId is missing', async () => {
    const res = await handler(makeRequest());
    const content = JSON.parse(res.content);
    expect(content.type).toBe('error');
    expect(content.message).toContain('missing orgId');
  });

  it('inlines a LOCAL storage contact-sheet URL as a base64 data URL', async () => {
    const key = '2026/07/06/contact.png';
    const filePath = path.join(tmpDir, key);
    writeFileSync(filePath, Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'));
    const localUrl = `http://localhost:4200/uploads/${key}`;

    aiDefaults.vision.mockResolvedValue('{"findings": []}');

    await handler(
      makeRequest({ contactSheetUrl: localUrl }),
      'org1'
    );

    expect(aiDefaults.vision).toHaveBeenCalledTimes(1);
    const passedUrl = aiDefaults.vision.mock.calls[0][1];
    expect(passedUrl).toMatch(/^data:image\/png;base64,/);
    expect(passedUrl).not.toBe(localUrl);
  });

  it('passes through a public HTTPS contact-sheet URL unchanged', async () => {
    const publicUrl = 'https://example.com/contact.png';
    aiDefaults.vision.mockResolvedValue('{"findings": []}');

    await handler(makeRequest({ contactSheetUrl: publicUrl }), 'org1');

    expect(aiDefaults.vision).toHaveBeenCalledTimes(1);
    expect(aiDefaults.vision.mock.calls[0][1]).toBe(publicUrl);
  });

  it('does no billable work when the dispatch signal is already aborted', async () => {
    await expect(
      (service as any)._handler({
        raw_input: makeRequest(),
        metadata: { orgId: 'org1', signal: AbortSignal.abort() },
      })
    ).rejects.toThrow('Cancelled');
    expect(aiDefaults.vision).not.toHaveBeenCalled();
  });

  it('threads the dispatch signal into the vision call', async () => {
    aiDefaults.vision.mockResolvedValue('{"findings": []}');
    const controller = new AbortController();

    await (service as any)._handler({
      raw_input: makeRequest(),
      metadata: { orgId: 'org1', signal: controller.signal },
    });

    expect(aiDefaults.vision.mock.calls[0][3]).toEqual({
      signal: controller.signal,
    });
  });

  it('includes the real schema block in the escalation prompt', async () => {
    aiDefaults.vision
      .mockResolvedValueOnce(
        '{"findings": [{"issue": "Headline is too small to read", "formatId": "ig-square"}]}'
      )
      .mockResolvedValueOnce('{"findings": []}');

    await handler(
      makeRequest({
        outputPreviews: [
          {
            formatId: 'ig-square',
            url: 'https://example.com/preview.png',
          },
        ],
      }),
      'org1'
    );

    expect(aiDefaults.vision).toHaveBeenCalledTimes(2);
    const escalationPrompt = aiDefaults.vision.mock.calls[1][2];
    expect(escalationPrompt).toContain('findings');
    expect(escalationPrompt).toContain('fix');
    expect(escalationPrompt).toContain('targetSlots');
    expect(escalationPrompt).not.toContain('same shape as before');
  });

  it('restates brand_safety in the escalation prompt (it carries no criteria list)', async () => {
    aiDefaults.vision
      .mockResolvedValueOnce(
        '{"findings": [{"issue": "Headline is too small to read", "formatId": "ig-square"}]}'
      )
      .mockResolvedValueOnce('{"findings": []}');

    await handler(
      makeRequest({
        outputPreviews: [
          { formatId: 'ig-square', url: 'https://example.com/preview.png' },
        ],
      }),
      'org1'
    );

    const escalationPrompt = aiDefaults.vision.mock.calls[1][2] as string;
    expect(escalationPrompt).toContain('brand_safety');
    expect(escalationPrompt).toContain('brand logo');
    expect(escalationPrompt).toContain('regenerateAsset');
  });

  it('appends the base text_fit criterion to every critique prompt', async () => {
    aiDefaults.vision.mockResolvedValue('{"findings": []}');

    await handler(
      makeRequest({ contactSheetUrl: 'https://example.com/contact.png' }),
      'org1'
    );

    const prompt = aiDefaults.vision.mock.calls[0][2] as string;
    expect(prompt).toContain('text_fit');
    expect(prompt).toContain('overflows its band or the canvas edges');
    // The skill's own criteria still come first.
    expect(prompt.indexOf('Legibility')).toBeLessThan(
      prompt.indexOf('text_fit')
    );
  });

  it('appends all new base criteria (baked-in text, framed imagery, legibility, accuracy, alignment)', async () => {
    aiDefaults.vision.mockResolvedValue('{"findings": []}');

    await handler(makeRequest(), 'org1');

    const prompt = aiDefaults.vision.mock.calls[0][2] as string;
    for (const name of [
      'no_baked_in_text',
      'no_framed_imagery',
      'feed_legibility',
      'text_accuracy',
      'text_alignment',
      'brand_safety',
    ]) {
      expect(prompt).toContain(name);
    }
    expect(prompt).toContain('baked-in text');
    expect(prompt).toContain('framed inset');
    // A photoreal branded product (live: sneakers with clear Nike swooshes)
    // does not read as "baked-in text/graphics", so it needs its own criterion.
    expect(prompt).toContain('third-party brand logos');
    expect(prompt).toContain('celebrity likenesses');
  });

  it('routes a brand_safety defect to regenerateAsset in the fix vocabulary', async () => {
    aiDefaults.vision.mockResolvedValue('{"findings": []}');

    await handler(makeRequest(), 'org1');

    const prompt = aiDefaults.vision.mock.calls[0][2] as string;
    const vocabulary = prompt.slice(prompt.indexOf('"regenerateAsset"'));
    expect(vocabulary).toContain('brand_safety');
    expect(vocabulary).toContain('branded product');
    expect(vocabulary).toContain('never with a text fix');
  });

  it('lists each output with its 25% feed-scale pixel size', async () => {
    aiDefaults.vision.mockResolvedValue('{"findings": []}');

    await handler(makeRequest(), 'org1');

    const prompt = aiDefaults.vision.mock.calls[0][2] as string;
    expect(prompt).toContain('ig-square: 1080x1080');
    expect(prompt).toContain('at 25% feed scale: 270x270px');
  });

  it('includes the expected copy per slot from the plans', async () => {
    aiDefaults.vision.mockResolvedValue('{"findings": []}');

    await handler(
      makeRequest({
        plans: [
          {
            variantId: 'v1',
            skill: 'announcement',
            concept: 'Beach party',
            slots: [{ id: 'headline', kind: 'text', role: 'headline' }],
            texts: { headline: 'Beach Party', badge: 'SUN • 3 PM' },
          },
        ],
      }),
      'org1'
    );

    const prompt = aiDefaults.vision.mock.calls[0][2] as string;
    expect(prompt).toContain('Expected copy');
    expect(prompt).toContain('headline: "Beach Party"');
    expect(prompt).toContain('badge: "SUN • 3 PM"');
  });

  it('omits the expected-copy section when the plans carry no texts', async () => {
    aiDefaults.vision.mockResolvedValue('{"findings": []}');

    await handler(
      makeRequest({
        plans: [
          {
            variantId: 'v1',
            skill: 'meme',
            concept: 'x',
            slots: [],
          },
        ],
      }),
      'org1'
    );

    const prompt = aiDefaults.vision.mock.calls[0][2] as string;
    expect(prompt).not.toContain('Expected copy');
  });

  it('notes that expected copy is compared case-insensitively (style transforms)', async () => {
    aiDefaults.vision.mockResolvedValue('{"findings": []}');

    await handler(
      makeRequest({
        plans: [
          {
            variantId: 'v1',
            skill: 'announcement',
            concept: 'Beach party',
            slots: [{ id: 'headline', kind: 'text', role: 'headline' }],
            texts: { headline: 'Beach Party' },
          },
        ],
      }),
      'org1'
    );

    const prompt = aiDefaults.vision.mock.calls[0][2] as string;
    expect(prompt).toContain('case-insensitively');
  });

  it('includes the design doc element summary (fills, bounds, z-order) in the prompt', async () => {
    aiDefaults.vision.mockResolvedValue('{"findings": []}');

    await handler(
      makeRequest({
        docSummary: [
          {
            formatId: 'ig-square',
            width: 1080,
            height: 1080,
            elements: [
              {
                originId: 'headline',
                type: 'text',
                text: 'Big launch',
                fill: '#000000',
                x: 100,
                y: 200,
                width: 880,
                height: 120,
                z: 0,
              },
              {
                originId: 'cta-bg',
                type: 'shape',
                fill: '#0A0A0A',
                x: 400,
                y: 800,
                width: 280,
                height: 80,
                z: 1,
              },
            ],
          },
        ],
      }),
      'org1'
    );

    const prompt = aiDefaults.vision.mock.calls[0][2] as string;
    expect(prompt).toContain('Design doc elements');
    expect(prompt).toContain('[z0] text (headline)');
    expect(prompt).toContain('x=100 y=200 w=880 h=120');
    expect(prompt).toContain('fill=#000000');
    expect(prompt).toContain('[z1] shape (cta-bg)');
    expect(prompt).toContain('fill=#0A0A0A');
    expect(prompt).toContain('text="Big launch"');
  });

  it('offers regenerateAsset in the fix vocabulary, tied to baked-in text', async () => {
    aiDefaults.vision.mockResolvedValue('{"findings": []}');

    await handler(makeRequest(), 'org1');

    const prompt = aiDefaults.vision.mock.calls[0][2] as string;
    expect(prompt).toContain('"regenerateAsset": { slotId, brief? }');
    expect(prompt).toContain(
      'must be fixed with regenerateAsset targeting the image slot — never with a text fix'
    );
    // The schema example shows a regenerateAsset finding too.
    expect(prompt).toContain('"regenerateAsset": { "slotId": "image"');
  });

  it('normalizes a regenerateAsset fix (trimmed slotId, brief capped at 500 chars)', async () => {
    aiDefaults.vision.mockResolvedValue(
      JSON.stringify({
        findings: [
          {
            issue: 'Baked-in logo on the packaging',
            slotId: 'image',
            fix: {
              scope: 'shared',
              regenerateAsset: { slotId: ' image ', brief: `  ${'x'.repeat(600)}` },
            },
          },
        ],
      })
    );

    const res = await handler(makeRequest(), 'org1');

    const content = JSON.parse(res.content);
    const fix = content.findings[0].fix;
    expect(fix.regenerateAsset.slotId).toBe('image');
    expect(fix.regenerateAsset.brief).toHaveLength(500);
  });

  it('carries the rubric criterion through to the finding', async () => {
    aiDefaults.vision.mockResolvedValue(
      JSON.stringify({
        findings: [
          {
            issue: 'The sneaker carries a recognizable brand swoosh',
            slotId: 'image',
            criterion: '  brand_safety  ',
            fix: {
              scope: 'shared',
              regenerateAsset: { slotId: 'image' },
            },
          },
          { issue: 'No criterion given' },
        ],
      })
    );

    const res = await handler(makeRequest(), 'org1');

    // The conductor picks the regeneration TECHNIQUE off this: brand_safety
    // switches to a stock search instead of re-rolling the image model.
    const content = JSON.parse(res.content);
    expect(content.findings[0].criterion).toBe('brand_safety');
    expect(content.findings[1].criterion).toBeUndefined();
  });

  it('drops align from a format-only style fix but keeps it on a shared one', async () => {
    aiDefaults.vision.mockResolvedValue(
      JSON.stringify({
        findings: [
          {
            issue: 'Headline alignment fights the panel on this format',
            formatId: 'x-post',
            fix: {
              scope: 'format-only',
              targetSlots: ['headline'],
              style: { align: 'center', fill: '#FFFFFF' },
            },
          },
          {
            issue: 'Copy alignment is inconsistent across the design',
            fix: {
              scope: 'shared',
              targetSlots: ['headline'],
              style: { align: 'left' },
            },
          },
        ],
      })
    );

    const res = await handler(makeRequest(), 'org1');

    const content = JSON.parse(res.content);
    // Alignment is a property of the design, not of one canvas: applying it to
    // a single output is what left the same slot left-aligned on one format
    // and centered on another. The rest of the style fix still applies.
    expect(content.findings[0].fix.style.align).toBeUndefined();
    expect(content.findings[0].fix.style.fill).toBe('#FFFFFF');
    expect(content.findings[1].fix.style.align).toBe('left');
  });

  it('drops a regenerateAsset fix with an empty slotId', async () => {
    aiDefaults.vision.mockResolvedValue(
      JSON.stringify({
        findings: [
          {
            issue: 'Baked-in logo on the packaging',
            fix: { scope: 'shared', regenerateAsset: { slotId: '   ' } },
          },
        ],
      })
    );

    const res = await handler(makeRequest(), 'org1');

    const content = JSON.parse(res.content);
    expect(content.findings[0].fix.regenerateAsset).toBeUndefined();
  });

  it('marks the pass skipped (not clean) when the image cannot be inlined', async () => {
    // A local storage URL pointing at a file that does not exist — the
    // inline read fails, so the critic never saw any evidence.
    const missingUrl = 'http://localhost:4200/uploads/2026/07/06/missing.png';

    const res = await handler(
      makeRequest({ contactSheetUrl: missingUrl }),
      'org1'
    );

    const content = JSON.parse(res.content);
    expect(content.type).toBe('findings');
    expect(content.findings).toEqual([]);
    expect(content.skipped).toBe(true);
    expect(aiDefaults.vision).not.toHaveBeenCalled();
  });

  it('marks the pass skipped (not clean) when the model reply is unparseable', async () => {
    aiDefaults.vision.mockResolvedValue('sorry, I cannot review images');

    const res = await handler(makeRequest(), 'org1');

    const content = JSON.parse(res.content);
    expect(content.type).toBe('findings');
    expect(content.findings).toEqual([]);
    expect(content.skipped).toBe(true);
  });

  it('omits the skipped marker on a clean zero-finding pass', async () => {
    aiDefaults.vision.mockResolvedValue('{"findings": []}');

    const res = await handler(makeRequest(), 'org1');

    const content = JSON.parse(res.content);
    expect(content.type).toBe('findings');
    expect(content.findings).toEqual([]);
    expect(content.skipped).toBeUndefined();
  });

  it('escalates contrast/occlusion findings to the full-res output pass', async () => {
    aiDefaults.vision
      .mockResolvedValueOnce(
        '{"findings": [{"issue": "Badge text has no contrast against the burst and is unreadable", "formatId": "ig-square"}]}'
      )
      .mockResolvedValueOnce('{"findings": []}');

    await handler(
      makeRequest({
        outputPreviews: [
          {
            formatId: 'ig-square',
            url: 'https://example.com/preview.png',
          },
        ],
      }),
      'org1'
    );

    expect(aiDefaults.vision).toHaveBeenCalledTimes(2);
    expect(aiDefaults.vision.mock.calls[1][2]).toContain('full-resolution');
  });
});
