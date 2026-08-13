import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiDesignerComposerService } from './ai-designer-composer.service';
import { DesignerDocService } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.service';
import { DesignerDocStrictSchema } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { canvasMarginPx } from '@postmill-ai/nestjs-libraries/media/designer-doc/reflow';
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

  const makeBadgeDoc = (plate: 'rect' | 'path') =>
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
            plate === 'rect'
              ? {
                  id: 'plate-1',
                  originId: 'badge-bg',
                  type: 'shape',
                  shape: 'rect',
                  x: 400,
                  y: 800,
                  width: 280,
                  height: 64,
                  fill: '#C0392B',
                  borderRadius: 32,
                }
              : {
                  id: 'plate-1',
                  originId: 'badge-bg',
                  type: 'path',
                  x: 0,
                  y: 0,
                  width: 1080,
                  height: 1080,
                  closed: true,
                  fill: '#C0392B',
                  nodes: [
                    { x: 402, y: 810 },
                    { x: 678, y: 810 },
                    { x: 680, y: 854 },
                    { x: 400, y: 854 },
                  ],
                },
            {
              id: 'label-1',
              originId: 'badge',
              type: 'text',
              x: 420,
              y: 800,
              width: 240,
              height: 64,
              text: '1893',
              fontSize: 28,
            },
          ],
        },
      ],
    } as any);

  it('re-emits a pill plate as a ribbon path under the label (structural badgeStyle fix)', async () => {
    // "The badge is not an arched ribbon" was visible to the critic and
    // unfixable — badge shape lived only at compose time.
    const findings: VisionFinding[] = [
      {
        issue: 'The badge is a pill; the reference shows an arched ribbon',
        fix: {
          scope: 'shared',
          targetSlots: ['badge'],
          style: { badgeStyle: 'ribbon' },
        },
      },
    ];

    await service.applyFixes(makeBadgeDoc('rect'), findings, 'org1');

    const ops = docService.applyOps.mock.calls[0][1] as any[];
    const add = ops.find((op) => op.op === 'addElement');
    const remove = ops.find((op) => op.op === 'removeElement');
    expect(add).toBeDefined();
    expect(add.element.type).toBe('path');
    expect(add.element.closed).toBe(true);
    expect(add.element.originId).toBe('badge-bg');
    expect(add.element.groupId).toBe('badge');
    expect(add.element.fill).toBe('#C0392B');
    // Inserted UNDER the label so the plate never paints over its copy.
    expect(add.beforeElementId).toBe('label-1');
    expect(remove).toEqual({
      op: 'removeElement',
      outputIndex: 0,
      elementId: 'plate-1',
    });
    // The label itself is untouched — no updateElement targeting it.
    expect(
      ops.filter((op) => op.op === 'updateElement' && op.elementId === 'label-1')
    ).toHaveLength(0);
  });

  it('converts a ribbon path back to a pill rect, and no-ops when the shape already matches', async () => {
    const toPill: VisionFinding[] = [
      {
        issue: 'The plate should be a simple pill',
        fix: {
          scope: 'shared',
          targetSlots: ['badge'],
          style: { badgeStyle: 'pill' },
        },
      },
    ];

    await service.applyFixes(makeBadgeDoc('path'), toPill, 'org1');
    const ops = docService.applyOps.mock.calls[0][1] as any[];
    const add = ops.find((op) => op.op === 'addElement');
    expect(add.element.type).toBe('shape');
    expect(add.element.shape).toBe('rect');
    // Half-height radius = pill.
    expect(add.element.borderRadius).toBe(Math.round(add.element.height / 2));

    docService.applyOps.mockClear();
    // burst downgrades to pill (same rule as compose) — on a rect plate that
    // is already the right shape class, nothing structural happens.
    const burstOnPill: VisionFinding[] = [
      {
        issue: 'Make it a starburst',
        fix: {
          scope: 'shared',
          targetSlots: ['badge'],
          style: { badgeStyle: 'burst' },
        },
      },
    ];
    const doc = makeBadgeDoc('rect');
    const result = await service.applyFixes(doc, burstOnPill, 'org1');
    expect(docService.applyOps).not.toHaveBeenCalled();
    expect(result).toBe(doc);
  });

  it('ignores a badgeStyle fix on a slot with no plate companion', async () => {
    const doc = makeDoc();
    const findings: VisionFinding[] = [
      {
        issue: 'Headline should be a ribbon (nonsense)',
        fix: {
          scope: 'shared',
          targetSlots: ['headline'],
          style: { badgeStyle: 'ribbon' },
        },
      },
    ];

    const result = await service.applyFixes(doc, findings, 'org1');

    expect(docService.applyOps).not.toHaveBeenCalled();
    expect(result).toBe(doc);
  });
});

describe('AiDesignerComposerService.planForRecompose', () => {
  const service = new AiDesignerComposerService(
    { applyOps: vi.fn() } as any,
    { generateText: vi.fn() } as any
  );
  const plan = {
    variantId: 'v1',
    skill: 'reference-clone',
    concept: 'pizza poster',
    slots: [
      { id: 'headline', role: 'headline', kind: 'text' },
      { id: 'image', role: 'product-image', kind: 'image' },
    ],
    assetNeeds: [],
    palette: ['#111111'],
    typeScale: {},
    background: { kind: 'image' },
    composition: 'hero-fullbleed',
    formatTemplate: 'hero-fullbleed',
    channelLayouts: { 'ig-square': 'stacked', 'ig-story': 'hero-top' },
  } as unknown as DesignPlan;
  const output = { formatId: 'ig-square', width: 1080, height: 1080 };
  const copy = { headline: 'PIZZA' };

  it('mutates a copy of the plan and clears the two silent-override levers', () => {
    const mutated = service.planForRecompose(plan, 'poster-left', output, copy);

    expect(mutated).not.toBeNull();
    expect(mutated!.composition).toBe('poster-left');
    // `effectiveLayout` (per-channel) and the D4 formatTemplate redirect both
    // silently beat plan.composition — a recompose must clear them or it is a
    // no-op with extra steps.
    expect(mutated!.formatTemplate).toBeUndefined();
    expect(mutated!.channelLayouts).toEqual({ 'ig-story': 'hero-top' });
    // The original plan is untouched.
    expect(plan.composition).toBe('hero-fullbleed');
    expect(plan.channelLayouts).toEqual({
      'ig-square': 'stacked',
      'ig-story': 'hero-top',
    });
  });

  it('returns null for an unknown composition id', () => {
    expect(service.planForRecompose(plan, 'zigzag-panel', output, copy)).toBeNull();
  });

  it('returns null when the composition fails the aspect fit (never a silent substitute)', () => {
    // banner-strip needs aspect ≥ 1.4; a square canvas fails it.
    expect(service.planForRecompose(plan, 'banner-strip', output, copy)).toBeNull();
  });

  it('returns null when a required role is missing', () => {
    const noImage = {
      ...plan,
      slots: [{ id: 'headline', role: 'headline', kind: 'text' }],
      background: { kind: 'solid' },
    } as unknown as DesignPlan;
    // overlap-card requires an image role.
    expect(
      service.planForRecompose(noImage, 'overlap-card', output, copy)
    ).toBeNull();
  });
});

