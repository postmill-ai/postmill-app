import { describe, it, expect, vi, afterEach } from 'vitest';
import { createDesignerStore } from './designer.store';
import { addImageClipToTimeline, addMediaToTimeline, addVoiceoverToTimeline, regenerateVoiceoverClip } from './add-media-to-timeline';
import { DEFAULT_CLIP_MS } from './add-text';
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

describe('addImageClipToTimeline', () => {
  afterEach(() => vi.restoreAllMocks());

  const toVideoMode = (store: ReturnType<typeof createDesignerStore>) => {
    store.getState().setMode('video');
    return store.getState().doc.outputs[0] as VideoOutput;
  };

  const firstImageClip = (store: ReturnType<typeof createDesignerStore>) => {
    const vo = store.getState().doc.outputs[0] as VideoOutput;
    const track = vo.tracks.find((t) => t.type === 'image');
    return { vo, track, clip: track?.clips[0] };
  };

  it('does nothing in an image document', () => {
    const store = createDesignerStore();
    expect(store.getState().doc.mode).toBe('image');
    const id = addImageClipToTimeline(store, { url: 'https://example.com/a.png', width: 400, height: 300 });
    expect(id).toBeNull();
  });

  it('creates an image track and lands a 4 s clip at the playhead', () => {
    const store = createDesignerStore();
    const vo = toVideoMode(store);
    store.getState().setPlayhead(2000);

    const id = addImageClipToTimeline(store, {
      url: 'https://example.com/a.png',
      fileId: 'file-1',
      width: 1600,
      height: 900,
    });

    expect(id).toBeTruthy();
    const { track, clip } = firstImageClip(store);
    expect(track).toBeDefined();
    expect(clip).toBeDefined();
    expect(clip!.startMs).toBe(2000);
    expect(clip!.endMs).toBe(2000 + DEFAULT_CLIP_MS);
    expect(clip!.src).toBe('https://example.com/a.png');
    expect(clip!.fileId).toBe('file-1');
    // fitWithin(1600×900 into 864×864): width-bounded, aspect preserved.
    expect(clip!.width).toBe(Math.round(vo.width * 0.8));
    expect(clip!.height).toBe(Math.round(vo.width * 0.8 * (900 / 1600)));
    expect(clip!.x).toBe(Math.round((vo.width - clip!.width!) / 2));
    expect(clip!.y).toBe(Math.round((vo.height - clip!.height!) / 2));
    expect(clip!.naturalWidth).toBe(1600);
    // The new clip is selected, like an inserted text clip.
    expect(store.getState().selectedClip?.clipId).toBe(id);
  });

  it('extends the output duration when the clip would run past the end', () => {
    const store = createDesignerStore();
    toVideoMode(store);
    const before = (store.getState().doc.outputs[0] as VideoOutput).durationMs;
    store.getState().setPlayhead(before - 1000);

    const id = addImageClipToTimeline(store, { url: 'https://example.com/a.png', width: 100, height: 100 });

    expect(id).toBeTruthy();
    const { vo, clip } = firstImageClip(store);
    expect(vo.durationMs).toBe(before - 1000 + DEFAULT_CLIP_MS);
    expect(clip!.endMs).toBe(clip!.startMs + DEFAULT_CLIP_MS);
  });

  it('places icon picks as a centered square without probing', () => {
    const store = createDesignerStore();
    const vo = toVideoMode(store);

    addImageClipToTimeline(store, { url: 'https://api.iconify.design/mdi/play.svg', square: true });

    const { clip } = firstImageClip(store);
    const side = Math.round(Math.min(vo.width, vo.height) * 0.2);
    expect(clip!.width).toBe(side);
    expect(clip!.height).toBe(side);
    expect(clip!.x).toBe(Math.round((vo.width - side) / 2));
    expect(clip!.y).toBe(Math.round((vo.height - side) / 2));
    expect(clip!.naturalWidth).toBeUndefined();
  });

  it('reuses an existing image track rather than adding a second one', () => {
    const store = createDesignerStore();
    toVideoMode(store);

    addImageClipToTimeline(store, { url: 'https://example.com/a.png', width: 100, height: 100 });
    addImageClipToTimeline(store, { url: 'https://example.com/b.png', width: 100, height: 100 });

    const vo = store.getState().doc.outputs[0] as VideoOutput;
    const imageTracks = vo.tracks.filter((t) => t.type === 'image');
    expect(imageTracks).toHaveLength(1);
    expect(imageTracks[0].clips).toHaveLength(2);
  });
});

