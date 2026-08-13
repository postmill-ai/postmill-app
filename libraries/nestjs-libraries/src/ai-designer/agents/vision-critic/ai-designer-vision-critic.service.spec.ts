import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { AiDesignerVisionCriticService } from './ai-designer-vision-critic.service';

// 1x1 transparent PNG
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// A valid PNG comfortably over the 2MB inline cap: raw noise stored
// uncompressed. Built once — sharp is fast but not free.
let oversizedPngPromise: Promise<Buffer> | undefined;
const makeOversizedPng = () =>
  (oversizedPngPromise ??= sharp(randomBytes(900 * 900 * 3), {
    raw: { width: 900, height: 900, channels: 3 },
  })
    .png({ compressionLevel: 0 })
    .toBuffer());

const makeRequest = (overrides?: {
  contactSheetUrl?: string;
  outputPreviews?: { formatId: string; url: string }[];
  plans?: unknown[];
  docSummary?: unknown[];
  referenceCues?: string[];
  referenceFileIds?: string[];
  briefIntent?: string;
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
    referenceCues: overrides?.referenceCues,
    referenceFileIds: overrides?.referenceFileIds,
    briefIntent: overrides?.briefIntent,
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
    // Inlined bytes mean a feed-scale thumbnail can ride along — the call
    // becomes [full design, 25% thumbnail].
    const images = aiDefaults.vision.mock.calls[0][1] as string[];
    expect(Array.isArray(images)).toBe(true);
    expect(images).toHaveLength(2);
    expect(images[0]).toMatch(/^data:image\/png;base64,/);
    expect(images[0]).not.toBe(localUrl);
    expect(images[1]).toMatch(/^data:image\/jpeg;base64,/);
    const prompt = aiDefaults.vision.mock.calls[0][2] as string;
    expect(prompt).toContain('TWO images');
    expect(prompt).toContain('Image 2 is the SAME design at feed size');
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

  it('serializes the plan art direction into the critique prompt and adds plan_conformance', async () => {
    aiDefaults.vision.mockResolvedValue('{"findings": []}');

    await handler(
      makeRequest({
        plans: [
          {
            variantId: 'v2',
            skill: 'sale-discount',
            concept: 'Moody late-night pizza poster, full-bleed slice pull',
            composition: 'poster-left',
            background: { kind: 'image', ref: 'asset:image' },
            decor: ['wavy-rule'],
            palette: ['#0A0A14', '#F0F0FF', '#39FF14'],
            styleId: 'neon',
            depth: 'deep',
            slots: [{ id: 'headline', role: 'headline', kind: 'text' }],
            texts: { headline: 'BUY 1 GET 1 FREE' },
          },
        ],
      }),
      'org1'
    );

    const prompt = aiDefaults.vision.mock.calls[0][2] as string;
    expect(prompt).toContain('composition: poster-left');
    expect(prompt).toContain('background: image (asset:image)');
    expect(prompt).toContain('decor: wavy-rule');
    expect(prompt).toContain('palette: #0A0A14, #F0F0FF, #39FF14');
    expect(prompt).toContain('plan_conformance');
  });

  it('omits plan_conformance when no plans ride along (revise re-check without plans)', async () => {
    aiDefaults.vision.mockResolvedValue('{"findings": []}');

    await handler(makeRequest(), 'org1');

    const prompt = aiDefaults.vision.mock.calls[0][2] as string;
    expect(prompt).not.toContain('plan_conformance');
  });

  it('drops a fractional geometry fontSize — pixels, not ratios', async () => {
    // "0.8" for "20% smaller" is a ratio the model sometimes answers with; as
    // an op it fails the strict patch schema (fontSize ≥ 1) and one such fix
    // aborted a variant's whole format expansion live.
    aiDefaults.vision.mockResolvedValue(
      JSON.stringify({
        findings: [
          {
            issue: 'Subhead slightly large',
            criterion: 'craft_polish',
            fix: {
              scope: 'shared',
              targetSlots: ['subhead'],
              geometry: { fontSize: 0.8, y: 500 },
            },
          },
        ],
      })
    );

    const res = await handler(makeRequest(), 'org1');
    const content = JSON.parse(res.content);

    expect(content.findings[0].fix.geometry.fontSize).toBeUndefined();
    expect(content.findings[0].fix.geometry.y).toBe(500);
  });

  it('defaults a criterion-less finding to aesthetic_quality so the hold-back gate sees it', async () => {
    aiDefaults.vision.mockResolvedValue(
      '{"findings": [{"issue": "The whole card reads as unfinished"}]}'
    );

    const res = await handler(makeRequest(), 'org1');
    const content = JSON.parse(res.content);

    expect(content.findings).toHaveLength(1);
    expect(content.findings[0].criterion).toBe('aesthetic_quality');
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
    // No criterion given → defaulted, never undefined: the hold-back gate
    // filters on the criterion, so an undefined one slipped past it.
    expect(content.findings[1].criterion).toBe('aesthetic_quality');
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

  it('downscales an oversized local contact sheet instead of skipping the review', async () => {
    // Over the 2MB inline cap the resolver refuses the image — before, the
    // critique returned skipped and the variant shipped unreviewed.
    const png = await makeOversizedPng();
    expect(png.length).toBeGreaterThan(2 * 1024 * 1024);
    const key = '2026/07/06/oversized.png';
    writeFileSync(path.join(tmpDir, key), png);
    aiDefaults.vision.mockResolvedValue('{"findings": []}');

    const res = await handler(
      makeRequest({ contactSheetUrl: `http://localhost:4200/uploads/${key}` }),
      'org1'
    );

    const content = JSON.parse(res.content);
    expect(content.skipped).toBeUndefined();
    expect(aiDefaults.vision).toHaveBeenCalledTimes(1);
    const images = aiDefaults.vision.mock.calls[0][1] as string[];
    expect(Array.isArray(images)).toBe(true);
    // Re-encoded through sharp (1024px long edge, JPEG), plus the feed-scale
    // thumbnail built from the downscaled bytes.
    expect(images[0]).toMatch(/^data:image\/jpeg;base64,/);
    expect(images[1]).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('escalation downscales an oversized per-format preview instead of dropping it silently', async () => {
    const png = await makeOversizedPng();
    const key = '2026/07/06/preview-oversized.png';
    writeFileSync(path.join(tmpDir, key), png);
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
            url: `http://localhost:4200/uploads/${key}`,
          },
        ],
      }),
      'org1'
    );

    expect(aiDefaults.vision).toHaveBeenCalledTimes(2);
    expect(aiDefaults.vision.mock.calls[1][1]).toMatch(
      /^data:image\/jpeg;base64,/
    );
  });

  it('numbers the reference Image 3 when the feed-scale thumbnail rides along', async () => {
    const key = '2026/07/06/contact-with-ref.png';
    writeFileSync(
      path.join(tmpDir, key),
      Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64')
    );
    fileService.getFileById.mockResolvedValue({
      path: 'https://example.com/reference.jpg',
    });
    aiDefaults.vision.mockResolvedValue('{"findings": []}');

    await handler(
      makeRequest({
        contactSheetUrl: `http://localhost:4200/uploads/${key}`,
        referenceFileIds: ['ref-1'],
      }),
      'org1'
    );

    const images = aiDefaults.vision.mock.calls[0][1] as string[];
    expect(images).toHaveLength(3);
    expect(images[2]).toBe('https://example.com/reference.jpg');
    const prompt = aiDefaults.vision.mock.calls[0][2] as string;
    expect(prompt).toContain('THREE images');
    expect(prompt).toContain('Image 2 is the SAME design at feed size');
    expect(prompt).toContain("Image 3 is the user's REFERENCE design");
    expect(prompt).toContain('compare Image 1 against Image 3 directly');
    expect(prompt).not.toContain("Image 2 is the user's REFERENCE");
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

  it('still critiques with the base criteria when the rubric is missing', async () => {
    // The planner improvises skill-id suffixes ("reference-clone-poster"), so
    // the conductor's rubric lookup can come back empty — the pass must run
    // on the base criteria, not die reading `.criteria` of undefined and ship
    // the variant unreviewed (observed live).
    aiDefaults.vision.mockResolvedValue('{"findings": []}');
    const raw = JSON.parse(makeRequest());
    delete raw.rubric;

    const res = await handler(JSON.stringify(raw), 'org1');

    const content = JSON.parse(res.content);
    expect(content.type).toBe('findings');
    expect(aiDefaults.vision).toHaveBeenCalledTimes(1);
    expect(aiDefaults.vision.mock.calls[0][2]).toContain('text_fit');
  });

  it('appends the professional-bar criteria (display dominance, balance) to every prompt', async () => {
    // The classes a live sale run shipped and the old rubric passed: an 83px
    // headline on an empty 1080 canvas, and copy crammed into one corner.
    aiDefaults.vision.mockResolvedValue('{"findings": []}');

    await handler(makeRequest(), 'org1');

    const prompt = aiDefaults.vision.mock.calls[0][2] as string;
    expect(prompt).toContain('display_hierarchy');
    expect(prompt).toContain('composition_balance');
  });

  it('judges offer fidelity against the user\'s own words when the brief rides the payload', async () => {
    // Plan and render agreed with each other and were both wrong for the
    // user ("B1G1 FREE" for "buy 1 get 1 free") — the plan's expected copy
    // cannot catch that; only the brief can.
    aiDefaults.vision.mockResolvedValue('{"findings": []}');
    const raw = JSON.parse(makeRequest());
    raw.briefIntent = 'create a post for my pizza business — buy 1 get 1 free';

    await handler(JSON.stringify(raw), 'org1');

    const prompt = aiDefaults.vision.mock.calls[0][2] as string;
    expect(prompt).toContain('offer_fidelity');
    expect(prompt).toContain('buy 1 get 1 free');
  });

  it('omits offer_fidelity when no brief intent is known', async () => {
    aiDefaults.vision.mockResolvedValue('{"findings": []}');

    await handler(makeRequest(), 'org1');

    expect(aiDefaults.vision.mock.calls[0][2]).not.toContain('offer_fidelity');
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

  it.each([
    'duplicate',
    'ghost',
    'washed',
    'faded',
    'clipped',
    'cut off',
    'floating',
  ])(
    'escalates a "%s" finding to the full-res output pass',
    async (keyword) => {
      aiDefaults.vision
        .mockResolvedValueOnce(
          JSON.stringify({
            findings: [
              { issue: `The badge looks ${keyword} here`, formatId: 'ig-square' },
            ],
          })
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

      expect(aiDefaults.vision).toHaveBeenCalledTimes(2);
    }
  );

  it('attaches the reference image next to the render on reference runs', async () => {
    fileService.getFileById.mockResolvedValue({
      path: 'https://example.com/reference.jpg',
    });
    aiDefaults.vision.mockResolvedValue('{"findings": []}');

    await handler(makeRequest({ referenceFileIds: ['ref-1'] }), 'org1');

    expect(aiDefaults.vision).toHaveBeenCalledTimes(1);
    // Image 1 = the render, Image 2 = the reference — the prompt addresses
    // them by this order.
    expect(aiDefaults.vision.mock.calls[0][1]).toEqual([
      'https://example.com/contact.png',
      'https://example.com/reference.jpg',
    ]);
    const prompt = aiDefaults.vision.mock.calls[0][2] as string;
    expect(prompt).toContain('TWO images');
    expect(prompt).toContain('REFERENCE FIDELITY CHECKLIST');
    expect(prompt).toContain('SILHOUETTE');
    expect(prompt).toContain('an arched ribbon is not a pill');
    // The copy is the user's — fidelity judges structure, never the words.
    expect(prompt).toContain('never the words themselves');
    // The criterion exists from the fileIds alone (no cues needed).
    expect(prompt).toContain('reference_fidelity');
  });

  it('downscales an inlined local reference through sharp before attaching it', async () => {
    const key = '2026/07/06/reference.png';
    writeFileSync(
      path.join(tmpDir, key),
      Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64')
    );
    fileService.getFileById.mockResolvedValue({
      path: `http://localhost:4200/uploads/${key}`,
    });
    aiDefaults.vision.mockResolvedValue('{"findings": []}');

    await handler(makeRequest({ referenceFileIds: ['ref-1'] }), 'org1');

    const urls = aiDefaults.vision.mock.calls[0][1] as string[];
    expect(Array.isArray(urls)).toBe(true);
    // Re-encoded JPEG data URI, not the raw PNG bytes.
    expect(urls[1]).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('degrades to the cue-only critique when the reference cannot be resolved — never skips', async () => {
    fileService.getFileById.mockResolvedValue(null);
    aiDefaults.vision.mockResolvedValue('{"findings": []}');

    const res = await handler(
      makeRequest({
        referenceFileIds: ['ref-gone'],
        referenceCues: ['COMPOSITION: type stack top-left'],
      }),
      'org1'
    );

    const content = JSON.parse(res.content);
    expect(content.skipped).toBeUndefined();
    // Single-image call, cue-based criterion still present.
    expect(aiDefaults.vision.mock.calls[0][1]).toBe(
      'https://example.com/contact.png'
    );
    const prompt = aiDefaults.vision.mock.calls[0][2] as string;
    expect(prompt).toContain('reference_fidelity');
    expect(prompt).not.toContain('REFERENCE FIDELITY CHECKLIST');
  });

  it('memoizes the resolved reference across critiques (same file, one lookup)', async () => {
    fileService.getFileById.mockResolvedValue({
      path: 'https://example.com/reference.jpg',
    });
    aiDefaults.vision.mockResolvedValue('{"findings": []}');

    await handler(makeRequest({ referenceFileIds: ['ref-1'] }), 'org1');
    await handler(makeRequest({ referenceFileIds: ['ref-1'] }), 'org1');

    expect(fileService.getFileById).toHaveBeenCalledTimes(1);
  });

  it('escalation passes stay single-image even on reference runs', async () => {
    fileService.getFileById.mockResolvedValue({
      path: 'https://example.com/reference.jpg',
    });
    aiDefaults.vision
      .mockResolvedValueOnce(
        '{"findings": [{"issue": "Headline is too small to read", "formatId": "ig-square"}]}'
      )
      .mockResolvedValueOnce('{"findings": []}');

    await handler(
      makeRequest({
        referenceFileIds: ['ref-1'],
        outputPreviews: [
          { formatId: 'ig-square', url: 'https://example.com/preview.png' },
        ],
      }),
      'org1'
    );

    expect(aiDefaults.vision).toHaveBeenCalledTimes(2);
    // The escalation is a legibility/safe-zone check — no reference attached.
    expect(aiDefaults.vision.mock.calls[1][1]).toBe(
      'https://example.com/preview.png'
    );
  });

  it('normalizes letterSpacing and lineHeight fixes with the composer clamps', async () => {
    // Both were advertised in the prompt and applied by the composer, but the
    // normalizer dropped them — every tracking/leading fix silently vanished
    // and craft_polish findings recurred until the variant was held back.
    aiDefaults.vision.mockResolvedValue(
      JSON.stringify({
        findings: [
          {
            issue: 'Footer caps are not tracked out',
            fix: {
              scope: 'shared',
              targetSlots: ['legal'],
              style: { letterSpacing: 4, lineHeight: 1.05 },
            },
          },
          {
            issue: 'Out-of-range values are clamped',
            fix: {
              scope: 'shared',
              targetSlots: ['headline'],
              style: { letterSpacing: 99, lineHeight: 0.2 },
            },
          },
        ],
      })
    );

    const res = await handler(makeRequest(), 'org1');

    const content = JSON.parse(res.content);
    expect(content.findings[0].fix.style.letterSpacing).toBe(4);
    expect(content.findings[0].fix.style.lineHeight).toBe(1.05);
    expect(content.findings[1].fix.style.letterSpacing).toBe(20);
    expect(content.findings[1].fix.style.lineHeight).toBe(1);
  });

  it('normalizes a badgeStyle fix (enum only) and advertises recompose with real composition ids', async () => {
    aiDefaults.vision.mockResolvedValue(
      JSON.stringify({
        findings: [
          {
            issue: 'The 1893 badge is an arched ribbon in the reference, not a pill',
            fix: {
              scope: 'shared',
              targetSlots: ['badge'],
              style: { badgeStyle: 'ribbon' },
            },
          },
          {
            issue: 'Junk value must be dropped',
            fix: {
              scope: 'shared',
              targetSlots: ['badge'],
              style: { badgeStyle: 'octagon', fill: '#FF0000' },
            },
          },
        ],
      })
    );

    const res = await handler(makeRequest(), 'org1');

    const content = JSON.parse(res.content);
    expect(content.findings[0].fix.style.badgeStyle).toBe('ribbon');
    expect(content.findings[1].fix.style.badgeStyle).toBeUndefined();
    expect(content.findings[1].fix.style.fill).toBe('#FF0000');
    const prompt = aiDefaults.vision.mock.calls[0][2] as string;
    expect(prompt).toContain('"recompose": a composition id');
    expect(prompt).toContain('poster-left');
    expect(prompt).toContain('badgeStyle ("pill"|"ribbon"');
  });

  describe('compare-request (best-of-N against the reference)', () => {
    const makeCompare = (over: Record<string, unknown> = {}) =>
      JSON.stringify({
        type: 'compare-request',
        referenceFileIds: ['ref-1'],
        candidates: [
          { variantId: 'v1', url: 'https://example.com/v1.png' },
          { variantId: 'v2', url: 'https://example.com/v2.png' },
        ],
        ...over,
      });

    beforeEach(() => {
      // Pin the candidate shuffle so image order is deterministic in tests
      // (0.99 makes every Fisher–Yates swap a self-swap).
      vi.spyOn(Math, 'random').mockReturnValue(0.99);
      fileService.getFileById.mockResolvedValue({
        path: 'https://example.com/reference.jpg',
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('sends the reference first, then every candidate, and maps the ranking back', async () => {
      aiDefaults.vision.mockResolvedValue(
        JSON.stringify({
          ranking: ['v2', 'v1'],
          reasons: { v2: 'top-left stack and arched ribbon match' },
        })
      );

      const res = await handler(makeCompare(), 'org1');

      expect(aiDefaults.vision).toHaveBeenCalledTimes(1);
      expect(aiDefaults.vision.mock.calls[0][1]).toEqual([
        'https://example.com/reference.jpg',
        'https://example.com/v1.png',
        'https://example.com/v2.png',
      ]);
      const prompt = aiDefaults.vision.mock.calls[0][2] as string;
      expect(prompt).toContain('Image 1 is the user\'s REFERENCE design');
      expect(prompt).toContain('Image 2 = "v1"');
      expect(prompt).toContain('Image 3 = "v2"');
      expect(prompt).toContain('never the words');
      const content = JSON.parse(res.content);
      expect(content.type).toBe('comparison');
      expect(content.ranking).toEqual(['v2', 'v1']);
      expect(content.reasons.v2).toContain('arched ribbon');
    });

    it('filters hallucinated candidate ids out of the ranking', async () => {
      aiDefaults.vision.mockResolvedValue(
        JSON.stringify({ ranking: ['v9', 'v1', 'v2'], reasons: { v9: 'x' } })
      );

      const res = await handler(makeCompare(), 'org1');

      const content = JSON.parse(res.content);
      expect(content.ranking).toEqual(['v1', 'v2']);
      expect(content.reasons?.v9).toBeUndefined();
    });

    it('skips when the reply is unparseable', async () => {
      aiDefaults.vision.mockResolvedValue('the second one looks nicer');

      const res = await handler(makeCompare(), 'org1');

      expect(JSON.parse(res.content)).toEqual({
        type: 'comparison',
        skipped: true,
      });
    });

    it('skips when the reference cannot be resolved — never invents a winner', async () => {
      fileService.getFileById.mockResolvedValue(null);

      const res = await handler(makeCompare(), 'org1');

      expect(JSON.parse(res.content).skipped).toBe(true);
      expect(aiDefaults.vision).not.toHaveBeenCalled();
    });

    it('skips with fewer than two resolvable candidates', async () => {
      const res = await handler(
        makeCompare({
          candidates: [{ variantId: 'v1', url: 'https://example.com/v1.png' }],
        }),
        'org1'
      );

      expect(JSON.parse(res.content).skipped).toBe(true);
      expect(aiDefaults.vision).not.toHaveBeenCalled();
    });
  });

  it('interprets a reference as a STRUCTURAL deconstruction, not a caption', async () => {
    // The one-sentence "dominant colors, mood, text, subject" prompt returned
    // cues with no composition, no per-line type stack and no ornament
    // inventory — it even merged three visible lines into one string, and the
    // planner mirrored that merge into a single slot. The reference-clone
    // skill's structural rules are only as good as these cues.
    fileService.getFileById.mockResolvedValue({
      path: 'https://example.com/ref.png',
    });
    aiDefaults.vision
      .mockResolvedValueOnce('COMPOSITION: type stack top-left')
      // The measurement call's reply — unparseable here, deliberately.
      .mockResolvedValueOnce('not json');

    const { cues, layout } = await service.interpretReferences('org1', ['f1']);

    // Two calls per (first) file now: the prose deconstruction AND the
    // structured measurement.
    expect(aiDefaults.vision).toHaveBeenCalledTimes(2);
    const prompt = aiDefaults.vision.mock.calls[0][2] as string;
    expect(prompt).toContain('COMPOSITION');
    expect(prompt).toContain('TYPE STACK');
    expect(prompt).toContain('ORNAMENTS');
    expect(prompt).toContain('NEVER merge');
    expect(cues).toEqual(['COMPOSITION: type stack top-left']);
    // Malformed measurement is fail-soft: cues carry the run alone.
    expect(layout).toBeUndefined();
  });

  it('measures the first reference into a structured layout (bands, ratios)', async () => {
    fileService.getFileById.mockResolvedValue({
      path: 'https://example.com/ref.png',
    });
    const measured = {
      lines: [
        {
          text: 'PIZZA',
          yBand: [0.08, 0.2],
          xAnchor: 'left',
          heightRatio: 0.11,
          fontClass: 'condensed slab serif',
          case: 'caps',
        },
        { text: 'Italian', yBand: [0.04, 0.07], xAnchor: 'left' },
      ],
      badge: { yBand: [0.6, 0.66], xAnchor: 'left', shape: 'ribbon' },
    };
    aiDefaults.vision
      .mockResolvedValueOnce('COMPOSITION: type stack top-left')
      .mockResolvedValueOnce(JSON.stringify(measured));

    const { layout } = await service.interpretReferences('org1', ['f1']);

    const measurementPrompt = aiDefaults.vision.mock.calls[1][2] as string;
    expect(measurementPrompt).toContain('FRACTION of image height');
    expect(measurementPrompt).toContain('yBand');
    expect(layout).toEqual(measured);
  });

  it('rejects an out-of-bounds measurement instead of persisting it', async () => {
    fileService.getFileById.mockResolvedValue({
      path: 'https://example.com/ref.png',
    });
    aiDefaults.vision
      .mockResolvedValueOnce('cue')
      .mockResolvedValueOnce(
        JSON.stringify({ lines: [{ text: 'PIZZA', yBand: [0.1, 7] }] })
      );

    const { cues, layout } = await service.interpretReferences('org1', ['f1']);

    expect(layout).toBeUndefined();
    expect(cues).toEqual(['cue']);
  });
});
