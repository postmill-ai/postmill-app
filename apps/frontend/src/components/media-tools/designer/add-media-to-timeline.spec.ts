import { describe, it, expect, vi, afterEach } from 'vitest';
import { createDesignerStore } from './designer.store';
import { addMediaToTimeline } from './add-media-to-timeline';
import type { VideoOutput } from './designer.store';

/**
 * jsdom's video element never loads metadata, so stub createElement('video')
 * to fire onloadedmetadata with the probed values (or onerror when null).
 */
const stubVideoProbe = (
  meta: { duration: number; videoWidth: number; videoHeight: number } | null
) => {
  const original = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string, ...rest: any[]) => {
    const el = original(tag, ...(rest as []));
    if (tag === 'video') {
      if (meta) {
        Object.defineProperty(el, 'duration', { value: meta.duration });
        Object.defineProperty(el, 'videoWidth', { value: meta.videoWidth });
        Object.defineProperty(el, 'videoHeight', { value: meta.videoHeight });
        Object.defineProperty(el, 'src', {
          set: () => setTimeout(() => el.onloadedmetadata?.(new Event('loadedmetadata')), 0),
        });
      } else {
        Object.defineProperty(el, 'src', {
          set: () => setTimeout(() => el.onerror?.(new Event('error')), 0),
        });
      }
    }
    return el;
  });
};

const firstVideoClip = (store: ReturnType<typeof createDesignerStore>) => {
  const vo = store.getState().doc.outputs[0] as VideoOutput;
  const track = vo.tracks.find((t) => t.type === 'video');
  return { vo, clip: track?.clips[0] };
};

describe('addMediaToTimeline — clip geometry', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fits a portrait video into the canvas, centered and aspect-preserved', async () => {
    stubVideoProbe({ duration: 7.32, videoWidth: 1080, videoHeight: 1920 });
    const store = createDesignerStore();

    await addMediaToTimeline(store, { type: 'video', url: 'https://example.com/v.mp4' });

    const { vo, clip } = firstVideoClip(store);
    expect(clip).toBeDefined();
    // fitWithin(1080×1920 into 1080×1080): full height, proportional width.
    expect(clip!.height).toBe(vo.height);
    expect(clip!.width).toBe(Math.round(vo.height * (1080 / 1920)));
    expect(clip!.x).toBe(Math.round((vo.width - clip!.width!) / 2));
    expect(clip!.y).toBe(0);
    expect(clip!.naturalWidth).toBe(1080);
    expect(clip!.naturalHeight).toBe(1920);
  });

  it('falls back to the full canvas when metadata cannot be probed', async () => {
    stubVideoProbe(null);
    const store = createDesignerStore();

    await addMediaToTimeline(store, { type: 'video', url: 'https://example.com/broken.mp4' });

    const { vo, clip } = firstVideoClip(store);
    expect(clip).toBeDefined();
    expect(clip!.width).toBe(vo.width);
    expect(clip!.height).toBe(vo.height);
    expect(clip!.x).toBe(0);
    expect(clip!.y).toBe(0);
  });
});
