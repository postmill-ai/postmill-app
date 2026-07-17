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
          op: 'setOutputBackground',
          outputIndex: 0,
          background: { type: 'color' as const, color: '#000000' },
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
});
