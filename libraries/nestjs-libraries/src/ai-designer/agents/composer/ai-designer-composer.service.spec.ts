import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiDesignerComposerService } from './ai-designer-composer.service';
import { DesignerDocService } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.service';
import type { DesignPlan, VisionFinding } from '../../ai-designer.types';

const makeDoc = () =>
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
          },
          {
            id: 'e2',
            originId: 'image',
            type: 'image',
            x: 0,
            y: 0,
            width: 1080,
            height: 1080,
          },
        ],
      },
    ],
  } as any);

describe('AiDesignerComposerService.applyFixes', () => {
  let docService: { applyOps: ReturnType<typeof vi.fn> };
  let model: { generateText: ReturnType<typeof vi.fn> };
  let service: AiDesignerComposerService;

  beforeEach(() => {
    docService = {
      applyOps: vi.fn((doc: unknown, ops: unknown[]) => ({
        ...(doc as object),
        appliedOps: ops,
      })),
    };
    model = { generateText: vi.fn() };
    service = new AiDesignerComposerService(
      docService as any,
      model as any
    );
  });

  it('does not log "kept over" for a critic round-trip on a pipe-cleaned lock', async () => {
    // The conductor now locks the pipe-NORMALIZED value (" • ") — the doc
    // renders it, the critic echoes it back, and the lock matches exactly.
    // The revert branch (and its "kept over the critic's rewrite" log) must
    // not fire on the machine-separator cleanup itself.
    const doc = makeDoc();
    doc.outputs[0].children[0].text = 'Join now • BEAN30';
    const findings: VisionFinding[] = [
      {
        issue: 'Headline needs emphasis',
        fix: {
          scope: 'shared',
          text: { slotId: 'headline', newText: 'Join now • BEAN30' },
        },
      },
    ];
    const logSpy = vi.spyOn((service as any)._logger, 'log');

    await service.applyFixes(doc, findings, 'org1', undefined, undefined, {
      headline: 'Join now • BEAN30',
    });

    const keptOver = logSpy.mock.calls.filter((call) =>
      String(call[0]).includes('kept over the')
    );
    expect(keptOver).toHaveLength(0);
    const ops = docService.applyOps.mock.calls[0][1] as any[];
    expect(ops[0].patch.text).toBe('Join now • BEAN30');
  });

  it('skips an unscoped geometry/style fix instead of patching every element', async () => {
    const doc = makeDoc();
    const findings: VisionFinding[] = [
      {
        issue: 'Everything is too low',
        fix: { scope: 'shared', geometry: { y: 1500 } },
      },
    ];

    const result = await service.applyFixes(doc, findings, 'org1');

    expect(docService.applyOps).not.toHaveBeenCalled();
    expect(result).toBe(doc);
  });

  it('applies a geometry fix scoped by targetSlots to matching elements only', async () => {
    const doc = makeDoc();
    const findings: VisionFinding[] = [
      {
        issue: 'Headline too low',
        fix: {
          scope: 'shared',
          targetSlots: ['headline'],
          geometry: { y: 40 },
        },
      },
    ];

    await service.applyFixes(doc, findings, 'org1');

    expect(docService.applyOps).toHaveBeenCalledTimes(1);
    const ops = docService.applyOps.mock.calls[0][1];
    expect(ops).toEqual([
      {
        op: 'updateElement',
        outputIndex: 0,
        elementId: 'e1',
        scope: 'shared',
        patch: { y: 40 },
      },
    ]);
  });

  it('moves a cta-button pair together when a geometry fix targets its slot', async () => {
    const doc = {
      mode: 'image',
      outputs: [
        {
          id: 'o1',
          formatId: 'ig-post',
          name: 'IG',
          width: 1080,
          height: 1080,
          background: '#000000',
          children: [
            { id: 'e1', originId: 'cta-bg', type: 'shape', x: 434, y: 856, width: 213, height: 59 },
            { id: 'e2', originId: 'cta', type: 'text', x: 434, y: 856, width: 213, height: 59, text: 'Shop now' },
          ],
        },
      ],
    } as any;
    const findings: VisionFinding[] = [
      {
        issue: 'CTA too low',
        fix: { scope: 'shared', targetSlots: ['cta'], geometry: { y: 700 } },
      },
    ];

    await service.applyFixes(doc, findings, 'org1');

    expect(docService.applyOps).toHaveBeenCalledTimes(1);
    const ops = docService.applyOps.mock.calls[0][1];
    // Both the label (originId 'cta') and its button shape ('cta-bg') are
    // patched — patching only the label would detach text from shape.
    expect(ops).toEqual([
      { op: 'updateElement', outputIndex: 0, elementId: 'e1', scope: 'shared', patch: { y: 700 } },
      { op: 'updateElement', outputIndex: 0, elementId: 'e2', scope: 'shared', patch: { y: 700 } },
    ]);
  });

  it('keeps a style fix label-only (does not recolor the button shape)', async () => {
    const doc = {
      mode: 'image',
      outputs: [
        {
          id: 'o1',
          formatId: 'ig-post',
          name: 'IG',
          width: 1080,
          height: 1080,
          background: '#000000',
          children: [
            { id: 'e1', originId: 'cta-bg', type: 'shape', x: 434, y: 856, width: 213, height: 59 },
            { id: 'e2', originId: 'cta', type: 'text', x: 434, y: 856, width: 213, height: 59, text: 'Shop now' },
          ],
        },
      ],
    } as any;
    const findings: VisionFinding[] = [
      {
        issue: 'CTA label lacks contrast',
        fix: { scope: 'shared', targetSlots: ['cta'], style: { fill: '#FFFFFF' } },
      },
    ];

    await service.applyFixes(doc, findings, 'org1');

    expect(docService.applyOps).toHaveBeenCalledTimes(1);
    const ops = docService.applyOps.mock.calls[0][1];
    expect(ops).toEqual([
      { op: 'updateElement', outputIndex: 0, elementId: 'e2', scope: 'shared', patch: { fill: '#FFFFFF' } },
    ]);
  });

  it('falls back to the finding slotId as the scope when targetSlots is absent', async () => {
    const doc = makeDoc();
    const findings: VisionFinding[] = [
      {
        issue: 'Headline lacks contrast',
        slotId: 'headline',
        fix: { scope: 'shared', style: { fill: '#000000' } },
      },
    ];

    await service.applyFixes(doc, findings, 'org1');

    expect(docService.applyOps).toHaveBeenCalledTimes(1);
    const ops = docService.applyOps.mock.calls[0][1];
    expect(ops).toEqual([
      {
        op: 'updateElement',
        outputIndex: 0,
        elementId: 'e1',
        scope: 'shared',
        patch: { fill: '#000000' },
      },
    ]);
  });

  it('still applies a text fix (self-scoped by its slotId) when no slot scope exists', async () => {
    const doc = makeDoc();
    const findings: VisionFinding[] = [
      {
        issue: 'Typo in the headline',
        fix: {
          scope: 'shared',
          text: { slotId: 'headline', newText: 'Fixed' },
        },
      },
    ];

    await service.applyFixes(doc, findings, 'org1');

    expect(docService.applyOps).toHaveBeenCalledTimes(1);
    const ops = docService.applyOps.mock.calls[0][1];
    expect(ops).toEqual([
      {
        op: 'updateElement',
        outputIndex: 0,
        elementId: 'e1',
        scope: 'shared',
        patch: { text: 'Fixed' },
      },
    ]);
  });

  it('stops the note-fix LLM fan-out when the abort signal is already set', async () => {
    const doc = makeDoc();
    const findings: VisionFinding[] = [
      { issue: 'a', fix: { scope: 'shared', note: 'make it pop' } },
      { issue: 'b', fix: { scope: 'shared', note: 'more contrast' } },
    ];
    const controller = new AbortController();
    controller.abort();

    const result = await service.applyFixes(
      doc,
      findings,
      'org1',
      controller.signal
    );

    expect(model.generateText).not.toHaveBeenCalled();
    expect(result).toBe(doc);
  });

  it('skips a format-only fix with an unknown formatId', async () => {
    const doc = makeDoc();
    const findings: VisionFinding[] = [
      {
        issue: 'Spacing issue',
        formatId: 'unknown-format',
        fix: { scope: 'format-only', geometry: { y: 40 } },
      },
    ];

    const result = await service.applyFixes(doc, findings, 'org1');

    expect(docService.applyOps).not.toHaveBeenCalled();
    expect(result).toBe(doc);
  });

  it('skips an unscoped format-only fix with a missing formatId', async () => {
    const doc = makeDoc();
    const findings: VisionFinding[] = [
      {
        issue: 'Spacing issue',
        fix: { scope: 'format-only', geometry: { y: 40 } },
      },
    ];

    const result = await service.applyFixes(doc, findings, 'org1');

    expect(docService.applyOps).not.toHaveBeenCalled();
    expect(result).toBe(doc);
  });
});

// ---------------------------------------------------------------------------
// compose (Phase 2B style-aware deterministic composer)
// ---------------------------------------------------------------------------

const SQUARE = { formatId: 'ig-square', width: 1080, height: 1080 };

const makePlan = (overrides: Partial<DesignPlan> = {}): DesignPlan => ({
  variantId: 'v1',
  skill: 'social',
  concept: 'Coffee launch',
  formatTemplate: 'hero-fullbleed',
  styleId: 'bold',
  palette: [],
  typeScale: {},
  background: { kind: 'solid', value: '#0A0A0A' },
  slots: [
    { id: 'img', role: 'image', kind: 'image' },
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'sub', role: 'subhead', kind: 'text' },
    { id: 'cta', role: 'cta', kind: 'cta-button' },
  ],
  assetNeeds: [],
  ...overrides,
});

const makeAssets = () => ({
  img: {
    slotId: 'img',
    fileId: 'f1',
    path: 'https://example.com/i.png',
    type: 'image' as const,
  },
});

const makeCopy = () => ({
  headline: 'Big launch',
  sub: 'Now brewing',
  cta: 'Shop now',
  badge: 'New',
});

const composeWith = async (
  plan: DesignPlan,
  outputs = [SQUARE],
  copy = makeCopy()
) => {
  const service = new AiDesignerComposerService(
    new DesignerDocService() as any,
    { generateText: vi.fn() } as any
  );
  const doc = await service.compose({
    plan,
    copy,
    assets: makeAssets(),
    outputs,
    orgId: 'o1',
    userId: 'u1',
  });
  return doc;
};

const childrenOf = (doc: any, index = 0) => doc.outputs[index].children as any[];
const byOrigin = (doc: any, originId: string, index = 0) =>
  childrenOf(doc, index).find((el) => el.originId === originId);