describe('AiDesignerComposerService.applyFixes on a lockup instance', () => {
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

  /**
   * A doc whose CTA is a symbol lockup, as the composer now emits it: the
   * instance keeps the slot's originId; plate+label live in the definition.
   */
  const makeLockupDoc = () =>
    ({
      mode: 'image',
      symbols: [
        {
          id: 'lockup-cta',
          name: 'cta lockup',
          width: 213,
          height: 59,
          children: [
            { id: 'plate', type: 'shape', x: 0, y: 0, width: 213, height: 59, fill: '#FF4D00' },
            { id: 'label', type: 'text', x: 0, y: 0, width: 213, height: 59, text: 'Shop now', fontSize: 28 },
          ],
        },
      ],
      outputs: [
        {
          id: 'o1',
          formatId: 'ig-post',
          name: 'IG',
          width: 1080,
          height: 1080,
          background: '#000000',
          children: [
            {
              id: 'e1',
              originId: 'cta',
              type: 'symbol',
              symbolId: 'lockup-cta',
              x: 434,
              y: 856,
              width: 213,
              height: 59,
              symbolOverrides: { label: { text: 'Shop now' } },
            },
          ],
        },
      ],
    } as any);

  it('maps a text fix to symbolOverrides.label.text on the instance', async () => {
    const findings: VisionFinding[] = [
      {
        issue: 'CTA copy is weak',
        fix: { scope: 'shared', text: { slotId: 'cta', newText: 'Shop the sale' } },
      },
    ];

    await service.applyFixes(makeLockupDoc(), findings, 'org1');

    const ops = docService.applyOps.mock.calls[0][1];
    expect(ops).toEqual([
      {
        op: 'updateElement',
        outputIndex: 0,
        elementId: 'e1',
        scope: 'shared',
        patch: { symbolOverrides: { label: { text: 'Shop the sale' } } },
      },
    ]);
  });

  it('maps a fill fix to symbolOverrides.plate.fill — the plate carries the visual weight', async () => {
    const findings: VisionFinding[] = [
      {
        issue: 'CTA button blends into the background',
        fix: { scope: 'shared', targetSlots: ['cta'], style: { fill: '#FFFFFF' } },
      },
    ];

    await service.applyFixes(makeLockupDoc(), findings, 'org1');

    const ops = docService.applyOps.mock.calls[0][1];
    expect(ops).toEqual([
      {
        op: 'updateElement',
        outputIndex: 0,
        elementId: 'e1',
        scope: 'shared',
        patch: { symbolOverrides: { label: { text: 'Shop now', fill: '#111111' }, plate: { fill: '#FFFFFF' } } },
      },
    ]);
  });

  it('merges a text fix and a fill fix from the same finding instead of clobbering one', async () => {
    const findings: VisionFinding[] = [
      {
        issue: 'CTA needs new copy and more contrast',
        fix: {
          scope: 'shared',
          targetSlots: ['cta'],
          style: { fill: '#FFFFFF' },
          text: { slotId: 'cta', newText: 'Shop the sale' },
        },
      },
    ];

    await service.applyFixes(makeLockupDoc(), findings, 'org1');

    const ops = docService.applyOps.mock.calls[0][1];
    expect(ops).toEqual([
      {
        op: 'updateElement',
        outputIndex: 0,
        elementId: 'e1',
        scope: 'shared',
        patch: {
          symbolOverrides: { label: { text: 'Shop the sale', fill: '#111111' }, plate: { fill: '#FFFFFF' } },
        },
      },
    ]);
  });

  it('maps a geometry fix to the instance box — and drops the unread fontSize', async () => {
    const findings: VisionFinding[] = [
      {
        issue: 'CTA too low',
        fix: { scope: 'shared', targetSlots: ['cta'], geometry: { y: 700, fontSize: 40 } },
      },
    ];

    await service.applyFixes(makeLockupDoc(), findings, 'org1');

    const ops = docService.applyOps.mock.calls[0][1];
    // The instance box IS the geometry target (the expansion scales plate
    // and label from it); a stored fontSize would sit in the doc unread.
    expect(ops).toEqual([
      { op: 'updateElement', outputIndex: 0, elementId: 'e1', scope: 'shared', patch: { y: 700 } },
    ]);
  });

  it('refuses the override write when the CTA text is locked', async () => {
    const findings: VisionFinding[] = [
      {
        issue: 'CTA copy is weak',
        fix: { scope: 'shared', text: { slotId: 'cta', newText: 'BUY NOW!!!' } },
      },
    ];

    const doc = makeLockupDoc();
    const result = await service.applyFixes(doc, findings, 'org1', undefined, undefined, {
      cta: 'Shop now',
    });

    // Locked plan copy wins — nothing is written, not even the lock back.
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
  copy = makeCopy(),
  assets: Record<string, any> = makeAssets()
) => {
  const service = new AiDesignerComposerService(
    new DesignerDocService() as any,
    { generateText: vi.fn() } as any
  );
  const doc = await service.compose({
    plan,
    copy,
    assets,
    outputs,
    orgId: 'o1',
    userId: 'u1',
  });
  return doc;
};

const childrenOf = (doc: any, index = 0) => doc.outputs[index].children as any[];
const byOrigin = (doc: any, originId: string, index = 0) =>
  childrenOf(doc, index).find((el) => el.originId === originId);

// The CTA composes as a symbol lockup: EVERY output carries an instance at
// the slot's originId; the plate/label pair lives once, in symbol-local
// coordinates, on `doc.symbols` (children `plate`/`label`). Underline CTAs
// have no plate and stay a plain text + bar pair.
const ctaDefinition = (doc: any) =>
  (doc.symbols ?? []).find((s: any) => s.id === 'lockup-cta');
const ctaChild = (doc: any, childId: string) =>
  ctaDefinition(doc)?.children.find((c: any) => c.id === childId);
const ctaPlate = (doc: any) => ctaChild(doc, 'plate');
const ctaLabel = (doc: any) => ctaChild(doc, 'label');

describe('AiDesignerComposerService.compose (style-aware)', () => {
  it('resolves the preset: display font on the headline, body font on supporting text', async () => {
    const doc = await composeWith(makePlan({ styleId: 'editorial' }));

    expect(byOrigin(doc, 'headline').fontFamily).toBe('Playfair Display');
    expect(byOrigin(doc, 'sub').fontFamily).toBe('Inter');
    // editorial's CTA is an underline — no lockup, the label is plain text.
    expect((ctaLabel(doc) ?? byOrigin(doc, 'cta')).fontFamily).toBe('Inter');
  });

  it('uses the default style when styleId is absent', async () => {
    const plan = makePlan();
    delete plan.styleId;
    const doc = await composeWith(plan);

    const headline = byOrigin(doc, 'headline');
    // Default preset is 'bold' (Anton display, uppercase headline).
    expect(headline.fontFamily).toBe('Anton');
    // Case is a render property now: the document keeps the authored copy and
    // the transform paints it uppercase — the renderer's fitter measures the
    // transformed string, so nothing downstream sees mutated text.
    expect(headline.text).toBe('Big launch');
    expect(headline.textTransform).toBe('uppercase');
  });

  it('honours reference-measured slot geometry: band placement and cap-height font size', async () => {
    // The size-ratio control: "PIZZA is 4× the subhead" survives planning as
    // numbers stamped by applyReferenceGeometry, not adjectives.
    const plan = makePlan();
    plan.slots[1] = {
      ...plan.slots[1],
      geometry: { yBand: [0.08, 0.2], xAnchor: 'left', heightRatio: 0.06 },
    } as any;
    const doc = await composeWith(plan);

    const headline = byOrigin(doc, 'headline');
    // Cap-height ratio → font size (cap ≈ 0.7 em): 0.06 × 1080 / 0.7 ≈ 93.
    expect(headline.fontSize).toBe(Math.round((0.06 * 1080) / 0.7));
    // hero-fullbleed anchors copy to the LOWER third; the measured band pins
    // this headline to the top of the canvas instead.
    expect(headline.y).toBeLessThan(1080 * 0.4);
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

  it('renders a cta-button slot as a symbol lockup — one definition, an instance per output', async () => {
    const doc = await composeWith(makePlan());

    const instance = byOrigin(doc, 'cta');
    expect(instance).toBeDefined();
    expect(instance.type).toBe('symbol');
    expect(instance.symbolId).toBe('lockup-cta');
    expect(instance.groupId).toBe('cta');
    // The label text rides as an override, pinned per instance so a later
    // definition edit can never silently reword approved copy.
    expect(instance.symbolOverrides).toEqual({ label: { text: 'Shop now' } });
    // No separate plate element remains — the instance encompasses it.
    expect(byOrigin(doc, 'cta-bg')).toBeUndefined();

    const def = ctaDefinition(doc);
    expect(def).toBeDefined();
    const [plate, label] = def.children;
    // 'bold' preset: pill CTA in the palette accent.
    expect(plate.type).toBe('shape');
    expect(plate.fill).toBe('#FF4D00');
    expect(plate.borderRadius).toBe(Math.round(def.height / 2));
    // The label covers the plate exactly — same symbol-local box, centered
    // both ways — so it can never render beside or below the pill.
    expect(label.x).toBe(plate.x);
    expect(label.y).toBe(plate.y);
    expect(label.width).toBe(plate.width);
    expect(label.height).toBe(plate.height);
    expect(label.align).toBe('center');
    expect(label.verticalAlign).toBe('middle');
    // The definition is authored at the primary output's box.
    expect(def.width).toBe(instance.width);
    expect(def.height).toBe(instance.height);
  });

  it('centers the CTA label inside the shape even in left-aligned panels', async () => {
    const doc = await composeWith(makePlan({ formatTemplate: 'split-panel' }));

    const plate = ctaPlate(doc);
    const label = ctaLabel(doc);
    expect(label.x).toBe(plate.x);
    expect(label.y).toBe(plate.y);
    expect(label.width).toBe(plate.width);
    expect(label.height).toBe(plate.height);
    expect(label.align).toBe('center');
    expect(label.verticalAlign).toBe('middle');
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
    expect(ctaPlate(doc).fill).toBe('#FF4D00');
  });

  it('honors a complete plan palette (surface/text/accent convention)', async () => {
    const doc = await composeWith(
      makePlan({ palette: ['#101010', '#EEEEEE', '#00FF00'] })
    );
    expect(ctaPlate(doc).fill).toBe('#00FF00');
  });

  it('maps preset typeScale ratios to px for 1080x1080', async () => {
    const doc = await composeWith(makePlan());

    // bold ratios on a 1080 baseline (~92px headline): 1 / 0.42 / 0.3.
    const headline = byOrigin(doc, 'headline').fontSize;
    const sub = byOrigin(doc, 'sub').fontSize;
    const cta = ctaLabel(doc).fontSize;
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
      channelLayouts: { 'x-post': 'side-by-side' },
    });
    const doc = await composeWith(plan, [
      SQUARE,
      // Wide, not tall: a split panel on a story is substituted, not forced
      // (the gallery's aspect rule — two 540px columns hold no word).
      { formatId: 'x-post', width: 1200, height: 675 },
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

    // The seeded output carries an instance of the SAME definition — one
    // glued unit that refits as a box, never a plate and a label that can
    // drift apart.
    const primary = byOrigin(doc, 'cta', 0);
    const seeded = byOrigin(doc, 'cta', 1);
    expect(seeded).toBeDefined();
    expect(seeded.type).toBe('symbol');
    expect(seeded.symbolId).toBe(primary.symbolId);
    expect(seeded.groupId).toBe('cta');
    expect(seeded.symbolOverrides).toEqual({ label: { text: 'Shop now' } });
  });

  it('produces a doc the strict schema accepts, symbols included', async () => {
    const doc = await composeWith(makePlan(), [
      SQUARE,
      { formatId: 'x-post', width: 1200, height: 675 },
    ]);

    expect(ctaDefinition(doc)).toBeDefined();
    expect(byOrigin(doc, 'cta', 1)?.type).toBe('symbol');
    const result = DesignerDocStrictSchema.safeParse(doc);
    expect(
      result.success ? true : result.error.issues.slice(0, 5)
    ).toBe(true);
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

  it('re-links alignment across outputs — it is a design property, not a per-canvas one', async () => {
    const real = new AiDesignerComposerService(
      new DesignerDocService() as any,
      model as any
    );
    const doc = makeTwoOutputDoc();
    // The drift a format-scoped critic fix used to bake in: the same slot
    // left-aligned on one output and centered on the other.
    doc.outputs[0].children[0].align = 'left';
    doc.outputs[1].children[0].align = 'center';

    const { doc: healed } = real.sanitizeDoc(doc);

    expect((healed.outputs[1] as any).children[0].align).toBe('left');
  });

  it('never writes align onto a shape element', () => {
    const service2 = new AiDesignerComposerService(
      new DesignerDocService() as any,
      model as any
    );
    const patch = (service2 as any)._stylePatch(
      { align: 'center', fill: '#FF0000' },
      { type: 'shape', originId: 'badge-bg' }
    );

    expect(patch.align).toBeUndefined();
    expect(patch.fill).toBe('#FF0000');
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

  it('reads ratio-shaped (0..1) plan.typeScale hints as RATIOS of the role size', async () => {
    // History: ratio hints once rounded to fontSize 0 and nuked the compose,
    // so they were IGNORED outright. But every live plan speaks ratios
    // (headline: 1, subhead: 0.42 — the skills' own vocabulary), and ignoring
    // them discarded the plan's hierarchy intent entirely. They now scale the
    // role's computed size, which keeps the doc valid by construction.
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
    // The ratio landed: 0.85 of the unpinned headline size — same slot set,
    // so the stack-count basis is identical.
    const basePlan = makePlan();
    basePlan.slots.push({ id: 'legal', role: 'legal', kind: 'text' });
    const baseDoc = await composeResilient(basePlan, {
      copy: { ...makeCopy(), legal: 'Terms apply' },
    });
    const baseHeadline = byOrigin(baseDoc, 'headline').fontSize;
    const ratioHeadline = byOrigin(doc, 'headline').fontSize;
    expect(Math.abs(ratioHeadline - Math.round(baseHeadline * 0.85))).toBeLessThanOrEqual(2);
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

  it('a design-language fix with a note stays typed (no freeform re-emit)', async () => {
    // The critic is taught to pair effects/treatment with a `note`. The
    // typed-check used to omit the design-language fields, so exactly that
    // fix shape fell into the freeform LLM re-emit and the grade was dropped.
    const findings: VisionFinding[] = [
      {
        issue: 'Headline has no separation from the photo',
        slotId: 'headline',
        fix: {
          scope: 'shared',
          effects: ['soft-lift'],
          note: 'lift the headline off the busy image',
        },
      },
    ];

    await service.applyFixes(makeDoc(), findings, 'org1');

    expect(docService.applyOps).toHaveBeenCalled();
    expect(opsOf()[0].op).toBe('updateElement');
    expect(model.generateText).not.toHaveBeenCalled();
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
    // fontSize authored against the primary (1080x1080) is re-fit onto the
    // 1200x675 output through the shared type basis (900/1080 = 0.833), not
    // the old min(1200/1080, 675/1080) = 0.625 short-edge scale.
    expect(ops[0].element.fontSize).toBe(40);
    expect(ops[1].element.fontSize).toBe(33);
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

  // ROUND 8 (A3c): most copy slots carry NO groupId, so a companion added to
  // one inherited nothing and reflowed on its own `deriveAnchor` thirds — a
  // `headline-*` rule seeded from a banner landed dead centre on the story and
  // struck through the headline. The group is backfilled onto the base so the
  // pair shares one frame.
  it('backfills a move group onto an UNGROUPED base when adding its companion', async () => {
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
              x: 54,
              y: 400,
              width: 972,
              height: 200,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: 'Office hours changed',
              fontSize: 88,
            },
          ],
        },
      ],
    } as any;
    const findings: VisionFinding[] = [
      {
        issue: 'The headline needs an accent rule',
        fix: {
          scope: 'shared',
          addElement: {
            slotId: 'headline-underline',
            type: 'shape',
            shape: 'rect',
            box: { x: 54, y: 610, width: 200, height: 4 },
            style: { fill: '#B23A48' },
          },
        },
      },
    ];

    await service.applyFixes(doc, findings, 'org1');

    const ops = opsOf();
    expect(ops).toHaveLength(2);
    // The base is grouped first, then the companion joins the same group.
    expect(ops[0]).toEqual({
      op: 'updateElement',
      outputIndex: 0,
      elementId: 'e1',
      scope: 'format-only',
      patch: { groupId: 'headline' },
    });
    expect(ops[1].op).toBe('addElement');
    expect(ops[1].element.groupId).toBe('headline');
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
    // Primary keeps the authored px; the 1200x675 output is re-fit through the
    // shared type basis: 64 × (900/1080) = 53 (the old short-edge scale gave 40).
    expect(primary.children[0].fontSize).toBe(64);
    expect(secondary.children[0].fontSize).toBe(53);
  });

  it('re-fits a shared GEOMETRY box per output instead of writing it verbatim', async () => {
    const findings: VisionFinding[] = [
      {
        issue: 'Headline sits too high everywhere',
        fix: {
          scope: 'shared',
          targetSlots: ['headline'],
          geometry: { y: 800, height: 200 },
        },
      },
    ];

    const result = await realService().applyFixes(
      makeTwoOutputDoc(),
      findings,
      'org1'
    );

    const [primary, secondary] = result.outputs as any[];
    expect(primary.children[0]).toMatchObject({ y: 800, height: 200 });
    // The box is authored against the primary's 1080² canvas. Written verbatim
    // (what shipped before) it put the headline at y=800 on a 675-tall output —
    // off-canvas. Sizes re-fit through the shared type basis (200 → 167),
    // positions per-axis (800 × 675/1080 = 500), and the result is clamped
    // into the TITLE-SAFE area: 500 + 167 = 667 clears the canvas but sits
    // 8px off the bottom edge, so the validator pulls it to 641.25 - 167.
    expect(secondary.children[0]).toMatchObject({ y: 474.25, height: 167 });
    expect(
      secondary.children[0].y + secondary.children[0].height
    ).toBeLessThanOrEqual(675 * 0.95);
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
  const bgOf = (background: any, assets?: any, palette?: string[]) => {
    const service = new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    );
    return (service as any)._backgroundToDesignerBg(
      background,
      assets,
      undefined,
      undefined,
      0,
      palette
    );
  };

  it('derives a missing background from the plan palette, never bare white', () => {
    // The blank-white-card live failure: a plan with no background at all
    // fell straight to '#ffffff'.
    expect(bgOf(undefined, undefined, ['#0A0A14', '#F0F0FF']).background).toBe(
      '#0A0A14'
    );
    expect(
      bgOf({ kind: 'solid' }, undefined, ['#F7E9D0', '#3B2F2F']).background
    ).toBe('#F7E9D0');
    // Junk palette entries are skipped, not trusted.
    expect(
      bgOf(undefined, undefined, ['not-a-color', '#123456']).background
    ).toBe('#123456');
  });

  it('keeps bare white only when there is no palette to derive from', () => {
    expect(bgOf(undefined).background).toBe('#ffffff');
    expect(bgOf({ kind: 'solid' }, undefined, []).background).toBe('#ffffff');
  });

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

  // A `legal` slot is the one copy role whose placement is an edge contract.
  // Before it had a layout model it packed as another line under the CTA (or,
  // when the vision critic added it, sat wherever the model put it) and the
  // copy stack balanced against a band that still spanned it — a live
  // split-panel shipped its legal line at y=1050 on a 1080 canvas with a
  // 429px (39.7% of canvas height) void above it.
  const planWithFooter = (formatTemplate: string) => {
    const plan = makePlan({ formatTemplate, styleId: 'editorial' } as any);
    plan.slots.push({ id: 'badge', role: 'badge', kind: 'badge' } as any);
    plan.slots.push({ id: 'legal', role: 'legal', kind: 'text' } as any);
    return plan;
  };
  const footerCopy = { ...makeCopy(), legal: 'northbean.shop' };

  it('anchors a legal slot on the bottom margin in every layout', async () => {
    for (const template of [
      'split-panel',
      'editorial-sidebar',
      'hero-fullbleed',
      'top-bottom',
      'badge-burst',
      'minimal-centered',
    ]) {
      const doc = await composeWith(
        planWithFooter(template),
        [SQUARE],
        footerCopy
      );
      const legal = byOrigin(doc, 'legal');
      // Bottom-anchored on the canvas margin (1080 − 5%), never flush with
      // the edge, and never packed into the middle of the copy stack.
      expect(legal.y + legal.height).toBe(1026);
      expect(byOrigin(doc, 'cta').y).toBeLessThan(legal.y);
    }
  });

  it('carves the footer out of the copy band instead of leaving a dead void above it', async () => {
    const doc = await composeWith(
      planWithFooter('split-panel'),
      [SQUARE],
      footerCopy
    );

    const legal = byOrigin(doc, 'legal');
    const badge = byOrigin(doc, 'badge-bg');
    const stack = childrenOf(doc).filter(
      (el: any) =>
        el.originId &&
        ['headline', 'sub', 'cta', 'cta-underline'].includes(el.originId)
    );
    const stackTop = Math.min(...stack.map((el: any) => el.y));
    const stackBottom = Math.max(...stack.map((el: any) => el.y + el.height));

    const voidAbove = stackTop - (badge.y + badge.height);
    const voidBelow = legal.y - stackBottom;
    // The void above the footer is what shipped at 39.7% of canvas height.
    expect(voidBelow / 1080).toBeLessThan(0.3);
    // …and it is the band's own balance, not a dead end: the copy sits
    // between its two neighbours, not packed against the top of a band that
    // still spans the footer.
    expect(Math.abs(voidAbove - voidBelow)).toBeLessThanOrEqual(1080 * 0.02);
  });

  it('leaves a footer-free layout on the capped balance shift', async () => {
    // The uncapped centring is scoped to a footer-bounded band — without one
    // the leftover below the stack is dead space, and the round-6 cap
    // (STACK_BALANCE_MAX_SHIFT) still owns it.
    const plan = makePlan({
      formatTemplate: 'split-panel',
      styleId: 'editorial',
    } as any);
    plan.slots.push({ id: 'badge', role: 'badge', kind: 'badge' } as any);
    const doc = await composeWith(plan, [SQUARE], makeCopy());

    const headline = byOrigin(doc, 'headline');
    const badge = byOrigin(doc, 'badge-bg');
    const cta = byOrigin(doc, 'cta-underline');
    const above = headline.y - (badge.y + badge.height);
    const below = 1026 - (cta.y + cta.height);
    expect(above).toBeLessThan(below);
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
    expect(ctaLabel(doc).fontSize).toBeGreaterThanOrEqual(
      Math.round(1080 * 0.028)
    );
  });

  // WAS: 'keeps burst badge text inside the star inner area, centered both ways'.
  // Round 8 (D1) retired the starburst badge: every star in the render corpus
  // was worse than its pill equivalent, and the label-inside-the-points problem
  // this test policed is gone with the star. It now asserts the replacement —
  // a pill whose label stays inside it and centered.
  it('composes a long retro/badge-burst badge as a pill with its label inside, centered both ways', async () => {
    const plan = makePlan({ styleId: 'retro', formatTemplate: 'badge-burst' });
    plan.slots.push({ id: 'badge', role: 'badge', kind: 'badge' });
    const doc = await composeWith(plan, [SQUARE], {
      ...makeCopy(),
      badge: 'SUN • 3 PM • BY THE PIER',
    });

    const shape = byOrigin(doc, 'badge-bg');
    const text = byOrigin(doc, 'badge');
    expect(shape.shape).toBe('rect');
    // A pill: fully rounded ends, and never the square star frame.
    expect(shape.borderRadius).toBe(Math.round(shape.height / 2));
    expect(shape.width).toBeGreaterThan(shape.height);
    // The label stays inside the pill horizontally and shares its band.
    expect(text.x).toBeGreaterThan(shape.x);
    expect(text.x + text.width).toBeLessThan(shape.x + shape.width);
    expect(text.y).toBeGreaterThanOrEqual(shape.y);
    expect(text.y + text.height).toBeLessThanOrEqual(shape.y + shape.height);
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

  it('shrinks a long unbroken string to fit its box WIDTH — the renderer never splits words', () => {
    const service = new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    );
    // Live: "WWW.YOURPAGE.COM" in the ~38%-wide editorial-sidebar panel. The
    // wrapped-line estimate breaks an over-long word mid-word, so at 30px the
    // URL "fit" as two wrapped lines and the clamp left it alone — while the
    // real renderer paints it as ONE 264px line (16 × 0.55 × 30) that
    // overflows the 200px box and clips at the panel edge.
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
              originId: 'subhead',
              type: 'text',
              x: 100,
              y: 100,
              width: 200,
              height: 120,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: 'WWW.YOURPAGE.COM',
              fontSize: 30,
            },
          ],
        },
      ],
    } as any;

    const clamped = (service as any)._clampTextToFit(doc);
    const el = clamped.outputs[0].children[0];

    expect(el.fontSize).toBeLessThan(30);
    // Fits on ONE line now: the widest word's estimated advance is inside the
    // box (the unit context has no loaded measurer, so the clamp used the
    // same 0.55 fallback this assertion mirrors).
    expect(el.fontSize * 0.55 * 'WWW.YOURPAGE.COM'.length).toBeLessThanOrEqual(200);
  });

  it('does not shrink wrappable copy whose widest word already fits the box', () => {
    const service = new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    );
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
              originId: 'subhead',
              type: 'text',
              x: 100,
              y: 100,
              width: 200,
              height: 120,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: 'Visit our page today',
              fontSize: 30,
            },
          ],
        },
      ],
    } as any;

    const clamped = (service as any)._clampTextToFit(doc);

    // Every word wraps fine at 30px and the block fits the height, so the new
    // width rule must not shrink ordinary copy (same-doc reference back).
    expect(clamped).toBe(doc);
  });


  it('honors a slot-level badgeStyle override over the preset treatment', async () => {
    // The 'bold' preset badges are pills — the plan's slot-level ribbon wins,
    // and a ribbon is a real one: a closed, gently arched path (proved in the
    // manual clone test), NOT the preset's fully-rounded pill and not a
    // barely-rounded rect (the old fake-ribbon behaviour).
    const plan = makePlan({ styleId: 'bold' });
    plan.slots.push({
      id: 'badge',
      role: 'badge',
      kind: 'badge',
      style: { badgeStyle: 'ribbon' },
    });
    const doc = await composeWith(plan, [SQUARE], {
      ...makeCopy(),
      badge: 'NEW',
    });

    const shape = byOrigin(doc, 'badge-bg');
    expect(shape.type).toBe('path');
    expect(shape.closed).toBe(true);
    expect(shape.borderRadius).toBeUndefined();
    expect(shape.nodes?.length).toBeGreaterThanOrEqual(4);
  });

  // Round 8 (D1): the `burst` enum value is deliberately KEPT (stored plans,
  // presets and the brief's "starburst" detection still carry it) but must
  // never reach a star. Both the plan-authored override and the layout-forced
  // treatment resolve to a pill.
  it('resolves a slot-level badgeStyle:"burst" to a pill — no star is composed', async () => {
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

    const shape = byOrigin(doc, 'badge-bg');
    expect(shape.shape).toBe('rect');
    expect(shape.borderRadius).toBe(Math.round(shape.height / 2));
  });

  it('badge-burst layout composes a PILL badge, not a star', async () => {
    const plan = makePlan({ styleId: 'bold', formatTemplate: 'badge-burst' });
    plan.slots.push({ id: 'badge', role: 'badge', kind: 'badge' });
    const doc = await composeWith(plan, [SQUARE], {
      ...makeCopy(),
      badge: 'NEW',
    });

    const shape = byOrigin(doc, 'badge-bg');
    expect(shape.shape).toBe('rect');
    expect(shape.borderRadius).toBe(Math.round(shape.height / 2));
  });

  it('composes no star shape on the happy path, whatever the preset asks for', async () => {
    // The retro and neobrutalism presets used to ask for a burst treatment.
    // Nothing they compose may reach `shape: 'star'` any more. (A plan with
    // explicit `accent-shape` slots can still cycle a decorative star — that is
    // a different feature and this plan carries none.)
    for (const styleId of ['retro', 'neobrutalism'] as const) {
      const plan = makePlan({ styleId });
      plan.slots.push({ id: 'badge', role: 'badge', kind: 'badge' });
      const doc = await composeWith(plan, [SQUARE], {
        ...makeCopy(),
        badge: 'SINCE 2019',
      });

      const stars = doc.outputs.flatMap((out: any) =>
        (out.children ?? []).filter((el: any) => el.shape === 'star')
      );
      expect(stars, `${styleId} composed a star badge`).toEqual([]);
    }
  });

  it('parks the CTA underline rule BELOW its label box, as a hairline', () => {
    // 'editorial' is the underline-CTA preset.
    const service = new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    );
    const elements = (service as any)._buildElements(
      makePlan({ styleId: 'editorial' }),
      makeCopy(),
      makeAssets(),
      { width: 1080, height: 1080 },
      'hero-fullbleed',
      (service as any)._resolveStyle(makePlan({ styleId: 'editorial' }))
    ) as any[];

    const label = elements.find((el) => el.originId === 'cta');
    const bar = elements.find((el) => el.originId === 'cta-underline');
    // Below the label box (never inside it, cutting through the descenders)
    // and thin — a rule, not a slab.
    expect(bar.y).toBeGreaterThanOrEqual(label.y + label.height);
    expect(bar.height).toBeLessThanOrEqual(Math.round(label.fontSize * 0.1));
    expect(bar.x).toBe(label.x);
    expect(bar.width).toBe(label.width);
  });

  it('keeps the underline rule below the label (and thin) after a geometry fix', () => {
    const service = new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    );
    const out = {
      width: 1080,
      height: 1080,
      children: [
        {
          id: 't1',
          originId: 'cta',
          type: 'text',
          x: 100,
          y: 400,
          width: 300,
          height: 48,
          text: 'Shop now',
          fontSize: 30,
        },
      ],
    } as any;
    const bar = { originId: 'cta-underline' } as any;

    const patch = (service as any)._deriveCompanionGeometry(out, bar, 'cta', {
      y: 400,
      height: 48,
    });

    // Derived from the label's BOTTOM, and the rule keeps its own hairline
    // height instead of inheriting the label's box height.
    expect(patch.y).toBe(400 + 48 + Math.max(2, Math.round(30 * 0.12)));
    expect(patch.height).toBe(Math.max(2, Math.round(30 * 0.07)));
  });

  // Changed deliberately (round 6): this used to assert `|above − below| <= 2`
  // measured from the panel MARGIN — i.e. it pinned "centre the stack in the
  // whole panel", which is precisely what opened a ~300px dead gap between the
  // badge and the copy (plus an equal void under it) on the live docs. The
  // band is now measured from the badge's real extent, and the drift into it is
  // capped at STACK_BALANCE_MAX_SHIFT so the copy lands at the band's optical
  // centre instead of its geometric one.
  it('drifts a short copy stack into the band the badge leaves, not to its geometric centre', async () => {
    // One short line in the split panel's tall band: packed top-down it ends in
    // the top third and leaves the panel's lower half dead.
    const plan = makePlan({ formatTemplate: 'split-panel' });
    plan.slots = plan.slots.filter((s) => s.id === 'img' || s.id === 'headline');
    plan.slots.push({ id: 'badge', role: 'badge', kind: 'badge' });
    const doc = await composeWith(plan, [SQUARE], {
      headline: 'Big launch',
      badge: 'New',
    });

    const headline = byOrigin(doc, 'headline');
    const badge = byOrigin(doc, 'badge-bg');
    const margin = Math.round(1080 * 0.05);
    const badgeBottom = badge.y + badge.height;
    // The copy band starts below the badge (measured, not estimated) and runs
    // to the panel's bottom margin.
    const band = 1080 - margin - badgeBottom;
    const drift = headline.y - badgeBottom;

    // It balanced — the stack is not packed flush under the badge…
    expect(drift).toBeGreaterThan(band * 0.05);
    // …but geometric centering (drift ≈ band / 2) is exactly the dead gap.
    expect(drift).toBeLessThan(band * 0.25);
    // …and the copy still clears the badge.
    expect(headline.y).toBeGreaterThanOrEqual(badgeBottom);
  });

  it('keeps a full copy stack packed from the top of its band', async () => {
    const doc = await composeWith(
      makePlan({
        formatTemplate: 'split-panel',
        typeScale: { headline: 160, subhead: 100, cta: 60 },
      })
    );

    // Big type fills the panel — nothing to balance, so the stack keeps
    // hugging the top of its band.
    const headline = byOrigin(doc, 'headline');
    expect(headline.y).toBe(Math.round(1080 * 0.05));
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
    // Pushed below the burst's VISIBLE box, not its raw AABB: a star only
    // paints its five points, so the collider is the 70% inner box
    // (100 + 33 inset + 154 = 287) plus the 8px floor and the +2px margin.
    expect(text.y).toBe(287 + 8 + 2);
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

  // Role-less slot ids on purpose: the copy-stack order assertion would
  // otherwise re-pack a headline/subhead pair left inverted by this cascade
  // (covered by its own test below) and hide the above-move being tested here.
  it('moves the text above the collider when there is no room below', () => {
    const doc = guardDoc([
      guardEl({
        id: 'h1',
        originId: 'block',
        x: 100,
        y: 400,
        width: 400,
        height: 600,
        text: 'Big block',
        fontSize: 40,
      }),
      guardEl({
        id: 's1',
        originId: 'note',
        x: 100,
        y: 960,
        width: 400,
        height: 80,
        text: 'Note',
        fontSize: 20,
      }),
    ]);

    const result = (realService() as any)._resolveOverlaps(doc);
    const sub = result.outputs[0].children[1];

    // Below the collider (y=1008) would overflow the canvas — the text went
    // above it instead (8px gap + the 2px margin above the floor).
    expect(sub.y).toBe(400 - 10 - 80);
    expect(sub.y + sub.height).toBeLessThanOrEqual(400);
  });

  it('keeps a nudge inside the title-safe area instead of flush with the canvas edge', () => {
    const doc = guardDoc([
      guardEl({
        id: 'b1',
        originId: 'block',
        x: 100,
        y: 900,
        width: 400,
        height: 60,
        text: 'Lower block',
        fontSize: 40,
      }),
      guardEl({
        id: 'n1',
        originId: 'note',
        x: 100,
        y: 940,
        width: 400,
        height: 80,
        text: 'Overlapping note',
        fontSize: 20,
      }),
    ]);

    const result = (realService() as any)._resolveOverlaps(doc);
    const note = result.outputs[0].children[1];

    // Below would land at 970..1050 — inside the raw 1080 canvas but past the
    // 5% title-safe bottom (1026), i.e. under the platform's UI chrome. The
    // guard measures against the safe rect, so it goes above instead.
    expect(note.y).toBe(810);
    expect(note.y + note.height).toBeLessThanOrEqual(1026);
  });

  it('re-packs a copy stack left out of role order by an above-cascade', () => {
    const doc = guardDoc([
      guardEl({
        id: 'h1',
        originId: 'headline',
        x: 100,
        y: 100,
        width: 400,
        height: 100,
        text: 'Headline',
        fontSize: 40,
      }),
      guardEl({
        id: 'p1',
        originId: 'cta-bg',
        type: 'shape',
        shape: 'rect',
        x: 100,
        y: 300,
        width: 200,
        height: 60,
        fill: '#FF4D00',
        groupId: 'cta',
      }),
      guardEl({
        id: 't1',
        originId: 'cta',
        x: 100,
        y: 300,
        width: 200,
        height: 60,
        text: 'Shop now',
        fontSize: 20,
        groupId: 'cta',
      }),
      // Collides with the CTA pill and gets nudged BELOW it — a subhead under
      // its own call to action.
      guardEl({
        id: 's1',
        originId: 'sub',
        x: 100,
        y: 290,
        width: 400,
        height: 80,
        text: 'Subhead',
        fontSize: 20,
      }),
    ]);

    const result = (realService() as any)._resolveOverlaps(doc);
    const [headline, pill, label, sub] = result.outputs[0].children;

    // Headline → subhead → CTA, re-packed top-down; the CTA pair still moves
    // as one unit.
    expect(headline.y).toBeLessThan(sub.y);
    expect(sub.y).toBeLessThan(label.y);
    expect(sub.y).toBe(210);
    expect(label.y).toBe(pill.y);
    expect(sub.y + sub.height).toBeLessThanOrEqual(label.y);
  });

  it('ranks a footer/legal line LAST when it re-packs a column', () => {
    // Without a stack rank the footer dropped out of the column entirely, so
    // a re-pack could leave it above the CTA it has to sit under.
    const doc = guardDoc([
      guardEl({
        id: 'h1',
        originId: 'headline',
        x: 100,
        y: 100,
        width: 400,
        height: 100,
        text: 'Headline',
        fontSize: 40,
      }),
      guardEl({
        id: 'l1',
        originId: 'legal',
        x: 100,
        y: 300,
        width: 400,
        height: 40,
        text: 'terms apply',
        fontSize: 16,
      }),
      // Out of order: the CTA sits BELOW the legal line.
      guardEl({
        id: 'c1',
        originId: 'cta',
        x: 100,
        y: 400,
        width: 200,
        height: 60,
        text: 'Shop now',
        fontSize: 20,
      }),
      guardEl({
        id: 's1',
        originId: 'sub',
        x: 100,
        y: 500,
        width: 400,
        height: 60,
        text: 'Subhead',
        fontSize: 20,
      }),
    ]);

    const result = (realService() as any)._resolveOverlaps(doc);
    const [headline, legal, cta, sub] = result.outputs[0].children;

    // headline → subhead → CTA → legal, top-down.
    expect(headline.y).toBeLessThan(sub.y);
    expect(sub.y).toBeLessThan(cta.y);
    expect(cta.y).toBeLessThan(legal.y);
    expect(legal.y + legal.height).toBeLessThanOrEqual(1026);
  });

  it('re-tests an earlier collider after a later one dragged the group back (fixpoint)', () => {
    const doc = guardDoc([
      guardEl({
        id: 'h1',
        originId: 'headline',
        x: 100,
        y: 100,
        width: 400,
        height: 50,
        text: 'Headline',
        fontSize: 20,
      }),
      // Group member A — clear of the headline to start (50px gap).
      guardEl({
        id: 'g1',
        originId: 'promo',
        x: 100,
        y: 200,
        width: 400,
        height: 40,
        text: 'Promo line',
        fontSize: 20,
        groupId: 'promo',
      }),
      guardEl({
        id: 'b1',
        originId: 'block',
        x: 100,
        y: 400,
        width: 400,
        height: 626,
        text: 'Wall of body copy',
        fontSize: 20,
      }),
      // Group member B collides with the wall and has no room below, so the
      // WHOLE group is moved up — dragging member A to 6px under the headline,
      // an earlier collider the single-pass sweep never re-tested.
      guardEl({
        id: 'g2',
        originId: 'promo-note',
        x: 100,
        y: 380,
        width: 400,
        height: 50,
        text: 'Promo note',
        fontSize: 60,
        groupId: 'promo',
      }),
    ]);

    const result = (realService() as any)._resolveOverlaps(doc);
    const memberA = result.outputs[0].children[1];

    // Second pass pushes the group back down to a legal 10px gap.
    expect(memberA.y).toBe(160);
    expect(memberA.y - 150).toBeGreaterThanOrEqual(8);
  });

  it('measures a star badge by its visible box, not its bounding box', () => {
    const doc = guardDoc([
      guardEl({
        id: 'e1',
        originId: 'badge-bg',
        type: 'shape',
        shape: 'star',
        x: 100,
        y: 100,
        width: 220,
        height: 220,
        fill: '#FF4D00',
      }),
      // 20px inside the star's AABB (bottom 320) but 13px clear of its
      // visible 70% box (bottom 287) — nowhere near a glyph, so no nudge.
      guardEl({
        id: 'e2',
        originId: 'headline',
        x: 120,
        y: 300,
        width: 500,
        height: 80,
        text: 'Big sale headline',
        fontSize: 40,
      }),
    ]);

    const result = (realService() as any)._resolveOverlaps(doc);

    expect(result).toBe(doc);
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

  // WAS: 'adds a scrim shape behind the first text element, clamped to the
  // canvas'. Round 8 (D2) removed the critic's ability to ADD backing shapes at
  // all — every shape it added in the corpus was a plate that stacked on each
  // revision pass and buried the photograph. The assertion is inverted: the fix
  // is dropped, and the equivalent text addition still works.
  it('drops an addElement fix that tries to insert a backing shape', async () => {
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

    // Nothing survived the screen, so no ops were applied at all.
    expect(opsOf() ?? []).toEqual([]);
  });

  it('still adds a TEXT element, clamped to the canvas', async () => {
    // The companion to the test above: text additions are the critic's
    // remaining vocabulary and keep their canvas clamp.
    const findings: VisionFinding[] = [
      {
        issue: 'Missing legal line',
        fix: {
          scope: 'shared',
          addElement: {
            slotId: 'legal',
            type: 'text',
            text: 'Terms apply',
            box: { x: -100, y: 1000, width: 2000, height: 400 },
          },
        },
      },
    ];

    await service.applyFixes(makeDoc(), findings, 'org1');

    const ops = opsOf();
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toBe('addElement');
    expect(ops[0].element.type).toBe('text');
    // Off-canvas box clamped into the 1080x1080 output.
    expect(ops[0].element.x).toBe(0);
    expect(ops[0].element.y).toBe(680);
    expect(ops[0].element.width).toBe(1080);
    expect(ops[0].element.height).toBe(400);
  });

  // Round 8 C3: the two add paths (`_buildAddElementOps` for the typed
  // fix.addElement spec, `_filterReviseOps` for freeform re-emitted ops) each
  // grew their own copy of the shape rules, and round 4's 0.6 opacity cap only
  // ever landed on the second one — so the typed path shipped a companion plate
  // at opacity 1.0. Both now go through `_hardenAddedShape`.

  it('caps the opacity of a companion shape added through the typed fix path', async () => {
    const findings: VisionFinding[] = [
      {
        issue: 'The headline needs a plate',
        fix: {
          scope: 'shared',
          addElement: {
            slotId: 'headline-bg',
            type: 'shape',
            shape: 'rect',
            box: { x: 0, y: 100, width: 1080, height: 200 },
            style: { fill: '#101010' },
          },
        },
      },
    ];

    await service.applyFixes(makeDoc(), findings, 'org1');

    const add = opsOf().find((op) => op.op === 'addElement');
    expect(add.element.type).toBe('shape');
    // Was hardcoded to 1 — the same value the OTHER path has capped since r4.
    expect(add.element.opacity).toBe(0.6);
    // And it is tucked under the copy rather than appended on top.
    expect(add.beforeElementId).toBe('e1');
  });

  it('drops a companion shape with no resolvable fill on the typed path', async () => {
    // The renderer paints a fill-less shape SOLID BLACK — the exact defect,
    // arriving by omission instead of by instruction.
    const findings: VisionFinding[] = [
      {
        issue: 'The headline needs a plate',
        fix: {
          scope: 'shared',
          addElement: {
            slotId: 'headline-bg',
            type: 'shape',
            shape: 'rect',
            box: { x: 0, y: 100, width: 1080, height: 200 },
          },
        },
      },
    ];

    await service.applyFixes(makeDoc(), findings, 'org1');

    expect(opsOf() ?? []).toEqual([]);
  });

  it('leaves no stray groupId patch behind when the shape is dropped', async () => {
    // The base's groupId backfill used to be pushed BEFORE the shape could be
    // rejected, so a dropped companion still mutated its base.
    const findings: VisionFinding[] = [
      {
        issue: 'The headline needs a plate',
        fix: {
          scope: 'shared',
          addElement: {
            slotId: 'headline-underline',
            type: 'shape',
            shape: 'line',
            box: { x: 0, y: 300, width: 1080, height: 8 },
          },
        },
      },
    ];

    await service.applyFixes(makeDoc(), findings, 'org1');

    expect(opsOf() ?? []).toEqual([]);
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

  it('survives an https:// URL in the ops end-to-end (no comment-strip mangling)', async () => {
    // repair() strips `//…` comments string-unaware BEFORE any parse, so
    // `https://` used to be mangled and could void the whole op array. The
    // parse-first helper means a valid reply never reaches repair() at all.
    const doc = makeDoc();
    model.generateText.mockResolvedValue(
      JSON.stringify([
        {
          op: 'setOutputBackground',
          outputIndex: 0,
          background: { type: 'color', color: '#123456' },
        },
        {
          op: 'updateElement',
          outputIndex: 0,
          elementId: 'e2',
          patch: {
            src: 'https://cdn.example.com/photo.png?w=10&h=20',
            borderRadius: 12,
          },
        },
      ])
    );

    const revised = await service.reviseByInstruction(
      doc,
      'recolor the background',
      'shared',
      'org1'
    );

    // The whole array applied: the background op was NOT voided by the URL in
    // a sibling op, and the image guard still stripped the protected src.
    expect((revised.outputs[0] as any).bg).toEqual({
      type: 'color',
      color: '#123456',
    });
    const image = (revised.outputs[0] as any).children.find(
      (el: any) => el.id === 'e2'
    );
    expect(image.src).toBeUndefined();
    expect(image.borderRadius).toBe(12);
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

  it('drops op types the revise prompt never sanctions (setDoc, placeImage, …)', async () => {
    // The filter is the stated backstop for the prompt's op vocabulary, but
    // any schema-valid op used to fall through to the doc: an off-script
    // reply could replace the whole doc or place an arbitrary image URL.
    const doc = makeDoc();
    model.generateText.mockResolvedValue(
      JSON.stringify([
        { op: 'removeOutput', outputIndex: 0 },
        {
          op: 'placeImage',
          outputIndex: 0,
          src: 'https://evil.example.com/tracker.png',
        },
        {
          op: 'updateElement',
          outputIndex: 0,
          elementId: 'e1',
          patch: { fill: '#222222' },
        },
      ])
    );

    const revised = await service.reviseByInstruction(
      doc,
      'darken the headline',
      'shared',
      'org1'
    );

    // The sanctioned op survived; the output was not removed and nothing was placed.
    expect(revised.outputs.length).toBe(1);
    const headline = (revised.outputs[0] as any).children.find(
      (el: any) => el.id === 'e1'
    );
    expect(headline.fill).toBe('#222222');
    expect(
      JSON.stringify(revised).includes('evil.example.com')
    ).toBe(false);
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

  // WAS: 'screens addElement shape ops: opacity cap, canvas clamp,
  // behind-the-copy insert'. Round 8 (D2): sanitizing an LLM-added plate was
  // not enough — a freeform re-emit stacked another one on every pass, and no
  // good output in the render corpus has one at all. The op is now DROPPED, so
  // the test asserts the band never lands.
  it('drops an LLM-added shape element instead of sanitizing it into a plate', async () => {
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

    const before = (makeDoc().outputs[0] as any).children.length;
    const revised = await service.reviseByInstruction(
      makeDoc(),
      'add a dark band behind the headline',
      'shared',
      'org1'
    );

    const children = (revised.outputs[0] as any).children;
    expect(
      children.find((el: any) => el.originId === 'accent-band')
    ).toBeUndefined();
    expect(children.filter((el: any) => el.type === 'shape')).toEqual([]);
    expect(children).toHaveLength(before);
  });

  it('clamps a critic-ADDED text element into the title-safe area', async () => {
    // The live defect: the plan carried no legal slot, so nothing in the
    // deterministic layout system created (or bounded) this element — the
    // vision critic added it, and it shipped flush with the canvas bottom.
    // The overlap guard's canvas clamp is x-only and its collision pass needs
    // an actual overlap, which a lone footer line has not got.
    model.generateText.mockResolvedValue(
      JSON.stringify([
        {
          op: 'addElement',
          outputIndex: 0,
          element: {
            type: 'text',
            x: 54,
            y: 1050,
            width: 400,
            height: 30,
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            text: 'northbean.shop',
            fontSize: 24,
            fill: '#111111',
            originId: 'legal',
          },
        },
      ])
    );

    const revised = await service.reviseByInstruction(
      makeDoc(),
      'add the shop URL at the bottom',
      'shared',
      'org1'
    );

    const legal = (revised.outputs[0] as any).children.find(
      (el: any) => el.originId === 'legal'
    );
    expect(legal).toBeDefined();
    // ig-square carries no platform chrome, so the safe area is the 5% inset:
    // 1026 - 30. y=1050 was legal by the canvas rule and unreadable in feed.
    expect(legal.y).toBe(996);
    expect(legal.y + legal.height).toBeLessThanOrEqual(1026);
  });

  it('keeps an added text box wider than the safe area on the canvas rule', async () => {
    // Per axis, like `smartReflow`: a full-bleed box must not be shrunk out of
    // its own layout just because it cannot fit the inset.
    model.generateText.mockResolvedValue(
      JSON.stringify([
        {
          op: 'addElement',
          outputIndex: 0,
          element: {
            type: 'text',
            x: -20,
            y: 1050,
            width: 1080,
            height: 40,
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            text: 'Full width band',
            fontSize: 24,
            fill: '#111111',
            originId: 'banner',
          },
        },
      ])
    );

    const revised = await service.reviseByInstruction(
      makeDoc(),
      'add a full-width line',
      'shared',
      'org1'
    );

    const banner = (revised.outputs[0] as any).children.find(
      (el: any) => el.originId === 'banner'
    );
    expect(banner.width).toBe(1080);
    expect(banner.x).toBe(0);
    // y still fits the safe area, so that axis keeps the safe rule.
    expect(banner.y).toBe(986);
  });
});

describe('AiDesignerComposerService.fixContrast', () => {
  const makeService = () =>
    new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    );

  /** The halo `fixContrast` applies for a light fill — zero offset, ~0.5em blur. */
  const darkHalo = (fontSize: number) => ({
    color: 'rgba(0,0,0,0.85)',
    blur: Math.max(4, Math.round(fontSize * 0.5)),
    offsetX: 0,
    offsetY: 0,
  });

  const imageryDoc = (fill: string, fontSize = 16, textShadow?: unknown) =>
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
              ...(textShadow ? { textShadow } : {}),
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

  // WAS: 'inserts a padded 0.55 scrim behind the text when neither flat fill
  // passes'. Round 8 (D2) deleted the scrim remedy — painting a flat dark
  // rectangle over the photograph satisfied the contrast predicate and wrecked
  // the design. The detection is unchanged; the CURE is now a type halo, so the
  // assertion is inverted: a shadow appears and NO scrim does.
  it('backs the text with a type halo when neither flat fill passes — and adds no scrim', () => {
    const service = makeService();
    // Mid-luma busy imagery: for 16px body text neither white (4.38:1) nor
    // near-black (4.32:1) reaches 4.5:1.
    const { doc, notes } = service.fixContrast(imageryDoc('#777777'), [
      violation(0.19),
    ]);

    const children = (doc.outputs[0] as any).children;
    const text = children.find((el: any) => el.id === 't1');

    // The cure is on the TYPE: best flat fill + a dark zero-offset halo.
    expect(text.fill).toBe('#FFFFFF');
    expect(text.textShadow).toEqual(darkHalo(16));
    // Nothing was painted over the photograph.
    expect(
      children.some((el: any) => String(el.originId ?? '').endsWith('-scrim'))
    ).toBe(false);
    expect(children.filter((el: any) => el.type === 'shape')).toEqual([]);
    expect(notes).toEqual([
      'backed "headline" with a dark type halo over the imagery',
    ]);
  });

  // WAS: 'routes a reason:"busy" violation straight to the scrim WITHOUT
  // flipping the fill'. The "don't just re-pick a flat colour" insight survives
  // — but the answer is the halo, not a slab. Flipping the fill is no longer a
  // no-op here precisely because the halo ships with it.
  it('routes a reason:"busy" violation to a type halo rather than a flat re-pick', () => {
    const service = makeService();
    // 40px text: the ratio branch alone would flip this to #FFFFFF (white reads
    // at 15:1 against the sampled mean) — but the mean is the lie. High-variance
    // imagery under the glyphs needs the halo.
    const { doc, notes } = service.fixContrast(imageryDoc('#777777', 40), [
      {
        outputIndex: 0,
        elementId: 't1',
        originId: 'headline',
        fill: '#777777',
        ratio: 15,
        backdropLuma: 0.02,
        reason: 'busy',
        backdropStdev: 92,
        crossingFraction: 0.42,
      } as any,
    ]);

    const children = (doc.outputs[0] as any).children;
    const text = children.find((el: any) => el.id === 't1');

    expect(text.fill).toBe('#FFFFFF');
    expect(text.textShadow).toEqual(darkHalo(40));
    expect(
      children.some((el: any) => String(el.originId ?? '').endsWith('-scrim'))
    ).toBe(false);
    expect(notes).toEqual([
      'backed "headline" with a dark type halo over the imagery',
    ]);
  });

  it('picks a LIGHT halo when the passing fill is the dark one', () => {
    const service = makeService();
    // Bright busy backdrop → #111111 wins the flip, so the halo inverts.
    const { doc, notes } = service.fixContrast(imageryDoc('#777777', 40), [
      {
        outputIndex: 0,
        elementId: 't1',
        originId: 'headline',
        fill: '#777777',
        ratio: 15,
        backdropLuma: 0.95,
        reason: 'busy',
      } as any,
    ]);

    const text = (doc.outputs[0] as any).children.find(
      (el: any) => el.id === 't1'
    );
    expect(text.fill).toBe('#111111');
    expect(text.textShadow).toEqual({
      color: 'rgba(255,255,255,0.85)',
      blur: 20,
      offsetX: 0,
      offsetY: 0,
    });
    expect(notes).toEqual([
      'backed "headline" with a light type halo over the imagery',
    ]);
  });

  it('routes a straddle violation to the type halo — a bare fill flip cannot read on both surfaces', () => {
    const service = makeService();
    // Worst line: near-black (the audit stamps the WORST line's luma on a
    // straddle). The plain ladder would flip to #FFFFFF — white reads ~19:1
    // against 0.005 — and ship white text on the pale band the OTHER lines
    // sit on. `straddle: true` must skip the bare flip and go straight to
    // the halo repair.
    const { doc, notes } = service.fixContrast(imageryDoc('#777777', 40), [
      {
        outputIndex: 0,
        elementId: 't1',
        originId: 'headline',
        fill: '#777777',
        ratio: 1.02,
        backdropLuma: 0.005,
        reason: 'contrast',
        straddle: true,
      } as any,
    ]);

    const children = (doc.outputs[0] as any).children;
    const text = children.find((el: any) => el.id === 't1');
    // The halo repair still flips the fill toward the worst line's surface —
    // but never alone: the opposite-colour zero-offset halo separates the
    // glyphs on the lines sitting on the other surface.
    expect(text.fill).toBe('#FFFFFF');
    expect(text.textShadow).toEqual(darkHalo(40));
    // No bare flip note, no scrim painted over the photograph.
    expect(children.filter((el: any) => el.type === 'shape')).toEqual([]);
    expect(notes).toEqual([
      'backed "headline" with a dark type halo over the imagery',
    ]);
  });

  it('still flips the fill for a reason:"contrast" violation at the same luminance', () => {
    const service = makeService();
    const { doc, notes } = service.fixContrast(imageryDoc('#777777', 40), [
      {
        outputIndex: 0,
        elementId: 't1',
        originId: 'headline',
        fill: '#777777',
        ratio: 1.2,
        backdropLuma: 0.02,
        reason: 'contrast',
      } as any,
    ]);

    const children = (doc.outputs[0] as any).children;
    expect(children.find((el: any) => el.id === 't1').fill).toBe('#FFFFFF');
    expect(
      children.some((el: any) => el.originId === 'headline-scrim')
    ).toBe(false);
    expect(notes).toEqual(['flipped "headline" to #FFFFFF over the imagery']);
  });

  // WAS: 'adjusts an existing scrim instead of layering a second one on a busy
  // re-flag'. The no-stacking guarantee is kept, but the escalation ladder in
  // front of it is new: a backing shape is now the LAST resort, reached only
  // once the halo is already on the glyphs and the audit still fails — and it
  // is a soft gradient, never a hard-edged opaque plate.
  it('escalates to a SOFT GRADIENT band only when the halo is already on and it still fails', () => {
    const service = makeService();
    const { doc, notes } = service.fixContrast(
      imageryDoc('#777777', 40, darkHalo(40)),
      [
        {
          outputIndex: 0,
          elementId: 't1',
          originId: 'headline',
          fill: '#777777',
          ratio: 15,
          backdropLuma: 0.02,
          reason: 'busy',
        } as any,
      ]
    );

    const children = (doc.outputs[0] as any).children;
    const bandIdx = children.findIndex(
      (el: any) => el.originId === 'headline-scrim'
    );
    const textIdx = children.findIndex((el: any) => el.id === 't1');
    const band = children[bandIdx];

    // Painted just before the text, fontSize 40 → 0.6em pad = 24px.
    expect(bandIdx).toBe(textIdx - 1);
    expect(band).toMatchObject({ x: 76, y: 76, width: 448, height: 88, opacity: 0.85 });
    // A soft fade, transparent at BOTH edges — not a flat opaque slab.
    expect(band.fill).toBeUndefined();
    expect(band.fillGradient).toEqual({
      type: 'linear',
      angle: 90,
      stops: [
        { offset: 0, color: 'rgba(0,0,0,0)' },
        { offset: 0.5, color: 'rgba(0,0,0,0.72)' },
        { offset: 1, color: 'rgba(0,0,0,0)' },
      ],
    });
    expect(notes).toEqual([
      'added a soft gradient behind "headline" over the imagery',
    ]);
  });

  it('adjusts the existing soft gradient instead of layering a second one', () => {
    const service = makeService();
    const doc = imageryDoc('#777777', 40, darkHalo(40));
    (doc.outputs[0] as any).children.unshift({
      id: 's1',
      originId: 'headline-scrim',
      type: 'shape',
      shape: 'rect',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
      opacity: 0.2,
      locked: false,
      hidden: false,
      fill: '#111111',
    });

    const { doc: fixed, notes } = service.fixContrast(doc, [
      {
        outputIndex: 0,
        elementId: 't1',
        originId: 'headline',
        fill: '#777777',
        ratio: 15,
        backdropLuma: 0.02,
        reason: 'busy',
      } as any,
    ]);

    const bands = (fixed.outputs[0] as any).children.filter(
      (el: any) => el.originId === 'headline-scrim'
    );
    expect(bands).toHaveLength(1);
    expect(bands[0]).toMatchObject({
      x: 76,
      y: 76,
      width: 448,
      height: 88,
      opacity: 0.85,
    });
    expect(notes).toEqual([
      'adjusted the soft gradient behind "headline" over the imagery',
    ]);
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

  /** A hero doc with a dark photo bg and a plated CTA, as a symbol instance. */
  const symbolCtaDoc = (plateFill: string, labelFill: string) =>
    ({
      mode: 'image',
      symbols: [
        {
          id: 'lockup-cta',
          name: 'cta lockup',
          width: 220,
          height: 60,
          children: [
            {
              id: 'plate',
              type: 'shape',
              shape: 'rect',
              x: 0,
              y: 0,
              width: 220,
              height: 60,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              fill: plateFill,
              borderRadius: 30,
            },
            {
              id: 'label',
              type: 'text',
              x: 10,
              y: 15,
              width: 200,
              height: 30,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: 'Shop now',
              fontSize: 20,
              fontWeight: 700,
              fill: labelFill,
            },
          ],
        },
      ],
      outputs: [
        {
          id: 'o1',
          formatId: 'ig-post',
          name: 'IG',
          width: 1080,
          height: 1080,
          background: '#000000',
          bg: { type: 'image', src: 'https://example.com/dark.png' },
          children: [
            {
              id: 'cta1',
              originId: 'cta',
              type: 'symbol',
              symbolId: 'lockup-cta',
              x: 100,
              y: 900,
              width: 220,
              height: 60,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              symbolOverrides: { label: { text: 'Shop now' } },
            },
          ],
        },
      ],
    } as any);

  it('repaints a symbol-instance CTA plate that went dark-on-dark over imagery', () => {
    const service = makeService();
    // Live: hero full-bleed, dark photo, dark accent plate — flipping the
    // label against the sampled photo (or haloing it) leaves the pair
    // dark-on-dark. The plate IS the label's backdrop, so the plate is what
    // must change.
    const { doc, notes } = service.fixContrast(
      symbolCtaDoc('#1F2937', '#111827'),
      [
        {
          outputIndex: 0,
          elementId: 'cta1::label',
          originId: 'cta',
          fill: '#111827',
          ratio: 1.1,
          backdropLuma: 0.02,
        } as any,
      ]
    );

    const instance = (doc.outputs[0] as any).children.find(
      (el: any) => el.id === 'cta1'
    );
    // Dark photo → the plate goes light; the dark label already reads on it,
    // so it is kept (no label override written).
    expect(instance.symbolOverrides.plate.fill).toBe('#FFFFFF');
    expect(instance.symbolOverrides.label.fill).toBeUndefined();
    // The wrong cures are absent: no halo on the label, no scrim shape added.
    expect(instance.textShadow).toBeUndefined();
    expect((doc.outputs[0] as any).children).toHaveLength(1);
    expect(notes).toEqual([
      'repainted the "cta" plate #1F2937 → #FFFFFF over the imagery (label #111827 kept)',
    ]);
  });

  it('flips a symbol-instance CTA label that no longer reads on the repainted plate', () => {
    const service = makeService();
    // Light label on a dark plate: the PAIR was legible, but the plate itself
    // vanishes against the dark photo — repainting the plate light flips the
    // label to its complement.
    const { doc, notes } = service.fixContrast(
      symbolCtaDoc('#1F2937', '#E5E7EB'),
      [
        {
          outputIndex: 0,
          elementId: 'cta1::label',
          originId: 'cta',
          fill: '#E5E7EB',
          ratio: 1.1,
          backdropLuma: 0.02,
        } as any,
      ]
    );

    const instance = (doc.outputs[0] as any).children.find(
      (el: any) => el.id === 'cta1'
    );
    expect(instance.symbolOverrides.plate.fill).toBe('#FFFFFF');
    expect(instance.symbolOverrides.label.fill).toBe('#111111');
    // The instance's existing label TEXT override survived the merge.
    expect(instance.symbolOverrides.label.text).toBe('Shop now');
    expect(notes).toEqual([
      'repainted the "cta" plate #1F2937 → #FFFFFF over the imagery (label #E5E7EB → #111111)',
    ]);
  });

  it('repaints the cta-bg shape of a PRE-symbol plated CTA instead of flipping the label', () => {
    const service = makeService();
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
          bg: { type: 'image', src: 'https://example.com/dark.png' },
          children: [
            {
              id: 'cta-bg',
              originId: 'cta-bg',
              type: 'shape',
              shape: 'rect',
              x: 100,
              y: 900,
              width: 220,
              height: 60,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              fill: '#1F2937',
              borderRadius: 30,
            },
            {
              id: 'cta1',
              originId: 'cta',
              type: 'text',
              x: 110,
              y: 915,
              width: 200,
              height: 30,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: 'Shop now',
              fontSize: 20,
              fontWeight: 700,
              fill: '#111827',
            },
          ],
        },
      ],
    } as any;

    const { doc: fixed, notes } = service.fixContrast(doc, [
      {
        outputIndex: 0,
        elementId: 'cta1',
        originId: 'cta',
        fill: '#111827',
        ratio: 1.1,
        backdropLuma: 0.02,
      } as any,
    ]);

    const children = (fixed.outputs[0] as any).children;
    const plate = children.find((el: any) => el.id === 'cta-bg');
    const label = children.find((el: any) => el.id === 'cta1');
    expect(plate.fill).toBe('#FFFFFF');
    expect(label.fill).toBe('#111827');
    expect(label.textShadow).toBeUndefined();
    expect(children).toHaveLength(2);
    expect(notes).toEqual([
      'repainted the "cta" plate #1F2937 → #FFFFFF over the imagery (label #111827 kept)',
    ]);
  });

  it('leaves a plated CTA whose pair reads fine to the ordinary ladder', () => {
    const service = makeService();
    // Light plate on a dark photo with a dark label: nothing about the PAIR
    // is broken, so no plate repaint — the violation must be about imagery
    // the label overhangs, which the flip/halo ladder owns.
    const doc = symbolCtaDoc('#FFFFFF', '#111111');
    const before = (doc.outputs[0] as any).children[0];

    const { notes } = service.fixContrast(doc, [
      {
        outputIndex: 0,
        elementId: 'cta1::label',
        originId: 'cta',
        fill: '#111111',
        ratio: 1.1,
        backdropLuma: 0.02,
      } as any,
    ]);

    expect(before.symbolOverrides.plate).toBeUndefined();
    expect(notes).toEqual([]);
  });

  /**
   * Two flat texts whose BOXES do not intersect (10px gap) but whose measured
   * INK does — the live "(PHONE NUMBER NEEDED)" over "Call today" defect: a
   * fitted line painted past its declared box bottom.
   */
  const inkOverlapDoc = () =>
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
              text: 'Call today',
              fontSize: 40,
            },
            {
              id: 'e2',
              originId: 'sub',
              type: 'text',
              x: 100,
              y: 160,
              width: 400,
              height: 50,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: '(PHONE NUMBER NEEDED)',
              fontSize: 20,
            },
          ],
        },
      ],
    } as any);

  const overlapViolation = (extra: Record<string, unknown> = {}) =>
    ({
      outputIndex: 0,
      elementId: 'e1',
      originId: 'headline',
      otherElementId: 'e2',
      fill: '',
      ratio: 0,
      backdropLuma: 0,
      reason: 'overlap',
      ...extra,
    } as any);

  it('separates an ink-only overlap by widening the boxes to the audit\'s ink rects', () => {
    const service = makeService();
    const input = inkOverlapDoc();
    // e1's ink runs 40px past its box bottom (150 → 190), crossing e2's box
    // (160 → 210); the declared boxes themselves never intersect.
    const inkRect = { x: 100, y: 146, width: 300, height: 44 };
    const { doc, notes } = service.fixContrast(input, [
      overlapViolation({
        inkRect,
        otherInkRect: { x: 100, y: 165, width: 250, height: 17 },
      }),
    ]);

    const children = (doc.outputs[0] as any).children;
    const headline = children.find((el: any) => el.id === 'e1');
    const sub = children.find((el: any) => el.id === 'e2');
    // e1's box now covers its former ink y-range…
    expect(headline.y).toBeLessThanOrEqual(inkRect.y);
    expect(headline.y + headline.height).toBeGreaterThanOrEqual(
      inkRect.y + inkRect.height
    );
    // …and the guard genuinely separated the pair: no box overlap remains.
    expect(sub.y).toBeGreaterThanOrEqual(headline.y + headline.height);
    expect(notes).toContain(
      'separated overlapping text the render audit caught'
    );
    // The input doc was not mutated in place.
    expect((input.outputs[0] as any).children[0].height).toBe(50);
    expect((input.outputs[0] as any).children[1].y).toBe(160);
  });

  it('still runs the plain box guard on an overlap violation without ink rects', () => {
    const service = makeService();
    // Boxes truly overlap here (e2 pulled up onto e1) — the pre-ink-rect
    // behavior: the guard separates by boxes alone, no crash.
    const input = inkOverlapDoc();
    (input.outputs[0] as any).children[1].y = 120;

    const { doc, notes } = service.fixContrast(input, [overlapViolation()]);

    const children = (doc.outputs[0] as any).children;
    const headline = children.find((el: any) => el.id === 'e1');
    const sub = children.find((el: any) => el.id === 'e2');
    expect(sub.y).toBeGreaterThanOrEqual(headline.y + headline.height);
    expect(notes).toContain(
      'separated overlapping text the render audit caught'
    );
  });

  it('skips ink rects naming elements that are gone — fail-soft', () => {
    const service = makeService();
    const input = inkOverlapDoc();

    const { doc } = service.fixContrast(input, [
      overlapViolation({
        elementId: 'ghost',
        otherElementId: 'also-gone',
        inkRect: { x: 100, y: 146, width: 300, height: 44 },
        otherInkRect: { x: 100, y: 165, width: 250, height: 17 },
      }),
    ]);

    // Nothing matched, the boxes never intersected: geometry is untouched.
    const children = (doc.outputs[0] as any).children;
    expect(children.find((el: any) => el.id === 'e1').height).toBe(50);
    expect(children.find((el: any) => el.id === 'e2').y).toBe(160);
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

describe('AiDesignerComposerService plan-fill backdrop guard', () => {
  // surface #8C7851, text #000000, accent #0A0A0A. Against the surface the
  // composer's palette-aware pick is #000000 (5.43:1) — a color the doc
  // validator (white/near-black only) would never choose, so these assertions
  // prove the COMPOSER made the call, not the downstream repair.
  const GUARD_PALETTE = ['#8C7851', '#000000', '#0A0A0A'];

  it('overrides a plan text fill painted in its own panel color', async () => {
    const plan = makePlan({
      formatTemplate: 'split-panel',
      palette: GUARD_PALETTE,
    });
    plan.slots[1].style = { fill: '#8C7851' }; // headline, == the panel surface
    const doc = await composeWith(plan);

    expect(byOrigin(doc, 'headline').fill).toBe('#000000');
  });

  it('keeps a plan text fill that reads against the panel', async () => {
    const plan = makePlan({
      formatTemplate: 'split-panel',
      palette: GUARD_PALETTE,
    });
    plan.slots[1].style = { fill: '#FFFFFF' }; // 3.87:1 on #8C7851
    const doc = await composeWith(plan);

    expect(byOrigin(doc, 'headline').fill).toBe('#FFFFFF');
  });

  it('lets the CTA/badge computed label win over the backdrop guard', async () => {
    const plan = makePlan({
      formatTemplate: 'split-panel',
      palette: GUARD_PALETTE,
    });
    plan.slots.push({ id: 'badge', role: 'badge', kind: 'badge' });
    const doc = await composeWith(plan);

    // Both labels are judged against their own SHAPE (the #0A0A0A accent),
    // not the panel beneath it — the guard must not repaint them #000000.
    expect(ctaPlate(doc).fill).toBe('#0A0A0A');
    expect(ctaLabel(doc).fill).toBe('#FFFFFF');
    expect(byOrigin(doc, 'badge').fill).toBe('#FFFFFF');
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

  // ROUND 8 (A3): the live 1584×396 geometry from
  // `.tmp-r7run3-screens/doc-*.json`. A right sidebar at x=982 w=602 placed
  // its copy at x=1002 w=562 — right edge 1564 against the format's 1504.8
  // title-safe edge — so the doc validator clamped the box to x=942.8 (the
  // fractional coordinate is its signature), 59.2px OUTSIDE the panel. The
  // escaped box then failed panel containment, got no container and reflowed
  // against the CANVAS: the seeded story spanned x=0 w=1080 across an empty
  // sidebar.
  it('keeps a wide banner\'s sidebar copy inside both the panel and the safe area', async () => {
    const doc = await composeWith(
      makePlan({ formatTemplate: 'editorial-sidebar', panelSide: 'right' }),
      [{ formatId: 'linkedin-banner', width: 1584, height: 396 }]
    );

    const sidebar = byOrigin(doc, 'editorial-sidebar-bg');
    const safeRight = 1584 * 0.95;
    for (const originId of ['headline', 'sub']) {
      const el = byOrigin(doc, originId);
      expect(el.x).toBeGreaterThanOrEqual(sidebar.x);
      expect(el.x + el.width).toBeLessThanOrEqual(sidebar.x + sidebar.width);
      // Inside the title-safe area, so the validator never has to clamp it.
      expect(el.x + el.width).toBeLessThanOrEqual(safeRight);
      // Integral: a fractional x is the validator's clamp, not a layout.
      expect(Number.isInteger(el.x)).toBe(true);
    }
  });
});

// ROUND 8 (D4): the backdrop must cover the full canvas.
//
// The round-7 regression: a plan whose imagery is a full-bleed `output.bg` and
// which carries NO image slot still had the panel layouts open with an opaque
// `style.surface` slab over one column. That painted a flat block over 38-46%
// of the photograph with a hard vertical seam — `.tmp-r7run3-screens/v1-banner`,
// `v1-yt` and `v1-igstory`, the three worst renders in the corpus. The banner
// numbers are reconstructed from `.tmp-r7run3-screens/doc-*.json`: a 1584x396
// canvas whose `editorial-sidebar-bg` rect sat at x=982, width=602 — a seam at
// 62% of the width with pure surface colour to its right.
describe('AiDesignerComposerService backdrop coverage (D4)', () => {
  const BANNER = { formatId: 'li-banner', width: 1584, height: 396 };

  /** A plan with NO image slot whose imagery is the canvas background. */
  const bgOnlyPlan = (formatTemplate: 'split-panel' | 'editorial-sidebar') =>
    makePlan({
      formatTemplate,
      background: { kind: 'image', ref: 'asset:bg' },
      slots: [
        { id: 'headline', role: 'headline', kind: 'text' },
        { id: 'sub', role: 'subhead', kind: 'text' },
      ],
    });

  const bgAssets = () => ({
    bg: {
      slotId: 'bg',
      fileId: 'f-bg',
      path: 'https://example.com/bg.png',
      type: 'image' as const,
    },
  });

  /** Opaque shapes that span the canvas top-to-bottom — the seam makers. */
  const fullHeightOpaqueShapes = (doc: any, index = 0) =>
    childrenOf(doc, index).filter(
      (el: any) =>
        el.type === 'shape' &&
        (el.opacity ?? 1) >= 1 &&
        el.y <= 0 &&
        el.height >= doc.outputs[index].height
    );

  for (const template of ['split-panel', 'editorial-sidebar'] as const) {
    it(`${template} with a full-bleed bg and no image slot paints no opaque column`, async () => {
      const doc = await composeWith(
        bgOnlyPlan(template),
        [BANNER],
        makeCopy(),
        bgAssets()
      );

      // The backdrop is the full-canvas image…
      expect(doc.outputs[0].bg).toMatchObject({ type: 'image' });
      // …and nothing punches a flat-colour column out of it.
      expect(byOrigin(doc, `${template}-bg`)).toBeUndefined();
      expect(fullHeightOpaqueShapes(doc)).toEqual([]);
    });
  }

  it('reproduces the r7 banner geometry: no 602px surface slab at x=982', async () => {
    const doc = await composeWith(
      bgOnlyPlan('editorial-sidebar'),
      [BANNER],
      makeCopy(),
      bgAssets()
    );

    const seamAt = Math.round(1584 * 0.62);
    const slab = childrenOf(doc).find(
      (el: any) => el.type === 'shape' && el.x >= seamAt - 5 && el.height >= 396
    );
    expect(slab).toBeUndefined();
  });

  it('keeps the panel slab when an image slot DOES fill the other column', async () => {
    // The control: split-panel is a layout the corpus shows we do well, and its
    // surface panel is the point of it. Only the no-image-slot case changed.
    const doc = await composeWith(makePlan({ formatTemplate: 'split-panel' }));

    const panel = byOrigin(doc, 'split-panel-bg');
    expect(panel).toBeDefined();
    expect(panel.height).toBe(1080);
    expect(byOrigin(doc, 'img')).toBeDefined();
  });

  it('keeps the panel slab over a FLAT background (no backdrop to cover)', async () => {
    // `outputBg` is defined only for a solid background — there is no full-bleed
    // backdrop to punch a hole in, so the editorial panel look survives.
    const doc = await composeWith(
      makePlan({
        formatTemplate: 'editorial-sidebar',
        background: { kind: 'solid', value: '#0A0A0A' },
        slots: [
          { id: 'headline', role: 'headline', kind: 'text' },
          { id: 'sub', role: 'subhead', kind: 'text' },
        ],
      }),
      [BANNER],
      makeCopy(),
      {}
    );

    expect(byOrigin(doc, 'editorial-sidebar-bg')).toBeDefined();
  });

  it('gives copy the over-image treatment once the panel slab is gone', async () => {
    // Without the slab the copy sits straight on the photograph, so it must get
    // the hero layout's over-image contract rather than surface-coloured text.
    const doc = await composeWith(
      bgOnlyPlan('editorial-sidebar'),
      [BANNER],
      makeCopy(),
      bgAssets()
    );

    const headline = byOrigin(doc, 'headline');
    expect(headline.fill).toBe('#FFFFFF');
  });
});

describe('AiDesignerComposerService badge position', () => {
  const badgePlan = (overrides: Partial<DesignPlan> = {}) => {
    const plan = makePlan(overrides);
    plan.slots.push({ id: 'badge', role: 'badge', kind: 'badge' });
    return plan;
  };

  it('defaults to the template corner (hero pins the badge top-right)', async () => {
    const doc = await composeWith(badgePlan());

    const shape = byOrigin(doc, 'badge-bg');
    const margin = Math.round(1080 * 0.05);
    expect(shape.y).toBe(margin);
    expect(shape.x + shape.width).toBe(1080 - margin);
  });

  it('moves the badge to the plan-requested top-left corner', async () => {
    const doc = await composeWith(badgePlan({ badgePosition: 'top-left' }));

    const shape = byOrigin(doc, 'badge-bg');
    const margin = Math.round(1080 * 0.05);
    expect(shape.x).toBe(margin);
    expect(shape.y).toBe(margin);
  });

  it('parks a bottom-corner badge on its band bottom', async () => {
    const doc = await composeWith(badgePlan({ badgePosition: 'bottom-right' }));

    const shape = byOrigin(doc, 'badge-bg');
    const text = byOrigin(doc, 'badge');
    const margin = Math.round(1080 * 0.05);
    expect(shape.y + shape.height).toBe(1080 - margin);
    expect(shape.x + shape.width).toBe(1080 - margin);
    // The label rides along with its chip.
    expect(text.y).toBeGreaterThanOrEqual(shape.y);
    expect(text.y + text.height).toBeLessThanOrEqual(shape.y + shape.height);
  });

  it('resolves the badge corner inside the split panel, not the canvas', async () => {
    const doc = await composeWith(
      badgePlan({ formatTemplate: 'split-panel', badgePosition: 'bottom-left' })
    );

    const panel = byOrigin(doc, 'split-panel-bg');
    const shape = byOrigin(doc, 'badge-bg');
    const margin = Math.round(1080 * 0.05);
    expect(shape.x).toBe(margin);
    expect(shape.x + shape.width).toBeLessThanOrEqual(panel.width);
    expect(shape.y + shape.height).toBe(1080 - margin);
  });

  it('lets the copy reclaim the top reservation when the badge sits at the bottom', async () => {
    const top = await composeWith(
      badgePlan({ formatTemplate: 'split-panel', badgePosition: 'top-left' })
    );
    const bottom = await composeWith(
      badgePlan({ formatTemplate: 'split-panel', badgePosition: 'bottom-left' })
    );

    expect(byOrigin(bottom, 'headline').y).toBeLessThan(
      byOrigin(top, 'headline').y
    );
  });

  it('stamps a plan-authored corner on the badge so it survives to other formats', async () => {
    const doc = await composeWith(
      badgePlan({ formatTemplate: 'split-panel', badgePosition: 'top-right' }),
      [SQUARE, { formatId: 'x-post', name: 'X', width: 1200, height: 675 }]
    );

    const rightGap = (index: number) => {
      const panel = byOrigin(doc, 'split-panel-bg', index);
      const shape = byOrigin(doc, 'badge-bg', index);
      expect(shape.anchor).toBe('top-right');
      return panel.x + panel.width - (shape.x + shape.width);
    };

    // The panel's right edge sits inside the CANVAS's left third, so the
    // seeded output re-derived `left` from canvas thirds and parked the badge
    // against the panel's LEFT margin. With the corner authored (and resolved
    // against the panel) it stays right-aligned, on the scaled margin.
    const square = rightGap(0);
    const wide = rightGap(1);
    expect(square).toBe(Math.round(1080 * 0.05));
    expect(Math.abs(wide - square * (1200 / 1080))).toBeLessThanOrEqual(2);
  });

  // ROUND 8 (A4): `plan.badgePosition` is a CONTRACT, `slot.style.align` is a
  // preference — and the art director emits `style.align` on essentially every
  // slot, so the plan's own corner was silently outranked (8 of 9 outputs in
  // one live run, 5 of 6 in another, rendered the badge dead centre; the ones
  // that "worked" were where the two happened to agree).
  it('lets the plan corner outrank a per-slot style.align', async () => {
    const plan = badgePlan({ badgePosition: 'top-left' });
    const badge = plan.slots.find((s) => s.id === 'badge');
    (badge as any).style = { align: 'center' };
    const doc = await composeWith(plan);

    const shape = byOrigin(doc, 'badge-bg');
    const margin = canvasMarginPx(1080, 1080);
    expect(shape.x).toBe(margin);
  });

  it('still honours style.align when the plan names no corner', async () => {
    const plan = badgePlan();
    const badge = plan.slots.find((s) => s.id === 'badge');
    (badge as any).style = { align: 'center' };
    const doc = await composeWith(plan);

    // hero's own default is top-RIGHT; with no plan contract the slot's own
    // alignment still wins.
    const shape = byOrigin(doc, 'badge-bg');
    expect(Math.abs(shape.x + shape.width / 2 - 540)).toBeLessThanOrEqual(1);
  });

  it('badge-burst ignores the plan hint — the badge IS the layout', async () => {
    const doc = await composeWith(
      badgePlan({ formatTemplate: 'badge-burst', badgePosition: 'bottom-right' })
    );

    const shape = byOrigin(doc, 'badge-bg');
    // Still the centered hero badge at ~14% of the canvas height.
    expect(shape.y).toBe(Math.round(1080 * 0.14));
    expect(Math.abs(shape.x + shape.width / 2 - 540)).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// C1 — subject-aware imagery: layout/attention-driven crop focal points
// ---------------------------------------------------------------------------

describe('AiDesignerComposerService subject-aware cropping', () => {
  const makeService = () =>
    new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    );

  // The renderer's own cover-crop, replicated so a test can assert what the
  // painted window actually contains — `focalPoint` is the crop WINDOW's
  // position within the slack, NOT "put this point at the centre", so an
  // assertion on the raw number alone can pass while cropping the wrong way.
  const cropWindow = (
    srcW: number,
    srcH: number,
    targetW: number,
    targetH: number,
    fp: { x: number; y: number }
  ) => {
    const targetRatio = targetW / targetH;
    const sw = srcW / srcH > targetRatio ? srcH * targetRatio : srcW;
    const sh = srcW / srcH > targetRatio ? srcH : srcW / targetRatio;
    const sx = (srcW - sw) * fp.x;
    const sy = (srcH - sh) * fp.y;
    return { sx, sy, sw, sh };
  };

  const WIDE_SRC = { naturalWidth: 1600, naturalHeight: 900 };

  it('defaults to dead centre when the asset says nothing about its subject', () => {
    const fp = (makeService() as any)._focalPointFor(
      { ...WIDE_SRC },
      583,
      1080
    );
    expect(fp).toEqual({ x: 0.5, y: 0.5 });
  });

  it('leans a split-panel hero right of centre without ever sliding to the edge', () => {
    // The generation prompt for split/side-by-side/editorial-sidebar says
    // "place the main subject on the right half of the frame", but the model
    // does not comply — both live generated assets measured a centroid of
    // ≈0.517. The guess therefore stays timid (0.55) and, on the live square
    // source, must NOT saturate: the old 0.75 converted to a clamped 1.0 and
    // sliced a quarter of the frame off.
    const fp = (makeService() as any)._focalPointFor(
      { ...WIDE_SRC, heroLayout: 'split-panel' },
      583,
      1080
    );

    // Direction, pinned: right of centre, and short of the rail.
    expect(fp.x).toBeGreaterThan(0.5);
    expect(fp.x).toBeLessThan(1);

    // The window it produces contains a subject sitting where the model
    // actually puts it (0.517), not where the prompt asked.
    const subjectX = 0.517 * WIDE_SRC.naturalWidth;
    const good = cropWindow(1600, 900, 583, 1080, fp);
    expect(subjectX).toBeGreaterThan(good.sx);
    expect(subjectX).toBeLessThan(good.sx + good.sw);

    // On the live 1024² square source the old 0.75 guess saturated; the rail
    // turns any such value into a plain centre crop instead of an edge slice.
    const square = (makeService() as any)._focalPointFor(
      { naturalWidth: 1024, naturalHeight: 1024, heroLayout: 'split-panel' },
      583,
      1080
    );
    expect(square.x).toBeLessThan(1);
    expect(square.x).toBeGreaterThan(0.5);
  });

  it('crops a full-bleed hero toward the TOP two-thirds', () => {
    // "Place the main subject in the upper two-thirds of the frame" (y=0.34).
    // A TALL source into a square canvas is what crops vertically.
    const tall = { naturalWidth: 900, naturalHeight: 1600 };
    const fp = (makeService() as any)._focalPointFor(
      { ...tall, heroLayout: 'hero-fullbleed' },
      1080,
      1080
    );

    expect(fp.y).toBeLessThan(0.5);
    const subjectY = 0.34 * tall.naturalHeight;
    const good = cropWindow(900, 1600, 1080, 1080, fp);
    expect(subjectY).toBeGreaterThanOrEqual(good.sy);
    expect(subjectY).toBeLessThanOrEqual(good.sy + good.sh);

    // …and sits closer to the middle of the kept band than a centre crop
    // would leave it (this axis has enough slack to matter, unlike the
    // wide-source case where the vertical crop is a no-op).
    const centred = cropWindow(900, 1600, 1080, 1080, { x: 0.5, y: 0.5 });
    expect(Math.abs(subjectY - (good.sy + good.sh / 2))).toBeLessThan(
      Math.abs(subjectY - (centred.sy + centred.sh / 2))
    );
  });

  it('prefers a measured subject centroid over the layout guess', () => {
    const fp = (makeService() as any)._focalPointFor(
      {
        ...WIDE_SRC,
        heroLayout: 'split-panel',
        // The detector actually found the subject on the LEFT.
        subjectPoint: { x: 0.2, y: 0.5 },
      },
      583,
      1080
    );

    expect(fp.x).toBeLessThan(0.5);
    const subjectX = 0.2 * WIDE_SRC.naturalWidth;
    const win = cropWindow(1600, 900, 583, 1080, fp);
    expect(subjectX).toBeGreaterThanOrEqual(win.sx);
    expect(subjectX).toBeLessThanOrEqual(win.sx + win.sw);
  });

  it('an explicit provider focalPoint (already a crop position) wins outright', () => {
    const fp = (makeService() as any)._focalPointFor(
      {
        ...WIDE_SRC,
        heroLayout: 'split-panel',
        subjectPoint: { x: 0.2, y: 0.5 },
        focalPoint: { x: 0.9, y: 0.1 },
      },
      583,
      1080
    );
    expect(fp).toEqual({ x: 0.9, y: 0.1 });
  });

  it('falls back to the raw centroid when the source dimensions are unknown', () => {
    const fp = (makeService() as any)._focalPointFor(
      { heroLayout: 'split-panel' },
      583,
      1080
    );
    // No exact conversion available; the centroid still beats dead centre.
    expect(fp).toEqual({ x: 0.55, y: 0.5 });
  });

  it('rails a centroid that would saturate back to dead centre', () => {
    // The live V2 asset: a 1024² source into the 583×1080 image column, with
    // the attention probe (correctly normalized) reporting 0.1875. The
    // conversion amplifies centroid error by srcW/slack ≈ 2.17, so that lands
    // at −0.18 and used to clamp to a hard-left 0 — an 8% slice of the frame.
    // A plain centre crop beats every saturated value.
    const fp = (makeService() as any)._focalPointFor(
      {
        naturalWidth: 1024,
        naturalHeight: 1024,
        subjectPoint: { x: 0.1875, y: 0.5 },
      },
      583,
      1080
    );
    expect(fp).toEqual({ x: 0.5, y: 0.5 });

    // Sanity: a centroid that converts inside range is NOT railed, so the
    // assertion above is not just "everything becomes 0.5".
    const inRange = (makeService() as any)._focalPointFor(
      {
        naturalWidth: 1024,
        naturalHeight: 1024,
        subjectPoint: { x: 0.517, y: 0.5 },
      },
      583,
      1080
    );
    expect(inRange.x).toBeGreaterThan(0.5);
    expect(inRange.x).toBeLessThan(1);
  });

  it('carries the subject centroid onto the element so a reflow can re-derive the crop', () => {
    const el = (makeService() as any)._imageElement(
      'img',
      { ...WIDE_SRC, subjectPoint: { x: 0.7, y: 0.5 } },
      0,
      0,
      583,
      1080
    );
    expect(el.subjectPoint).toEqual({ x: 0.7, y: 0.5 });

    // A provider-supplied focalPoint is already a crop position and is box
    // independent — no centroid, so reflow leaves it alone.
    const provided = (makeService() as any)._imageElement(
      'img',
      { ...WIDE_SRC, subjectPoint: { x: 0.7, y: 0.5 }, focalPoint: { x: 0.9, y: 0.1 } },
      0,
      0,
      583,
      1080
    );
    expect(provided.subjectPoint).toBeUndefined();
    expect(provided.focalPoint).toEqual({ x: 0.9, y: 0.1 });
  });

  it('a stock asset carries no heroLayout, so it stays centre-cropped', () => {
    const fp = (makeService() as any)._focalPointFor(
      { ...WIDE_SRC, source: 'stock' },
      583,
      1080
    );
    expect(fp).toEqual({ x: 0.5, y: 0.5 });
  });

  it('wires the layout-aware focal point (and natural size) onto the composed image element', async () => {
    const doc = await composeWith(
      makePlan({ formatTemplate: 'split-panel', panelSide: 'right' }),
      [SQUARE],
      makeCopy(),
      {
        img: {
          slotId: 'img',
          fileId: 'f1',
          path: 'https://example.com/i.png',
          type: 'image' as const,
          source: 'generate' as const,
          heroLayout: 'split-panel',
          naturalWidth: 1600,
          naturalHeight: 900,
        },
      }
    );

    const image = byOrigin(doc, 'img');
    // panelSide 'right' parks the IMAGE column on the left of the canvas —
    // the crop direction is a property of the SOURCE, not the column's side.
    expect(image.x).toBe(0);
    expect(image.naturalWidth).toBe(1600);
    expect(image.naturalHeight).toBe(900);
    expect(image.focalPoint.x).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// C2 — per-preset CTA treatments
// ---------------------------------------------------------------------------

describe('AiDesignerComposerService CTA treatments', () => {
  const ctaOf = (doc: any) => ({
    // A plated CTA is a symbol lockup: plate/label live in the definition
    // (symbol-local coordinates), the instance at originId 'cta' carries the
    // on-canvas box. An underline CTA has no definition — its label stays a
    // plain text element.
    shape: ctaPlate(doc),
    text: ctaDefinition(doc) ? ctaLabel(doc) : byOrigin(doc, 'cta'),
    instance: byOrigin(doc, 'cta'),
    shadow: byOrigin(doc, 'cta-shadow'),
    underline: byOrigin(doc, 'cta-underline'),
  });

  it('minimal: a plain rectangular CTA — square corners, no border, no shadow', async () => {
    const { shape, text, shadow } = ctaOf(
      await composeWith(makePlan({ styleId: 'minimal' }))
    );

    expect(shape.borderRadius).toBe(0);
    expect(shape.fill).toBeDefined();
    expect(shape.stroke).toBeUndefined();
    // The doc schema normalizes an absent strokeWidth to 0.
    expect(shape.strokeWidth || 0).toBe(0);
    expect(shadow).toBeUndefined();
    // The label reads against the solid fill, not the accent.
    expect(text.fill).not.toBe(shape.fill);
  });

  it('corporate: a lightly rounded rectangle (14% of height)', async () => {
    const { shape } = ctaOf(await composeWith(makePlan({ styleId: 'corporate' })));

    expect(shape.borderRadius).toBe(Math.round(shape.height * 0.14));
    expect(shape.borderRadius).toBeGreaterThan(0);
    expect(shape.borderRadius).toBeLessThan(Math.round(shape.height / 2));
  });

  it('neobrutalism: hard-edged block with a thick border AND an offset solid shadow', async () => {
    const doc = await composeWith(makePlan({ styleId: 'neobrutalism' }));
    const { shape, instance, shadow } = ctaOf(doc);

    expect(shape.borderRadius).toBe(0);
    expect(shape.stroke).toBeDefined();
    expect(shape.strokeWidth).toBeGreaterThanOrEqual(2);

    // The renderer has no shape drop-shadow — the shadow is its own rect,
    // offset from the INSTANCE's on-canvas box (the plate's own box is
    // symbol-local now).
    expect(shadow).toBeDefined();
    expect(shadow.type).toBe('shape');
    expect(shadow.width).toBe(instance.width);
    expect(shadow.height).toBe(instance.height);
    expect(shadow.x).toBeGreaterThan(instance.x);
    expect(shadow.y).toBeGreaterThan(instance.y);
    expect(shadow.x - instance.x).toBe(shadow.y - instance.y);
    expect(shadow.borderRadius).toBe(0);
    expect(shadow.groupId).toBe('cta');

    // Painted BEHIND the button instance.
    const children = childrenOf(doc);
    expect(children.indexOf(shadow)).toBeLessThan(children.indexOf(instance));
  });

  it('neon: an outline CTA — stroked, unfilled, and the label takes the accent', async () => {
    const { shape, text, shadow } = ctaOf(
      await composeWith(makePlan({ styleId: 'neon' }))
    );

    expect(shape.fill).toBeUndefined();
    expect(shape.stroke).toBeDefined();
    expect(shape.strokeWidth).toBeGreaterThanOrEqual(2);
    expect(text.fill).toBe(shape.stroke);
    expect(shape.borderRadius).toBe(Math.round(shape.height * 0.14));
    expect(shadow).toBeUndefined();
  });

  it('editorial: an underline CTA — no button shape at all', async () => {
    const { shape, text, underline } = ctaOf(
      await composeWith(makePlan({ styleId: 'editorial' }))
    );

    expect(shape).toBeUndefined();
    expect(underline).toBeDefined();
    expect(underline.type).toBe('shape');
    expect(underline.groupId).toBe('cta');
    expect(text.groupId).toBe('cta');
  });

  it('bold: the pill preset is unchanged by the new treatments', async () => {
    const { shape, shadow } = ctaOf(await composeWith(makePlan({ styleId: 'bold' })));

    expect(shape.borderRadius).toBe(Math.round(shape.height / 2));
    expect(shadow).toBeUndefined();
    expect(shape.stroke).toBeUndefined();
  });

  it('a per-slot ctaStyle override beats the preset treatment', async () => {
    // 'bold' is the pill preset; the plan asks this slot for an outline.
    const plan = makePlan({ styleId: 'bold' });
    plan.slots[3].style = { ctaStyle: 'outline' };
    const { shape, text } = ctaOf(await composeWith(plan));

    expect(shape.fill).toBeUndefined();
    expect(shape.stroke).toBeDefined();
    expect(text.fill).toBe(shape.stroke);
  });

  it('outline CTA: an accent that fails the surface gets a readable label', async () => {
    // An outline button paints no fill, so its label sits on the surface —
    // but the label fill was the stroke accent BY CONSTRUCTION, so the pair
    // was never checked against anything. #FFE100 on #FFFFFF is 1.31:1.
    const plan = makePlan({ palette: ['#FFFFFF', '#111111', '#FFE100'] });
    plan.slots[3].style = { ctaStyle: 'outline' };
    const { shape, text } = ctaOf(await composeWith(plan));

    expect(shape.fill).toBeUndefined();
    expect(shape.stroke).toBe('#FFE100');
    expect(text.fill).not.toBe(shape.stroke);
    expect(text.fill).toBe('#111111');
  });

  it('outline CTA: an accent that reads against the surface keeps it', async () => {
    // #8A0F55 on #FFFFFF is 9.2:1 — the accent label is the intended look
    // and the guard must not repaint it.
    const plan = makePlan({ palette: ['#FFFFFF', '#111111', '#8A0F55'] });
    plan.slots[3].style = { ctaStyle: 'outline' };
    const { shape, text } = ctaOf(await composeWith(plan));

    expect(shape.stroke).toBe('#8A0F55');
    expect(text.fill).toBe(shape.stroke);
  });

  it('a per-slot ctaStyle:"underline" override drops the button on a pill preset', async () => {
    const plan = makePlan({ styleId: 'bold' });
    plan.slots[3].style = { ctaStyle: 'underline' };
    const { shape, underline } = ctaOf(await composeWith(plan));

    expect(shape).toBeUndefined();
    expect(underline).toBeDefined();
  });

  it('a per-slot ctaStyle:"pill" override rounds a square-cornered preset', async () => {
    const plan = makePlan({ styleId: 'neobrutalism' });
    plan.slots[3].style = { ctaStyle: 'pill' };
    const { shape } = ctaOf(await composeWith(plan));

    // ctaStyle 'pill' wins over the preset's `ctaRadius: 'square'`.
    expect(shape.borderRadius).toBe(Math.round(shape.height / 2));
  });

  it('moves the neobrutalism shadow with the button when a geometry fix hits the slot', () => {
    const service = new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    );
    const out = {
      width: 1080,
      height: 1080,
      children: [
        {
          id: 't1',
          originId: 'cta',
          type: 'text',
          x: 100,
          y: 400,
          width: 300,
          height: 48,
          text: 'Shop now',
          fontSize: 30,
        },
      ],
    } as any;
    const shadow = { originId: 'cta-shadow' } as any;

    const patch = (service as any)._deriveCompanionGeometry(out, shadow, 'cta', {
      x: 100,
      y: 400,
      width: 300,
      height: 48,
    });

    // The shadow IS the button box, offset — the button box is the label box
    // exactly, so no badge inset applies here.
    const offset = Math.max(3, Math.round(30 * 0.18));
    expect(patch).toEqual({
      x: 100 + offset,
      y: 400 + offset,
      width: 300,
      height: 48,
    });
  });

  it('drags the whole neobrutalism CTA stack (shadow included) through applyFixes', async () => {
    const docService = {
      applyOps: vi.fn((doc: unknown, ops: unknown[]) => ({
        ...(doc as object),
        appliedOps: ops,
      })),
    };
    const service = new AiDesignerComposerService(
      docService as any,
      { generateText: vi.fn() } as any
    );
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
            { id: 'sh', originId: 'cta-shadow', type: 'shape', x: 106, y: 406, width: 300, height: 48 },
            { id: 'bg', originId: 'cta-bg', type: 'shape', x: 100, y: 400, width: 300, height: 48 },
            { id: 'la', originId: 'cta', type: 'text', x: 100, y: 400, width: 300, height: 48, fontSize: 30, text: 'Shop now' },
          ],
        },
      ],
    } as any;

    await service.applyFixes(
      doc,
      [
        {
          issue: 'CTA runs off the canvas',
          slotId: 'cta',
          fix: { scope: 'shared', targetSlots: ['cta'], geometry: { y: 600 } },
        } as VisionFinding,
      ],
      'org1'
    );

    const ops = docService.applyOps.mock.calls[0][1] as any[];
    const byId = Object.fromEntries(ops.map((op) => [op.elementId, op.patch]));
    const offset = Math.max(3, Math.round(30 * 0.18));
    expect(byId['la']).toMatchObject({ y: 600 });
    expect(byId['bg']).toMatchObject({ y: 600 });
    expect(byId['sh']).toMatchObject({ y: 600 + offset });
  });
});

// The headline fix of round 7: a channel variant is the SAME design re-fit to a
// different canvas. Type used to be derived from `Math.min(w, h)`, so a 1200×675
// seeded from a 1080² — a canvas 11% WIDER than the one it came from — was
// typeset for its 675 short edge (a lone 41px headline in a 432px panel).
describe('AiDesignerComposerService aspect-aware type basis', () => {
  const scaleFor = (w: number, h: number, layout: string) => {
    const service = new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    ) as any;
    const plan = makePlan({ formatTemplate: layout });
    return service._typeScalePx(
      plan,
      service._resolveStyle(plan),
      w,
      h,
      layout
    );
  };

  // The table that pins the basis. Square canvases are UNCHANGED by
  // construction (geometric mean === short edge at 1:1); the 16:9 case is the
  // live x-post; 1584×396 is the LinkedIn banner, the 4:1 extreme.
  it('sizes type from the canvas geometric mean, not its short edge', () => {
    expect(scaleFor(1080, 1080, 'hero-fullbleed')).toEqual({
      headline: 92,
      subhead: 39,
      cta: 30,
      legal: 15,
    });
    expect(scaleFor(1200, 675, 'hero-fullbleed')).toEqual({
      headline: 70,
      subhead: 30,
      cta: 23,
      legal: 11,
    });
    expect(scaleFor(1584, 396, 'hero-fullbleed')).toEqual({
      headline: 41,
      subhead: 17,
      cta: 14,
      legal: 8,
    });

    // split-panel is the live case: the 41px headline becomes 55px.
    expect(scaleFor(1080, 1080, 'split-panel')).toEqual({
      headline: 66,
      subhead: 35,
      cta: 30,
      legal: 11,
    });
    expect(scaleFor(1200, 675, 'split-panel')).toEqual({
      headline: 55,
      subhead: 29,
      cta: 25,
      legal: 9,
    });
    // ROUND 8 (A2): 34 → 48. A panel layout owns the full column between the
    // margins, so its vertical budget (1239px of basis on this canvas) never
    // binds — the 34 was the layout-BLIND √2 aspect cap, which suppressed this
    // canvas by 30% for a stack that had all the room it needed.
    expect(scaleFor(1584, 396, 'split-panel')).toEqual({
      headline: 48,
      subhead: 25,
      cta: 22,
      legal: 8,
    });
  });

  it('never types a canvas SMALLER than the old short-edge basis did', () => {
    // headline px under `Math.min(w, h) * 0.085 * LAYOUT_TYPE_SCALE`, floored
    // by the old role floor — what every canvas shipped before the basis.
    const before: Record<string, Record<string, number>> = {
      'hero-fullbleed': { '1080x1080': 92, '1200x675': 57, '1584x396': 34 },
      'split-panel': { '1080x1080': 66, '1200x675': 41, '1584x396': 24 },
      'minimal-centered': { '1080x1080': 83, '1200x675': 52, '1584x396': 30 },
      'top-bottom': { '1080x1080': 73, '1200x675': 46, '1584x396': 27 },
      'badge-burst': { '1080x1080': 87, '1200x675': 55, '1584x396': 32 },
      'editorial-sidebar': { '1080x1080': 66, '1200x675': 41, '1584x396': 24 },
    };
    for (const [layout, sizes] of Object.entries(before)) {
      for (const [canvas, headline] of Object.entries(sizes)) {
        const [w, h] = canvas.split('x').map(Number);
        expect(scaleFor(w, h, layout).headline).toBeGreaterThanOrEqual(
          headline
        );
      }
    }
    // …and a square canvas is byte-identical, not merely no-smaller.
    expect(scaleFor(1080, 1080, 'hero-fullbleed').headline).toBe(92);
  });

  it('keeps a 4:1 banner\'s whole copy stack inside its 396px canvas', async () => {
    // The geometric mean alone (792 for 1584×396) would size a headline whose
    // headline+subhead+CTA rhythm no longer fits the band — the layout's own
    // vertical budget pulls the basis back.
    const doc = await composeWith(makePlan(), [
      { formatId: 'li-banner', width: 1584, height: 396 },
    ]);
    for (const el of childrenOf(doc)) {
      expect(el.y).toBeGreaterThanOrEqual(0);
      expect(el.y + el.height).toBeLessThanOrEqual(396);
    }
    // And the copy is still legibly bigger than the 34px the short edge gave.
    expect(byOrigin(doc, 'headline').fontSize).toBeGreaterThan(34);
  });

  // ROUND 8 (A2): compose and reflow must measure a canvas the SAME way. The
  // banner composes at its layout's budgeted basis (486, not the 792 geometric
  // mean), so seeding from it has to divide by 486 — dividing by 792 shipped
  // every sibling format 1.63× too small.
  it('seeds sibling formats from the basis the primary actually composed at', async () => {
    const doc = await composeWith(makePlan(), [
      { formatId: 'linkedin-banner', width: 1584, height: 396 },
      { formatId: 'ig-post', name: 'IG', width: 1080, height: 1080 },
    ]);

    // The budget the primary was typeset under, carried onto the seed.
    expect((doc.outputs[0] as any).typeBudget).toBeCloseTo(
      0.49 / (4.705 * 0.085),
      6
    );
    expect((doc.outputs[1] as any).typeBudget).toBe(
      (doc.outputs[0] as any).typeBudget
    );

    const banner = byOrigin(doc, 'headline', 0).fontSize;
    const square = byOrigin(doc, 'headline', 1).fontSize;
    // A square composed fresh in this layout is 92px; the seed lands within a
    // rounding step of it, instead of the 56px the unbudgeted basis gave.
    expect(square).toBeGreaterThanOrEqual(88);
    expect(square / banner).toBeGreaterThan(2);
  });
});

describe('AiDesignerComposerService poster-left composition', () => {
  it('stacks left-aligned copy at the top over a left scrim', async () => {
    const doc = await composeWith(makePlan({ composition: 'poster-left' }));
    const headline = byOrigin(doc, 'headline');
    expect(headline.align).toBe('left');
    // Top-anchored: the headline sits in the top quarter, not the hero's lower third.
    expect(headline.y).toBeLessThan(1080 * 0.25);

    const scrim = byOrigin(doc, 'poster-left-scrim');
    expect(scrim).toBeDefined();
    expect(scrim.fillGradient.stops[0].color).toContain('rgba(0,0,0');
    // The scrim covers the copy's side only, and sits above the image, below the copy.
    expect(scrim.width).toBeLessThan(1080);
    const children = childrenOf(doc);
    const z = (oid: string) => children.findIndex((el) => el.originId === oid);
    expect(z('poster-left-scrim')).toBeGreaterThan(z('img'));
    expect(z('poster-left-scrim')).toBeLessThan(z('headline'));
  });

  it('honours a slot-level script accent: fontFamily and fill override the preset', async () => {
    const plan = makePlan({ composition: 'poster-left' });
    plan.slots.push({
      id: 'kicker',
      role: 'subhead',
      kind: 'text',
      style: { fontFamily: 'Dancing Script', fill: '#FFD400' },
    } as any);
    const doc = await composeWith(plan, undefined, {
      ...makeCopy(),
      kicker: 'Traditional',
    });
    const kicker = byOrigin(doc, 'kicker');
    expect(kicker.fontFamily).toBe('Dancing Script');
    expect(kicker.fill).toBe('#FFD400');
  });

  it('rides an accent-role slot ABOVE the headline — poster grammar', async () => {
    // The kicker/script line ("Italian" over "PIZZA") is not a subhead
    // variant: bound to the subhead role it stacked under the headline and
    // every reference with a top kicker composed wrong.
    const plan = makePlan({ composition: 'poster-left' });
    plan.slots.push({
      id: 'kicker',
      role: 'accent',
      kind: 'text',
      style: { fontFamily: 'Great Vibes', fill: '#E2B84B' },
    } as any);
    const doc = await composeWith(plan, undefined, {
      ...makeCopy(),
      kicker: 'Italian',
    });
    const kicker = byOrigin(doc, 'kicker');
    const headline = byOrigin(doc, 'headline');
    expect(kicker).toBeDefined();
    expect(kicker.y).toBeLessThan(headline.y);
    expect(headline.y).toBeLessThan(1080 * 0.35);
  });

  it('treats a copy slot hidden with opacity: 0 as ABSENT, plate included', async () => {
    // The planner's way of saying "the reference has no CTA" was a cta slot
    // with style.opacity 0 — the label took the 0 while the plate painted at
    // full strength, and an empty red pill shipped.
    const plan = makePlan({ composition: 'poster-left' });
    const cta = plan.slots.find((s) => s.id === 'cta')!;
    (cta as any).style = { opacity: 0 };
    const doc = await composeWith(plan);
    const children = childrenOf(doc);
    expect(children.some((el) => (el.originId || '') === 'cta')).toBe(false);
    expect(children.some((el) => (el.originId || '') === 'cta-bg')).toBe(false);
  });

  it('rotates a badge UNIT rigidly — label and ribbon plate together', async () => {
    // The label is the only member whose originId IS the slot id, so a
    // plan-level `rotation` patched the label alone: the text swung off the
    // flat plate (a sticker-pop badge shipped exactly that, label at -6°
    // hanging above its ribbon).
    const plan = makePlan({ composition: 'poster-left' });
    plan.slots.push({
      id: 'badge',
      role: 'badge',
      kind: 'badge',
      style: { badgeStyle: 'ribbon' },
      rotation: -6,
    } as any);
    const doc = await composeWith(plan);

    const label = byOrigin(doc, 'badge');
    expect(label.rotation).toBe(-6);
    const plate = byOrigin(doc, 'badge-bg');
    // The plate's painted centre must still sit on the label's centre —
    // rotated rigidly about the same pivot, they cannot separate.
    const ys = plate.nodes.map((n: any) => n.y);
    const xs = plate.nodes.map((n: any) => n.x);
    const plateCx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const plateCy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const labelCx = label.x + label.width / 2;
    const labelCy = label.y + label.height / 2;
    // Rotating a wide flat unit by 6° moves the extremes most; the centres
    // stay within a few px of each other.
    expect(Math.abs(plateCx - labelCx)).toBeLessThan(15);
    expect(Math.abs(plateCy - labelCy)).toBeLessThan(15);
  });

  it('grows a short display headline toward its column', async () => {
    // The role ratios size a headline for the average multi-word line — a
    // two-word sale headline at that size reads as a caption on an empty
    // poster ("B1G1 FREE" shipped at 83px on a 1080 white canvas).
    const plan = makePlan({ composition: 'poster-left' });
    const doc = await composeWith(plan, undefined, {
      ...makeCopy(),
      headline: 'SALE',
    });
    const headline = byOrigin(doc, 'headline');
    expect(headline.fontSize).toBeGreaterThan(150);
  });

  it('leaves an ordinary multi-word headline at its ratio size', async () => {
    // Fill-grow must not churn every layout: a headline that already covers
    // half its column keeps the ratio-sized result.
    const doc = await composeWith(makePlan({ composition: 'poster-left' }));
    expect(byOrigin(doc, 'headline').fontSize).toBeLessThan(150);
  });

  it('reads slot-id-keyed typeScale hints as within-role ratios', async () => {
    // The planner ranks lines WITHIN a role (`typeScale: { echo: 0.5 }` —
    // the second PIZZA under the big one); only the four role keys reached
    // `_typeScalePx`, so the echo composed at full headline size.
    const plan = makePlan({
      composition: 'poster-left',
      typeScale: { echo: 0.5 } as any,
    });
    plan.slots.push({ id: 'echo', role: 'headline', kind: 'text' } as any);
    const doc = await composeWith(plan, undefined, {
      ...makeCopy(),
      echo: 'PIZZA',
    });
    const headline = byOrigin(doc, 'headline');
    const echo = byOrigin(doc, 'echo');
    expect(
      Math.abs(echo.fontSize - Math.round(headline.fontSize * 0.5))
    ).toBeLessThanOrEqual(2);
  });

  it('re-anchors copy-anchored decor when a critic fix moves the copy', async () => {
    // The rule under the headline is a pure function of the headline's box;
    // a geometry fix that moved the headline used to leave the rule floating
    // where the headline WAS — a red streak across the photo, live.
    const doc = await composeWith(makePlan({ composition: 'poster-left', decor: ['rule'] } as any));
    const ruleY = (d: any) =>
      Math.min(
        ...(childrenOf(d).find((el) => el.originId === 'decor-rule')?.nodes ?? [{ y: Infinity }])
          .map((n: any) => n.y)
      );

    const fixed = await new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    ).applyFixes(doc, [
      {
        issue: 'headline too high',
        fix: { scope: 'shared', targetSlots: ['headline'], geometry: { y: 300 } },
      },
    ] as any, 'org1');

    // Wherever the stack settles, the rule sits in the gap directly under the
    // headline's FINAL box — re-emitted, not left where the headline was —
    // and capped by the room above the next line.
    const h = byOrigin(fixed, 'headline');
    const subY = byOrigin(fixed, 'sub').y;
    const rY = ruleY(fixed);
    expect(rY).toBeGreaterThanOrEqual(h.y + h.height);
    expect(rY).toBeLessThan(subY);
  });

  it('carves the copy band from a ribbon badge’s PAINTED extent, not its canvas-sized path box', async () => {
    // The ribbon plate is a closed path on the emit-decor contract: a
    // canvas-sized box with absolute nodes. Carving the band from that box
    // started it below the bottom edge and the whole stack collapsed into the
    // overlap guard's bottom re-pack — a live pizza-clone run composed its
    // "poster-left" stack at y=755 with the subhead off-canvas.
    const plan = makePlan({ composition: 'poster-left' });
    plan.slots.push({
      id: 'badge',
      role: 'badge',
      kind: 'badge',
      style: { badgeStyle: 'ribbon' },
    } as any);
    const doc = await composeWith(plan);

    const plate = byOrigin(doc, 'badge-bg');
    expect(plate.type).toBe('path');
    // The contract that broke the carve: the plate's box really is the canvas.
    expect(plate.width).toBe(1080);
    expect(plate.height).toBe(1080);

    // Top-anchored regardless: the headline sits in the top quarter.
    const headline = byOrigin(doc, 'headline');
    expect(headline.y).toBeLessThan(1080 * 0.25);
    expect(byOrigin(doc, 'sub').y).toBeGreaterThan(headline.y);
    expect(byOrigin(doc, 'sub').y).toBeLessThan(1080 * 0.5);
  });
});

describe('AiDesignerComposerService seeded-output re-fit', () => {
  const X_POST = { formatId: 'x-post', width: 1200, height: 675 };

  const seedAndRefit = async (plan: DesignPlan) => {
    const service = new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    );
    const seeded = await service.compose({
      plan,
      copy: makeCopy(),
      assets: makeAssets(),
      outputs: [SQUARE, X_POST],
      orgId: 'o1',
      userId: 'u1',
    } as any);
    return { seeded, refit: service.refitSeededOutputs(seeded) };
  };

  /** Largest empty vertical run between consecutive copy units in the band. */
  const largestGap = (els: any[]) => {
    const sorted = [...els].sort((a, b) => a.y - b.y);
    let gap = 0;
    for (let i = 1; i < sorted.length; i++) {
      const prevBottom = Math.max(
        ...sorted.slice(0, i).map((el) => el.y + el.height)
      );
      gap = Math.max(gap, sorted[i].y - prevBottom);
    }
    return gap;
  };

  it('closes the dead bands independent per-element anchoring opens', () => {
    const service = new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    );
    const text = (over: any) => ({
      type: 'text',
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      ...over,
    });
    // A copy column that the seed scattered: the headline anchored to the top
    // of the new canvas, the subhead to its centre, the CTA to the bottom —
    // the 26.7% / 24.9% voids measured on the live x-post.
    const doc: any = {
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
            text({ id: 'a1', originId: 'headline', x: 54, y: 267, width: 972, height: 165, fontSize: 66, text: 'Big launch' }),
            text({ id: 'a2', originId: 'sub', x: 54, y: 462, width: 972, height: 63, fontSize: 35, text: 'Now brewing' }),
            text({ id: 'a3', originId: 'cta', x: 54, y: 541, width: 400, height: 63, fontSize: 30, text: 'Shop now' }),
          ],
        },
        {
          id: 'o2',
          formatId: 'x-post',
          name: 'X',
          width: 1200,
          height: 675,
          background: '#ffffff',
          children: [
            text({ id: 'b1', originId: 'headline', x: 60, y: 34, width: 810, height: 138, fontSize: 55, text: 'Big launch' }),
            text({ id: 'b2', originId: 'sub', x: 60, y: 300, width: 810, height: 53, fontSize: 29, text: 'Now brewing' }),
            text({ id: 'b3', originId: 'cta', x: 60, y: 600, width: 333, height: 53, fontSize: 25, text: 'Shop now' }),
          ],
        },
      ],
    };

    const before = largestGap(doc.outputs[1].children);
    const wide = service.refitSeededOutputs(doc).outputs[1] as any;
    const after = largestGap(wide.children);

    // Before: a 247px void (37% of the canvas) between the subhead and the
    // CTA. After: the composer's own rhythm gap (round(fontSize × 0.45)).
    expect(before).toBeGreaterThan(675 * 0.3);
    expect(after).toBeLessThan(675 * 0.08);
    // The column is packed top-down inside the band and balanced into it, so
    // it neither hugs the top margin nor spills past the bottom one.
    const margin = canvasMarginPx(1200, 675);
    const sorted = [...wide.children].sort((a: any, b: any) => a.y - b.y);
    expect(sorted[0].y).toBeGreaterThan(margin);
    expect(sorted[2].y + sorted[2].height).toBeLessThanOrEqual(675 - margin);
    // …and the column is re-margined to the target canvas on both sides.
    expect(sorted[0].x).toBe(margin);
    expect(sorted[0].x + sorted[0].width).toBe(1200 - margin);
  });

  it('keeps the copy column tight inside the band it is re-fit into', async () => {
    const plan = makePlan({ formatTemplate: 'split-panel' });
    plan.slots.push({ id: 'badge', role: 'badge', kind: 'badge' });
    const { refit } = await seedAndRefit(plan);
    const copy = (refit.outputs[1] as any).children.filter((el: any) =>
      ['headline', 'sub', 'cta', 'cta-bg'].includes(el.originId)
    );
    expect(largestGap(copy)).toBeLessThan(675 * 0.08);
  });

  it('still re-fits a doc carrying a bottom-anchored footer', async () => {
    // A footer is bottom-anchored like a bottom badge but carves the band
    // from the OTHER end. Counted as a badge it made the badge bounding box
    // span the whole panel (top badge + bottom footer), the carve returned a
    // zero-height band, and the whole re-fit was silently skipped.
    const plan = makePlan({ formatTemplate: 'split-panel' });
    plan.slots.push({ id: 'badge', role: 'badge', kind: 'badge' } as any);
    plan.slots.push({ id: 'legal', role: 'legal', kind: 'text' } as any);
    const service = new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    );
    const seeded = await service.compose({
      plan,
      copy: { ...makeCopy(), legal: 'northbean.shop' },
      assets: makeAssets(),
      outputs: [SQUARE, X_POST],
      orgId: 'o1',
      userId: 'u1',
    } as any);
    const refit = service.refitSeededOutputs(seeded);

    expect(refit).not.toBe(seeded);
    const wide = (refit.outputs[1] as any).children;
    const legal = wide.find((el: any) => el.originId === 'legal');
    const copy = wide.filter((el: any) =>
      ['headline', 'sub', 'cta', 'cta-bg', 'cta-underline'].includes(
        el.originId
      )
    );
    const margin = canvasMarginPx(1200, 675);
    // The footer keeps the bottom margin and the column stays above it.
    expect(legal.y + legal.height).toBe(675 - margin);
    expect(Math.max(...copy.map((el: any) => el.y + el.height))).toBeLessThan(
      legal.y
    );
    expect(largestGap(copy)).toBeLessThan(675 * 0.08);
  });

  it('re-derives the margins for the target canvas instead of scaling them', async () => {
    const { refit } = await seedAndRefit(
      makePlan({ formatTemplate: 'split-panel' })
    );
    const wide = refit.outputs[1] as any;
    const panel = wide.children.find(
      (el: any) => el.originId === 'split-panel-bg'
    );
    const headline = wide.children.find(
      (el: any) => el.originId === 'headline'
    );
    // The canvas's OWN margin — round(typeBasis(1200, 675) × 0.05) = 45 — on
    // both sides of the panel, not the 60/34 anisotropy a per-axis scale
    // leaves. (A1: off the type basis, not the short edge.)
    const margin = canvasMarginPx(1200, 675);
    expect(headline.x - panel.x).toBe(margin);
    expect(panel.x + panel.width - (headline.x + headline.width)).toBe(margin);
    expect(headline.y).toBeGreaterThanOrEqual(margin);
  });

  it('re-fits without recomposing: ids, originIds, copy and z-order survive', async () => {
    const { seeded, refit } = await seedAndRefit(
      makePlan({ formatTemplate: 'split-panel' })
    );
    const before = (seeded.outputs[1] as any).children;
    const after = (refit.outputs[1] as any).children;
    expect(after.map((el: any) => el.id)).toEqual(
      before.map((el: any) => el.id)
    );
    expect(after.map((el: any) => el.originId)).toEqual(
      before.map((el: any) => el.originId)
    );
    expect(after.map((el: any) => el.text)).toEqual(
      before.map((el: any) => el.text)
    );
  });

  it('leaves a single-format doc alone', async () => {
    const service = new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    );
    const doc = await composeWith(makePlan());
    expect(service.refitSeededOutputs(doc)).toBe(doc);
  });

  it('re-emits headline-anchored decor against the re-fit headline', async () => {
    // A rule emitted under the primary's headline cannot ride the seed: a
    // full-canvas path scales 1:1 onto any other canvas, so the mark stayed
    // where the PRIMARY'S copy was. It is re-emitted against the re-fit
    // headline instead.
    const plan = makePlan({ formatTemplate: 'minimal-centered' });
    (plan as any).decor = ['rule'];
    const { refit } = await seedAndRefit(plan);
    const wide = (refit.outputs[1] as any).children;
    const headline = wide.find((el: any) => el.originId === 'headline');
    const decor = wide.find((el: any) => el.originId === 'decor-rule');
    expect(decor).toBeDefined();
    const nodeYs = (decor.nodes || []).map((n: any) => decor.y + n.y);
    // Under the re-fit headline, close beneath it — not wherever the primary's
    // headline happened to sit.
    expect(Math.min(...nodeYs)).toBeGreaterThanOrEqual(
      headline.y + headline.height
    );
    expect(Math.min(...nodeYs)).toBeLessThan(
      headline.y + headline.height + headline.height
    );
  });
});

