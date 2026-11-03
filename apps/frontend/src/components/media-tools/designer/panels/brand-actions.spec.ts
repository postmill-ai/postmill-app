import { describe, expect, it } from 'vitest';
import { addBrandLogo, applyBrandColor, applyBrandFont } from './brand-actions';
import { createDesignerStore, type VideoOutput } from '../designer.store';

const textElement = {
  id: 'text-1', type: 'text' as const, text: 'Headline', x: 0, y: 0, width: 300, height: 80,
  rotation: 0, opacity: 1, locked: false, hidden: false, fontFamily: 'Inter', fill: '#ffffff',
};

describe('Brand actions', () => {
  it('applies color and font to a selected static text element with one undo entry each', () => {
    const store = createDesignerStore();
    store.getState().addElement(textElement);
    store.getState().setSelectedIds(['text-1']);

    expect(applyBrandColor(store, '#ff0000')).toBe(true);
    expect(applyBrandFont(store, 'Georgia')).toBe(true);
    const selected = (store.getState().doc.outputs[0] as any).children[0];
    expect(selected.fill).toBe('#ff0000');
    expect(selected.fontFamily).toBe('Georgia');
    expect(store.getState().historyLabels).toContain('Apply brand color');
    expect(store.getState().historyLabels).toContain('Apply brand font');
  });

  it('applies color and font to selected video text clips', () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    store.getState().addTrack(0, 'text');
    const output = store.getState().doc.outputs[0] as VideoOutput;
    const track = output.tracks.find((item) => item.type === 'text')!;
    store.getState().addClip(0, track.id, {
      id: 'text-clip', startMs: 0, endMs: 1000, text: 'Headline',
      x: 0, y: 0, width: 300, height: 80, fontFamily: 'Inter', fill: '#ffffff',
    });
    store.getState().setSelectedClip({ outputIndex: 0, trackId: track.id, clipId: 'text-clip' });

    expect(applyBrandColor(store, '#00ff00')).toBe(true);
    expect(applyBrandFont(store, 'Georgia')).toBe(true);
    const clip = (store.getState().doc.outputs[0] as VideoOutput).tracks
      .find((item) => item.id === track.id)!.clips[0];
    expect(clip.fill).toBe('#00ff00');
    expect(clip.fontFamily).toBe('Georgia');
  });

  it('rejects Brand style actions without a compatible selection', () => {
    const store = createDesignerStore();
    expect(applyBrandColor(store, '#ff0000')).toBe(false);
    expect(applyBrandFont(store, 'Georgia')).toBe(false);
  });

  it('inserts a static logo with its aspect ratio preserved and centered', async () => {
    const store = createDesignerStore();
    await expect(addBrandLogo(store, { id: 'logo-file', path: '/logo.png' }, async () => ({
      width: 800,
      height: 400,
    }))).resolves.toBe(true);
    expect((store.getState().doc.outputs[0] as any).children[0]).toMatchObject({
      x: 270,
      y: 405,
      width: 540,
      height: 270,
      naturalWidth: 800,
      naturalHeight: 400,
      fileId: 'logo-file',
    });
  });

  it('inserts a logo as a selected video image clip', async () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    await expect(addBrandLogo(store, { id: 'logo-file', path: '/logo.png' })).resolves.toBe(true);
    const output = store.getState().doc.outputs[0] as VideoOutput;
    const track = output.tracks.find((item) => item.type === 'image')!;
    expect(track.clips[0]).toMatchObject({ src: '/logo.png', fileId: 'logo-file', mediaType: 'image' });
    expect(store.getState().selectedClip).toMatchObject({ trackId: track.id, clipId: track.clips[0].id });
  });
});