describe('AiDesignerComposerService.compose (style-aware)', () => {
  it('resolves the preset: display font on the headline, body font on supporting text', async () => {
    const doc = await composeWith(makePlan({ styleId: 'editorial' }));

    expect(byOrigin(doc, 'headline').fontFamily).toBe('Playfair Display');
    expect(byOrigin(doc, 'sub').fontFamily).toBe('Inter');
    expect(byOrigin(doc, 'cta').fontFamily).toBe('Inter');
  });

  it('uses the default style when styleId is absent', async () => {
    const plan = makePlan();
    delete plan.styleId;
    const doc = await composeWith(plan);

    const headline = byOrigin(doc, 'headline');
    // Default preset is 'bold' (Anton display, uppercase headline).
    expect(headline.fontFamily).toBe('Anton');
    expect(headline.text).toBe('BIG LAUNCH');
  });

  it('lets a per-slot style override win over preset defaults', async () => {
    const plan = makePlan();
    plan.slots[1].style = {
      fontFamily: 'Inter',
      fontWeight: 300,
      fill: '#123456',
    };
    const doc = await composeWith(plan);

    const headline = byOrigin(doc, 'headline');
    expect(headline.fontFamily).toBe('Inter');
    expect(headline.fontWeight).toBe(300);
    expect(headline.fill).toBe('#123456');
  });

  it('renders a cta-button slot as an accent shape + centered text pair', async () => {
    const doc = await composeWith(makePlan());

    const shape = byOrigin(doc, 'cta-bg');
    const text = byOrigin(doc, 'cta');
    expect(shape).toBeDefined();
    expect(text).toBeDefined();
    expect(shape.type).toBe('shape');
    // 'bold' preset: pill CTA in the palette accent.
    expect(shape.fill).toBe('#FF4D00');
    expect(shape.borderRadius).toBe(Math.round(shape.height / 2));
    expect(shape.groupId).toBe('cta');
    expect(text.groupId).toBe('cta');
    // The label overlaps the button shape exactly — same box, centered both
    // ways — so it can never render beside or below the pill.
    expect(text.x).toBe(shape.x);
    expect(text.y).toBe(shape.y);
    expect(text.width).toBe(shape.width);
    expect(text.height).toBe(shape.height);
    expect(text.align).toBe('center');
    expect(text.verticalAlign).toBe('middle');
    expect(text.text).toBe('Shop now');
  });

  it('centers the CTA label inside the shape even in left-aligned panels', async () => {
    const doc = await composeWith(makePlan({ formatTemplate: 'split-panel' }));

    const shape = byOrigin(doc, 'cta-bg');
    const text = byOrigin(doc, 'cta');
    expect(text.x).toBe(shape.x);
    expect(text.y).toBe(shape.y);
    expect(text.width).toBe(shape.width);
    expect(text.height).toBe(shape.height);
    expect(text.align).toBe('center');
    expect(text.verticalAlign).toBe('middle');
  });

  it('renders a badge slot as a pill + short text', async () => {
    const plan = makePlan();
    plan.slots.push({ id: 'badge', role: 'badge', kind: 'badge' });
    const doc = await composeWith(plan);

    const shape = byOrigin(doc, 'badge-bg');
    const text = byOrigin(doc, 'badge');
    expect(shape.type).toBe('shape');
    expect(shape.fill).toBe('#FF4D00');
    expect(shape.borderRadius).toBe(Math.round(shape.height / 2));
    expect(text.text).toBe('New');
    expect(text.verticalAlign).toBe('middle');
    // The label is horizontally inset inside the pill so glyphs never touch
    // or clip the pill's edges.
    expect(text.x).toBeGreaterThan(shape.x);
    expect(text.x + text.width).toBeLessThan(shape.x + shape.width);
    expect(text.y).toBe(shape.y);
    expect(text.height).toBe(shape.height);
  });

  it('falls back to the preset palette when the plan palette is too short', async () => {
    const doc = await composeWith(makePlan({ palette: ['#123456'] }));
    expect(byOrigin(doc, 'cta-bg').fill).toBe('#FF4D00');
  });

  it('honors a complete plan palette (surface/text/accent convention)', async () => {
    const doc = await composeWith(
      makePlan({ palette: ['#101010', '#EEEEEE', '#00FF00'] })
    );
    expect(byOrigin(doc, 'cta-bg').fill).toBe('#00FF00');
  });

  it('maps preset typeScale ratios to px for 1080x1080', async () => {
    const doc = await composeWith(makePlan());

    // bold ratios on a 1080 baseline (~92px headline): 1 / 0.42 / 0.3.
    const headline = byOrigin(doc, 'headline').fontSize;
    const sub = byOrigin(doc, 'sub').fontSize;
    const cta = byOrigin(doc, 'cta').fontSize;
    expect(headline).toBeGreaterThanOrEqual(85);
    expect(headline).toBeLessThanOrEqual(100);
    expect(sub).toBeGreaterThanOrEqual(33);
    expect(sub).toBeLessThanOrEqual(45);
    expect(cta).toBeGreaterThanOrEqual(24);
    expect(cta).toBeLessThanOrEqual(32);
  });

  it('lets plan.typeScale px hints override the preset ratios', async () => {
    const doc = await composeWith(makePlan({ typeScale: { headline: 120 } }));
    expect(byOrigin(doc, 'headline').fontSize).toBe(120);
  });

  it('falls back to hero-fullbleed for unknown templates when the plan has imagery', async () => {
    const doc = await composeWith(makePlan({ formatTemplate: 'something-weird' }));

    const image = byOrigin(doc, 'img');
    expect(image.width).toBe(1080);
    expect(image.height).toBe(1080);
    // Headline sits in the lower half (hero lower-third stack).
    expect(byOrigin(doc, 'headline').y).toBeGreaterThanOrEqual(1080 * 0.4);
  });

  it('falls back to minimal-centered for unknown templates without imagery', async () => {
    const plan = makePlan({ formatTemplate: 'something-weird' });
    plan.slots = plan.slots.filter((s) => s.kind !== 'image');
    const doc = await composeWith(plan);

    expect(childrenOf(doc).some((el) => el.type === 'image')).toBe(false);
    const headline = byOrigin(doc, 'headline');
    expect(headline.align).toBe('center');
    expect(headline.verticalAlign).toBe('middle');
    expect(headline.textStroke).toBeUndefined();
  });

  it('aliases legacy template ids into the gallery', async () => {
    const macro = await composeWith(makePlan({ formatTemplate: 'image-macro' }));
    expect(byOrigin(macro, 'img').height).toBe(1080);
    expect(byOrigin(macro, 'headline').y).toBeGreaterThanOrEqual(1080 * 0.4);

    const twoPanel = await composeWith(makePlan({ formatTemplate: 'two-panel' }));
    expect(byOrigin(twoPanel, 'split-panel-bg')).toBeDefined();

    const topBottom = await composeWith(
      makePlan({ formatTemplate: 'top-bottom-text' })
    );
    // Top caption pinned to the safe margin at the top.
    expect(byOrigin(topBottom, 'headline').y).toBe(54);
  });

  it('composes a channelLayouts output with the mapped layout instead of the reflow', async () => {
    const plan = makePlan({
      channelLayouts: { story: 'side-by-side' },
    });
    const doc = await composeWith(plan, [
      SQUARE,
      { formatId: 'story', width: 1080, height: 1920 },
    ]);

    expect(doc.outputs).toHaveLength(2);
    // Secondary output got the split-panel treatment; the primary did not.
    expect(byOrigin(doc, 'split-panel-bg', 1)).toBeDefined();
    expect(byOrigin(doc, 'split-panel-bg', 0)).toBeUndefined();
    expect(byOrigin(doc, 'headline', 1).align).toBe('left');
    expect(byOrigin(doc, 'headline', 0).align).not.toBe('left');
  });

  it('paints accent shapes before text elements (behind the copy)', async () => {
    const plan = makePlan();
    plan.slots.push({ id: 'acc', role: 'accent', kind: 'accent-shape' });
    const doc = await composeWith(plan);

    const children = childrenOf(doc);
    const accentIdx = children.findIndex((el) => el.originId === 'acc');
    const headlineIdx = children.findIndex((el) => el.originId === 'headline');
    expect(accentIdx).toBeGreaterThanOrEqual(0);
    expect(headlineIdx).toBeGreaterThanOrEqual(0);
    expect(accentIdx).toBeLessThan(headlineIdx);
    expect(children[accentIdx].type).toBe('shape');
    expect(children[accentIdx].fill).toBe('#FF4D00');
  });

  it('hero-fullbleed is full-bleed by design — the image covers the whole canvas (no scrim band)', async () => {
    const doc = await composeWith(makePlan({ formatTemplate: 'hero-fullbleed' }));

    const image = byOrigin(doc, 'img');
    expect(image.x).toBe(0);
    expect(image.y).toBe(0);
    expect(image.width).toBe(1080);
    expect(image.height).toBe(1080);
    expect(image.fitMode).toBe('cover');
  });

  it('split-panel image fills the panel column (full height, right side)', async () => {
    const doc = await composeWith(makePlan({ formatTemplate: 'split-panel' }));

    const image = byOrigin(doc, 'img');
    const panelW = Math.round(1080 * 0.46);
    expect(image.x).toBe(panelW);
    expect(image.y).toBe(0);
    expect(image.width).toBe(1080 - panelW);
    expect(image.height).toBe(1080);
    expect(image.fitMode).toBe('cover');
  });

  it('keeps the split-panel image column (not a full-canvas bg) on seeded secondary outputs', async () => {
    const doc = await composeWith(makePlan({ formatTemplate: 'split-panel' }), [
      SQUARE,
      { formatId: 'x-post', width: 1200, height: 675 },
    ]);

    const image = byOrigin(doc, 'img', 1);
    // Fractional panel box preserved per-axis: x ≈ 0.46·1200, w ≈ 0.54·1200,
    // full target height — never stretched to a full-canvas background.
    expect(image.y).toBe(0);
    expect(image.height).toBe(675);
    expect(image.x).toBeGreaterThan(400);
    expect(image.x).toBeLessThan(600);
    expect(image.width).toBeGreaterThan(560);
    expect(image.width).toBeLessThan(720);
    expect(image.fitMode).toBe('cover');
  });

  it('keeps the hero image full-canvas on seeded secondary outputs', async () => {
    const doc = await composeWith(makePlan(), [
      SQUARE,
      { formatId: 'x-post', width: 1200, height: 675 },
    ]);

    const image = byOrigin(doc, 'img', 1);
    expect(image.x).toBe(0);
    expect(image.y).toBe(0);
    expect(image.width).toBe(1200);
    expect(image.height).toBe(675);
  });

  it('keeps cta-button pairs glued on seeded secondary outputs', async () => {
    const doc = await composeWith(makePlan(), [
      SQUARE,
      { formatId: 'x-post', width: 1200, height: 675 },
    ]);

    const shape = byOrigin(doc, 'cta-bg', 1);
    const text = byOrigin(doc, 'cta', 1);
    expect(text.x).toBe(shape.x);
    expect(text.y).toBe(shape.y);
    expect(text.width).toBe(shape.width);
    expect(text.height).toBe(shape.height);
    expect(text.align).toBe('center');
    expect(text.verticalAlign).toBe('middle');
  });
});

