import { describe, expect, it } from 'vitest';
import { create } from 'qrcode';
import sharp from 'sharp';
import { createDesignerStore, type DesignerDoc, type VideoOutput } from './designer.store';
import { generateQrCode, insertQrCode, qrCodePatch, DEFAULT_QR_CODE_SETTINGS } from './qr-code';
import { DesignRenderService } from '@postmill-ai/nestjs-libraries/media/design-render/design-render.service';

const settings = { ...DEFAULT_QR_CODE_SETTINGS, value: ' https://postmill.ai/docs ' };

describe('editable QR codes', () => {
  it('generates a real 1024px QR matrix with the requested correction level', async () => {
    const src = await generateQrCode(settings);
    expect(src).toMatch(/^data:image\/png;base64,/);
    const image = sharp(Buffer.from(src.split(',')[1], 'base64'));
    await expect(image.metadata()).resolves.toMatchObject({ width: 1024, height: 1024, format: 'png' });
    const matrix = create('https://postmill.ai/docs', { errorCorrectionLevel: 'M' });
    expect(matrix.modules.size).toBeGreaterThan(20);
    expect(matrix.modules.data.length).toBe(matrix.modules.size ** 2);
  });

  it('inserts an editable static image and preserves its settings across save/reopen', async () => {
    const store = createDesignerStore(1080, 1080);
    expect(await insertQrCode(store, settings)).toBe(true);
    const inserted = store.getState().doc.outputs[0] as any;
    const qr = inserted.children[0];
    expect(qr).toMatchObject({
      type: 'image', qr: { ...settings, value: 'https://postmill.ai/docs' },
      naturalWidth: 1024, naturalHeight: 1024, fitMode: 'contain',
    });

    const saved = structuredClone(store.getState().doc);
    const reopened = createDesignerStore();
    reopened.getState().loadDesign(saved, 'design-1', 'Campaign');
    expect((reopened.getState().doc.outputs[0] as any).children[0].qr).toEqual(qr.qr);
    expect((reopened.getState().doc.outputs[0] as any).children[0].src).toBe(qr.src);
  });

  it('inserts a still-image video clip with editable settings', async () => {
    const store = createDesignerStore(1080, 1080);
    store.getState().setMode('video');
    expect(await insertQrCode(store, settings)).toBe(true);
    const output = store.getState().doc.outputs[0] as VideoOutput;
    const clip = output.tracks.find((track) => track.type === 'image')?.clips[0];
    expect(clip).toMatchObject({
      mediaType: 'image', qr: { ...settings, value: 'https://postmill.ai/docs' },
      naturalWidth: 1024, naturalHeight: 1024,
    });
    expect(clip?.src).toMatch(/^data:image\/png;base64,/);
  });

  it('clears the previous owned file and derived media when QR settings regenerate the pixels', async () => {
    const patch = await qrCodePatch(settings);
    expect(patch).toMatchObject({
      fileId: undefined,
      originalSrc: undefined,
      originalFileId: undefined,
      smartFilters: undefined,
      maskSrc: undefined,
      maskFileId: undefined,
      maskEnabled: undefined,
      crop: undefined,
      focalPoint: undefined,
      naturalWidth: 1024,
    });
    expect(patch.qr?.value).toBe('https://postmill.ai/docs');
  });

  it('does not let a smart-filter rebake or old mask restore the previous QR code', async () => {
    const store = createDesignerStore();
    await insertQrCode(store, settings);
    const element = (store.getState().doc.outputs[0] as any).children[0];
    store.getState().updateElement(element.id, {
      originalSrc: element.src,
      originalFileId: 'old-qr-file',
      smartFilters: [{ id: 'blur', params: { radius: 3 } }],
      maskSrc: '/uploads/old-mask.png',
      maskFileId: 'old-mask-file',
      maskEnabled: true,
      crop: { x: 0, y: 0, width: 100, height: 100 },
    });

    const patch = await qrCodePatch({ ...settings, value: 'https://postmill.ai/new' });
    store.getState().updateElement(element.id, patch);

    const regenerated = (store.getState().doc.outputs[0] as any).children[0];
    expect(regenerated.qr.value).toBe('https://postmill.ai/new');
    expect(regenerated.originalSrc).toBeUndefined();
    expect(regenerated.originalFileId).toBeUndefined();
    expect(regenerated.smartFilters).toBeUndefined();
    expect(regenerated.maskSrc).toBeUndefined();
    expect(regenerated.maskFileId).toBeUndefined();
    expect(regenerated.maskEnabled).toBeUndefined();
    expect(regenerated.crop).toBeUndefined();
  });

  it('normalizes picker colors and invalidates settings when pixels are replaced', async () => {
    const recolored = await qrCodePatch({ ...settings, foreground: '#11223344', background: '#abc' });
    expect(recolored.qr).toMatchObject({ foreground: '#112233', background: '#AABBCC' });

    const store = createDesignerStore();
    await insertQrCode(store, settings);
    const element = (store.getState().doc.outputs[0] as any).children[0];
    store.getState().updateElement(element.id, { src: '/uploads/replacement.png' });
    expect((store.getState().doc.outputs[0] as any).children[0].qr).toBeUndefined();

    store.getState().setMode('video');
    await insertQrCode(store, settings);
    const selected = store.getState().selectedClip!;
    store.getState().updateClip(selected.outputIndex, selected.trackId, selected.clipId, {
      src: '/uploads/replacement.png',
    });
    const output = store.getState().doc.outputs[0] as VideoOutput;
    const clip = output.tracks.find((track) => track.id === selected.trackId)?.clips[0];
    expect(clip?.qr).toBeUndefined();
  }, 20_000);

  it('exports the same QR pixels through the server renderer', async () => {
    const src = await generateQrCode(settings);
    const doc = {
      version: 13,
      mode: 'image',
      outputs: [{
        id: 'out-1', formatId: 'square', name: 'Square', width: 1024, height: 1024,
        background: '#FFFFFF',
        children: [{
          id: 'qr-1', type: 'image', src, qr: { ...settings, value: 'https://postmill.ai/docs' },
          x: 0, y: 0, width: 1024, height: 1024, rotation: 0, opacity: 1,
          locked: false, hidden: false, naturalWidth: 1024, naturalHeight: 1024,
        }],
      }],
    } as unknown as DesignerDoc;
    const renderer = new DesignRenderService({
      loadOrgFonts: async () => undefined,
      loadCuratedFonts: async () => undefined,
    } as any);

    const png = await renderer.renderPage(doc, 0);
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(1024);
    expect(new Set(data).size).toBeGreaterThan(1);
  });
});