// Round 7 C2: `background.ref` naming a slot no assetNeed produced used to
// fall straight through to a flat #1f2937 — live, a plan asked for
// `asset:image-bg-01` while its own need was for slot `image`.
describe('AiDesignerComposerService dangling background ref (round 7 C2)', () => {
  const makeService = () =>
    new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    );

  const oneAsset = {
    'v1:image:square': {
      slotId: 'v1:image',
      fileId: 'f-img',
      path: 'https://example.com/img.png',
      type: 'image' as const,
      aspect: 'square' as const,
    },
  };

  it('uses the variant\'s only image when the ref resolves nothing', () => {
    const service = makeService();
    const bg = (service as any)._backgroundToDesignerBg(
      { kind: 'image', ref: 'asset:image-bg-01' },
      oneAsset,
      SQUARE,
      'v1'
    );

    expect(bg.bg).toMatchObject({
      type: 'image',
      src: 'https://example.com/img.png',
      fileId: 'f-img',
    });
    expect(bg.background).toBe('#000000');
  });

  it('keeps the solid fallback when two distinct images could be meant', () => {
    const service = makeService();
    const warnSpy = vi
      .spyOn((service as any)._logger, 'warn')
      .mockImplementation(() => undefined);

    const bg = (service as any)._backgroundToDesignerBg(
      { kind: 'image', ref: 'asset:image-bg-01' },
      {
        ...oneAsset,
        'v1:product:square': {
          slotId: 'v1:product',
          fileId: 'f-prod',
          path: 'https://example.com/prod.png',
          type: 'image' as const,
          aspect: 'square' as const,
        },
      },
      SQUARE,
      'v1'
    );

    expect(bg.bg).toBeUndefined();
    expect(bg.background).toBe('#1f2937');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('2 distinct images are available'),
      expect.anything()
    );
  });

  it('ignores another variant\'s images (scoped by variantId)', () => {
    const service = makeService();
    const bg = (service as any)._backgroundToDesignerBg(
      { kind: 'image', ref: 'asset:nope' },
      {
        'v2:image:square': {
          slotId: 'v2:image',
          fileId: 'f-other',
          path: 'https://example.com/other.png',
          type: 'image' as const,
          aspect: 'square' as const,
        },
      },
      SQUARE,
      'v1'
    );

    expect(bg.bg).toBeUndefined();
    expect(bg.background).toBe('#1f2937');
  });

  it('refuses to steal a sibling slot\'s image when the plan asked for two', () => {
    // The other single-asset shape: the plan wanted a background AND a product
    // shot and the BACKGROUND generation failed. Promoting the product to a
    // full-bleed background would then delete the product element
    // (`_dropBackgroundDuplicateImages`) and destroy the composition.
    const service = makeService();
    const warnSpy = vi
      .spyOn((service as any)._logger, 'warn')
      .mockImplementation(() => undefined);

    const bg = (service as any)._backgroundToDesignerBg(
      { kind: 'image', ref: 'asset:background' },
      {
        'v1:product:square': {
          slotId: 'v1:product',
          fileId: 'f-prod',
          path: 'https://example.com/prod.png',
          type: 'image' as const,
          aspect: 'square' as const,
        },
      },
      SQUARE,
      'v1',
      2
    );

    expect(bg.bg).toBeUndefined();
    expect(bg.background).toBe('#1f2937');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('the plan asked for 2 images'),
      expect.anything()
    );
  });

  it('a resolvable ref still wins over the rescue path', () => {
    const service = makeService();
    const bg = (service as any)._backgroundToDesignerBg(
      { kind: 'image', ref: 'asset:image' },
      oneAsset,
      SQUARE,
      'v1'
    );
    expect(bg.bg).toMatchObject({ fileId: 'f-img' });
  });

  it('rescues end-to-end without shipping the same picture twice', async () => {
    // A dangling ref PLUS an image slot on the same asset: the rescue makes
    // the background the picture, and `_dropBackgroundDuplicateImages` must
    // then remove the element so it is not painted on top of itself.
    const doc = await composeWith(
      makePlan({ background: { kind: 'image', ref: 'asset:image-bg-01' } }),
      [SQUARE],
      makeCopy(),
      makeAssets()
    );

    expect((doc.outputs[0] as any).bg).toMatchObject({
      type: 'image',
      fileId: 'f1',
    });
    expect(
      childrenOf(doc).filter((el) => el.type === 'image' && el.fileId === 'f1')
    ).toHaveLength(0);
  });
});