describe('AiDesignerComposerService asset resolution (variant-scoped)', () => {
  const WIDE = { formatId: 'fb-post', width: 1200, height: 630 };

  const aspectAssets = (): Record<string, any> => ({
    'img:square': {
      slotId: 'img',
      fileId: 'f-sq',
      path: 'https://example.com/square.png',
      type: 'image',
      aspect: 'square',
    },
    'img:wide': {
      slotId: 'img',
      fileId: 'f-wide',
      path: 'https://example.com/wide.png',
      type: 'image',
      aspect: 'wide',
    },
  });

  const composeWithAssets = async (
    plan: DesignPlan,
    assets: Record<string, any>,
    outputs = [SQUARE, WIDE]
  ) => {
    const service = new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    );
    return service.compose({
      plan,
      copy: makeCopy(),
      assets,
      outputs,
      orgId: 'o1',
      userId: 'u1',
    });
  };

  it('keeps the primary asset on the seeded secondary output (no per-aspect swap)', async () => {
    const doc = await composeWithAssets(makePlan(), aspectAssets());

    expect(doc.outputs).toHaveLength(2);
    expect(byOrigin(doc, 'img', 0).src).toBe('https://example.com/square.png');
    // Variants are faithful copies: the seeded secondary output inherits the
    // primary's imagery — the renderer cover-crops per format instead of
    // swapping in a per-aspect photo.
    expect(byOrigin(doc, 'img', 1).src).toBe('https://example.com/square.png');
    expect(byOrigin(doc, 'img', 1).fileId).toBe('f-sq');
  });

  it('resolves a variant-scoped asset key first, per plan', async () => {
    // The conductor keys generated assets `${variantId}:${slotId}:aspect` so
    // each plan's original gets its OWN image for the same slot id.
    const v1Doc = await composeWithAssets(makePlan({ variantId: 'v1' }), {
      'v1:img:square': {
        slotId: 'v1:img',
        fileId: 'f-v1',
        path: 'https://example.com/v1.png',
        type: 'image',
        aspect: 'square',
      },
      'v2:img:square': {
        slotId: 'v2:img',
        fileId: 'f-v2',
        path: 'https://example.com/v2.png',
        type: 'image',
        aspect: 'square',
      },
    });
    const v2Doc = await composeWithAssets(makePlan({ variantId: 'v2' }), {
      'v1:img:square': {
        slotId: 'v1:img',
        fileId: 'f-v1',
        path: 'https://example.com/v1.png',
        type: 'image',
        aspect: 'square',
      },
      'v2:img:square': {
        slotId: 'v2:img',
        fileId: 'f-v2',
        path: 'https://example.com/v2.png',
        type: 'image',
        aspect: 'square',
      },
    });

    expect(byOrigin(v1Doc, 'img', 0).src).toBe('https://example.com/v1.png');
    expect(byOrigin(v2Doc, 'img', 0).src).toBe('https://example.com/v2.png');
  });

  it('still resolves legacy unscoped keys for docs composed before variant scoping', async () => {
    const doc = await composeWithAssets(makePlan({ variantId: 'v1' }), {
      'img:square': {
        slotId: 'img',
        fileId: 'f-sq',
        path: 'https://example.com/square.png',
        type: 'image',
        aspect: 'square',
      },
    });

    expect(byOrigin(doc, 'img', 0).src).toBe('https://example.com/square.png');
  });

  it('falls back to another aspect with a centered focal point when the match is missing', async () => {
    const assets = aspectAssets();
    delete assets['img:wide'];
    const doc = await composeWithAssets(makePlan(), assets);

    expect(byOrigin(doc, 'img', 1).src).toBe('https://example.com/square.png');
    expect(byOrigin(doc, 'img', 1).focalPoint).toEqual({ x: 0.5, y: 0.5 });
  });

  it('keeps the primary image background on the seeded secondary output', async () => {
    const plan = makePlan({
      background: { kind: 'image', ref: 'asset:bg' },
    });
    const doc = await composeWithAssets(plan, {
      'bg:square': {
        slotId: 'bg',
        fileId: 'f-bsq',
        path: 'https://example.com/bg-square.png',
        type: 'image',
        aspect: 'square',
        focalPoint: { x: 0.3, y: 0.4 },
      },
      'bg:wide': {
        slotId: 'bg',
        fileId: 'f-bwide',
        path: 'https://example.com/bg-wide.png',
        type: 'image',
        aspect: 'wide',
      },
    });

    expect((doc.outputs[0] as any).bg.src).toBe('https://example.com/bg-square.png');
    // No per-aspect swap on the seeded variant — same background asset, and
    // the provider focal point rides along for the cover-crop.
    expect((doc.outputs[1] as any).bg.src).toBe('https://example.com/bg-square.png');
    expect((doc.outputs[1] as any).bg.focalPoint).toEqual({ x: 0.3, y: 0.4 });
  });
});

// ---------------------------------------------------------------------------
// One-original flow: single-output compose + expansion-time asset re-resolution
// ---------------------------------------------------------------------------

