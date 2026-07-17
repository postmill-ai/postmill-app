import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiDesignerComposerService } from './ai-designer-composer.service';
import type { VisionFinding } from '../../ai-designer.types';

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