// Round 7 C6: a format-only fix whose formatId was missing or unknown
// returned `[]` behind a `logger.warn` — a silent no-op. Nothing derived a
// formatId from the request's own `targetOutputs` either.
describe('AiDesignerComposerService format-only scope resolution (round 7 C6)', () => {
  const service = () =>
    new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any
    );

  const twoOutputDoc = () =>
    ({
      mode: 'image',
      outputs: [
        { id: 'a', formatId: 'ig-square', name: 'IG', width: 1080, height: 1080, background: '#fff', children: [] },
        { id: 'b', formatId: 'fb-post', name: 'FB', width: 1200, height: 630, background: '#fff', children: [] },
      ],
    } as any);

  const resolve = (scope: any, formatId?: string, targetOutputs?: string[]) =>
    (service() as any)._resolveTargetOutputIndexes(
      twoOutputDoc(),
      scope,
      formatId,
      targetOutputs
    );

  it('pins to the finding\'s own formatId when it names a real output', () => {
    expect(resolve('format-only', 'fb-post')).toEqual([1]);
  });

  it('derives the target from targetOutputs when the finding carries none', () => {
    expect(resolve('format-only', undefined, ['fb-post'])).toEqual([1]);
  });

  it('falls back to shared scope (not a no-op) when nothing resolves', () => {
    const svc = service();
    const warnSpy = vi
      .spyOn((svc as any)._logger, 'warn')
      .mockImplementation(() => undefined);

    const unknown = (svc as any)._resolveTargetOutputIndexes(
      twoOutputDoc(),
      'format-only',
      'li-story',
      ['also-unknown']
    );
    const missing = (svc as any)._resolveTargetOutputIndexes(
      twoOutputDoc(),
      'format-only'
    );

    expect(unknown).toEqual([0, 1]);
    expect(missing).toEqual([0, 1]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('falling back to shared scope'),
      expect.anything()
    );
  });

  it('shared scope still spans every output', () => {
    expect(resolve('shared')).toEqual([0, 1]);
  });

  it('canResolveFormatScope answers for the conductor\'s degradation note', () => {
    const svc = service();
    expect(svc.canResolveFormatScope(twoOutputDoc(), ['fb-post'])).toBe(true);
    expect(svc.canResolveFormatScope(twoOutputDoc(), ['nope'])).toBe(false);
    expect(svc.canResolveFormatScope(twoOutputDoc(), [])).toBe(false);
    expect(svc.canResolveFormatScope(twoOutputDoc(), undefined)).toBe(false);
  });

  // Round 8 C4: both resolvers went through strict formatId equality, so the
  // words users actually say ("Facebook", "the story") pinned nothing and every
  // format-scoped revision degraded to shared.

  it('pins a format the user named by channel, not by id', () => {
    expect(resolve('format-only', undefined, ['Facebook'])).toEqual([1]);
    expect(resolve('format-only', 'Facebook Post')).toEqual([1]);
  });

  it('canResolveFormatScope agrees with the index resolver on aliases', () => {
    // The two MUST agree: the conductor promises the scope off
    // canResolveFormatScope and the composer then applies it off the indexes.
    const svc = service();
    for (const alias of ['Facebook', 'Facebook Post', 'fb-post', 'the FB one']) {
      expect(svc.canResolveFormatScope(twoOutputDoc(), [alias])).toBe(true);
      expect(
        (svc as any)._resolveTargetOutputIndexes(
          twoOutputDoc(),
          'format-only',
          undefined,
          [alias]
        )
      ).toEqual([1]);
    }
  });

  it('still degrades to shared for a format the doc does not carry', () => {
    const svc = service();
    vi.spyOn((svc as any)._logger, 'warn').mockImplementation(() => undefined);
    expect(svc.canResolveFormatScope(twoOutputDoc(), ['LinkedIn'])).toBe(false);
    expect(
      (svc as any)._resolveTargetOutputIndexes(
        twoOutputDoc(),
        'format-only',
        undefined,
        ['LinkedIn']
      )
    ).toEqual([0, 1]);
  });

  it('applies a format-only fix that names no format to every output', async () => {
    const svc = service();
    const doc = {
      mode: 'image',
      outputs: [
        {
          id: 'a', formatId: 'ig-square', name: 'IG', width: 1080, height: 1080, background: '#fff',
          children: [{ id: 'e1', originId: 'headline', type: 'text', x: 0, y: 0, width: 100, height: 40, text: 'Hi' }],
        },
        {
          id: 'b', formatId: 'fb-post', name: 'FB', width: 1200, height: 630, background: '#fff',
          children: [{ id: 'e2', originId: 'headline', type: 'text', x: 0, y: 0, width: 100, height: 40, text: 'Hi' }],
        },
      ],
    } as any;

    const findings: VisionFinding[] = [
      {
        issue: 'headline too low',
        severity: 'major',
        slotId: 'headline',
        fix: { scope: 'format-only', geometry: { y: 200 }, targetSlots: ['headline'] },
      } as any,
    ];

    const patched = await svc.applyFixes(doc, findings, 'org-1');

    expect((patched.outputs[0] as any).children[0].y).toBe(200);
    expect((patched.outputs[1] as any).children[0].y).toBe(200);
  });
});