describe('addVoiceoverToTimeline — shared TTS/recording landing', () => {
  afterEach(() => vi.restoreAllMocks());

  /** Same probe stub as the video variant, for the audio element. */
  const stubAudioProbe = (durationSec: number | null) => {
    const original = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, ...rest: any[]) => {
      const el = original(tag, ...(rest as []));
      if (tag === 'audio') {
        if (durationSec !== null) {
          Object.defineProperty(el, 'duration', { value: durationSec });
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

  const toVideoMode = (store: ReturnType<typeof createDesignerStore>) => {
    store.getState().setMode('video');
    return store.getState().doc.outputs[0] as VideoOutput;
  };

  const firstAudioClip = (store: ReturnType<typeof createDesignerStore>) => {
    const vo = store.getState().doc.outputs[0] as VideoOutput;
    const track = vo.tracks.find((t) => t.type === 'audio');
    return { vo, track, clip: track?.clips[0] };
  };

  it('does nothing in an image document', async () => {
    const store = createDesignerStore();
    expect(store.getState().doc.mode).toBe('image');
    const landed = await addVoiceoverToTimeline(store, {
      url: 'https://example.com/v.webm',
      fileId: 'file-v',
      durationMs: 3000,
    });
    expect(landed).toBe(false);
    const vo = store.getState().doc.outputs[0] as VideoOutput;
    expect(vo.tracks ?? []).toHaveLength(0);
  });

  it('creates the audio track and clips in at the playhead at volume 1', async () => {
    const store = createDesignerStore();
    const vo = toVideoMode(store);
    store.getState().setPlayhead(1500);

    const landed = await addVoiceoverToTimeline(store, {
      url: 'https://example.com/v.webm',
      fileId: 'file-v',
      durationMs: 4000,
    });

    expect(landed).toBe(true);
    const { track, clip } = firstAudioClip(store);
    expect(track).toBeDefined();
    expect(clip).toBeDefined();
    expect(clip!.startMs).toBe(1500);
    expect(clip!.endMs).toBe(5500);
    expect(clip!.src).toBe('https://example.com/v.webm');
    // fileId keeps the doc-file-refs reference (purge scans keep it).
    expect(clip!.fileId).toBe('file-v');
    expect(clip!.volume).toBe(1);
  });

  it('probes the real duration when none is given', async () => {
    stubAudioProbe(7.25);
    const store = createDesignerStore();
    toVideoMode(store);

    await addVoiceoverToTimeline(store, { url: 'https://example.com/tts.mp3' });

    const { clip } = firstAudioClip(store);
    expect(clip!.endMs - clip!.startMs).toBe(7250);
  });

  it('clamps the clip at the output duration instead of extending', async () => {
    const store = createDesignerStore();
    const vo = toVideoMode(store);
    store.getState().setPlayhead(vo.durationMs - 1000);

    const landed = await addVoiceoverToTimeline(store, {
      url: 'https://example.com/v.webm',
      durationMs: 5000,
    });

    expect(landed).toBe(true);
    const { clip } = firstAudioClip(store);
    expect(clip!.endMs).toBe(vo.durationMs);
  });

  it('returns false when the playhead is at the very end', async () => {
    const store = createDesignerStore();
    const vo = toVideoMode(store);
    store.getState().setPlayhead(vo.durationMs);

    const landed = await addVoiceoverToTimeline(store, {
      url: 'https://example.com/v.webm',
      durationMs: 5000,
    });

    expect(landed).toBe(false);
    const { track } = firstAudioClip(store);
    expect(track?.clips ?? []).toHaveLength(0);
  });

  it('reuses an existing audio track', async () => {
    const store = createDesignerStore();
    toVideoMode(store);

    await addVoiceoverToTimeline(store, { url: 'https://example.com/a.webm', durationMs: 1000 });
    await addVoiceoverToTimeline(store, { url: 'https://example.com/b.webm', durationMs: 1000 });

    const vo = store.getState().doc.outputs[0] as VideoOutput;
    const audioTracks = vo.tracks.filter((t) => t.type === 'audio');
    expect(audioTracks).toHaveLength(1);
    expect(audioTracks[0].clips).toHaveLength(2);
  });
});

describe('voiceover metadata + regenerateVoiceoverClip', () => {
  afterEach(() => vi.restoreAllMocks());

  const stubAudioProbe = (durationSec: number | null) => {
    const original = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, ...rest: any[]) => {
      const el = original(tag, ...(rest as []));
      if (tag === 'audio') {
        if (durationSec !== null) {
          Object.defineProperty(el, 'duration', { value: durationSec });
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

  const seedVoiceoverClip = async (store: ReturnType<typeof createDesignerStore>) => {
    store.getState().setMode('video');
    await addVoiceoverToTimeline(store, {
      url: 'https://example.com/tts-1.mp3',
      fileId: 'file-1',
      durationMs: 3000,
      voiceover: { script: 'hello world', voice: 'alloy' },
    });
    const vo = store.getState().doc.outputs[0] as VideoOutput;
    const track = vo.tracks.find((t) => t.type === 'audio')!;
    return { vo, track, clip: track.clips[0] };
  };

  it('persists the script + voice on the landed clip', async () => {
    const store = createDesignerStore();
    const { clip } = await seedVoiceoverClip(store);
    expect(clip.voiceover).toEqual({ script: 'hello world', voice: 'alloy' });
  });

  it('leaves mic recordings (no metadata) without the field', async () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    await addVoiceoverToTimeline(store, {
      url: 'https://example.com/mic.webm',
      fileId: 'file-mic',
      durationMs: 2000,
    });
    const vo = store.getState().doc.outputs[0] as VideoOutput;
    const clip = vo.tracks.find((t) => t.type === 'audio')!.clips[0];
    expect(clip.voiceover).toBeUndefined();
  });

  it('swaps src/fileId in place, keeps the timeline start, re-probes the end', async () => {
    const store = createDesignerStore();
    const { track, clip } = await seedVoiceoverClip(store);
    stubAudioProbe(5.25); // the new render is longer

    const ok = await regenerateVoiceoverClip(
      store,
      { outputIndex: 0, trackId: track.id, clipId: clip.id },
      {
        url: 'https://example.com/tts-2.mp3',
        fileId: 'file-2',
        voiceover: { script: 'hello world', voice: 'coral' },
      }
    );

    expect(ok).toBe(true);
    const after = (store.getState().doc.outputs[0] as VideoOutput).tracks
      .find((t) => t.id === track.id)!
      .clips.find((c) => c.id === clip.id)!;
    expect(after.id).toBe(clip.id);
    expect(after.startMs).toBe(clip.startMs);
    expect(after.src).toBe('https://example.com/tts-2.mp3');
    expect(after.fileId).toBe('file-2');
    expect(after.endMs).toBe(clip.startMs + 5250);
    expect(after.voiceover).toEqual({ script: 'hello world', voice: 'coral' });
  });

  it('clamps the re-probed end at the output duration', async () => {
    const store = createDesignerStore();
    const { vo, track, clip } = await seedVoiceoverClip(store);
    stubAudioProbe(3600); // far past the output duration

    const ok = await regenerateVoiceoverClip(
      store,
      { outputIndex: 0, trackId: track.id, clipId: clip.id },
      { url: 'https://example.com/long.mp3', fileId: 'file-3' }
    );

    expect(ok).toBe(true);
    const after = (store.getState().doc.outputs[0] as VideoOutput).tracks
      .find((t) => t.id === track.id)!
      .clips.find((c) => c.id === clip.id)!;
    expect(after.endMs).toBe(vo.durationMs);
  });

  it('returns false for a clip that no longer exists', async () => {
    const store = createDesignerStore();
    const { track } = await seedVoiceoverClip(store);

    const ok = await regenerateVoiceoverClip(
      store,
      { outputIndex: 0, trackId: track.id, clipId: 'gone' },
      { url: 'https://example.com/x.mp3', durationMs: 1000 }
    );
    expect(ok).toBe(false);
  });
});
