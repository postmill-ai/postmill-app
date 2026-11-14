import { describe, expect, it, vi } from 'vitest';
import { imageDropTargetById, replaceUploadedImageAtDropTarget, uploadDroppedImage, imageDropErrorMessage, UploadedImageCleanupError } from './image-drop';
import { MAX_UPLOAD_BYTES } from './export-format';
import { createDesignerStore, type VideoOutput, type VideoTrack } from './designer.store';

vi.mock('./elements', () => ({
  probeImageNaturalSize: vi.fn(async () => ({ width: 100, height: 50 })),
}));

describe('imageDropTargetById', () => {
  it('accepts static image elements only', () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'image', type: 'image', x: 0, y: 0, width: 100, height: 100,
      rotation: 0, opacity: 1, locked: false, hidden: false, src: '/image.png',
    });
    store.getState().addElement({
      id: 'text', type: 'text', text: 'Not media', x: 0, y: 0, width: 100, height: 100,
      rotation: 0, opacity: 1, locked: false, hidden: false,
    });

    expect(imageDropTargetById(store, 'image')).toEqual({ kind: 'element', elementId: 'image' });
    expect(imageDropTargetById(store, 'text')).toBeNull();
    expect(imageDropTargetById(store, 'missing')).toBeNull();

    store.getState().updateElement('image', { locked: true });
    expect(imageDropTargetById(store, 'image')).toBeNull();
    store.getState().updateElement('image', { locked: false, hidden: true });
    expect(imageDropTargetById(store, 'image')).toBeNull();
  });

  it('accepts image and sticker clips but never video or audio', () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    const ensureTrack = (type: VideoTrack['type']) => {
      let output = store.getState().doc.outputs[0] as VideoOutput;
      let track = output.tracks.find((item) => item.type === type);
      if (!track) {
        store.getState().addTrack(0, type);
        output = store.getState().doc.outputs[0] as VideoOutput;
        track = output.tracks.find((item) => item.type === type);
      }
      return track!;
    };
    const video = ensureTrack('video');
    const image = ensureTrack('image');
    const sticker = ensureTrack('sticker');
    const audio = ensureTrack('audio');
    store.getState().addClip(0, video.id, {
      id: 'video', startMs: 0, endMs: 1000, src: '/video.mp4', mediaType: 'video',
    });
    store.getState().addClip(0, image.id, {
      id: 'still', startMs: 0, endMs: 1000, src: '/still.png', mediaType: 'image',
    });
    store.getState().addClip(0, sticker.id, {
      id: 'sticker', startMs: 0, endMs: 1000, src: '/sticker.png', mediaType: 'image',
    });
    store.getState().addClip(0, audio.id, {
      id: 'audio', startMs: 0, endMs: 1000, src: '/audio.mp3',
    });

    expect(imageDropTargetById(store, 'still')).toEqual({
      kind: 'clip',
      target: { outputIndex: 0, trackId: image.id, clipId: 'still' },
    });
    expect(imageDropTargetById(store, 'sticker')).toEqual({
      kind: 'clip',
      target: { outputIndex: 0, trackId: sticker.id, clipId: 'sticker' },
    });
    expect(imageDropTargetById(store, 'video')).toBeNull();
    expect(imageDropTargetById(store, 'audio')).toBeNull();
    store.getState().setTrackLocked(0, image.id, true);
    expect(imageDropTargetById(store, 'still')).toBeNull();
  });
});

describe('uploadDroppedImage', () => {
  const response = {
    ok: true,
    json: async () => ({ id: 'file-1', path: '/uploads/new.png' }),
  } as Response;

  it('uses upload-simple for small images', async () => {
    const fetch = vi.fn().mockResolvedValue(response);
    const file = new File(['small'], 'small.png', { type: 'image/png' });

    await expect(uploadDroppedImage(fetch, file)).resolves.toMatchObject({
      url: '/uploads/new.png',
      fileId: 'file-1',
      width: 100,
      height: 50,
    });
    expect(fetch).toHaveBeenCalledWith('/files/upload-simple', expect.objectContaining({ method: 'POST' }));
  });

  it('uses upload-server above the simple-upload cap', async () => {
    const fetch = vi.fn().mockResolvedValue(response);
    const file = new File(['large'], 'large.png', { type: 'image/png' });
    vi.spyOn(file, 'size', 'get').mockReturnValue(MAX_UPLOAD_BYTES + 1);

    await uploadDroppedImage(fetch, file);
    expect(fetch).toHaveBeenCalledWith('/files/upload-server', expect.objectContaining({ method: 'POST' }));
  });

  it('rejects an uploaded file that the browser cannot decode', async () => {
    const fetch = vi.fn().mockResolvedValue(response);
    const file = new File(['not an image'], 'broken.png', { type: 'image/png' });

    await expect(uploadDroppedImage(fetch, file, async () => null))
      .rejects.toThrow('Image decode failed');
  });
});

describe('replaceUploadedImageAtDropTarget', () => {
  const item = { url: '/uploads/new.png', fileId: 'new-file', width: 100, height: 50 };

  it('deletes the new upload when its target disappeared', async () => {
    const store = createDesignerStore();
    const fetch = vi.fn().mockResolvedValue({ ok: true });

    await expect(replaceUploadedImageAtDropTarget({
      fetch,
      store,
      target: { kind: 'element', elementId: 'missing' },
      item,
    })).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledWith('/files/new-file', { method: 'DELETE' });
  });

  it('surfaces a refused cleanup instead of silently orphaning the upload', async () => {
    const store = createDesignerStore();
    const fetch = vi.fn().mockResolvedValue({ ok: false });

    await expect(replaceUploadedImageAtDropTarget({
      fetch,
      store,
      target: { kind: 'element', elementId: 'missing' },
      item,
    })).rejects.toThrow('Uploaded image cleanup failed');
  });

  it('tells the user the uploaded file remains after refused cleanup', () => {
    const t = vi.fn((_key: string, fallback: string) => fallback);

    expect(imageDropErrorMessage(new UploadedImageCleanupError(), t)).toBe(
      'The image was uploaded, but the replacement could not be applied. The file remains in your library.'
    );
    expect(t).toHaveBeenCalledWith('designer_image_cleanup_failed', expect.any(String));
    expect(t).not.toHaveBeenCalledWith('failed_to_upload_file', expect.any(String));
  });

  it('attempts cleanup when applying the replacement throws', async () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'image', type: 'image', x: 0, y: 0, width: 100, height: 100,
      rotation: 0, opacity: 1, locked: false, hidden: false, src: '/old.png',
    });
    vi.spyOn(store.getState(), 'updateElementsSilent').mockImplementation(() => {
      throw new Error('write failed');
    });
    const fetch = vi.fn().mockResolvedValue({ ok: true });

    await expect(replaceUploadedImageAtDropTarget({
      fetch,
      store,
      target: { kind: 'element', elementId: 'image' },
      item,
    })).rejects.toThrow('write failed');
    expect(fetch).toHaveBeenCalledWith('/files/new-file', { method: 'DELETE' });
  });

  it('retains the uploaded file after a successful replacement', async () => {
    const store = createDesignerStore();
    store.getState().addElement({
      id: 'image', type: 'image', x: 0, y: 0, width: 100, height: 100,
      rotation: 0, opacity: 1, locked: false, hidden: false, src: '/old.png',
    });
    const fetch = vi.fn();

    await expect(replaceUploadedImageAtDropTarget({
      fetch,
      store,
      target: { kind: 'element', elementId: 'image' },
      item,
    })).resolves.toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