describe('AiDesignerComposerService one-original flow', () => {
  const WIDE = { formatId: 'fb-post', width: 1200, height: 630 };

  it('composes a one-output doc from a single output, ignoring channelLayouts', async () => {
    const plan = makePlan({ channelLayouts: { 'fb-post': 'side-by-side' } });
    const doc = await composeWith(plan, [SQUARE]);

    expect(doc.outputs).toHaveLength(1);
    expect(doc.outputs[0].formatId).toBe('ig-square');
    // No secondary output means no per-channel recompose happened at all.
    expect(byOrigin(doc, 'split-panel-bg', 0)).toBeUndefined();
  });

  it('a seeded variant output keeps the primary asset verbatim (no swap step exists)', async () => {
    const docService = new DesignerDocService();
    const service = new AiDesignerComposerService(
      docService as any,
      { generateText: vi.fn() } as any
    );
    const plan = makePlan();
    const doc = await service.compose({
      plan,
      copy: makeCopy(),
      assets: {
        'img:square': {
          slotId: 'img',
          fileId: 'f-sq',
          path: 'https://example.com/square.png',
          type: 'image',
          aspect: 'square',
        },
      },
      outputs: [SQUARE],
      orgId: 'o1',
      userId: 'u1',
    });

    // The expansion path: designer-doc addOutput seeds the wide format from
    // the primary. That seed IS the variant's imagery — the composer has no
    // per-aspect re-resolution step anymore (the renderer cover-crops).
    const expanded = docService.applyOps(doc, [
      {
        op: 'addOutput',
        preset: { formatId: WIDE.formatId, name: 'FB', width: WIDE.width, height: WIDE.height },
      },
    ] as any);
    expect(byOrigin(expanded, 'img', 1).src).toBe('https://example.com/square.png');
    expect(byOrigin(expanded, 'img', 1).fileId).toBe('f-sq');
    expect((service as any).applyPerOutputAssets).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Image-background dedupe: an image element on the SAME asset as the image
// background is always a duplicate (the bg already carries that subject).
// ---------------------------------------------------------------------------

describe('AiDesignerComposerService image-background dedupe', () => {
  const WIDE = { formatId: 'fb-post', width: 1200, height: 630 };

  const makeService = () =>
    new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    );

  it('drops the image slot that resolves to the same asset as the image background', async () => {
    const service = makeService();
    const logSpy = vi.spyOn((service as any)._logger, 'log');
    // The failing plan shape: an image background (`ref: 'asset:img'`) AND an
    // image slot with the same id — `_collectAssetNeeds` dedupes them into
    // ONE asset, which used to land as both the bg and a centered inset.
    const plan = makePlan({
      background: { kind: 'image', ref: 'asset:img' },
    });
    const doc = await service.compose({
      plan,
      copy: makeCopy(),
      assets: makeAssets(),
      outputs: [SQUARE],
      orgId: 'o1',
      userId: 'u1',
    });

    expect((doc.outputs[0] as any).bg).toMatchObject({
      type: 'image',
      src: 'https://example.com/i.png',
      fileId: 'f1',
    });
    expect(byOrigin(doc, 'img', 0)).toBeUndefined();
    expect(
      childrenOf(doc, 0).some(
        (el) => el.type === 'image' && el.fileId === 'f1'
      )
    ).toBe(false);
    // The drop is traceable in the logs, not silent.
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('same asset as the image background'),
      expect.anything()
    );
  });

  it('keeps an image slot that resolves to a DIFFERENT asset than the background', async () => {
    const service = makeService();
    const plan = makePlan({
      background: { kind: 'image', ref: 'asset:bg' },
    });
    const doc = await service.compose({
      plan,
      copy: makeCopy(),
      assets: {
        bg: {
          slotId: 'bg',
          fileId: 'f-bg',
          path: 'https://example.com/bg.png',
          type: 'image' as const,
        },
        ...makeAssets(),
      },
      outputs: [SQUARE],
      orgId: 'o1',
      userId: 'u1',
    });

    expect((doc.outputs[0] as any).bg.src).toBe('https://example.com/bg.png');
    const image = byOrigin(doc, 'img', 0);
    expect(image).toBeDefined();
    expect(image.src).toBe('https://example.com/i.png');
  });

  it('dedupes seeded variant outputs the same way (match by fileId, fallback to src)', async () => {
    const service = makeService();
    // A doc as it existed BEFORE the dedupe guard (or seeded from one): both
    // outputs carry the duplicate inset next to the image background. The
    // wide output's inset matches by src only (no fileId) to cover the
    // fallback.
    const doc = {
      mode: 'image',
      outputs: [
        {
          id: 'o1',
          formatId: SQUARE.formatId,
          name: 'IG',
          width: SQUARE.width,
          height: SQUARE.height,
          background: '#000000',
          bg: { type: 'image', src: 'https://example.com/square.png', fileId: 'f-sq' },
          children: [
            {
              id: 'e1',
              originId: 'img',
              type: 'image',
              x: 100,
              y: 100,
              width: 300,
              height: 300,
              src: 'https://example.com/square.png',
              fileId: 'f-sq',
            },
          ],
        },
        {
          id: 'o2',
          formatId: WIDE.formatId,
          name: 'FB',
          width: WIDE.width,
          height: WIDE.height,
          background: '#000000',
          bg: { type: 'image', src: 'https://example.com/wide.png', fileId: 'f-wide' },
          children: [
            {
              id: 'e2',
              originId: 'img',
              type: 'image',
              x: 100,
              y: 100,
              width: 300,
              height: 300,
              src: 'https://example.com/wide.png',
            },
          ],
        },
      ],
    } as any;

    const reresolved = (service as any)._dropBackgroundDuplicateImages(doc);

    for (const index of [0, 1]) {
      expect(childrenOf(reresolved, index).some((el) => el.type === 'image')).toBe(false);
    }
    // The backgrounds themselves are untouched.
    expect((reresolved.outputs[0] as any).bg.fileId).toBe('f-sq');
    expect((reresolved.outputs[1] as any).bg.fileId).toBe('f-wide');
  });
});

describe('AiDesignerComposerService.applyFixes targetOutputs pinning', () => {
  let docService: { applyOps: ReturnType<typeof vi.fn> };
  let model: { generateText: ReturnType<typeof vi.fn> };
  let service: AiDesignerComposerService;

  beforeEach(() => {
    docService = {
      applyOps: vi.fn((doc: unknown, ops: unknown[]) => ({
        ...(doc as object),
        appliedOps: ops,
      })),
    };
    model = { generateText: vi.fn() };
    service = new AiDesignerComposerService(docService as any, model as any);
  });

  it('forces a shared-scope fix format-only onto the pinned format', async () => {
    const findings: VisionFinding[] = [
      {
        issue: 'Headline too low on the wide output',
        fix: { scope: 'shared', targetSlots: ['headline'], geometry: { y: 40 } },
      },
    ];

    await service.applyFixes(makeTwoOutputDoc(), findings, 'org1', undefined, [
      'fb-wide',
    ]);

    const ops = docService.applyOps.mock.calls[0][1];
    // Only the pinned output is patched, and the op is format-only so
    // linked propagation cannot leak it onto the primary.
    expect(ops).toEqual([
      {
        op: 'updateElement',
        outputIndex: 1,
        elementId: 'e9',
        scope: 'format-only',
        patch: { y: 40 },
      },
    ]);
  });

  it('pins a finding without a formatId to the targeted output', async () => {
    const findings: VisionFinding[] = [
      {
        issue: 'Spacing issue',
        fix: { scope: 'format-only', targetSlots: ['headline'], geometry: { y: 40 } },
      },
    ];

    await service.applyFixes(makeTwoOutputDoc(), findings, 'org1', undefined, [
      'fb-wide',
    ]);

    const ops = docService.applyOps.mock.calls[0][1];
    expect(ops).toEqual([
      {
        op: 'updateElement',
        outputIndex: 1,
        elementId: 'e9',
        scope: 'format-only',
        patch: { y: 40 },
      },
    ]);
  });
});


// ---------------------------------------------------------------------------
// compose resilience (bug-fix round: fontSize floor, fallback assets/copy)
// ---------------------------------------------------------------------------

describe('AiDesignerComposerService compose resilience', () => {
  const composeResilient = (
    plan: DesignPlan,
    opts: {
      copy?: Record<string, string>;
      assets?: Record<string, any>;
      outputs?: { formatId: string; width: number; height: number }[];
      sabotageFirstApplyOps?: boolean;
    } = {}
  ) => {
    const docService = new DesignerDocService();
    if (opts.sabotageFirstApplyOps) {
      // Force the primary compose to fail doc validation exactly once, the
      // way a bad op did in production — the fallback path then runs for real.
      const realApply = docService.applyOps.bind(docService);
      let calls = 0;
      vi.spyOn(docService, 'applyOps').mockImplementation(
        (doc: any, ops: any) => {
          calls++;
          if (calls === 1) {
            throw new Error('Invalid DesignerDoc op — forced');
          }
          return realApply(doc, ops);
        }
      );
    }
    const service = new AiDesignerComposerService(
      docService as any,
      { generateText: vi.fn() } as any
    );
    return service.compose({
      plan,
      copy: opts.copy ?? makeCopy(),
      assets: opts.assets ?? makeAssets(),
      outputs: opts.outputs ?? [SQUARE],
      orgId: 'o1',
      userId: 'u1',
    });
  };

  it('ignores ratio-shaped (0..1) plan.typeScale hints instead of rounding them to 0', async () => {
    const plan = makePlan({
      typeScale: { headline: 0.85, subhead: 0.4, cta: 0.28, legal: 0.16 },
    });
    plan.slots.push({ id: 'legal', role: 'legal', kind: 'text' });
    const doc = await composeResilient(plan, {
      copy: { ...makeCopy(), legal: 'Terms apply' },
    });

    // The composition survived (no one-text total fallback).
    expect(byOrigin(doc, 'fallback-text')).toBeUndefined();
    for (const el of childrenOf(doc)) {
      if (el.type === 'text') {
        expect(el.fontSize).toBeGreaterThanOrEqual(8);
      }
    }
    // Sub-floor hints are ignored — the preset ratio sizes win instead.
    expect(byOrigin(doc, 'headline').fontSize).toBeGreaterThanOrEqual(85);
  });

  it('clamps zero/negative/NaN typeScale hints to the legibility floor', async () => {
    const plan = makePlan({
      typeScale: { headline: 0, subhead: Number.NaN, cta: -5, legal: 0 },
    });
    plan.slots.push({ id: 'legal', role: 'legal', kind: 'text' });
    const doc = await composeResilient(plan, {
      copy: { ...makeCopy(), legal: 'Terms apply' },
    });

    expect(byOrigin(doc, 'fallback-text')).toBeUndefined();
    for (const el of childrenOf(doc)) {
      if (el.type === 'text') {
        expect(Number.isFinite(el.fontSize)).toBe(true);
        expect(el.fontSize).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it('keeps generated imagery in the total-fallback doc (slotId:aspect keys)', async () => {
    const plan = makePlan({
      background: { kind: 'image', ref: 'asset:bg' },
    });
    const doc = await composeResilient(plan, {
      assets: {
        'bg:square': {
          slotId: 'bg',
          fileId: 'f-bsq',
          path: 'https://example.com/bg-square.png',
          type: 'image',
          aspect: 'square',
        },
      },
      sabotageFirstApplyOps: true,
    });

    const out = doc.outputs[0] as any;
    expect(out.bg?.type).toBe('image');
    expect(out.bg.src).toBe('https://example.com/bg-square.png');
    expect(out.bg.fileId).toBe('f-bsq');
  });

  it('truncates the concept to 60 chars in the total-fallback doc instead of dumping it', async () => {
    const plan = makePlan({
      concept:
        'An end of summer sale concept paragraph that rambles on well past sixty characters total',
    });
    const doc = await composeResilient(plan, {
      copy: {}, // copywriter copy never arrived
      sabotageFirstApplyOps: true,
    });

    const text = byOrigin(doc, 'fallback-text');
    expect(text).toBeDefined();
    expect(text.text).toBe(plan.concept.slice(0, 60));
    expect(text.text.length).toBeLessThanOrEqual(60);
  });

  it('flags the total-fallback doc in the agent response (and not a normal compose)', async () => {
    const buildInput = () => ({
      plan: makePlan(),
      copy: makeCopy(),
      assets: makeAssets(),
      outputs: [SQUARE],
      orgId: 'o1',
      userId: 'u1',
    });

    const okService = new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    );
    const okRes = await (okService as any)._handler({
      raw_input: JSON.stringify(buildInput()),
    });
    expect(JSON.parse(okRes.content).fallback).toBeUndefined();

    const docService = new DesignerDocService();
    vi.spyOn(docService, 'applyOps').mockImplementationOnce(() => {
      throw new Error('Invalid DesignerDoc op — forced');
    });
    const fallbackService = new AiDesignerComposerService(
      docService as any,
      { generateText: vi.fn() } as any
    );
    const fallbackRes = await (fallbackService as any)._handler({
      raw_input: JSON.stringify(buildInput()),
    });
    const content = JSON.parse(fallbackRes.content);
    expect(content.type).toBe('doc');
    expect(content.fallback).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyFixes op vocabulary + scoped fontSize propagation (Phase 4)
// ---------------------------------------------------------------------------

const makeTwoOutputDoc = () =>
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
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
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
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            text: 'Hello',
            fontSize: 30,
          },
        ],
      },
    ],
  } as any);

describe('AiDesignerComposerService.applyFixes op vocabulary (Phase 4)', () => {
  let docService: { applyOps: ReturnType<typeof vi.fn> };
  let model: { generateText: ReturnType<typeof vi.fn> };
  let service: AiDesignerComposerService;

  beforeEach(() => {
    docService = {
      applyOps: vi.fn((doc: unknown, ops: unknown[]) => ({
        ...(doc as object),
        appliedOps: ops,
      })),
    };
    model = { generateText: vi.fn() };
    service = new AiDesignerComposerService(docService as any, model as any);
  });

  const opsOf = (call = 0) => docService.applyOps.mock.calls[call][1] as any[];

  it('applies the new style fields (fontFamily/align/verticalAlign/textStroke)', async () => {
    const findings: VisionFinding[] = [
      {
        issue: 'Headline needs the display treatment',
        slotId: 'headline',
        fix: {
          scope: 'shared',
          style: {
            fontFamily: 'Anton',
            align: 'left',
            verticalAlign: 'bottom',
            textStroke: { color: '#111111', width: 4 },
          },
        },
      },
    ];

    await service.applyFixes(makeDoc(), findings, 'org1');

    expect(opsOf()[0].patch).toEqual({
      fontFamily: 'Anton',
      align: 'left',
      verticalAlign: 'bottom',
      textStroke: { color: '#111111', width: 4 },
    });
  });

  it('textShadow: true synthesizes a default shadow scaled to the element', async () => {
    const findings: VisionFinding[] = [
      {
        issue: 'Headline floats over a busy image',
        slotId: 'headline',
        fix: { scope: 'shared', style: { textShadow: true } },
      },
    ];

    await service.applyFixes(makeDoc(), findings, 'org1');

    const shadow = opsOf()[0].patch.textShadow;
    expect(shadow).toBeDefined();
    expect(shadow.color).toBeTruthy();
    expect(shadow.blur).toBeGreaterThan(0);
  });

  it('textShadow: false clears the shadow (undefined-valued patch key)', async () => {
    const findings: VisionFinding[] = [
      {
        issue: 'Shadow looks muddy',
        slotId: 'headline',
        fix: { scope: 'shared', style: { textShadow: false } },
      },
    ];

    await service.applyFixes(makeDoc(), findings, 'org1');

    const patch = opsOf()[0].patch;
    expect(Object.prototype.hasOwnProperty.call(patch, 'textShadow')).toBe(true);
    expect(patch.textShadow).toBeUndefined();
  });

  it('still rejects unknown style keys instead of poisoning the ops array', async () => {
    const findings: VisionFinding[] = [
      {
        issue: 'Invented key',
        slotId: 'headline',
        fix: { scope: 'shared', style: { color: '#ffffff' } as any },
      },
    ];

    const result = await service.applyFixes(makeDoc(), findings, 'org1');

    expect(docService.applyOps).not.toHaveBeenCalled();
    expect(result).toEqual(makeDoc());
  });

  it('addElement emits a validated add op per targeted output, scaled to each canvas', async () => {
    const findings: VisionFinding[] = [
      {
        issue: 'Missing a "new" sticker',
        fix: {
          scope: 'shared',
          addElement: {
            slotId: 'sticker',
            type: 'text',
            text: 'NEW',
            style: { fontSize: 40, fill: '#FFFFFF' },
          },
        },
      },
    ];

    await service.applyFixes(makeTwoOutputDoc(), findings, 'org1');

    const ops = opsOf();
    expect(ops).toHaveLength(2);
    expect(ops[0].op).toBe('addElement');
    expect(ops[0].outputIndex).toBe(0);
    expect(ops[1].op).toBe('addElement');
    expect(ops[1].outputIndex).toBe(1);
    // Linked via originId; the spec carries no server-owned id.
    expect(ops[0].element.originId).toBe('sticker');
    expect(ops[0].element).not.toHaveProperty('id');
    expect(ops[0].element.text).toBe('NEW');
    expect(ops[0].element.fill).toBe('#FFFFFF');
    // fontSize authored against the primary (1080x1080) scales to the
    // 1200x675 output by min(1200/1080, 675/1080) = 0.625.
    expect(ops[0].element.fontSize).toBe(40);
    expect(ops[1].element.fontSize).toBe(25);
  });

  it('rejects an addElement spec missing its required text', async () => {
    const findings: VisionFinding[] = [
      {
        issue: 'Empty text element',
        fix: { scope: 'shared', addElement: { slotId: 'x', type: 'text' } },
      },
    ];

    const result = await service.applyFixes(makeDoc(), findings, 'org1');

    expect(docService.applyOps).not.toHaveBeenCalled();
    expect(result).toEqual(makeDoc());
  });

  it('rejects an addElement spec outside the constrained vocabulary', async () => {
    const findings: VisionFinding[] = [
      {
        issue: 'Arbitrary image injection',
        fix: {
          scope: 'shared',
          addElement: { slotId: 'x', type: 'image', src: 'https://evil.example/x.png' } as any,
        },
      },
    ];

    const result = await service.applyFixes(makeDoc(), findings, 'org1');

    expect(docService.applyOps).not.toHaveBeenCalled();
    expect(result).toEqual(makeDoc());
  });

  it('removeElement removes the target slot across the targeted outputs', async () => {
    const findings: VisionFinding[] = [
      {
        issue: 'Drop the headline',
        fix: { scope: 'shared', removeElement: 'headline' },
      },
    ];

    await service.applyFixes(makeTwoOutputDoc(), findings, 'org1');

    expect(opsOf()).toEqual([
      { op: 'removeElement', outputIndex: 0, elementId: 'e1' },
      { op: 'removeElement', outputIndex: 1, elementId: 'e9' },
    ]);
  });

  it('addElement on an existing slotId patches the element instead of layering a duplicate', async () => {
    const findings: VisionFinding[] = [
      {
        issue: 'Headline needs a new position',
        fix: {
          scope: 'shared',
          addElement: {
            slotId: 'headline',
            type: 'text',
            text: 'Hello',
            box: { x: 80, y: 90, width: 500, height: 220 },
            style: { fill: '#111111' },
          },
        },
      },
    ];

    await service.applyFixes(makeDoc(), findings, 'org1');

    // The slot already exists — no second element is inserted (the double
    // "badge-bg" plate bug); the existing one gets the spec's box/fill.
    const ops = opsOf();
    expect(ops).toEqual([
      {
        op: 'updateElement',
        outputIndex: 0,
        elementId: 'e1',
        scope: 'format-only',
        patch: { x: 80, y: 90, width: 500, height: 220, fill: '#111111' },
      },
    ]);
  });

  it('a genuinely-new `-bg` companion inherits its base element groupId', async () => {
    const doc = {
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
              type: 'text',
              x: 400,
              y: 800,
              width: 200,
              height: 60,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: 'Shop now',
              fontSize: 24,
              groupId: 'cta',
            },
          ],
        },
      ],
    } as any;
    const findings: VisionFinding[] = [
      {
        issue: 'CTA label floats without a button shape',
        fix: {
          scope: 'shared',
          addElement: {
            slotId: 'cta-bg',
            type: 'shape',
            shape: 'rect',
            box: { x: 380, y: 790, width: 240, height: 80 },
            style: { fill: '#FF4D00' },
          },
        },
      },
    ];

    await service.applyFixes(doc, findings, 'org1');

    const ops = opsOf();
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toBe('addElement');
    expect(ops[0].element.originId).toBe('cta-bg');
    // Joined to the base label's move group so nudges keep the pair glued.
    expect(ops[0].element.groupId).toBe('cta');
  });

  it('re-derives a `-bg` companion box from the label instead of copying it verbatim', async () => {
    const doc = {
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
            { id: 'e1', originId: 'badge-bg', type: 'shape', shape: 'rect', x: 688, y: 100, width: 124, height: 40 },
            { id: 'e2', originId: 'badge', type: 'text', x: 700, y: 100, width: 100, height: 40, text: 'NEW', fontSize: 20 },
          ],
        },
      ],
    } as any;
    const findings: VisionFinding[] = [
      {
        issue: 'Badge sits too far right',
        fix: {
          scope: 'shared',
          targetSlots: ['badge'],
          geometry: { x: 200, width: 150 },
        },
      },
    ];

    await service.applyFixes(doc, findings, 'org1');

    // The fan-out no longer collapses the pill onto the label byte-identical:
    // the pill re-derives x/width via the badge inset (round(20 × 0.6) = 12).
    expect(opsOf()).toEqual([
      { op: 'updateElement', outputIndex: 0, elementId: 'e1', scope: 'shared', patch: { x: 188, width: 174 } },
      { op: 'updateElement', outputIndex: 0, elementId: 'e2', scope: 'shared', patch: { x: 200, width: 150 } },
    ]);
  });
});

