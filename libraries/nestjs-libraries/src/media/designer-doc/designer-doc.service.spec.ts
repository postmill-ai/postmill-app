import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { DesignerDocService } from './designer-doc.service';
import { createBlankDoc } from './designer-doc.migrate';
import { DesignerDocOpError } from './designer-doc.errors';

const makeService = () => new DesignerDocService();

const minimalImageElement = {
  type: 'text' as const,
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  text: 'Hello',
};

describe('DesignerDocService', () => {
  it('validates and clamps a legacy doc leniently', () => {
    const service = makeService();
    const raw = {
      version: 2,
      mode: 'image',
      outputs: [
        {
          id: 'out-1',
          formatId: 'custom',
          name: 'Custom',
          width: 999999,
          height: 1080,
          background: '#ffffff',
          children: [
            {
              id: 'el-1',
              type: 'text',
              x: 0,
              y: 0,
              width: 100,
              height: 50,
              rotation: 0,
              opacity: 2,
              locked: false,
              hidden: false,
            },
          ],
        },
      ],
    };
    const doc = service.validate(raw);
    expect(doc.outputs[0].width).toBe(16384);
    expect(doc.outputs[0].children[0].opacity).toBe(1);
  });

  it('applies addOutput and creates a new image output', () => {
    const service = makeService();
    const doc = createBlankDoc();
    const result = service.applyOps(doc, [
      {
        op: 'addOutput',
        preset: {
          formatId: 'instagram-portrait',
          name: 'Instagram Portrait',
          width: 1080,
          height: 1350,
        },
      },
    ]);
    expect(result.outputs).toHaveLength(2);
    const added = result.outputs[1] as any;
    expect(added.width).toBe(1080);
    expect(added.height).toBe(1350);
    expect(added.formatId).toBe('instagram-portrait');
    expect(added.id).toMatch(/^out-[0-9a-f-]{36}$/i);
  });

  it('applies addElement and assigns ids/originId', () => {
    const service = makeService();
    const doc = createBlankDoc();
    const result = service.applyOps(doc, [
      {
        op: 'addElement',
        outputIndex: 0,
        element: minimalImageElement,
      },
    ]);
    const el = (result.outputs[0] as any).children[0];
    expect(el.id).toMatch(/^el-[0-9a-f-]{36}$/i);
    expect(el.originId).toBe(el.id);
    expect(el.text).toBe('Hello');
  });

  it('applies updateElement patch and preserves type/id', () => {
    const service = makeService();
    let doc = createBlankDoc();
    doc = service.applyOps(doc, [
      {
        op: 'addElement',
        outputIndex: 0,
        element: minimalImageElement,
      },
    ]);
    const id = (doc.outputs[0] as any).children[0].id;
    const result = service.applyOps(doc, [
      {
        op: 'updateElement',
        outputIndex: 0,
        elementId: id,
        patch: { text: 'World' },
      },
    ]);
    const el = (result.outputs[0] as any).children[0];
    expect(el.text).toBe('World');
    expect(el.type).toBe('text');
    expect(el.id).toBe(id);
  });

  it('rejects updateElement patch containing id/originId/type', () => {
    const service = makeService();
    const doc = createBlankDoc();
    const result = service.applyOps.safeParse?.(doc, [
      {
        op: 'updateElement',
        outputIndex: 0,
        elementId: 'el-1',
        patch: { id: 'new-id' },
      },
    ] as any);
    // applyOps does not expose safeParse; it throws on bad ops.
    expect(() =>
      service.applyOps(doc, [
        {
          op: 'updateElement',
          outputIndex: 0,
          elementId: 'el-1',
          patch: { id: 'new-id' },
        } as any,
      ])
    ).toThrow();
  });

  it('assigns ids on a video output clip', () => {
    const service = makeService();
    const doc = {
      version: 2,
      mode: 'video' as const,
      outputs: [
        {
          formatId: 'reels',
          name: 'Reels',
          width: 1080,
          height: 1920,
          fps: 30,
          durationMs: 10000,
          tracks: [
            {
              type: 'video' as const,
              clips: [{ startMs: 0, endMs: 10000 } as any],
            },
          ],
        },
      ],
    };
    const result = service.assignIdsAndNormalize(doc as any);
    const clip = (result.outputs[0] as any).tracks[0].clips[0];
    expect(clip.id).toMatch(/^clip-[0-9a-f-]{36}$/i);
    expect(clip.originId).toBe(clip.id);
  });

  it('throws DesignerDocOpError for image-only op on video output', () => {
    const service = makeService();
    const doc = {
      version: 2,
      mode: 'video' as const,
      outputs: [
        {
          id: 'out-v1',
          formatId: 'reels',
          name: 'Reels',
          width: 1080,
          height: 1920,
          fps: 30,
          durationMs: 10000,
          tracks: [{ id: 'trk-1', type: 'video' as const, clips: [] }],
        },
      ],
    };
    expect(() =>
      service.applyOps(doc, [
        {
          op: 'placeImage',
          outputIndex: 0,
          src: 'https://example.com/a.png',
        },
      ])
    ).toThrow(DesignerDocOpError);
  });

  it('throws DesignerDocOpError for out-of-range outputIndex', () => {
    const service = makeService();
    const doc = createBlankDoc();
    expect(() =>
      service.applyOps(doc, [
        {
          op: 'addElement',
          outputIndex: 5,
          element: minimalImageElement,
        },
      ])
    ).toThrow(DesignerDocOpError);
  });

  it('throws BadRequestException for a bad field value in an op', () => {
    const service = makeService();
    const doc = createBlankDoc();
    expect(() =>
      service.applyOps(doc, [
        {
          op: 'placeImage',
          outputIndex: 0,
          src: 'not-a-url',
        } as any,
      ])
    ).toThrow(BadRequestException);
  });

  it('throws BadRequestException for too many ops', () => {
    const service = makeService();
    const doc = createBlankDoc();
    const ops = Array(201).fill({
      op: 'removeOutput',
      outputIndex: 0,
    });
    expect(() => service.applyOps(doc, ops as any)).toThrow(
      BadRequestException
    );
  });

  it('a lenient base with passthrough keys survives applyOps', () => {
    const service = makeService();
    const doc = service.validate({
      version: 2,
      mode: 'image',
      outputs: [
        {
          id: 'out-1',
          formatId: 'custom',
          name: 'Custom',
          width: 100,
          height: 100,
          background: '#ffffff',
          children: [],
          _legacyKey: 'keep-me',
        },
      ],
    });
    const result = service.applyOps(doc, [
      { op: 'addElement', outputIndex: 0, element: minimalImageElement },
    ]);
    expect((result.outputs[0] as any)._legacyKey).toBe('keep-me');
  });

  it('buildPlaceImageOp constructs a valid op', () => {
    const service = makeService();
    const op = service.buildPlaceImageOp({
      outputIndex: 0,
      src: 'http://localhost:3000/uploads/test.png',
      fileId: 'file-1',
    });
    expect(op.op).toBe('placeImage');
    expect(op.src).toBe('http://localhost:3000/uploads/test.png');
    expect(op.fileId).toBe('file-1');
  });

  it('addOutput seeds children and copies the primary background', () => {
    const service = makeService();
    const doc = service.validate({
      version: 2,
      mode: 'image',
      outputs: [
        {
          id: 'out-primary',
          formatId: 'custom',
          name: 'Primary',
          width: 1080,
          height: 1080,
          background: '#ffcc00',
          children: [
            {
              id: 'el-1',
              type: 'text',
              x: 490,
              y: 490,
              width: 100,
              height: 50,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: 'Hello',
              originId: 'slot-1',
            },
          ],
        },
      ],
    });

    const result = service.applyOps(doc, [
      {
        op: 'addOutput',
        preset: {
          formatId: 'custom',
          name: 'Half size',
          width: 540,
          height: 540,
        },
      },
    ]);

    expect(result.outputs).toHaveLength(2);
    const added = result.outputs[1] as any;
    expect(added.background).toBe('#ffcc00');
    expect(added.children).toHaveLength(1);
    expect(added.children[0].text).toBe('Hello');
    expect(added.children[0].originId).toBe('slot-1');
    // 540x540 = 0.5x scale; centered element stays centered.
    expect(added.children[0].width).toBe(50);
    expect(added.children[0].x).toBe(245);
    expect(added.children[0].y).toBe(257.5);
  });

  it('addOutput seeds a grouped CTA pair through one shared anchor', () => {
    const service = makeService();
    const doc = service.validate({
      version: 2,
      mode: 'image',
      outputs: [
        {
          id: 'out-primary',
          formatId: 'custom',
          name: 'Primary',
          width: 1080,
          height: 1080,
          background: '#ffffff',
          children: [
            {
              id: 'el-bar',
              type: 'shape',
              shape: 'rect',
              x: 400,
              y: 564,
              width: 280,
              height: 6,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              fill: '#8A6D3B',
              groupId: 'cta',
              originId: 'cta-underline',
            },
            {
              id: 'el-label',
              type: 'text',
              x: 400,
              y: 500,
              width: 280,
              height: 60,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: 'Shop now',
              fontSize: 40,
              groupId: 'cta',
              originId: 'cta',
            },
          ],
        },
      ],
    });

    const result = service.applyOps(doc, [
      {
        op: 'addOutput',
        preset: {
          formatId: 'ig-story',
          name: 'Story',
          width: 1080,
          height: 1920,
        },
      },
    ]);

    const added = result.outputs[1] as any;
    const bar = added.children.find((el: any) => el.originId === 'cta-underline');
    const label = added.children.find((el: any) => el.originId === 'cta');
    // Individually derived anchors would split the pair (the bar would land
    // ~37px off the label); the shared group anchor keeps the source offset,
    // re-fit at the pair's content scale (the story's 4/3 type basis, each
    // member rounding independently: the 64px offset becomes 86).
    expect(bar.y - label.y).toBe(86);
    expect(bar.x - label.x).toBe(0);
  });

  it('addOutput reflows panel contents against the panel, not the canvas', () => {
    const service = makeService();
    const doc = service.validate({
      version: 2,
      mode: 'image',
      outputs: [
        {
          id: 'out-primary',
          formatId: 'ig-post',
          name: 'Primary',
          width: 1080,
          height: 1080,
          background: '#ffffff',
          children: [
            {
              id: 'el-panel',
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
              originId: 'split-panel-bg',
            },
            {
              id: 'el-headline',
              type: 'text',
              x: 54,
              y: 415,
              width: 389,
              height: 225,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: 'Big launch',
              fontSize: 90,
              originId: 'headline',
            },
          ],
        },
      ],
    });

    const result = service.applyOps(doc, [
      {
        op: 'addOutput',
        preset: { formatId: 'x-post', name: 'X', width: 1200, height: 675 },
      },
    ]);

    const added = result.outputs[1] as any;
    const panel = added.children.find(
      (el: any) => el.originId === 'split-panel-bg'
    );
    const headline = added.children.find(
      (el: any) => el.originId === 'headline'
    );
    // The panel scales per-axis (497 → 552). Its copy used to take the uniform
    // ratio (389 → 243) and leave a 249px dead gutter against a 60px one.
    expect(panel.width).toBe(552);
    expect(headline.x).toBe(60);
    expect(panel.width - (headline.x + headline.width)).toBe(60);
  });

  it('addOutput re-derives an image background focal point for the new aspect', () => {
    const service = makeService();
    const doc = service.validate({
      version: 2,
      mode: 'image',
      outputs: [
        {
          id: 'out-primary',
          formatId: 'ig-post',
          name: 'Primary',
          width: 1080,
          height: 1080,
          background: '#000000',
          bg: {
            type: 'image',
            src: 'https://example.com/hero.png',
            focalPoint: { x: 0.5, y: 0.5 },
            subjectPoint: { x: 0.5, y: 0.3 },
            naturalWidth: 1024,
            naturalHeight: 1024,
          },
          children: [],
        },
      ],
    });

    const result = service.applyOps(doc, [
      {
        op: 'addOutput',
        preset: { formatId: 'x-post', name: 'X', width: 1200, height: 675 },
      },
    ]);

    // A full-bleed background is cover-cropped like an image element, so the
    // inherited 0.5 was computed for a square box and crops the wrong band.
    expect((result.outputs[1] as any).bg.focalPoint.y).toBeCloseTo(0.042857, 5);
    expect((result.outputs[0] as any).bg.focalPoint.y).toBe(0.5);
  });

  it('addOutput keeps alignment on the seeded copies', () => {
    const service = makeService();
    const doc = service.validate({
      version: 2,
      mode: 'image',
      outputs: [
        {
          id: 'out-primary',
          formatId: 'custom',
          name: 'Primary',
          width: 1080,
          height: 1080,
          background: '#ffffff',
          children: [
            {
              id: 'el-headline',
              type: 'text',
              x: 100,
              y: 200,
              width: 400,
              height: 120,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: 'Left aligned',
              fontSize: 48,
              align: 'left',
              verticalAlign: 'middle',
              originId: 'headline',
            },
          ],
        },
      ],
    });

    const result = service.applyOps(doc, [
      {
        op: 'addOutput',
        preset: {
          formatId: 'x-post',
          name: 'X',
          width: 1200,
          height: 675,
        },
      },
    ]);

    // Alignment is a linked design property — a seeded copy inherits it
    // verbatim (the composer re-asserts the same invariant on every pass).
    const seeded = (result.outputs[1] as any).children[0];
    expect(seeded.align).toBe('left');
    expect(seeded.verticalAlign).toBe('middle');
  });

  it('addOutput backfills originId on primary children when missing', () => {
    const service = makeService();
    const doc = service.validate({
      version: 2,
      mode: 'image',
      outputs: [
        {
          id: 'out-primary',
          formatId: 'custom',
          name: 'Primary',
          width: 100,
          height: 100,
          background: '#ffffff',
          children: [
            {
              id: 'el-1',
              type: 'text',
              x: 0,
              y: 0,
              width: 10,
              height: 10,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: 'A',
            },
          ],
        },
      ],
    });

    const result = service.applyOps(doc, [
      {
        op: 'addOutput',
        preset: {
          formatId: 'custom',
          name: 'Double',
          width: 200,
          height: 200,
        },
      },
    ]);

    const primary = result.outputs[0] as any;
    const added = result.outputs[1] as any;
    expect(primary.children[0].originId).toBeDefined();
    expect(added.children[0].originId).toBe(primary.children[0].originId);
  });

  it('shared-scope updateElement propagates non-geometry changes by originId', () => {
    const service = makeService();
    const doc = service.validate({
      version: 2,
      mode: 'image',
      outputs: [
        {
          id: 'out-1',
          formatId: 'custom',
          name: 'One',
          width: 100,
          height: 100,
          background: '#ffffff',
          children: [
            {
              id: 'el-1',
              type: 'text',
              x: 0,
              y: 0,
              width: 10,
              height: 10,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: 'A',
              originId: 'slot-1',
            },
          ],
        },
        {
          id: 'out-2',
          formatId: 'custom',
          name: 'Two',
          width: 100,
          height: 100,
          background: '#ffffff',
          children: [
            {
              id: 'el-2',
              type: 'text',
              x: 50,
              y: 50,
              width: 10,
              height: 10,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: 'A',
              originId: 'slot-1',
            },
          ],
        },
      ],
    });

    const result = service.applyOps(doc, [
      {
        op: 'updateElement',
        outputIndex: 0,
        elementId: 'el-1',
        patch: { text: 'Updated' },
        scope: 'shared',
      },
    ]);

    expect((result.outputs[0] as any).children[0].text).toBe('Updated');
    expect((result.outputs[1] as any).children[0].text).toBe('Updated');
  });

  it('shared-scope updateElement does not propagate geometry keys', () => {
    const service = makeService();
    const doc = service.validate({
      version: 2,
      mode: 'image',
      outputs: [
        {
          id: 'out-1',
          formatId: 'custom',
          name: 'One',
          width: 100,
          height: 100,
          background: '#ffffff',
          children: [
            {
              id: 'el-1',
              type: 'text',
              x: 0,
              y: 0,
              width: 10,
              height: 10,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              originId: 'slot-1',
            },
          ],
        },
        {
          id: 'out-2',
          formatId: 'custom',
          name: 'Two',
          width: 100,
          height: 100,
          background: '#ffffff',
          children: [
            {
              id: 'el-2',
              type: 'text',
              x: 50,
              y: 50,
              width: 10,
              height: 10,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              originId: 'slot-1',
            },
          ],
        },
      ],
    });

    const result = service.applyOps(doc, [
      {
        op: 'updateElement',
        outputIndex: 0,
        elementId: 'el-1',
        patch: { x: 99 },
        scope: 'shared',
      },
    ]);

    expect((result.outputs[0] as any).children[0].x).toBe(99);
    expect((result.outputs[1] as any).children[0].x).toBe(50);
  });

  it('unscoped updateElement stays format-only (back-compat default)', () => {
    const service = makeService();
    const doc = service.validate({
      version: 2,
      mode: 'image',
      outputs: [
        {
          id: 'out-1',
          formatId: 'custom',
          name: 'One',
          width: 100,
          height: 100,
          background: '#ffffff',
          children: [
            {
              id: 'el-1',
              type: 'text',
              x: 0,
              y: 0,
              width: 10,
              height: 10,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: 'A',
              originId: 'slot-1',
            },
          ],
        },
        {
          id: 'out-2',
          formatId: 'custom',
          name: 'Two',
          width: 100,
          height: 100,
          background: '#ffffff',
          children: [
            {
              id: 'el-2',
              type: 'text',
              x: 50,
              y: 50,
              width: 10,
              height: 10,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: 'A',
              originId: 'slot-1',
            },
          ],
        },
      ],
    });

    // No `scope` — the pre-scope contract: only the addressed element changes,
    // a linked copy (same originId) on another output must stay untouched.
    const result = service.applyOps(doc, [
      {
        op: 'updateElement',
        outputIndex: 0,
        elementId: 'el-1',
        patch: { text: 'Updated' },
      },
    ]);

    expect((result.outputs[0] as any).children[0].text).toBe('Updated');
    expect((result.outputs[1] as any).children[0].text).toBe('A');
  });

  it('addOutput after removing every output appends an unseeded canvas', () => {
    const service = makeService();
    const doc = service.validate({
      version: 2,
      mode: 'image',
      outputs: [
        {
          id: 'out-1',
          formatId: 'custom',
          name: 'Only',
          width: 100,
          height: 100,
          background: '#ffcc00',
          children: [{ id: 'el-1', ...minimalImageElement }],
        },
      ],
    });

    // Previously-valid sequence: empty the doc, then add — nothing to seed.
    const result = service.applyOps(doc, [
      { op: 'removeOutput', outputIndex: 0 },
      {
        op: 'addOutput',
        preset: { formatId: 'custom', name: 'Fresh', width: 200, height: 200 },
      },
    ]);

    expect(result.outputs).toHaveLength(1);
    const added = result.outputs[0] as any;
    expect(added.background).toBe('#ffffff');
    expect(added.children).toHaveLength(0);
  });

  it('addOutput with seed:false appends an empty white canvas, untouched primary', () => {
    const service = makeService();
    const doc = service.validate({
      version: 2,
      mode: 'image',
      outputs: [
        {
          id: 'out-primary',
          formatId: 'custom',
          name: 'Primary',
          width: 100,
          height: 100,
          background: '#ffcc00',
          children: [{ id: 'el-1', ...minimalImageElement }],
        },
      ],
    });

    const result = service.applyOps(doc, [
      {
        op: 'addOutput',
        preset: { formatId: 'custom', name: 'Blank', width: 200, height: 200 },
        seed: false,
      },
    ]);

    expect(result.outputs).toHaveLength(2);
    const primary = result.outputs[0] as any;
    const added = result.outputs[1] as any;
    // Pre-seeding semantics: no children copied, no background inherited,
    // and no fresh-UUID originId backfill on the primary output (the
    // normalize pass still defaults originId to the element id).
    expect(added.background).toBe('#ffffff');
    expect(added.children).toHaveLength(0);
    expect(primary.children[0].originId).toBe('el-1');
  });

  it('applies addPage and assigns a page id', () => {
    const service = makeService();
    const doc = createBlankDoc();
    const result = service.applyOps(doc, [
      { op: 'addPage', outputIndex: 0, name: 'Slide 2' },
    ]);
    const out = result.outputs[0] as any;
    expect(out.children).toHaveLength(0); // page 1 untouched
    expect(out.pages).toHaveLength(1);
    expect(out.pages[0].name).toBe('Slide 2');
    expect(out.pages[0].id).toMatch(/^pg-[0-9a-f-]{36}$/i);
    expect(out.pages[0].children).toEqual([]);
  });

  it('duplicatePage deep-clones with fresh element ids and originIds', () => {
    const service = makeService();
    let doc = createBlankDoc();
    doc = service.applyOps(doc, [
      { op: 'addElement', outputIndex: 0, element: minimalImageElement },
    ]);
    const source = (doc.outputs[0] as any).children[0];
    const result = service.applyOps(doc, [
      { op: 'duplicatePage', outputIndex: 0, pageNumber: 0 },
    ]);
    const out = result.outputs[0] as any;
    expect(out.pages).toHaveLength(1);
    const copyEl = out.pages[0].children[0];
    expect(copyEl.text).toBe('Hello');
    expect(copyEl.id).not.toBe(source.id);
    expect(copyEl.originId).not.toBe(source.originId);
  });

  it('removePage refuses page 1 and drops a later page', () => {
    const service = makeService();
    let doc = createBlankDoc();
    doc = service.applyOps(doc, [
      { op: 'addPage', outputIndex: 0 },
      { op: 'addPage', outputIndex: 0 },
    ]);
    expect(() =>
      service.applyOps(doc, [{ op: 'removePage', outputIndex: 0, pageNumber: 0 }])
    ).toThrow(DesignerDocOpError);
    const result = service.applyOps(doc, [
      { op: 'removePage', outputIndex: 0, pageNumber: 1 },
    ]);
    expect((result.outputs[0] as any).pages).toHaveLength(1);
  });

  it('reorderPage can move page 1 into the extras and back', () => {
    const service = makeService();
    let doc = createBlankDoc();
    doc = service.applyOps(doc, [
      { op: 'addElement', outputIndex: 0, element: minimalImageElement },
      { op: 'addPage', outputIndex: 0, name: 'Second' },
    ]);
    const firstChildren = (doc.outputs[0] as any).children;
    const result = service.applyOps(doc, [
      { op: 'reorderPage', outputIndex: 0, from: 0, to: 1 },
    ]);
    const out = result.outputs[0] as any;
    // The extras page moved onto the base slot; the old page 1's children now
    // live in pages[0].
    expect(out.children).toHaveLength(0);
    expect(out.pages[0].children[0].text).toBe('Hello');
    expect(out.pages[0].children[0].id).toBe(firstChildren[0].id);
  });

  it('page ops reject video outputs', () => {
    const service = makeService();
    const doc = service.validate({
      version: 5,
      mode: 'video',
      outputs: [
        {
          id: 'out-1',
          formatId: 'tiktok',
          name: 'TikTok',
          width: 1080,
          height: 1920,
          fps: 30,
          durationMs: 10000,
          tracks: [],
        },
      ],
    });
    expect(() =>
      service.applyOps(doc, [{ op: 'addPage', outputIndex: 0 }])
    ).toThrow(DesignerDocOpError);
  });

  const videoDoc = () =>
    makeService().validate({
      version: 5,
      mode: 'video',
      outputs: [
        {
          id: 'out-v1',
          formatId: 'custom-wide',
          name: 'Wide',
          width: 1920,
          height: 1080,
          fps: 30,
          durationMs: 10000,
          tracks: [
            {
              id: 'trk-1',
              type: 'text',
              clips: [
                {
                  id: 'clip-1',
                  startMs: 500,
                  endMs: 4000,
                  text: 'Headline',
                  x: 460,
                  y: 900,
                  width: 1000,
                  height: 140,
                  fontSize: 64,
                },
              ],
            },
          ],
        },
      ],
    });

  it('applies addOutput on a video doc: cloned variant, fresh ids, reflowed geometry', () => {
    const doc = videoDoc();
    const result = makeService().applyOps(doc, [
      {
        op: 'addOutput',
        preset: { formatId: 'custom-tall', name: 'Tall', width: 1080, height: 1920 },
      },
    ]);
    expect(result.outputs).toHaveLength(2);
    const added = result.outputs[1] as any;
    expect(added).toMatchObject({
      width: 1080,
      height: 1920,
      formatId: 'custom-tall',
      fps: 30,
      durationMs: 10000,
    });
    expect(added.id).toMatch(/^out-[0-9a-f-]{36}$/i);
    const clip = added.tracks[0].clips[0];
    const sourceClip = (result.outputs[0] as any).tracks[0].clips[0];
    expect(clip.id).not.toBe(sourceClip.id);
    expect(clip.originId).toBe(sourceClip.originId);
    expect(clip.startMs).toBe(500); // timing invariant
    expect(clip.y).not.toBe(900); // geometry reflowed
  });

  it('addOutput with seed:false on a video doc appends an empty timeline', () => {
    const doc = videoDoc();
    const result = makeService().applyOps(doc, [
      {
        op: 'addOutput',
        preset: { formatId: 'custom-tall', name: 'Tall', width: 1080, height: 1920 },
        seed: false,
      },
    ]);
    const added = result.outputs[1] as any;
    expect(added.tracks).toEqual([]);
    // No cross-output linking seeded — the normalize pass only defaults
    // originId to the clip's own id (its long-standing behavior).
    const srcClip = (result.outputs[0] as any).tracks[0].clips[0];
    expect(srcClip.originId).toBe(srcClip.id);
  });

  it('resizeOutput reflows a video output in place and rejects a bad index', () => {
    const doc = videoDoc();
    const result = makeService().applyOps(doc, [
      { op: 'resizeOutput', outputIndex: 0, width: 1080, height: 1920, formatId: 'custom-tall' },
    ]);
    const out = result.outputs[0] as any;
    expect(out).toMatchObject({ width: 1080, height: 1920, formatId: 'custom-tall', durationMs: 10000 });
    expect(out.tracks[0].clips[0].id).toBe('clip-1'); // ids preserved
    expect(out.tracks[0].clips[0].y).not.toBe(900);

    expect(() =>
      makeService().applyOps(doc, [
        { op: 'resizeOutput', outputIndex: 7, width: 1080, height: 1920 },
      ])
    ).toThrow(DesignerDocOpError);
  });

  it('image element ops still reject video outputs (gating unchanged)', () => {
    const doc = videoDoc();
    expect(() =>
      makeService().applyOps(doc, [
        { op: 'addElement', outputIndex: 0, element: minimalImageElement },
      ])
    ).toThrow(DesignerDocOpError);
  });

  it('enforces the pages-per-output cap', () => {
    const service = makeService();
    let doc = createBlankDoc();
    doc = service.applyOps(
      doc,
      Array.from({ length: 19 }, () => ({ op: 'addPage' as const, outputIndex: 0 }))
    );
    expect((doc.outputs[0] as any).pages).toHaveLength(19);
    expect(() =>
      service.applyOps(doc, [{ op: 'addPage', outputIndex: 0 }])
    ).toThrow(DesignerDocOpError);
  });
});

