import { describe, it, expect, vi, afterEach } from 'vitest';
import { composeClipsAtPlayhead, findTransitionWindows, sourceTimeForPlayhead, VideoPreviewEngine } from './video-preview';
import { createDesignerStore } from './designer.store';
import type { VideoClip, VideoOutput, VideoTrack } from './designer.store';

const clip = (over: Partial<VideoClip> = {}): VideoClip =>
  ({ id: 'c1', startMs: 0, endMs: 4000, src: 'a.mp4', ...over }) as VideoClip;

const voWith = (clips: VideoClip[]): VideoOutput =>
  ({
    id: 'o1',
    formatId: 'square',
    name: 'Out',
    width: 1080,
    height: 1080,
    fps: 30,
    durationMs: 10000,
    tracks: [{ id: 't1', type: 'video', clips }],
  }) as VideoOutput;

describe('composeClipsAtPlayhead boundary inclusivity', () => {
  it('includes a clip at t=0 (its very first frame)', () => {
    const composed = composeClipsAtPlayhead(voWith([clip()]), 0);
    expect(composed.map((c) => c.clip.id)).toEqual(['c1']);
  });

  it('keeps the clip visible at exactly its endMs — last-frame hold, never blank', () => {
    const composed = composeClipsAtPlayhead(voWith([clip()]), 4000);
    expect(composed.map((c) => c.clip.id)).toEqual(['c1']);
  });

  it('drops the clip one millisecond past its end', () => {
    expect(composeClipsAtPlayhead(voWith([clip()]), 4001)).toHaveLength(0);
  });

  it('freeze extension stays visible through the freeze window', () => {
    const frozen = clip({ freezeAtMs: 2000 });
    expect(composeClipsAtPlayhead(voWith([frozen]), 6000).length).toBe(1);
    expect(composeClipsAtPlayhead(voWith([frozen]), 6001).length).toBe(0);
  });

  it('at a hard cut the outgoing last frame and the incoming first frame both resolve', () => {
    const a = clip({ id: 'a', startMs: 0, endMs: 4000 });
    const b = clip({ id: 'b', startMs: 4000, endMs: 8000 });
    const composed = composeClipsAtPlayhead(voWith([a, b]), 4000);
    expect(composed.map((c) => c.clip.id)).toEqual(['a', 'b']);
  });
});

describe('sourceTimeForPlayhead at the boundaries', () => {
  it('maps t=0 to the trim-in (not null)', () => {
    expect(sourceTimeForPlayhead(clip({ trimInMs: 500 }), 0)).toBe(500);
  });

  it('maps the exact end to the end of the source window (the held last frame)', () => {
    expect(sourceTimeForPlayhead(clip(), 4000)).toBe(4000);
    expect(sourceTimeForPlayhead(clip({ trimInMs: 500 }), 4000)).toBe(4500);
  });

  it('returns null only strictly outside the clip', () => {
    expect(sourceTimeForPlayhead(clip(), 4001)).toBeNull();
  });
});

describe('findTransitionWindows with a custom duration', () => {
  const trackWith = (durationMs: number): VideoTrack =>
    ({
      id: 't1',
      type: 'video',
      clips: [
        clip({ id: 'a', startMs: 0, endMs: 4000, transitionOut: { type: 'fade', durationMs } }),
        clip({ id: 'b', startMs: 4000, endMs: 8000, transitionIn: { type: 'fade', durationMs } }),
      ],
    }) as VideoTrack;

  it('sizes the window from the transition durationMs, not a hardcoded 500ms', () => {
    const [w] = findTransitionWindows(trackWith(1200));
    expect(w.durationMs).toBe(1200);
    expect(w.startMs).toBe(4000 - 1200);
    expect(w.endMs).toBe(4000);
  });

  it('shrinks the window when the duration is shorter than the default', () => {
    const [w] = findTransitionWindows(trackWith(200));
    expect(w.startMs).toBe(3800);
  });

  it('keeps the min-of-both-sides rule when the two clips disagree', () => {
    const track = {
      id: 't1',
      type: 'video',
      clips: [
        clip({ id: 'a', startMs: 0, endMs: 4000, transitionOut: { type: 'fade', durationMs: 1500 } }),
        clip({ id: 'b', startMs: 4000, endMs: 8000, transitionIn: { type: 'fade', durationMs: 700 } }),
      ],
    } as VideoTrack;
    const [w] = findTransitionWindows(track);
    expect(w.durationMs).toBe(700);
  });
});

describe('VideoPreviewEngine — muted tracks and looping', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const videoStoreWithAudio = (muted: boolean) => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    store.getState().addTrack(0, 'audio');
    const vo = store.getState().doc.outputs[0] as VideoOutput;
    const audioTrack = vo.tracks.find((t) => t.type === 'audio')!;
    store.getState().addClip(0, audioTrack.id, {
      id: 'a1',
      startMs: 0,
      endMs: 2000,
      src: 'https://example.com/a.mp3',
    } as VideoClip);
    if (muted) store.getState().setTrackMuted(0, audioTrack.id, true);
    return store;
  };

  it('a muted audio track never spins up a media element', () => {
    const store = videoStoreWithAudio(true);
    const engine = new VideoPreviewEngine(store);
    engine.seek(1000);
    expect((engine as any).audioElements.size).toBe(0);
    engine.destroy();
  });

  it('an audible track under the playhead does', () => {
    // jsdom's HTMLMediaElement.play is unimplemented — stub it so the engine's
    // `.play().catch()` chain doesn't explode on undefined.
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      value: vi.fn().mockResolvedValue(undefined),
      configurable: true,
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      value: vi.fn(),
      configurable: true,
    });
    const store = videoStoreWithAudio(false);
    const engine = new VideoPreviewEngine(store);
    engine.seek(1000);
    expect((engine as any).audioElements.size).toBe(1);
    engine.destroy();
  });

  it('loop playback wraps to 0 instead of ending', async () => {
    vi.useFakeTimers();
    const store = createDesignerStore();
    store.getState().setMode('video');
    store.getState().setVideoDuration(0, 1000);
    const engine = new VideoPreviewEngine(store);

    let ended = 0;
    const ticks: number[] = [];
    engine.play({ loop: true, onTick: (ms) => ticks.push(ms), onEnd: () => ended++ });
    // Two and a half durations' worth of wall time.
    await vi.advanceTimersByTimeAsync(2500);

    expect(ended).toBe(0);
    // Wrapped at least twice: the playhead returned to ~0 after each duration.
    expect(ticks.filter((ms) => ms === 0).length).toBeGreaterThanOrEqual(2);
    engine.destroy();
  });

  it('non-loop playback still ends at the duration', async () => {
    vi.useFakeTimers();
    const store = createDesignerStore();
    store.getState().setMode('video');
    store.getState().setVideoDuration(0, 1000);
    const engine = new VideoPreviewEngine(store);

    let ended = 0;
    engine.play({ onTick: () => {}, onEnd: () => ended++ });
    await vi.advanceTimersByTimeAsync(1500);

    expect(ended).toBe(1);
    engine.destroy();
  });
});