describe('AiDesignerComposerService.applyFixes scoped fontSize propagation (Phase 4)', () => {
  const realService = () =>
    new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    );

  it('scales a shared fontSize fix proportionally per output (1080x1080 + 1200x675)', async () => {
    const findings: VisionFinding[] = [
      {
        issue: 'Headline too small everywhere',
        fix: {
          scope: 'shared',
          targetSlots: ['headline'],
          geometry: { fontSize: 64 },
        },
      },
    ];

    const result = await realService().applyFixes(
      makeTwoOutputDoc(),
      findings,
      'org1'
    );

    const [primary, secondary] = result.outputs as any[];
    // Primary keeps the authored px; the 1200x675 output gets 64 * 0.625 = 40.
    expect(primary.children[0].fontSize).toBe(64);
    expect(secondary.children[0].fontSize).toBe(40);
  });

  it('keeps raw px for a format-only fontSize fix', async () => {
    const findings: VisionFinding[] = [
      {
        issue: 'Headline too small on the wide output',
        formatId: 'fb-wide',
        fix: {
          scope: 'format-only',
          targetSlots: ['headline'],
          geometry: { fontSize: 64 },
        },
      },
    ];

    const result = await realService().applyFixes(
      makeTwoOutputDoc(),
      findings,
      'org1'
    );

    const [primary, secondary] = result.outputs as any[];
    expect(primary.children[0].fontSize).toBe(48);
    expect(secondary.children[0].fontSize).toBe(64);
  });
});

describe('AiDesignerComposerService background colors (gradient robustness)', () => {
  const bgOf = (background: any, assets?: any) => {
    const service = new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    );
    return (service as any)._backgroundToDesignerBg(background, assets);
  };

  it('parses a full CSS linear-gradient string into valid stops', () => {
    // The S3 live failure: the plan background carried a CSS gradient string
    // and the comma split handed "linear-gradient(135deg" to the renderer,
    // which threw "parse color failed".
    const bg = bgOf({
      kind: 'gradient',
      value: 'linear-gradient(135deg, #0A0A0A 0%, #B22234 100%)',
    });

    expect(bg.background).toBe('#0A0A0A');
    expect(bg.bg.type).toBe('gradient');
    expect(bg.bg.gradient.stops.map((s: any) => s.color)).toEqual([
      '#0A0A0A',
      '#B22234',
    ]);
  });

  it('keeps the comma-separated color list shape working', () => {
    const bg = bgOf({ kind: 'gradient', value: '#ffffff, #000000' });

    expect(bg.bg.gradient.stops.map((s: any) => s.color)).toEqual([
      '#ffffff',
      '#000000',
    ]);
    expect(bg.bg.gradient.stops.map((s: any) => s.offset)).toEqual([0, 1]);
  });

  it('drops invalid color tokens from the list', () => {
    const bg = bgOf({
      kind: 'gradient',
      value: '#fff, not-a-color, #000000',
    });

    expect(bg.bg.gradient.stops.map((s: any) => s.color)).toEqual([
      '#fff',
      '#000000',
    ]);
  });

  it('keeps rgb(a) tokens from a CSS gradient string', () => {
    const bg = bgOf({
      kind: 'gradient',
      value: 'radial-gradient(circle, rgba(0, 0, 0, 0.8) 0%, #ffffff 100%)',
    });

    expect(bg.bg.gradient.stops.map((s: any) => s.color)).toEqual([
      'rgba(0, 0, 0, 0.8)',
      '#ffffff',
    ]);
  });

  it('falls back to a solid background when fewer than 2 valid colors survive', () => {
    const oneValid = bgOf({
      kind: 'gradient',
      value: 'linear-gradient(135deg, #0A0A0A 0%, junk 100%)',
    });
    expect(oneValid).toEqual({ background: '#0A0A0A' });

    const noneValid = bgOf({
      kind: 'gradient',
      value: 'linear-gradient(135deg, junk 0%)',
    });
    expect(noneValid).toEqual({ background: '#1f2937' });
  });

  it('sanitizes the solid branch', () => {
    expect(bgOf({ kind: 'solid', value: 'linear-gradient(135deg' })).toEqual({
      background: '#ffffff',
    });
    expect(bgOf({ kind: 'solid', value: '  #123456  ' })).toEqual({
      background: '#123456',
    });
    expect(bgOf({ kind: 'solid', value: 'rgba(0, 0, 0, 0.5)' })).toEqual({
      background: 'rgba(0, 0, 0, 0.5)',
    });
  });

  it('sanitizes the image-fallback value', () => {
    const bg = bgOf({ kind: 'image', ref: 'asset:missing', value: 'junk' }, {});
    expect(bg).toEqual({ background: '#1f2937' });
  });

  it('composes a CSS-gradient plan background with only parseable colors', async () => {
    const doc = await composeWith(
      makePlan({
        background: {
          kind: 'gradient',
          value: 'linear-gradient(135deg, #0A0A0A 0%, #B22234 100%)',
        },
      })
    );

    const output = doc.outputs[0] as any;
    expect(output.bg.type).toBe('gradient');
    expect(
      output.bg.gradient.stops.every((s: any) =>
        /^#[0-9a-f]{6}$/i.test(s.color)
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// reviseByInstruction: background op coverage + font-size clamp
// ---------------------------------------------------------------------------

describe('AiDesignerComposerService.reviseByInstruction', () => {
  let model: { generateText: ReturnType<typeof vi.fn> };
  let service: AiDesignerComposerService;

  beforeEach(() => {
    model = { generateText: vi.fn() };
    service = new AiDesignerComposerService(
      new DesignerDocService() as any,
      model as any
    );
  });

  it('summarizes each output background and offers setOutputBackground in the prompt', async () => {
    model.generateText.mockResolvedValue('[]');

    await service.reviseByInstruction(
      makeDoc(),
      'change the background to dark green',
      'shared',
      'org1'
    );

    const prompt = model.generateText.mock.calls[0][1] as string;
    expect(prompt).toContain('"background":"color #ffffff"');
    expect(prompt).toContain('setOutputBackground');
    expect(prompt).toContain('"type":"color"');
  });

  it('applies a setOutputBackground op for a background-color instruction', async () => {
    model.generateText.mockResolvedValue(
      JSON.stringify([
        {
          op: 'setOutputBackground',
          outputIndex: 0,
          background: { type: 'color', color: '#0B3D2E' },
        },
      ])
    );

    const revised = await service.reviseByInstruction(
      makeDoc(),
      'change the background to dark green',
      'shared',
      'org1'
    );

    expect((revised.outputs[0] as any).bg).toEqual({
      type: 'color',
      color: '#0B3D2E',
    });
  });

  it('clamps an oversized revised fontSize down toward the element box', async () => {
    model.generateText.mockResolvedValue(
      JSON.stringify([
        {
          op: 'updateElement',
          outputIndex: 0,
          elementId: 'e1',
          patch: {
            fontSize: 400,
            text: 'A very long headline that wraps across multiple lines easily',
          },
        },
      ])
    );

    const revised = await service.reviseByInstruction(
      makeDoc(),
      'make the headline huge',
      'shared',
      'org1'
    );

    const headline = (revised.outputs[0] as any).children.find(
      (el: any) => el.id === 'e1'
    );
    expect(headline.fontSize).toBeLessThan(400);
    expect(headline.fontSize).toBeGreaterThanOrEqual(8);
  });

  it('leaves a fitting fontSize untouched and returns the same doc', async () => {
    const doc = makeDoc();
    model.generateText.mockResolvedValue('[]');

    const revised = await service.reviseByInstruction(
      doc,
      'nothing to change',
      'shared',
      'org1'
    );

    expect(revised).toBe(doc);
  });
});


// ---------------------------------------------------------------------------
// Layout framing, type floors, badge fit, overlap guard
// ---------------------------------------------------------------------------

describe('AiDesignerComposerService framing & legibility', () => {
  it('minimal-centered renders the image as an edge-to-edge band (never a framed inset)', async () => {
    const doc = await composeWith(makePlan({ formatTemplate: 'minimal-centered' }));

    const image = byOrigin(doc, 'img');
    expect(image.x).toBe(0);
    expect(image.y).toBe(0);
    expect(image.width).toBe(1080);
    expect(image.fitMode).toBe('cover');
  });

  it('every other gallery layout keeps its imagery edge-to-edge too', async () => {
    for (const template of [
      'hero-fullbleed',
      'top-bottom',
      'badge-burst',
    ] as const) {
      const doc = await composeWith(makePlan({ formatTemplate: template }));
      const image = byOrigin(doc, 'img');
      expect(image.x).toBe(0);
      expect(image.width).toBe(1080);
    }
    for (const template of ['split-panel', 'editorial-sidebar'] as const) {
      const doc = await composeWith(makePlan({ formatTemplate: template }));
      const image = byOrigin(doc, 'img');
      // Fills its column edge-to-edge: no margin on any side of the band.
      expect(image.y).toBe(0);
      expect(image.height).toBe(1080);
      expect(image.x + image.width).toBe(1080);
    }
  });

  it('clamps every role up to its per-role floor (% of min(w,h))', async () => {
    const doc = await composeWith(
      makePlan({ typeScale: { headline: 12, subhead: 12, cta: 12 } })
    );

    expect(byOrigin(doc, 'headline').fontSize).toBeGreaterThanOrEqual(
      Math.round(1080 * 0.06)
    );
    expect(byOrigin(doc, 'sub').fontSize).toBeGreaterThanOrEqual(
      Math.round(1080 * 0.032)
    );
    expect(byOrigin(doc, 'cta').fontSize).toBeGreaterThanOrEqual(
      Math.round(1080 * 0.028)
    );
  });

  it('keeps burst badge text inside the star inner area, centered both ways', async () => {
    const plan = makePlan({ styleId: 'retro', formatTemplate: 'badge-burst' });
    plan.slots.push({ id: 'badge', role: 'badge', kind: 'badge' });
    const doc = await composeWith(plan, [SQUARE], {
      ...makeCopy(),
      badge: 'SUN • 3 PM • BY THE PIER',
    });

    const shape = byOrigin(doc, 'badge-bg');
    const text = byOrigin(doc, 'badge');
    expect(shape.shape).toBe('star');
    // The text box sits in the burst's ~60% inner safe area.
    expect(text.x).toBeGreaterThan(shape.x);
    expect(text.y).toBeGreaterThan(shape.y);
    expect(text.x + text.width).toBeLessThan(shape.x + shape.width);
    expect(text.y + text.height).toBeLessThan(shape.y + shape.height);
    expect(text.width).toBeLessThanOrEqual(Math.ceil(shape.width * 0.6) + 2);
    expect(text.height).toBeLessThanOrEqual(Math.ceil(shape.height * 0.6) + 2);
    expect(text.align).toBe('center');
    expect(text.verticalAlign).toBe('middle');
  });

  it('auto-fits a badge label down when the estimate would overflow its shape', async () => {
    // A long pill label in the narrow split-panel badge area wraps past the
    // pill's two-line height — the font must shrink until it fits.
    const plan = makePlan({ styleId: 'bold', formatTemplate: 'split-panel' });
    plan.slots.push({ id: 'badge', role: 'badge', kind: 'badge' });
    const doc = await composeWith(plan, [SQUARE], {
      ...makeCopy(),
      badge: 'SUN • 3 PM • BY THE PIER • FREE ENTRY',
    });

    const shape = byOrigin(doc, 'badge-bg');
    const text = byOrigin(doc, 'badge');
    const service = new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    );
    const lines = (service as any)._estimateWrappedLines(
      text.text,
      text.width,
      text.fontSize
    );
    expect(lines * 1.1 * text.fontSize).toBeLessThanOrEqual(text.height + 1);
    // And it never spilled: the guard leaves badge text inside its shape.
    expect(text.x).toBeGreaterThanOrEqual(shape.x);
    expect(text.x + text.width).toBeLessThanOrEqual(shape.x + shape.width);
  });

  it('repeated clamp passes never ratchet below the role floor — the box grows instead', () => {
    const service = new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    );
    const longText =
      'A very long line of copy that cannot possibly fit its tiny box at a legible size';
    const textEl = (overrides: Record<string, unknown>) => ({
      type: 'text',
      x: 100,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      text: longText,
      ...overrides,
    });
    let doc = {
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
            textEl({ id: 'e1', originId: 'sub', y: 100, width: 200, height: 30, fontSize: 35 }),
            textEl({ id: 'e2', originId: 'cta', y: 600, width: 150, height: 20, fontSize: 30, groupId: 'cta' }),
          ],
        },
      ],
    } as any;

    // The old relative floor (60% of the current size) ratcheted across
    // passes: 35 → 21 → 13 → 12px. The shared role floor is absolute.
    for (let pass = 0; pass < 4; pass++) {
      doc = (service as any)._clampTextToFit(doc);
    }
    const [sub, cta] = doc.outputs[0].children;

    expect(sub.fontSize).toBe(10); // ungrouped floor
    expect(cta.fontSize).toBe(12); // grouped (badge/CTA) floor at 1080
    // At the floor the boxes GREW to fit the wrapped block instead of the
    // type shrinking below legibility.
    const subLines = (service as any)._estimateWrappedLines(longText, 200, 10);
    expect(sub.height).toBeGreaterThanOrEqual(Math.ceil(subLines * 1.2 * 10));
    expect(cta.height).toBeGreaterThan(20);
  });

  it('honors a slot-level badgeStyle override over the preset treatment', async () => {
    // The 'bold' preset badges are pills — the plan's slot-level burst wins.
    const plan = makePlan({ styleId: 'bold' });
    plan.slots.push({
      id: 'badge',
      role: 'badge',
      kind: 'badge',
      style: { badgeStyle: 'burst' },
    });
    const doc = await composeWith(plan, [SQUARE], {
      ...makeCopy(),
      badge: 'NEW',
    });

    expect(byOrigin(doc, 'badge-bg').shape).toBe('star');
  });

  it('badge-burst layout forces the burst treatment for pill-badge presets', async () => {
    const plan = makePlan({ styleId: 'bold', formatTemplate: 'badge-burst' });
    plan.slots.push({ id: 'badge', role: 'badge', kind: 'badge' });
    const doc = await composeWith(plan, [SQUARE], {
      ...makeCopy(),
      badge: 'NEW',
    });

    expect(byOrigin(doc, 'badge-bg').shape).toBe('star');
  });
});