// Round 7 D: the offline saliency probe is gone; the real VLM detector runs
// only where a cover crop actually risks losing the subject.
describe('AiDesignerComposerService risky-crop subject detection (round 7 D)', () => {
  const makeService = (imageFocalPoint?: any) =>
    new AiDesignerComposerService(
      new DesignerDocService() as any,
      { generateText: vi.fn() } as any,
      imageFocalPoint ? ({ imageFocalPoint } as any) : undefined
    );

  const docWith = (
    element: Record<string, unknown>,
    output: Record<string, unknown> = {}
  ) =>
    ({
      mode: 'image',
      outputs: [
        {
          id: 'o1',
          formatId: 'ig-story',
          width: 1080,
          height: 1920,
          background: '#fff',
          children: [
            {
              id: 'e1',
              originId: 'image',
              type: 'image',
              src: 'https://example.com/i.png',
              fileId: 'f1',
              x: 0,
              y: 0,
              rotation: 0,
              opacity: 1,
              focalPoint: { x: 0.5, y: 0.5 },
              ...element,
            },
          ],
          ...output,
        },
      ],
    } as any);

  it('never calls the detector for a full-bleed crop with no slack', async () => {
    const imageFocalPoint = vi.fn();
    const service = makeService(imageFocalPoint);
    // 1080x1920 source into a 1080x1920 box: slack 0.
    const doc = docWith({ naturalWidth: 1080, naturalHeight: 1920, width: 1080, height: 1920 });

    const out = await service.applySubjectFocalPoints(doc, 'org-1');

    expect(imageFocalPoint).not.toHaveBeenCalled();
    expect(out).toBe(doc);
  });

  it('never calls the detector for a mildly-cropped square in a 4:5 box', async () => {
    const imageFocalPoint = vi.fn();
    const service = makeService(imageFocalPoint);
    // 1024² into 1080x1350 discards ~20% of the width — under the rail.
    const doc = docWith({ naturalWidth: 1024, naturalHeight: 1024, width: 1080, height: 1350 });

    await service.applySubjectFocalPoints(doc, 'org-1');

    expect(imageFocalPoint).not.toHaveBeenCalled();
  });

  it('calls the detector for a narrow split-panel column and uses its point', async () => {
    // 1024² into a 583x1080 column discards ~46% of the width — the live case
    // that cropped 45% off a product.
    const imageFocalPoint = vi
      .fn()
      .mockResolvedValue({ x: 0.3, y: 0.5, source: 'provider' });
    const service = makeService(imageFocalPoint);
    const doc = docWith({ naturalWidth: 1024, naturalHeight: 1024, width: 583, height: 1080 });

    const out = await service.applySubjectFocalPoints(doc, 'org-1');

    expect(imageFocalPoint).toHaveBeenCalledWith('org-1', 'https://example.com/i.png');
    const el = (out.outputs[0] as any).children[0];
    expect(el.subjectPoint).toEqual({ x: 0.3, y: 0.5 });
    // The centroid converts to a crop position LEFT of centre.
    expect(el.focalPoint.x).toBeLessThan(0.5);
  });

  it('applies the detected point to an image BACKGROUND too', async () => {
    const imageFocalPoint = vi
      .fn()
      .mockResolvedValue({ x: 0.7, y: 0.5, source: 'provider' });
    const service = makeService(imageFocalPoint);
    const doc = {
      mode: 'image',
      outputs: [
        {
          id: 'o1',
          formatId: 'ig-story',
          width: 583,
          height: 1080,
          background: '#000',
          bg: {
            type: 'image',
            src: 'https://example.com/bg.png',
            fileId: 'f-bg',
            naturalWidth: 1024,
            naturalHeight: 1024,
            focalPoint: { x: 0.5, y: 0.5 },
          },
          children: [],
        },
      ],
    } as any;

    const out = await service.applySubjectFocalPoints(doc, 'org-1');

    expect((out.outputs[0] as any).bg.subjectPoint).toEqual({ x: 0.7, y: 0.5 });
    expect((out.outputs[0] as any).bg.focalPoint.x).toBeGreaterThan(0.5);
  });

  it('centres when no vision provider is wired at all', async () => {
    const service = makeService();
    const doc = docWith({ naturalWidth: 1024, naturalHeight: 1024, width: 583, height: 1080 });

    const out = await service.applySubjectFocalPoints(doc, 'org-1');

    expect(out).toBe(doc);
    expect((out.outputs[0] as any).children[0].focalPoint).toEqual({ x: 0.5, y: 0.5 });
  });

  it('centres (never throws) when the detector rejects or answers fallback', async () => {
    const rejecting = makeService(
      vi.fn().mockRejectedValue(new Error('no vision default'))
    );
    const doc = docWith({ naturalWidth: 1024, naturalHeight: 1024, width: 583, height: 1080 });
    vi.spyOn((rejecting as any)._logger, 'warn').mockImplementation(() => undefined);

    await expect(
      rejecting.applySubjectFocalPoints(doc, 'org-1')
    ).resolves.toBe(doc);

    const fallback = makeService(
      vi.fn().mockResolvedValue({ x: 0.5, y: 0.5, source: 'fallback' })
    );
    await expect(
      fallback.applySubjectFocalPoints(doc, 'org-1')
    ).resolves.toBe(doc);

    const malformed = makeService(vi.fn().mockResolvedValue({ nope: true }));
    await expect(
      malformed.applySubjectFocalPoints(doc, 'org-1')
    ).resolves.toBe(doc);
  });

  it('skips the lookup when the intrinsic size is unknown', async () => {
    const imageFocalPoint = vi.fn();
    const service = makeService(imageFocalPoint);
    const doc = docWith({ width: 583, height: 1080 });

    await service.applySubjectFocalPoints(doc, 'org-1');

    expect(imageFocalPoint).not.toHaveBeenCalled();
  });

  it('looks a source up ONCE however many outputs paint it', async () => {
    const imageFocalPoint = vi
      .fn()
      .mockResolvedValue({ x: 0.3, y: 0.5, source: 'provider' });
    const service = makeService(imageFocalPoint);
    const risky = {
      id: 'e1', originId: 'image', type: 'image',
      src: 'https://example.com/i.png', fileId: 'f1',
      x: 0, y: 0, width: 583, height: 1080, rotation: 0, opacity: 1,
      naturalWidth: 1024, naturalHeight: 1024,
    };
    const doc = {
      mode: 'image',
      outputs: [
        { id: 'a', formatId: 'ig-story', name: 'A', width: 583, height: 1080, background: '#fff', children: [risky] },
        { id: 'b', formatId: 'x', name: 'B', width: 583, height: 1080, background: '#fff', children: [{ ...risky, id: 'e2' }] },
      ],
    } as any;

    await service.applySubjectFocalPoints(doc, 'org-1');

    expect(imageFocalPoint).toHaveBeenCalledTimes(1);
  });

  it('the saturation rail still applies to a detected point', async () => {
    // A centroid hard against the edge would convert to a value outside
    // [0,1]; the rail turns that into a plain centre crop.
    const imageFocalPoint = vi
      .fn()
      .mockResolvedValue({ x: 0.02, y: 0.5, source: 'provider' });
    const service = makeService(imageFocalPoint);
    const doc = docWith({ naturalWidth: 1024, naturalHeight: 1024, width: 583, height: 1080 });

    const out = await service.applySubjectFocalPoints(doc, 'org-1');

    const el = (out.outputs[0] as any).children[0];
    expect(el.subjectPoint).toEqual({ x: 0.02, y: 0.5 });
    expect(el.focalPoint).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe('AiDesignerComposerService.compose (new designer vocabulary)', () => {
  it('emits the plan slot’s type tools on the text element', async () => {
    const plan = makePlan();
    plan.slots = plan.slots.map((s) =>
      s.id === 'headline'
        ? {
            ...s,
            style: {
              textScaleX: 0.65,
              textTransform: 'uppercase' as const,
              curve: 'arc-up' as const,
              letterSpacing: 3,
            },
          }
        : s
    );
    const doc = await composeWith(plan);
    const headline = byOrigin(doc, 'headline');
    expect(headline.textScaleX).toBe(0.65);
    expect(headline.textTransform).toBe('uppercase');
    // The plan names the arc; the emitter owns the degrees.
    expect(headline.curve).toBe(30);
    expect(headline.letterSpacing).toBe(3);
  });

  it('emits a multi-stop radial gradient from the widened plan form', async () => {
    const plan = makePlan();
    plan.slots = plan.slots.map((s) =>
      s.id === 'headline'
        ? {
            ...s,
            style: {
              gradient: {
                type: 'radial' as const,
                focalX: 0.3,
                focalY: 0.25,
                stops: [
                  { color: '#ff5a36', offset: 0 },
                  { color: '#7a1fff', offset: 0.6 },
                  { color: '#0b1020', offset: 1 },
                ],
              },
            },
          }
        : s
    );
    const doc = await composeWith(plan);
    const headline = byOrigin(doc, 'headline');
    expect(headline.fillGradient?.type).toBe('radial');
    expect(headline.fillGradient?.stops).toHaveLength(3);
    expect(headline.fillGradient?.focalX).toBe(0.3);
  });

  it('legacy tuple gradients still emit a two-stop linear ramp', async () => {
    const plan = makePlan();
    plan.slots = plan.slots.map((s) =>
      s.id === 'headline'
        ? { ...s, style: { gradient: ['#ff5a36', '#0b1020'] as [string, string] } }
        : s
    );
    const doc = await composeWith(plan);
    const headline = byOrigin(doc, 'headline');
    expect(headline.fillGradient?.type).toBe('linear');
    expect(headline.fillGradient?.stops).toEqual([
      { offset: 0, color: '#ff5a36' },
      { offset: 1, color: '#0b1020' },
    ]);
  });
});