describe('DesignerDocService clip ops (video outputs)', () => {
  const videoDoc = () =>
    makeService().validate({
      version: 5,
      mode: 'video',
      outputs: [
        {
          id: 'out-v1',
          formatId: 'custom-wide',
          name: 'Wide',
          width: 1920,
          height: 1080,
          fps: 30,
          durationMs: 10000,
          tracks: [
            {
              id: 'trk-text',
              type: 'text',
              clips: [
                {
                  id: 'clip-1',
                  startMs: 500,
                  endMs: 4000,
                  text: 'Headline',
                  x: 460,
                  y: 900,
                  width: 1000,
                  height: 140,
                  fontSize: 64,
                  fill: '#ffffff',
                  transitionIn: { type: 'fade', durationMs: 400 },
                },
              ],
            },
            {
              id: 'trk-img',
              type: 'image',
              clips: [
                {
                  id: 'clip-2',
                  startMs: 0,
                  endMs: 10000,
                  src: 'https://example.com/bg.png',
                  fileId: 'file-1',
                },
              ],
            },
          ],
        },
      ],
    });

  it('applies updateClip text/style/geometry patches', () => {
    const result = makeService().applyOps(videoDoc(), [
      {
        op: 'updateClip',
        outputIndex: 0,
        clipId: 'clip-1',
        patch: {
          text: 'New headline',
          fill: '#ff0000',
          fillGradient: { type: 'linear', stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#00ff00' }] },
          align: 'justify',
          fontSize: 80,
          y: 700,
        },
      },
    ]);
    const clip = (result.outputs[0] as any).tracks[0].clips[0];
    expect(clip.text).toBe('New headline');
    expect(clip.fill).toBe('#ff0000');
    expect(clip.fillGradient.stops).toHaveLength(2);
    expect(clip.align).toBe('justify');
    expect(clip.fontSize).toBe(80);
    expect(clip.y).toBe(700);
    expect(clip.startMs).toBe(500); // timing untouched
    expect(clip.id).toBe('clip-1');
  });

  it('applies updateClip timing within the output duration', () => {
    const result = makeService().applyOps(videoDoc(), [
      {
        op: 'updateClip',
        outputIndex: 0,
        clipId: 'clip-1',
        patch: { startMs: 1000, endMs: 6000 },
      },
    ]);
    const clip = (result.outputs[0] as any).tracks[0].clips[0];
    expect(clip.startMs).toBe(1000);
    expect(clip.endMs).toBe(6000);
  });

  it('rejects updateClip timing past the output duration or inverted', () => {
    const doc = videoDoc();
    expect(() =>
      makeService().applyOps(doc, [
        {
          op: 'updateClip',
          outputIndex: 0,
          clipId: 'clip-1',
          patch: { endMs: 12000 },
        },
      ])
    ).toThrow(/exceeds the output duration/);
    expect(() =>
      makeService().applyOps(doc, [
        {
          op: 'updateClip',
          outputIndex: 0,
          clipId: 'clip-1',
          patch: { startMs: 5000, endMs: 4000 },
        },
      ])
    ).toThrow(/must be after startMs/);
  });

  it('updateClip rejects an unknown clip and an image output target', () => {
    const doc = videoDoc();
    expect(() =>
      makeService().applyOps(doc, [
        { op: 'updateClip', outputIndex: 0, clipId: 'nope', patch: { fill: '#000' } },
      ])
    ).toThrow(/not found/);

    const imageDoc = createBlankDoc();
    expect(() =>
      makeService().applyOps(imageDoc, [
        { op: 'updateClip', outputIndex: 0, clipId: 'clip-1', patch: { fill: '#000' } },
      ])
    ).toThrow(/targets an image output/);
  });

  it('updateClip patch rejects non-whitelisted keys', () => {
    expect(() =>
      makeService().applyOps(videoDoc(), [
        {
          op: 'updateClip',
          outputIndex: 0,
          clipId: 'clip-1',
          patch: { src: 'https://evil.example/x.png' } as any,
        },
      ])
    ).toThrow(BadRequestException);
  });

  it('applies updateClip media-presentation patches (fitMode/volume/speed/fades)', () => {
    const result = makeService().applyOps(videoDoc(), [
      {
        op: 'updateClip',
        outputIndex: 0,
        clipId: 'clip-2',
        patch: {
          fitMode: 'contain',
          volume: 0.5,
          speed: 1.5,
          fadeInMs: 200,
          fadeOutMs: 300,
        },
      },
    ]);
    const clip = (result.outputs[0] as any).tracks[1].clips[0];
    expect(clip.fitMode).toBe('contain');
    expect(clip.volume).toBe(0.5);
    expect(clip.speed).toBe(1.5);
    expect(clip.fadeInMs).toBe(200);
    expect(clip.fadeOutMs).toBe(300);
    // Timing untouched.
    expect(clip.startMs).toBe(0);
    expect(clip.endMs).toBe(10000);
  });

  it('rejects updateClip media-presentation values outside the clip bounds', () => {
    expect(() =>
      makeService().applyOps(videoDoc(), [
        { op: 'updateClip', outputIndex: 0, clipId: 'clip-2', patch: { volume: 2 } },
      ])
    ).toThrow(BadRequestException);
    expect(() =>
      makeService().applyOps(videoDoc(), [
        { op: 'updateClip', outputIndex: 0, clipId: 'clip-2', patch: { speed: 0 } },
      ])
    ).toThrow(BadRequestException);
    expect(() =>
      makeService().applyOps(videoDoc(), [
        { op: 'updateClip', outputIndex: 0, clipId: 'clip-2', patch: { fitMode: 'stretch' } },
      ])
    ).toThrow(BadRequestException);
  });

  it('applies replaceClipMedia on an image clip', () => {
    const result = makeService().applyOps(videoDoc(), [
      {
        op: 'replaceClipMedia',
        outputIndex: 0,
        clipId: 'clip-2',
        src: 'https://example.com/new.png',
        fileId: 'file-2',
        naturalWidth: 800,
        naturalHeight: 600,
      },
    ]);
    const clip = (result.outputs[0] as any).tracks[1].clips[0];
    expect(clip.src).toBe('https://example.com/new.png');
    expect(clip.fileId).toBe('file-2');
    expect(clip.naturalWidth).toBe(800);
  });

  it('replaceClipMedia rejects clips on non-media tracks', () => {
    expect(() =>
      makeService().applyOps(videoDoc(), [
        {
          op: 'replaceClipMedia',
          outputIndex: 0,
          clipId: 'clip-1',
          src: 'https://example.com/new.png',
        },
      ])
    ).toThrow(/no media to replace/);
  });

  it('applies and removes transitions via updateTransition', () => {
    const service = makeService();
    let doc = videoDoc();
    doc = service.applyOps(doc, [
      {
        op: 'updateTransition',
        outputIndex: 0,
        clipId: 'clip-1',
        edge: 'out',
        transition: { type: 'dissolve', durationMs: 600 },
      },
    ]);
    let clip = (doc.outputs[0] as any).tracks[0].clips[0];
    expect(clip.transitionOut).toEqual({ type: 'dissolve', durationMs: 600 });
    expect(clip.transitionIn).toEqual({ type: 'fade', durationMs: 400 });

    // A transition longer than the clip clamps to the clip duration
    // (clip-1 runs 500–4000ms → 3500ms).
    doc = service.applyOps(doc, [
      {
        op: 'updateTransition',
        outputIndex: 0,
        clipId: 'clip-1',
        edge: 'out',
        transition: { type: 'dissolve', durationMs: 99999 },
      },
    ]);
    clip = (doc.outputs[0] as any).tracks[0].clips[0];
    expect(clip.transitionOut.durationMs).toBe(3500);

    // null removes the transition on that edge.
    doc = service.applyOps(doc, [
      {
        op: 'updateTransition',
        outputIndex: 0,
        clipId: 'clip-1',
        edge: 'out',
        transition: null,
      },
    ]);
    clip = (doc.outputs[0] as any).tracks[0].clips[0];
    expect(clip.transitionOut).toBeUndefined();
  });

  it('applies setOutputBackground on a video output', () => {
    const result = makeService().applyOps(videoDoc(), [
      {
        op: 'setOutputBackground',
        outputIndex: 0,
        background: {
          type: 'gradient',
          gradient: {
            type: 'linear',
            angle: 180,
            stops: [
              { color: '#000000', offset: 0 },
              { color: '#123456', offset: 1 },
            ],
          },
        },
      },
    ]);
    expect((result.outputs[0] as any).bg).toEqual({
      type: 'gradient',
      gradient: {
        type: 'linear',
        angle: 180,
        stops: [
          { color: '#000000', offset: 0 },
          { color: '#123456', offset: 1 },
        ],
      },
    });
  });

  it('clip ops are format-local: a second output is untouched', () => {
    const service = makeService();
    let doc = videoDoc();
    doc = service.applyOps(doc, [
      {
        op: 'addOutput',
        preset: { formatId: 'custom-tall', name: 'Tall', width: 1080, height: 1920 },
      },
    ]);
    const result = service.applyOps(doc, [
      {
        op: 'updateClip',
        outputIndex: 0,
        clipId: 'clip-1',
        patch: { text: 'Only here' },
      },
    ]);
    const other = (result.outputs[1] as any).tracks
      .find((t: any) => t.type === 'text')
      .clips.find((c: any) => c.originId === 'clip-1' || c.text);
    expect(other.text).toBe('Headline');
  });
});