describe('AiDesignerComposerService overlap guard', () => {
  const realService = () =>
    new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    );

  const overlapDoc = () =>
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
              x: 100,
              y: 100,
              width: 400,
              height: 50,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: 'Headline',
              fontSize: 40,
            },
            {
              id: 'e2',
              originId: 'sub',
              type: 'text',
              x: 100,
              y: 120,
              width: 400,
              height: 50,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: 'Subhead colliding',
              fontSize: 20,
            },
          ],
        },
      ],
    } as any);

  it('nudges a text-on-text collision apart after applyFixes', async () => {
    const result = await realService().applyFixes(overlapDoc(), [], 'org1');

    const [headline, sub] = (result.outputs[0] as any).children;
    expect(headline.y).toBe(100);
    expect(sub.y).toBeGreaterThanOrEqual(100 + 50);
    // The nudge is a logged degradation, not a crash.
  });

  it('clamps text spilling outside its containing shape back inside', async () => {
    const doc = {
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
              originId: 'badge-bg',
              type: 'shape',
              shape: 'rect',
              x: 100,
              y: 100,
              width: 200,
              height: 60,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
            },
            {
              id: 'e2',
              originId: 'badge',
              type: 'text',
              x: 100,
              y: 100,
              width: 320,
              height: 60,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: 'NEW',
              fontSize: 16,
            },
          ],
        },
      ],
    } as any;

    const result = await realService().applyFixes(doc, [], 'org1');

    const [shape, text] = (result.outputs[0] as any).children;
    expect(text.x).toBeGreaterThanOrEqual(shape.x);
    expect(text.y).toBeGreaterThanOrEqual(shape.y);
    expect(text.x + text.width).toBeLessThanOrEqual(shape.x + shape.width);
    expect(text.y + text.height).toBeLessThanOrEqual(shape.y + shape.height);
  });

  it('returns the same doc reference when nothing overlaps', async () => {
    const doc = overlapDoc();
    // Separate the two texts so the guard has nothing to do.
    doc.outputs[0].children[1].y = 300;

    const result = await realService().applyFixes(doc, [], 'org1');

    expect(result).toBe(doc);
  });

  it('nudges a headline out from under a badge burst shape', () => {
    const doc = {
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
              originId: 'badge-bg',
              type: 'shape',
              shape: 'star',
              x: 100,
              y: 100,
              width: 220,
              height: 220,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              fill: '#FF4D00',
            },
            {
              id: 'e2',
              originId: 'headline',
              type: 'text',
              x: 120,
              y: 180,
              width: 500,
              height: 80,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: 'Big sale headline',
              fontSize: 40,
            },
          ],
        },
      ],
    } as any;

    const result = (realService() as any)._resolveOverlaps(doc);

    const text = result.outputs[0].children[1];
    // Pushed below the burst (100 + 220 + gap, incl. the +2 margin above the
    // near-touch floor), no longer overlapping it.
    expect(text.y).toBeGreaterThanOrEqual(322);
    expect(text.y).toBeLessThanOrEqual(
      320 + Math.max(8, Math.round(40 * 0.2)) + 2
    );
  });

  it('leaves text on a big background panel (split-panel-bg) alone', () => {
    const doc = {
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
              originId: 'split-panel-bg',
              type: 'shape',
              shape: 'rect',
              x: 0,
              y: 0,
              width: 497,
              height: 1080,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              fill: '#111111',
            },
            {
              id: 'e2',
              originId: 'headline',
              type: 'text',
              x: 60,
              y: 400,
              width: 380,
              height: 120,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: 'Panel copy',
              fontSize: 40,
              fill: '#FFFFFF',
            },
          ],
        },
      ],
    } as any;

    const result = (realService() as any)._resolveOverlaps(doc);

    // The panel is a backdrop, not a collision — the doc is untouched.
    expect(result).toBe(doc);
  });

  it('clamps text running off the right canvas edge back on-canvas', () => {
    const doc = {
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
              x: 900,
              y: 400,
              width: 400,
              height: 80,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: 'Overflowing right',
              fontSize: 40,
            },
          ],
        },
      ],
    } as any;

    const result = (realService() as any)._resolveOverlaps(doc);

    const text = result.outputs[0].children[0];
    expect(text.x + text.width).toBeLessThanOrEqual(1080);
    expect(text.x).toBe(680); // pulled left, width kept (fits the canvas)
  });

  const guardDoc = (children: any[]) =>
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
          children,
        },
      ],
    } as any);

  const guardEl = (overrides: Record<string, unknown>) => ({
    type: 'text',
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    ...overrides,
  });

  it('moves a label and its pill together when a collision nudges the group', () => {
    const doc = guardDoc([
      guardEl({
        id: 'h1',
        originId: 'headline',
        x: 100,
        y: 100,
        width: 400,
        height: 50,
        text: 'Headline',
        fontSize: 40,
      }),
      guardEl({
        id: 'p1',
        originId: 'cta-bg',
        type: 'shape',
        shape: 'rect',
        x: 100,
        y: 120,
        width: 200,
        height: 60,
        fill: '#FF4D00',
        groupId: 'cta',
      }),
      guardEl({
        id: 't1',
        originId: 'cta',
        x: 100,
        y: 120,
        width: 200,
        height: 60,
        text: 'Shop now',
        fontSize: 24,
        groupId: 'cta',
      }),
    ]);

    const result = (realService() as any)._resolveOverlaps(doc);
    const [, pill, label] = result.outputs[0].children;

    // The whole group translated by the same delta — the label stays glued
    // to its pill instead of being ripped out of it.
    expect(pill.y).toBeGreaterThan(120);
    expect(label.y).toBe(pill.y);
    expect(label.x).toBe(pill.x);
    expect(label.y).toBeGreaterThanOrEqual(150);
  });

  it('never treats own-group companions as colliders', () => {
    const doc = guardDoc([
      guardEl({
        id: 'p1',
        originId: 'cta-bg',
        type: 'shape',
        shape: 'rect',
        x: 100,
        y: 120,
        width: 200,
        height: 60,
        fill: '#FF4D00',
        groupId: 'cta',
      }),
      guardEl({
        id: 't1',
        originId: 'cta',
        x: 100,
        y: 120,
        width: 200,
        height: 60,
        text: 'Shop now',
        fontSize: 24,
        groupId: 'cta',
      }),
    ]);

    const result = (realService() as any)._resolveOverlaps(doc);

    expect(result).toBe(doc);
  });

  it('moves the text above the collider when there is no room below', () => {
    const doc = guardDoc([
      guardEl({
        id: 'h1',
        originId: 'headline',
        x: 100,
        y: 400,
        width: 400,
        height: 600,
        text: 'Big block',
        fontSize: 40,
      }),
      guardEl({
        id: 's1',
        originId: 'sub',
        x: 100,
        y: 960,
        width: 400,
        height: 80,
        text: 'Subhead',
        fontSize: 20,
      }),
    ]);

    const result = (realService() as any)._resolveOverlaps(doc);
    const sub = result.outputs[0].children[1];

    // Below the collider (y=1008) would overflow the 1080 canvas — the text
    // went above it instead (8px gap + the 2px margin above the floor).
    expect(sub.y).toBe(400 - 10 - 80);
    expect(sub.y + sub.height).toBeLessThanOrEqual(400);
  });

  it('reorders the group behind the colliding text when neither below nor above fits', () => {
    const doc = guardDoc([
      guardEl({
        id: 'h1',
        originId: 'headline',
        x: 100,
        y: 0,
        width: 400,
        height: 1000,
        text: 'Wall of text',
        fontSize: 40,
      }),
      guardEl({
        id: 's1',
        originId: 'sub',
        x: 100,
        y: 500,
        width: 400,
        height: 80,
        text: 'Trapped subhead',
        fontSize: 20,
      }),
    ]);

    const result = (realService() as any)._resolveOverlaps(doc);
    const order = result.outputs[0].children.map((c: any) => c.originId);

    // Paint order resolves what geometry could not: the colliding headline
    // now paints on top of the trapped text.
    expect(order).toEqual(['sub', 'headline']);
  });

  it('treats a near-touching unrelated pair as a collision', () => {
    const doc = guardDoc([
      guardEl({
        id: 'h1',
        originId: 'headline',
        x: 100,
        y: 100,
        width: 400,
        height: 50,
        text: 'Headline',
        fontSize: 40,
      }),
      guardEl({
        id: 's1',
        originId: 'sub',
        x: 100,
        y: 152,
        width: 400,
        height: 50,
        text: 'Two pixels below',
        fontSize: 20,
      }),
    ]);

    const result = (realService() as any)._resolveOverlaps(doc);
    const sub = result.outputs[0].children[1];

    // 2px gap < the 8px minimum at a 1080 canvas → separated to the gap,
    // resting 2px ABOVE the near-touch floor rather than exactly on it.
    expect(sub.y).toBe(150 + 8 + 2);
  });

  it('leaves a pair with enough breathing room untouched', () => {
    const doc = guardDoc([
      guardEl({
        id: 'h1',
        originId: 'headline',
        x: 100,
        y: 100,
        width: 400,
        height: 50,
        text: 'Headline',
        fontSize: 40,
      }),
      guardEl({
        id: 's1',
        originId: 'sub',
        x: 100,
        y: 160,
        width: 400,
        height: 50,
        text: 'Ten pixels below',
        fontSize: 20,
      }),
    ]);

    const result = (realService() as any)._resolveOverlaps(doc);

    expect(result).toBe(doc);
  });

  it('re-centers a label left-flush in its pill', () => {
    const doc = guardDoc([
      guardEl({
        id: 'p1',
        originId: 'promo-bg',
        type: 'shape',
        shape: 'rect',
        x: 100,
        y: 100,
        width: 300,
        height: 80,
        fill: '#FF4D00',
      }),
      // Reflow clamp drift left the label glued to the pill's left edge.
      guardEl({
        id: 't1',
        originId: 'promo',
        x: 100,
        y: 130,
        width: 150,
        height: 40,
        text: 'NEW DROP',
        fontSize: 24,
        verticalAlign: 'middle',
      }),
    ]);

    const result = (realService() as any)._resolveOverlaps(doc);
    const [pill, label] = result.outputs[0].children;

    // Horizontally centered in the pill; vertically too (middle-aligned).
    // The pill itself never moves.
    expect(pill.x).toBe(100);
    expect(label.x).toBe(100 + Math.round((300 - 150) / 2));
    expect(label.y).toBe(100 + Math.round((80 - 40) / 2));
  });

  it('scales minGap by the canvas geometric mean on landscape outputs', () => {
    const doc = {
      mode: 'image',
      outputs: [
        {
          id: 'o1',
          formatId: 'fb-wide',
          name: 'FB',
          width: 1200,
          height: 675,
          background: '#ffffff',
          children: [
            guardEl({
              id: 'h1',
              originId: 'headline',
              x: 100,
              y: 100,
              width: 400,
              height: 50,
              text: 'Headline',
              fontSize: 40,
            }),
            guardEl({
              id: 's1',
              originId: 'sub',
              x: 100,
              y: 153,
              width: 400,
              height: 50,
              text: 'Three pixels below',
              fontSize: 20,
            }),
          ],
        },
      ],
    } as any;

    const result = (realService() as any)._resolveOverlaps(doc);
    const sub = result.outputs[0].children[1];

    // sqrt(1200×675)/1080 × 8 = 7px (the old min(w,h) basis collapsed to 5),
    // and the nudge rests 2px ABOVE the floor rather than exactly on it.
    expect(sub.y).toBe(150 + 7 + 2);
  });
});

