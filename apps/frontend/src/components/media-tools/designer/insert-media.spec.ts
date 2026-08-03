import { describe, it, expect, vi, afterEach } from 'vitest';
import { createDesignerStore } from './designer.store';
import { addMediaToTimeline } from './add-media-to-timeline';

/**
 * Insert ▸ Video / Audio land on the timeline.
 *
 * The menu items are one line each; what matters is that what they hand off to
 * puts the clip on the right track — nothing in the Designer created a video or
 * audio clip from a file before.
 *
 * jsdom fires neither `loadedmetadata` nor `error` on a media element, so the
 * duration probe always falls through to its 5 s timeout. Fake timers skip that
 * wait rather than making every case take five seconds.
 */

afterEach(() => {
  vi.useRealTimers();
});

const land = async (
  store: ReturnType<typeof createDesignerStore>,
  options: Parameters<typeof addMediaToTimeline>[1]
) => {
  vi.useFakeTimers();
  const done = addMediaToTimeline(store, options);
  await vi.advanceTimersByTimeAsync(6000);
  await done;
};

const videoStore = () => {
  const store = createDesignerStore(1080, 1080);
  store.getState().setMode('video');
  return store;
};

const tracks = (store: ReturnType<typeof createDesignerStore>) =>
  (store.getState().doc.outputs[0] as never as {
    tracks: {
      id: string;
      type: string;
      clips: { src?: string; fileId?: string; startMs: number; endMs: number }[];
    }[];
  }).tracks;

describe('addMediaToTimeline', () => {
  it('creates a video track and lands the clip on it', async () => {
    const store = videoStore();
    await land(store, { type: 'video', url: 'https://x/clip.mp4' });

    const track = tracks(store).find((t) => t.type === 'video');
    expect(track).toBeTruthy();
    expect(track!.clips).toHaveLength(1);
    expect(track!.clips[0].src).toBe('https://x/clip.mp4');
  });

  it('creates an audio track for audio, not a video one', async () => {
    const store = videoStore();
    await land(store, { type: 'audio', url: 'https://x/song.mp3' });

    const audio = tracks(store).find((t) => t.type === 'audio');
    expect(audio).toBeTruthy();
    expect(audio!.clips[0].src).toBe('https://x/song.mp3');
  });

  it('reuses an existing track rather than stacking new ones', async () => {
    const store = videoStore();
    await land(store, { type: 'audio', url: 'https://x/a.mp3' });
    await land(store, { type: 'audio', url: 'https://x/b.mp3' });

    const audioTracks = tracks(store).filter((t) => t.type === 'audio');
    expect(audioTracks).toHaveLength(1);
    expect(audioTracks[0].clips).toHaveLength(2);
  });

  it('gives the clip a real duration even when the probe never resolves', async () => {
    const store = videoStore();
    await land(store, { type: 'video', url: 'https://x/clip.mp4' });
    const clip = tracks(store).find((t) => t.type === 'video')!.clips[0];
    expect(clip.endMs).toBeGreaterThan(clip.startMs);
  });

  it('carries the fileId through, so the clip references a real file', async () => {
    const store = videoStore();
    await land(store, { type: 'audio', url: 'https://x/song.mp3', fileId: 'file-123' });
    const clip = tracks(store).find((t) => t.type === 'audio')!.clips[0];
    expect(clip.fileId).toBe('file-123');
  });

  it('converts an image document to video rather than failing', async () => {
    // Documented behaviour: it switches modes if it has to. The Insert items are
    // gated on video mode anyway, so this only matters for the deep-link path.
    const store = createDesignerStore(1080, 1080);
    expect(store.getState().doc.mode).toBe('image');

    await land(store, { type: 'video', url: 'https://x/clip.mp4' });

    expect(store.getState().doc.mode).toBe('video');
    expect(tracks(store).find((t) => t.type === 'video')!.clips).toHaveLength(1);
  });
});
