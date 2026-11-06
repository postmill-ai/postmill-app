import { describe, expect, it } from 'vitest';
import { buildPostmillFile, parsePostmillFile } from './postmill-file';
import { DesignerDocLenientSchema, DesignerDocStrictSchema } from './designer-doc.schema';
import { DESIGNER_DOC_VERSION } from './designer-doc.limits';
import { DesignerDocService } from './designer-doc.service';

const qr = {
  value: 'https://postmill.ai',
  foreground: '#112233',
  background: '#FFFFFF',
  errorCorrection: 'H' as const,
  margin: 6,
};

const imageDoc = {
  version: DESIGNER_DOC_VERSION,
  mode: 'image',
  outputs: [{
    id: 'out-1', formatId: 'square', name: 'Square', width: 1080, height: 1080,
    background: '#FFFFFF',
    children: [{
      id: 'qr-1', type: 'image', src: 'data:image/png;base64,abc', qr,
      x: 0, y: 0, width: 200, height: 200, rotation: 0, opacity: 1, locked: false, hidden: false,
    }],
  }],
};

describe('QR document compatibility', () => {
  it('accepts bounded editable settings in strict and lenient static documents', () => {
    expect(DesignerDocStrictSchema.parse(imageDoc).outputs[0].children[0].qr).toEqual(qr);
    expect(DesignerDocLenientSchema.parse(imageDoc).outputs[0].children[0].qr).toEqual(qr);
    expect(DesignerDocStrictSchema.safeParse({
      ...imageDoc,
      outputs: [{ ...imageDoc.outputs[0], children: [{ ...imageDoc.outputs[0].children[0], qr: { ...qr, margin: 99 } }] }],
    }).success).toBe(false);
  });

  it('accepts settings on a still-image video clip', () => {
    const doc = {
      version: DESIGNER_DOC_VERSION,
      mode: 'video',
      outputs: [{
        id: 'video-1', formatId: 'square', name: 'Square', width: 1080, height: 1080,
        fps: 30, durationMs: 5000,
        tracks: [{
          id: 'track-1', type: 'image',
          clips: [{
            id: 'clip-1', startMs: 0, endMs: 5000, src: 'data:image/png;base64,abc', qr,
            mediaType: 'image', x: 0, y: 0, width: 200, height: 200,
          }],
        }],
      }],
    };
    const parsed = DesignerDocStrictSchema.parse(doc) as any;
    expect(parsed.outputs[0].tracks[0].clips[0].qr).toEqual(qr);
  });

  it('round-trips editable settings verbatim in .pdesign files', () => {
    const parsed = parsePostmillFile(buildPostmillFile(imageDoc as any, 'QR campaign'));
    expect((parsed.doc as any).outputs[0].children[0].qr).toEqual(qr);
    expect(parsed.manifest.docVersion).toBe(13);
  });

  it('clears settings when a headless operation replaces the image source', () => {
    const result = new DesignerDocService().applyOps(imageDoc as any, [{
      op: 'updateElement',
      outputIndex: 0,
      elementId: 'qr-1',
      patch: { src: '/uploads/replacement.png' },
    }]) as any;
    expect(result.outputs[0].children[0].src).toBe('/uploads/replacement.png');
    expect(result.outputs[0].children[0].qr).toBeUndefined();
  });
});