describe('AiDesignerComposerService fix-loop protections', () => {
  let docService: { applyOps: ReturnType<typeof vi.fn> };
  let model: { generateText: ReturnType<typeof vi.fn> };
  let service: AiDesignerComposerService;

  beforeEach(() => {
    docService = {
      applyOps: vi.fn((doc: unknown, ops: unknown[]) => ({
        ...(doc as object),
        appliedOps: ops,
      })),
    };
    model = { generateText: vi.fn() };
    service = new AiDesignerComposerService(
      docService as any,
      model as any
    );
  });

  const opsOf = () => docService.applyOps.mock.calls[0]?.[1] as any[];

  it('refuses a removeElement fix that targets an image slot', async () => {
    const findings: VisionFinding[] = [
      {
        issue: 'I do not like the photo',
        fix: { scope: 'shared', removeElement: 'image' },
      },
    ];

    const result = await service.applyFixes(makeDoc(), findings, 'org1');

    expect(docService.applyOps).not.toHaveBeenCalled();
    expect(result).toEqual(makeDoc());
  });

  it('refuses a text fix that targets an image slot', async () => {
    const findings: VisionFinding[] = [
      {
        issue: 'The photo has a baked-in logo',
        slotId: 'image',
        fix: {
          scope: 'shared',
          text: { slotId: 'image', newText: 'REPLACE_IMAGE_NO_TEXT_NO_LOGOS' },
        },
      },
    ];
    const warnSpy = vi
      .spyOn((service as any)._logger, 'warn')
      .mockImplementation(() => undefined);

    const result = await service.applyFixes(makeDoc(), findings, 'org1');

    expect(docService.applyOps).not.toHaveBeenCalled();
    expect(result).toEqual(makeDoc());
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Refusing text fix on image slot "image"'),
      expect.any(String)
    );
  });

  it('sanitizeDoc strips stray text from an image element (corrupted-doc heal)', () => {
    const doc = makeDoc();
    (doc.outputs[0] as any).children[1].text = 'REGENERATE_BASE_PHOTO: no logos';

    const { doc: cleaned } = service.sanitizeDoc(doc);

    const image = (cleaned.outputs[0] as any).children.find(
      (el: any) => el.id === 'e2'
    );
    expect(image.text).toBeUndefined();
    // Text elements keep their copy.
    const headline = (cleaned.outputs[0] as any).children.find(
      (el: any) => el.id === 'e1'
    );
    expect(headline.text).toBe('Hello');
  });

  it('refuses a style fix that fades an image slot to opacity 0', async () => {
    const findings: VisionFinding[] = [
      {
        issue: 'Tone the photo down',
        fix: {
          scope: 'shared',
          targetSlots: ['image'],
          style: { opacity: 0 },
        },
      },
    ];

    const result = await service.applyFixes(makeDoc(), findings, 'org1');

    // The only patch key was stripped, so no op survives.
    expect(docService.applyOps).not.toHaveBeenCalled();
    expect(result).toEqual(makeDoc());
  });

  it('forces the locked plan copy over a critic text rewrite', async () => {
    const findings: VisionFinding[] = [
      {
        issue: 'Punchier headline',
        fix: {
          scope: 'shared',
          text: { slotId: 'headline', newText: 'Critic rewrite' },
        },
      },
    ];

    await service.applyFixes(
      makeDoc(),
      findings,
      'org1',
      undefined,
      undefined,
      { headline: 'Approved line' }
    );

    expect(opsOf()).toEqual([
      {
        op: 'updateElement',
        outputIndex: 0,
        elementId: 'e1',
        scope: 'shared',
        patch: { text: 'Approved line' },
      },
    ]);
  });

  it('adds a scrim shape behind the first text element, clamped to the canvas', async () => {
    const findings: VisionFinding[] = [
      {
        issue: 'Text needs a scrim',
        fix: {
          scope: 'shared',
          addElement: {
            slotId: 'scrim',
            type: 'shape',
            box: { x: -100, y: 1000, width: 2000, height: 400 },
            style: { fill: '#000000' },
          },
        },
      },
    ];

    await service.applyFixes(makeDoc(), findings, 'org1');

    const ops = opsOf();
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toBe('addElement');
    // Never appended topmost: inserted before the first text element.
    expect(ops[0].beforeElementId).toBe('e1');
    // Off-canvas box clamped into the 1080x1080 output.
    expect(ops[0].element.x).toBe(0);
    expect(ops[0].element.y).toBe(680);
    expect(ops[0].element.width).toBe(1080);
    expect(ops[0].element.height).toBe(400);
  });
});

describe('AiDesignerComposerService LLM revise protections', () => {
  let model: { generateText: ReturnType<typeof vi.fn> };
  let service: AiDesignerComposerService;

  beforeEach(() => {
    model = { generateText: vi.fn() };
    service = new AiDesignerComposerService(
      new DesignerDocService() as any,
      model as any
    );
  });

  const twoOutputDoc = () =>
    ({
      mode: 'image',
      outputs: [
        {
          id: 'o1',
          formatId: 'ig-post',
          name: 'IG Post',
          width: 1080,
          height: 1080,
          background: '#ffffff',
          children: [
            {
              id: 'p1',
              originId: 'headline',
              type: 'text',
              x: 100,
              y: 100,
              width: 400,
              height: 80,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: 'Post headline',
              fontSize: 40,
              fill: '#111111',
            },
          ],
        },
        {
          id: 'o2',
          formatId: 'ig-story',
          name: 'IG Story',
          width: 1080,
          height: 1920,
          background: '#ffffff',
          children: [
            {
              id: 's1',
              originId: 'headline',
              type: 'text',
              x: 100,
              y: 900,
              width: 400,
              height: 80,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: 'Story headline',
              fontSize: 40,
              fill: '#111111',
            },
          ],
        },
      ],
    } as any);

  it('drops removeElement / hidden / opacity:0 ops that target image slots', async () => {
    const doc = makeDoc();
    model.generateText.mockResolvedValue(
      JSON.stringify([
        { op: 'removeElement', outputIndex: 0, elementId: 'e2' },
        {
          op: 'updateElement',
          outputIndex: 0,
          elementId: 'e2',
          patch: { hidden: true, borderRadius: 24 },
        },
      ])
    );

    const revised = await service.reviseByInstruction(
      doc,
      'get rid of the photo',
      'shared',
      'org1'
    );

    const image = (revised.outputs[0] as any).children.find(
      (el: any) => el.id === 'e2'
    );
    // Still there, not hidden — but the innocuous patch key survived.
    expect(image).toBeDefined();
    expect(image.hidden).toBe(false);
    expect(image.borderRadius).toBe(24);
  });

  it('strips text/src/fileId from an updateElement patch on an image slot', async () => {
    const doc = makeDoc();
    model.generateText.mockResolvedValue(
      JSON.stringify([
        {
          op: 'updateElement',
          outputIndex: 0,
          elementId: 'e2',
          patch: {
            text: 'REPLACE_IMAGE_NO_TEXT_NO_LOGOS',
            // data: shape — the repair step's comment stripping mangles `//`
            // in https URLs before the filter ever sees the op.
            src: 'data:image/png;base64,AAAA',
            fileId: 'f-other',
            borderRadius: 24,
          },
        },
      ])
    );

    const revised = await service.reviseByInstruction(
      doc,
      'swap the photo',
      'shared',
      'org1'
    );

    const image = (revised.outputs[0] as any).children.find(
      (el: any) => el.id === 'e2'
    );
    expect(image.text).toBeUndefined();
    expect(image.src).toBeUndefined();
    expect(image.fileId).toBeUndefined();
    // The innocuous patch key still applied.
    expect(image.borderRadius).toBe(24);
  });

  it('refuses setOutputBackground when the current background is an image', async () => {
    const doc = makeDoc();
    (doc.outputs[0] as any).bg = {
      type: 'image',
      src: 'https://example.com/bg.png',
    };
    model.generateText.mockResolvedValue(
      JSON.stringify([
        {
          op: 'setOutputBackground',
          outputIndex: 0,
          background: { type: 'color', color: '#0B3D2E' },
        },
      ])
    );

    const revised = await service.reviseByInstruction(
      doc,
      'make the background dark green',
      'shared',
      'org1'
    );

    expect((revised.outputs[0] as any).bg).toEqual({
      type: 'image',
      src: 'https://example.com/bg.png',
    });
  });

  it('still applies setOutputBackground when the background is a plain color', async () => {
    model.generateText.mockResolvedValue(
      JSON.stringify([
        {
          op: 'setOutputBackground',
          outputIndex: 0,
          background: { type: 'color', color: '#0B3D2E' },
        },
      ])
    );

    const revised = await service.reviseByInstruction(
      makeDoc(),
      'make the background dark green',
      'shared',
      'org1'
    );

    expect((revised.outputs[0] as any).bg).toEqual({
      type: 'color',
      color: '#0B3D2E',
    });
  });

  it('forces locked copy over an LLM patch.text rewrite', async () => {
    model.generateText.mockResolvedValue(
      JSON.stringify([
        {
          op: 'updateElement',
          outputIndex: 0,
          elementId: 'e1',
          patch: { text: 'LLM rewrite' },
        },
      ])
    );

    const revised = await service.reviseByInstruction(
      makeDoc(),
      'rewrite the headline',
      'shared',
      'org1',
      undefined,
      undefined,
      undefined,
      { headline: 'Approved line' }
    );

    const headline = (revised.outputs[0] as any).children.find(
      (el: any) => el.id === 'e1'
    );
    expect(headline.text).toBe('Approved line');
  });

  it('rejects ops whose outputIndex is outside the targetOutputs scope', async () => {
    model.generateText.mockResolvedValue(
      JSON.stringify([
        {
          op: 'updateElement',
          outputIndex: 0,
          elementId: 'p1',
          patch: { y: 40 },
        },
        {
          op: 'updateElement',
          outputIndex: 1,
          elementId: 's1',
          patch: { y: 940 },
        },
      ])
    );

    const revised = await service.reviseByInstruction(
      twoOutputDoc(),
      'move the headline',
      'format-only',
      'org1',
      ['ig-story']
    );

    const post = (revised.outputs[0] as any).children[0];
    const story = (revised.outputs[1] as any).children[0];
    // The leak onto the unrequested format was dropped…
    expect(post.y).toBe(100);
    // …while the in-scope op applied.
    expect(story.y).toBe(940);
  });

  it('screens addElement shape ops: opacity cap, canvas clamp, behind-the-copy insert', async () => {
    model.generateText.mockResolvedValue(
      JSON.stringify([
        {
          op: 'addElement',
          outputIndex: 0,
          element: {
            type: 'shape',
            shape: 'rect',
            x: 900,
            y: -50,
            width: 1200,
            height: 300,
            rotation: 0,
            opacity: 0.95,
            locked: false,
            hidden: false,
            fill: '#000000',
            originId: 'accent-band',
          },
        },
      ])
    );

    const revised = await service.reviseByInstruction(
      makeDoc(),
      'add a dark band behind the headline',
      'shared',
      'org1'
    );

    const children = (revised.outputs[0] as any).children;
    const bandIdx = children.findIndex(
      (el: any) => el.originId === 'accent-band'
    );
    const band = children[bandIdx];
    expect(band).toBeDefined();
    // Scrim discipline: opacity capped at 0.6, box clamped to the canvas…
    expect(band.opacity).toBe(0.6);
    expect(band.width).toBe(1080);
    expect(band.x).toBe(0);
    expect(band.y).toBe(0);
    // …and painted behind the copy: forced before the first non-hidden
    // non-empty text element.
    expect(bandIdx).toBeLessThan(
      children.findIndex((el: any) => el.id === 'e1')
    );
  });
});

