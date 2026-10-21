import { describe, it, expect, vi, afterEach } from 'vitest';
import { createDesignerStore } from './designer.store';
import { addImageClipToTimeline, addMediaToTimeline, addVoiceoverToTimeline, regenerateVoiceoverClip, pollMediaJobArtifact } from './add-media-to-timeline';
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

describe('pollMediaJobArtifact — job-status polling resilience', () => {
  afterEach(() => vi.restoreAllMocks());

  const messages = {
    checkFailed: 'Failed to check job status',
    noArtifact: 'Job completed but no artifact',
    generationFailed: 'Generation failed',
  };
  const noSleep = () => Promise.resolve();
  const okJob = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body }) as Response;
  const badJob = (status: number) =>
    ({ ok: false, status, json: async () => ({}) }) as Response;

  it('returns the artifact URL and file id on completion', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(okJob({ status: 'pending' }))
      .mockResolvedValueOnce(
        okJob({ status: 'completed', artifactUrl: '/uploads/v.mp4', fileId: 'file-9' })
      );

    const outcome = await pollMediaJobArtifact({
      jobId: 'job-1',
      fetch,
      isMounted: () => true,
      messages,
      sleep: noSleep,
    });

    expect(outcome).toEqual({ kind: 'completed', url: '/uploads/v.mp4', fileId: 'file-9' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries a transient 5xx instead of aborting the poll', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(badJob(503))
      .mockResolvedValueOnce(badJob(502))
      .mockResolvedValueOnce(
        okJob({ status: 'completed', artifactUrl: '/uploads/v.mp4', fileId: null })
      );

    const outcome = await pollMediaJobArtifact({
      jobId: 'job-1',
      fetch,
      isMounted: () => true,
      messages,
      sleep: noSleep,
    });

    expect(outcome).toEqual({ kind: 'completed', url: '/uploads/v.mp4', fileId: null });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('treats a network-level throw as transient too', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(okJob({ status: 'completed', artifactUrl: '/uploads/v.mp4' }));

    const outcome = await pollMediaJobArtifact({
      jobId: 'job-1',
      fetch,
      isMounted: () => true,
      messages,
      sleep: noSleep,
    });

    expect(outcome).toMatchObject({ kind: 'completed', url: '/uploads/v.mp4' });
  });

  it('gives up after three transient failures in a row', async () => {
    const fetch = vi.fn().mockResolvedValue(badJob(500));

    await expect(
      pollMediaJobArtifact({ jobId: 'job-1', fetch, isMounted: () => true, messages, sleep: noSleep })
    ).rejects.toThrow('Failed to check job status');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('a non-transient non-OK (404) aborts immediately', async () => {
    const fetch = vi.fn().mockResolvedValue(badJob(404));

    await expect(
      pollMediaJobArtifact({ jobId: 'job-1', fetch, isMounted: () => true, messages, sleep: noSleep })
    ).rejects.toThrow('Failed to check job status');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("throws the job's own error when the job failed", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(okJob({ status: 'failed', error: 'provider exploded' }));

    await expect(
      pollMediaJobArtifact({ jobId: 'job-1', fetch, isMounted: () => true, messages, sleep: noSleep })
    ).rejects.toThrow('provider exploded');
  });

  it('throws when the job completes without an artifact', async () => {
    const fetch = vi.fn().mockResolvedValue(okJob({ status: 'completed' }));

    await expect(
      pollMediaJobArtifact({ jobId: 'job-1', fetch, isMounted: () => true, messages, sleep: noSleep })
    ).rejects.toThrow('Job completed but no artifact');
  });

  it('stops without erroring when the timeline unmounted', async () => {
    const fetch = vi.fn().mockResolvedValue(okJob({ status: 'pending' }));

    const outcome = await pollMediaJobArtifact({
      jobId: 'job-1',
      fetch,
      isMounted: () => false,
      messages,
      sleep: noSleep,
    });

    expect(outcome).toEqual({ kind: 'unmounted' });
  });
});

describe('addMediaToTimeline — clip geometry', () => {
  afterEach(() => vi.restoreAllMocks());

  it('carries the generation fileId onto the clip (retention purge keep-list)', async () => {
    stubVideoProbe({ duration: 5, videoWidth: 1080, videoHeight: 1080 });
    const store = createDesignerStore();

    await addMediaToTimeline(store, {
      type: 'video',
      url: 'https://example.com/v.mp4',
      fileId: 'file-gen-1',
    });

    const { clip } = firstVideoClip(store);
    expect(clip!.fileId).toBe('file-gen-1');
  });

  it('fits a portrait video into the canvas, centered and aspect-preserved', async () => {
    stubVideoProbe({ duration: 7.32, videoWidth: 1080, videoHeight: 1920 });
    const store = createDesignerStore();

    const landed = await addMediaToTimeline(store, { type: 'video', url: 'https://example.com/v.mp4' });

    expect(landed!.probeFailed).toBe(false);
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

    const landed = await addMediaToTimeline(store, { type: 'video', url: 'https://example.com/broken.mp4' });

    // The clip lands with the 10s fallback AND flags the probe failure so the
    // caller can warn instead of the drop failing silently.
    expect(landed!.probeFailed).toBe(true);
    const { vo, clip } = firstVideoClip(store);
    expect(clip).toBeDefined();
    expect(clip!.endMs).toBe(10000);
    expect(clip!.width).toBe(vo.width);
    expect(clip!.height).toBe(vo.height);
    expect(clip!.x).toBe(0);
    expect(clip!.y).toBe(0);
  });
});

describe('addMediaToTimeline — output duration', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lands a second video drop on a NEW track instead of stacking at t=0', async () => {
    // Both drops land at the timeline start — the second must not pile on top
    // of the first on the same track.
    stubVideoProbe({ duration: 5, videoWidth: 1080, videoHeight: 1080 });
    const store = createDesignerStore();

    await addMediaToTimeline(store, { type: 'video', url: 'https://example.com/a.mp4' });
    await addMediaToTimeline(store, { type: 'video', url: 'https://example.com/b.mp4' });

    const vo = store.getState().doc.outputs[0] as VideoOutput;
    const videoTracks = vo.tracks.filter((t) => t.type === 'video');
    expect(videoTracks).toHaveLength(2);
    expect(videoTracks[0].clips.map((c) => c.src)).toEqual(['https://example.com/a.mp4']);
    expect(videoTracks[1].clips.map((c) => c.src)).toEqual(['https://example.com/b.mp4']);
  });

  it('never shrinks the output duration when the drop is shorter than the timeline', async () => {
    // Regression: a 5.11s music drop onto a 10s reel set durationMs to 5110,
    // stranding every clip that ran past it.
    stubVideoProbe({ duration: 5.11, videoWidth: 1080, videoHeight: 1080 });
    const store = createDesignerStore();
    store.getState().setMode('video');
    store.getState().setVideoDuration(0, 30000);

    await addMediaToTimeline(store, { type: 'video', url: 'https://example.com/short.mp4' });

    const { vo, clip } = firstVideoClip(store);
    expect(vo.durationMs).toBe(30000);
    expect(clip!.endMs).toBe(5110);
  });

  it('still extends the output duration when the drop runs past it', async () => {
    stubVideoProbe({ duration: 20, videoWidth: 1080, videoHeight: 1080 });
    const store = createDesignerStore();

    await addMediaToTimeline(store, { type: 'video', url: 'https://example.com/long.mp4' });

    const { vo, clip } = firstVideoClip(store);
    expect(vo.durationMs).toBe(20000);
    expect(clip!.endMs).toBe(20000);
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

  it('reuses an existing image track when its window is free at the playhead', () => {
    const store = createDesignerStore();
    toVideoMode(store);

    addImageClipToTimeline(store, { url: 'https://example.com/a.png', width: 100, height: 100 });
    // Move the playhead past the first clip so the window is free again.
    store.getState().setPlayhead(DEFAULT_CLIP_MS + 1000);
    addImageClipToTimeline(store, { url: 'https://example.com/b.png', width: 100, height: 100 });

    const vo = store.getState().doc.outputs[0] as VideoOutput;
    const imageTracks = vo.tracks.filter((t) => t.type === 'image');
    expect(imageTracks).toHaveLength(1);
    expect(imageTracks[0].clips).toHaveLength(2);
  });

  it('creates a second image track when the first is occupied at the playhead', () => {
    const store = createDesignerStore();
    toVideoMode(store);

    // Both inserts at playhead 0: stacking the second on top of the first is
    // exactly the pile-up multi-track landing exists to prevent.
    addImageClipToTimeline(store, { url: 'https://example.com/a.png', width: 100, height: 100 });
    addImageClipToTimeline(store, { url: 'https://example.com/b.png', width: 100, height: 100 });

    const vo = store.getState().doc.outputs[0] as VideoOutput;
    const imageTracks = vo.tracks.filter((t) => t.type === 'image');
    expect(imageTracks).toHaveLength(2);
    expect(imageTracks[0].clips.map((c) => c.src)).toEqual(['https://example.com/a.png']);
    expect(imageTracks[1].clips.map((c) => c.src)).toEqual(['https://example.com/b.png']);
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

    expect(landed).toBe('playhead');
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

    expect(landed).toBe('playhead');
    const { clip } = firstAudioClip(store);
    expect(clip!.endMs).toBe(vo.durationMs);
  });

  it('relocates to the timeline start when the playhead is at the very end', async () => {
    // Regression: playhead == durationMs used to return false — the generated
    // file was orphaned and the caller toasted "Voiceover generation failed".
    const store = createDesignerStore();
    const vo = toVideoMode(store);
    store.getState().setPlayhead(vo.durationMs);

    const landed = await addVoiceoverToTimeline(store, {
      url: 'https://example.com/v.webm',
      durationMs: 5000,
    });

    expect(landed).toBe('relocated');
    const { clip } = firstAudioClip(store);
    expect(clip).toBeDefined();
    expect(clip!.startMs).toBe(0);
    expect(clip!.endMs).toBe(5000);
  });

  it('relocates after the last same-track clip when the whole clip fits there', async () => {
    const store = createDesignerStore();
    const vo = toVideoMode(store);

    await addVoiceoverToTimeline(store, { url: 'https://example.com/a.webm', durationMs: 2000 });
    store.getState().setPlayhead(vo.durationMs);

    const landed = await addVoiceoverToTimeline(store, {
      url: 'https://example.com/b.webm',
      durationMs: 3000,
    });

    expect(landed).toBe('relocated');
    const track = (store.getState().doc.outputs[0] as VideoOutput).tracks.find((t) => t.type === 'audio')!;
    const second = track.clips.find((c) => c.src === 'https://example.com/b.webm')!;
    expect(second.startMs).toBe(2000);
    expect(second.endMs).toBe(5000);
  });

  it('clamps a clip longer than the whole output to the output length instead of failing', async () => {
    const store = createDesignerStore();
    const vo = toVideoMode(store);
    store.getState().setPlayhead(vo.durationMs);

    const landed = await addVoiceoverToTimeline(store, {
      url: 'https://example.com/long.webm',
      durationMs: vo.durationMs * 3,
    });

    expect(landed).toBe('relocated');
    const { clip } = firstAudioClip(store);
    expect(clip!.startMs).toBe(0);
    expect(clip!.endMs).toBe(vo.durationMs);
  });

  it('relocates when the playhead leaves less than the minimum clip length', async () => {
    // addClip enforces a 100ms floor — 50ms of room would be silently dropped
    // by the store even if the helper returned success.
    const store = createDesignerStore();
    const vo = toVideoMode(store);
    store.getState().setPlayhead(vo.durationMs - 50);

    const landed = await addVoiceoverToTimeline(store, {
      url: 'https://example.com/v.webm',
      durationMs: 5000,
    });

    expect(landed).toBe('relocated');
    const { clip } = firstAudioClip(store);
    expect(clip!.startMs).toBe(0);
  });

  it('reuses an existing audio track when its window is free at the playhead', async () => {
    const store = createDesignerStore();
    toVideoMode(store);

    await addVoiceoverToTimeline(store, { url: 'https://example.com/a.webm', durationMs: 1000 });
    store.getState().setPlayhead(2000);
    await addVoiceoverToTimeline(store, { url: 'https://example.com/b.webm', durationMs: 1000 });

    const vo = store.getState().doc.outputs[0] as VideoOutput;
    const audioTracks = vo.tracks.filter((t) => t.type === 'audio');
    expect(audioTracks).toHaveLength(1);
    expect(audioTracks[0].clips).toHaveLength(2);
  });

  it('lands a second voiceover at the same playhead on a NEW audio track', async () => {
    const store = createDesignerStore();
    toVideoMode(store);

    await addVoiceoverToTimeline(store, { url: 'https://example.com/a.webm', durationMs: 1000 });
    const landed = await addVoiceoverToTimeline(store, { url: 'https://example.com/b.webm', durationMs: 1000 });

    expect(landed).toBe('playhead');
    const vo = store.getState().doc.outputs[0] as VideoOutput;
    const audioTracks = vo.tracks.filter((t) => t.type === 'audio');
    expect(audioTracks).toHaveLength(2);
    expect(audioTracks[0].clips.map((c) => c.src)).toEqual(['https://example.com/a.webm']);
    expect(audioTracks[1].clips.map((c) => c.src)).toEqual(['https://example.com/b.webm']);
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

  it('heals a clip left out of bounds by a duration shrink instead of failing the swap', async () => {
    // A clip whose start sits at/past the output end used to invert
    // (min(start + probed, duration) <= start) and the regen was rejected —
    // the freshly rendered file was orphaned with a "generation failed" toast.
    const store = createDesignerStore();
    store.getState().setMode('video');
    store.getState().setPlayhead(3000);
    await addVoiceoverToTimeline(store, {
      url: 'https://example.com/tts-1.mp3',
      fileId: 'file-1',
      durationMs: 3000,
      voiceover: { script: 'hello world', voice: 'alloy' },
    });
    const before = store.getState().doc.outputs[0] as VideoOutput;
    const track = before.tracks.find((t) => t.type === 'audio')!;
    const clip = track.clips[0];
    // Shrink the output so the clip start (3000) is past the new end (1000).
    store.getState().setVideoDuration(0, 1000);

    const ok = await regenerateVoiceoverClip(
      store,
      { outputIndex: 0, trackId: track.id, clipId: clip.id },
      { url: 'https://example.com/tts-2.mp3', fileId: 'file-2', durationMs: 500 }
    );

    expect(ok).toBe(true);
    const after = (store.getState().doc.outputs[0] as VideoOutput).tracks
      .find((t) => t.id === track.id)!
      .clips.find((c) => c.id === clip.id)!;
    expect(after.src).toBe('https://example.com/tts-2.mp3');
    expect(after.startMs).toBeLessThan(after.endMs);
    expect(after.endMs).toBe(1000);
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
