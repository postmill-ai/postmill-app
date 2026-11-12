import { describe, expect, it } from 'vitest';
import { imageDropTargetById } from './image-drop';
import { createDesignerStore, type VideoOutput, type VideoTrack } from './designer.store';

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
  });
});