describe('AiDesignerComposerService.fixContrast', () => {
  const makeService = () =>
    new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    );

  const imageryDoc = (fill: string, fontSize = 16) =>
    ({
      mode: 'image',
      outputs: [
        {
          id: 'o1',
          formatId: 'ig-post',
          name: 'IG',
          width: 1080,
          height: 1080,
          background: '#ffffff',
          bg: { type: 'image', src: 'https://example.com/bg.png' },
          children: [
            {
              id: 't1',
              originId: 'headline',
              type: 'text',
              x: 100,
              y: 100,
              width: 400,
              height: 40,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: 'Over imagery',
              fontSize,
              fill,
            },
          ],
        },
      ],
    } as any);

  const violation = (backdropLuma: number) => ({
    outputIndex: 0,
    elementId: 't1',
    originId: 'headline',
    fill: '#777777',
    ratio: 1.2,
    backdropLuma,
  });

  it('flips the failing fill to #FFFFFF when white reads against the sampled luminance', () => {
    const service = makeService();
    const { doc, notes } = service.fixContrast(imageryDoc('#777777'), [
      violation(0.02),
    ]);

    const text = (doc.outputs[0] as any).children.find(
      (el: any) => el.id === 't1'
    );
    expect(text.fill).toBe('#FFFFFF');
    expect(notes).toEqual(['flipped "headline" to #FFFFFF over the imagery']);
  });

  it('flips the failing fill to #111111 over a bright backdrop', () => {
    const service = makeService();
    const { doc, notes } = service.fixContrast(imageryDoc('#777777'), [
      violation(0.9),
    ]);

    const text = (doc.outputs[0] as any).children.find(
      (el: any) => el.id === 't1'
    );
    expect(text.fill).toBe('#111111');
    expect(notes).toEqual(['flipped "headline" to #111111 over the imagery']);
  });

  it('inserts a padded 0.55 scrim behind the text when neither flat fill passes', () => {
    const service = makeService();
    // Mid-luma busy imagery: for 16px body text neither white (4.38:1) nor
    // near-black (4.32:1) reaches 4.5:1.
    const { doc, notes } = service.fixContrast(imageryDoc('#777777'), [
      violation(0.19),
    ]);

    const children = (doc.outputs[0] as any).children;
    const scrimIdx = children.findIndex(
      (el: any) => el.originId === 'headline-scrim'
    );
    const textIdx = children.findIndex((el: any) => el.id === 't1');
    const scrim = children[scrimIdx];

    // Painted just before the text, dark, subtle, text box + ~0.3em padding.
    expect(scrimIdx).toBe(textIdx - 1);
    expect(scrim.opacity).toBe(0.55);
    expect(scrim.fill).toBe('#111111');
    expect(scrim.x).toBe(95);
    expect(scrim.y).toBe(95);
    expect(scrim.width).toBe(410);
    expect(scrim.height).toBe(50);
    // The old fill fails against the dark scrim too — forced to white.
    expect(children[textIdx].fill).toBe('#FFFFFF');
    expect(notes).toEqual(['added a scrim behind "headline" over the imagery']);
  });

  it('does nothing when no violations are reported', () => {
    const service = makeService();
    const doc = imageryDoc('#777777');
    const result = service.fixContrast(doc, []);

    expect(result.doc).toBe(doc);
    expect(result.notes).toEqual([]);
  });

  it('preserves output-level bg imagery on every output through the fix + save-path round-trip', () => {
    // Regression guard (live run 1, design cms8d84dq002xp32avywbnd8x): image
    // backgrounds live at the OUTPUT level (background '#000000' + bg:{type:
    // 'image', src, fileId, focalPoint}), not as image elements — a contrast
    // fix that round-trips the doc through applyOps and the save path's
    // lenient parse must retain the full bg shape on ALL outputs, including
    // formats the fix never touched.
    const service = makeService();
    const bg = {
      type: 'image',
      src: 'http://localhost:4200/uploads/org/2026/07/31/flatlay.webp',
      fileId: '5a712d0d-3bf2-4576-8991-02cf9392cdeb',
      focalPoint: { x: 0.5, y: 0.5 },
    };
    const textEl = (id: string) => ({
      id,
      originId: 'headline',
      type: 'text',
      x: 100,
      y: 100,
      width: 400,
      height: 40,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      text: 'Over imagery',
      fontSize: 16,
      fill: '#777777',
    });
    const doc = {
      mode: 'image',
      outputs: [
        {
          id: 'o1',
          formatId: 'ig-post',
          name: 'IG',
          width: 1080,
          height: 1080,
          background: '#000000',
          bg: { ...bg, focalPoint: { ...bg.focalPoint } },
          children: [textEl('t1')],
        },
        {
          id: 'o2',
          formatId: 'x-post',
          name: 'X',
          width: 1600,
          height: 900,
          background: '#000000',
          bg: { ...bg, focalPoint: { ...bg.focalPoint } },
          children: [textEl('t2')],
        },
      ],
    } as any;

    // Violation on the SECOND output only — the first stays untouched.
    const { doc: fixed, notes } = service.fixContrast(doc, [
      {
        outputIndex: 1,
        elementId: 't2',
        originId: 'headline',
        fill: '#777777',
        ratio: 1.2,
        backdropLuma: 0.02,
      } as any,
    ]);
    expect(notes.length).toBeGreaterThan(0);

    // The saver's write path (DesignService.updateDesign) lenient-parses the
    // doc once more before persisting — mirror it.
    const persisted = new DesignerDocService().validate(fixed);

    for (const out of persisted.outputs as any[]) {
      expect(out.background).toBe('#000000');
      expect(out.bg).toEqual(bg);
    }
    // The fix itself still landed on the flagged output.
    const fixedText = (persisted.outputs[1] as any).children.find(
      (el: any) => el.id === 't2'
    );
    expect(fixedText.fill).toBe('#FFFFFF');
    // And the untouched output kept its original fill.
    const untouched = (persisted.outputs[0] as any).children.find(
      (el: any) => el.id === 't1'
    );
    expect(untouched.fill).toBe('#777777');
  });
});

describe('AiDesignerComposerService contrast floor', () => {
  const realService = () =>
    new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    );

  it('picks white on a near-black underlying fill', () => {
    const service = realService();
    const style = (service as any)._resolveStyle(makePlan());
    expect((service as any)._contrastOn('#0A0A0A', style)).toBe('#FFFFFF');
  });

  it('keeps a readable label on a near-black badge accent', async () => {
    const plan = makePlan();
    plan.slots.push({
      id: 'badge',
      role: 'badge',
      kind: 'badge',
      style: { fill: '#0B0B0B' },
    });
    const doc = await composeWith(plan);

    expect(byOrigin(doc, 'badge-bg').fill).toBe('#0B0B0B');
    expect(byOrigin(doc, 'badge').fill).toBe('#FFFFFF');
  });

  it('keeps a usable plan-supplied accent and falls back on a failing pair', () => {
    const service = realService();
    const style = (service as any)._resolveStyle(makePlan());

    // A fill the composer can put a readable label on survives.
    expect((service as any)._resolveAccent('#B23A48', style)).toBe('#B23A48');

    // When the best possible label still fails the minimum ratio, the plan
    // fill is overridden by the style accent.
    vi.spyOn(service as any, '_contrastOn').mockReturnValue('#808080');
    expect((service as any)._resolveAccent('#787878', style)).toBe(
      style.accents[0]
    );
  });

  it('uses a contrast-aware fill in the total-fallback doc', () => {
    const service = realService();
    // makePlan's background is solid #0A0A0A — the old hardcoded #111827
    // text was invisible on it.
    const doc = (service as any)._buildFallbackDoc([SQUARE], makePlan(), {}, {});
    expect(doc.outputs[0].children[0].fill).toBe('#FFFFFF');
  });

  it('clamps outsized plan.typeScale hints to MAX_FONT_SIZE', () => {
    const service = realService();
    const style = (service as any)._resolveStyle(makePlan());
    const scale = (service as any)._typeScalePx(
      makePlan({ typeScale: { headline: 99999 } }),
      style,
      1080,
      1080,
      'hero-fullbleed'
    );
    expect(scale.headline).toBe(2000);
  });
});

describe('AiDesignerComposerService panel side', () => {
  it('mirrors the split-panel layout when the plan asks for a right panel', async () => {
    const doc = await composeWith(
      makePlan({ formatTemplate: 'split-panel', panelSide: 'right' })
    );

    const panel = byOrigin(doc, 'split-panel-bg');
    const image = byOrigin(doc, 'img');
    // Panel on the right, image on the left.
    expect(panel.x).toBe(1080 - panel.width);
    expect(image.x).toBe(0);
    expect(image.width).toBe(1080 - panel.width);
  });

  it('defaults the split-panel layout to a left panel', async () => {
    const doc = await composeWith(makePlan({ formatTemplate: 'split-panel' }));

    const panel = byOrigin(doc, 'split-panel-bg');
    const image = byOrigin(doc, 'img');
    expect(panel.x).toBe(0);
    expect(image.x).toBe(panel.width);
  });

  it('mirrors the editorial sidebar when the plan asks for a right panel', async () => {
    const doc = await composeWith(
      makePlan({ formatTemplate: 'editorial-sidebar', panelSide: 'right' })
    );

    const sidebar = byOrigin(doc, 'editorial-sidebar-bg');
    const image = byOrigin(doc, 'img');
    expect(sidebar.x).toBe(1080 - sidebar.width);
    expect(image.x).toBe(0);
  });
});
