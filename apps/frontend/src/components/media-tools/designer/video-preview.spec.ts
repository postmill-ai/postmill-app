import { describe, it, expect, vi, afterEach } from 'vitest';
import { composeClipsAtPlayhead, fadeGainAt, findTransitionWindows, sourceTimeForPlayhead, VideoPreviewEngine } from './video-preview';
import { sourceTimeForPlayhead as sharedSourceTimeForPlayhead } from '@postmill-ai/nestjs-libraries/media/designer-doc/speed-curve';
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

describe('VideoPreviewEngine — keyframed volume and pitch', () => {
  const stubMedia = () => {
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      value: vi.fn().mockResolvedValue(undefined),
      configurable: true,
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      value: vi.fn(),
      configurable: true,
    });
  };

  const audioStoreWithClip = (clip: Partial<VideoClip>, trackGain?: number) => {
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
      ...clip,
    } as VideoClip);
    if (trackGain !== undefined) {
      store.getState().setTrackGain(0, audioTrack.id, trackGain);
    }
    return store;
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies the interpolated volume at the playhead, times track gain', () => {
    stubMedia();
    const store = audioStoreWithClip(
      {
        keyframes: [
          { tMs: 0, props: { volume: 0 } },
          { tMs: 2000, props: { volume: 1 } },
        ],
      },
      0.5
    );
    const engine = new VideoPreviewEngine(store);
    engine.seek(1000);
    const el = (engine as any).audioElements.get('a1') as HTMLAudioElement;
    expect(el).toBeTruthy();
    // Halfway up a linear 0→1 ramp, × 0.5 track gain.
    expect(el.volume).toBeCloseTo(0.25, 6);
    engine.destroy();
  });

  it('falls back to the base volume when no keyframe sets volume', () => {
    stubMedia();
    const store = audioStoreWithClip({
      volume: 0.6,
      keyframes: [{ tMs: 0, props: { x: 5 } }],
    });
    const engine = new VideoPreviewEngine(store);
    engine.seek(1000);
    const el = (engine as any).audioElements.get('a1') as HTMLAudioElement;
    expect(el.volume).toBeCloseTo(0.6, 6);
    engine.destroy();
  });

  it('drives a VIDEO element’s audio from the keyframes too, and keeps pitch', () => {
    stubMedia();
    const store = createDesignerStore();
    store.getState().setMode('video');
    const vo = store.getState().doc.outputs[0] as VideoOutput;
    const videoTrack = vo.tracks.find((t) => t.type === 'video');
    // A fresh store may have no video track yet — add one if so.
    const trackId = videoTrack
      ? videoTrack.id
      : (() => {
          store.getState().addTrack(0, 'video');
          const vo2 = store.getState().doc.outputs[0] as VideoOutput;
          return vo2.tracks.find((t) => t.type === 'video')!.id;
        })();
    store.getState().addClip(0, trackId, {
      id: 'v1',
      startMs: 0,
      endMs: 2000,
      src: 'https://example.com/v.mp4',
      speed: 2,
      keyframes: [
        { tMs: 0, props: { volume: 0.2 } },
        { tMs: 2000, props: { volume: 0.8 } },
      ],
    } as VideoClip);

    const engine = new VideoPreviewEngine(store);
    engine.seek(1000);
    const el = (engine as any).videoElements.get('v1') as HTMLVideoElement;
    expect(el).toBeTruthy();
    expect(el.volume).toBeCloseTo(0.5, 6);
    expect(el.playbackRate).toBe(2);
    // Explicit pitch preservation — ffmpeg's atempo on the export path is
    // pitch-preserving, so the preview must not chipmunk either.
    expect(el.preservesPitch).toBe(true);
    engine.destroy();
  });
});


describe('speed ramping in the preview', () => {
  const rampClip = (over: Partial<VideoClip> = {}): VideoClip =>
    ({
      id: 'r1',
      startMs: 0,
      endMs: 4000,
      src: 'a.mp4',
      speedCurve: [
        { atMs: 0, speed: 1 },
        { atMs: 1000, speed: 3 },
      ],
      ...over,
    }) as VideoClip;

  it('sourceTimeForPlayhead IS the shared module implementation (no local copy)', () => {
    // The drift pin: if video-preview ever grows its own mapping again, the
    // frame page (injected from the same module) and the preview diverge.
    expect(sourceTimeForPlayhead).toBe(sharedSourceTimeForPlayhead);
  });

  it('maps a ramped clip through the integrated curve', () => {
    // Trapezoid over [0,1000]: (1+3)/2*1000 = 2000 source ms, then a 3× hold.
    expect(sourceTimeForPlayhead(rampClip(), 1000)).toBeCloseTo(2000, 9);
    expect(sourceTimeForPlayhead(rampClip(), 4000)).toBeCloseTo(2000 + 3 * 3000, 9);
    expect(sourceTimeForPlayhead(rampClip(), 500)).toBeCloseTo(750, 9);
  });

  it('keeps constant-speed and freeze behavior byte-identical to before', () => {
    expect(sourceTimeForPlayhead(clip({ speed: 2, trimInMs: 100 }), 1500)).toBe(3100);
    expect(sourceTimeForPlayhead(clip({ speed: 0, trimInMs: 250 }), 2000)).toBe(250);
    expect(sourceTimeForPlayhead(clip({ freezeAtMs: 1000, speed: 2 }), 4500)).toBe(4000);
  });

  it('drives a ramped video element at the curve’s instantaneous rate per tick', () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    const vo = store.getState().doc.outputs[0] as VideoOutput;
    const trackId = vo.tracks[0].id;
    store.getState().addClip(0, trackId, {
      id: 'v1',
      startMs: 0,
      endMs: 4000,
      src: 'https://example.com/v.mp4',
      speedCurve: [
        { atMs: 0, speed: 1 },
        { atMs: 1000, speed: 3 },
      ],
    } as VideoClip);

    const engine = new VideoPreviewEngine(store);
    engine.seek(500);
    const el = (engine as any).videoElements.get('v1') as HTMLVideoElement;
    expect(el).toBeTruthy();
    // Mid-segment the curve reads 2×; pitch preservation stays on.
    expect(el.playbackRate).toBeCloseTo(2, 6);
    expect(el.preservesPitch).toBe(true);
    // The seek target is the integrated source time (750ms at t=500).
    expect(el.currentTime).toBeCloseTo(0.75, 6);
    engine.destroy();
  });
});

describe('composeClipsAtPlayhead — hidden tracks and transition semantics', () => {
  const transitionVo = (
    type: 'fade' | 'dissolve' | 'wipe' | 'blur' | 'zoom',
    durationMs = 1000
  ): VideoOutput =>
    ({
      id: 'o1',
      formatId: 'square',
      name: 'Out',
      width: 1080,
      height: 1080,
      fps: 30,
      durationMs: 10000,
      tracks: [
        {
          id: 't1',
          type: 'video',
          clips: [
            clip({ id: 'a', startMs: 0, endMs: 4000, width: 200, height: 100, transitionOut: { type, durationMs } }),
            clip({ id: 'b', startMs: 4000, endMs: 8000, width: 200, height: 100, transitionIn: { type, durationMs } }),
          ],
        },
      ],
    }) as VideoOutput;

  const propsOf = (vo: VideoOutput, ms: number, id: string) =>
    composeClipsAtPlayhead(vo, ms).find((c) => c.clip.id === id)?.props;

  it('a hidden track composes nothing (mirrors the frame renderer)', () => {
    const vo = voWith([clip()]) as VideoOutput & { tracks: VideoTrack[] };
    vo.tracks[0].hidden = true;
    expect(composeClipsAtPlayhead(vo, 1000)).toHaveLength(0);
  });

  it('fade goes THROUGH BLACK — both clips are invisible at the window midpoint', () => {
    const vo = transitionVo('fade');
    expect(propsOf(vo, 3500, 'a')?.opacity).toBe(0);
    expect(propsOf(vo, 3500, 'b')?.opacity).toBe(0);
    // First half belongs to the outgoing clip, second half to the incoming.
    expect(propsOf(vo, 3250, 'a')?.opacity).toBeCloseTo(0.5, 6);
    expect(propsOf(vo, 3250, 'b')?.opacity).toBe(0);
    expect(propsOf(vo, 3750, 'a')?.opacity).toBe(0);
    expect(propsOf(vo, 3750, 'b')?.opacity).toBeCloseTo(0.5, 6);
  });

  it('dissolve cross-mixes at the midpoint (the ramp fade used to share)', () => {
    const vo = transitionVo('dissolve');
    expect(propsOf(vo, 3500, 'a')?.opacity).toBeCloseTo(0.5, 6);
    expect(propsOf(vo, 3500, 'b')?.opacity).toBeCloseTo(0.5, 6);
  });

  it('wipe keeps both clips fully opaque and slides only the incoming one', () => {
    const vo = transitionVo('wipe');
    const out = propsOf(vo, 3500, 'a');
    expect(out?.opacity).toBe(1);
    expect(out?.x).toBeCloseTo(0, 6);
    const inc = propsOf(vo, 3500, 'b');
    expect(inc?.opacity).toBe(1);
    // Halfway in from the left: -((1 - 0.5) * 200).
    expect(inc?.x).toBeCloseTo(-100, 6);
  });

  it('blur ramps blurPx inversely to each clip\'s opacity', () => {
    const vo = transitionVo('blur');
    expect(propsOf(vo, 3000, 'a')?.blurPx ?? 0).toBeCloseTo(0, 6);
    expect(propsOf(vo, 4000, 'a')?.blurPx).toBeCloseTo(24, 6);
    expect(propsOf(vo, 3000, 'b')?.blurPx).toBeCloseTo(24, 6);
    expect(propsOf(vo, 4000, 'b')?.blurPx ?? 0).toBeCloseTo(0, 6);
  });

  it('zoom scales the incoming clip up into place', () => {
    const vo = transitionVo('zoom');
    const inc = propsOf(vo, 3000, 'b');
    expect(inc?.width).toBeCloseTo(120, 6); // 200 × 0.6
    const out = propsOf(vo, 4000, 'a');
    expect(out?.width).toBeCloseTo(280, 6); // 200 × 1.4
  });
});

describe('VideoPreviewEngine — hidden tracks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a hidden audio track never spins up a media element (like a muted one)', () => {
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
    store.getState().setTrackHidden(0, audioTrack.id, true);

    const engine = new VideoPreviewEngine(store);
    engine.seek(1000);
    expect((engine as any).audioElements.size).toBe(0);
    engine.destroy();
  });
});
describe('fadeGainAt — preview mirrors the export afade ramps', () => {
  it('is 1 for a clip without fades', () => {
    expect(fadeGainAt(clip(), 0)).toBe(1);
    expect(fadeGainAt(clip(), 2000)).toBe(1);
  });

  it('ramps up linearly over fadeInMs from the clip start', () => {
    const c = clip({ startMs: 1000, endMs: 5000, fadeInMs: 1000 });
    expect(fadeGainAt(c, 0)).toBe(0);
    expect(fadeGainAt(c, 500)).toBeCloseTo(0.5);
    expect(fadeGainAt(c, 1000)).toBe(1);
    expect(fadeGainAt(c, 3000)).toBe(1);
  });

  it('ramps down linearly over fadeOutMs toward the clip end', () => {
    const c = clip({ startMs: 0, endMs: 4000, fadeOutMs: 1000 });
    expect(fadeGainAt(c, 2000)).toBe(1);
    expect(fadeGainAt(c, 3500)).toBeCloseTo(0.5);
    expect(fadeGainAt(c, 4000)).toBe(0);
  });

  it('counts the freeze window toward the fade-out end (like getClipVisualState)', () => {
    const c = clip({ startMs: 0, endMs: 4000, freezeAtMs: 1000, fadeOutMs: 1000 });
    // Effective end is 5000 — at 4000 the fade has not started yet.
    expect(fadeGainAt(c, 4000)).toBe(1);
    expect(fadeGainAt(c, 4500)).toBeCloseTo(0.5);
    expect(fadeGainAt(c, 5000)).toBe(0);
  });
});

describe('VideoPreviewEngine — in-place src swap (regenerate)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a regenerated clip keeps its id but the cached audio element follows the new src', () => {
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      value: vi.fn().mockResolvedValue(undefined),
      configurable: true,
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      value: vi.fn(),
      configurable: true,
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'load', {
      value: vi.fn(),
      configurable: true,
    });

    const store = createDesignerStore();
    store.getState().setMode('video');
    store.getState().addTrack(0, 'audio');
    const vo = store.getState().doc.outputs[0] as VideoOutput;
    const audioTrack = vo.tracks.find((t) => t.type === 'audio')!;
    store.getState().addClip(0, audioTrack.id, {
      id: 'a1',
      startMs: 0,
      endMs: 2000,
      src: 'https://example.com/take-1.mp3',
    } as VideoClip);

    const engine = new VideoPreviewEngine(store);
    engine.seek(1000);
    const el = (engine as any).audioElements.get('a1') as HTMLAudioElement;
    expect(el.getAttribute('src')).toBe('https://example.com/take-1.mp3');

    // Regenerate swaps the src in place, same clip id — and clears the
    // demoted-media flag too, or a previously-failed clip would stay dead
    // after a successful regenerate.
    store.getState().updateClipSilent(0, audioTrack.id, 'a1', {
      src: 'https://example.com/take-2.mp3',
    });
    engine.seek(1000);
    expect((engine as any).audioElements.size).toBe(1);
    expect(el.getAttribute('src')).toBe('https://example.com/take-2.mp3');
    engine.destroy();
  });
});

describe('VideoPreviewEngine — failed media demotion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const stubMedia = () => {
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      value: vi.fn().mockResolvedValue(undefined),
      configurable: true,
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      value: vi.fn(),
      configurable: true,
    });
  };

  const audioStore = () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    store.getState().addTrack(0, 'audio');
    const vo = store.getState().doc.outputs[0] as VideoOutput;
    const audioTrack = vo.tracks.find((t) => t.type === 'audio')!;
    store.getState().addClip(0, audioTrack.id, {
      id: 'a1',
      startMs: 0,
      endMs: 2000,
      src: 'https://example.com/dead.mp3',
    } as VideoClip);
    return store;
  };

  it('logs and demotes a clip whose element errors, and stops driving it', () => {
    stubMedia();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = audioStore();
    const engine = new VideoPreviewEngine(store);
    engine.seek(1000);
    const el = (engine as any).audioElements.get('a1') as HTMLAudioElement;
    expect(el).toBeTruthy();

    el.dispatchEvent(new Event('error'));

    expect((engine as any).failedMedia.has('a1')).toBe(true);
    // The log carries the clip id AND src — the two things needed to find the
    // dead artifact.
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('a1'));
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('dead.mp3'));

    // Demoted: the per-tick path no longer seeks or plays the dead element.
    (el.play as ReturnType<typeof vi.fn>).mockClear();
    engine.seek(1500);
    expect(el.play).not.toHaveBeenCalled();
    engine.destroy();
  });

  it('a sibling clip keeps playing after another clip errors', () => {
    stubMedia();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = audioStore();
    const vo = store.getState().doc.outputs[0] as VideoOutput;
    const audioTrack = vo.tracks.find((t) => t.type === 'audio')!;
    store.getState().addClip(0, audioTrack.id, {
      id: 'a2',
      startMs: 0,
      endMs: 2000,
      src: 'https://example.com/fine.mp3',
    } as VideoClip);

    const engine = new VideoPreviewEngine(store);
    engine.seek(1000);
    const dead = (engine as any).audioElements.get('a1') as HTMLAudioElement;
    const fine = (engine as any).audioElements.get('a2') as HTMLAudioElement;
    dead.dispatchEvent(new Event('error'));

    (fine.play as ReturnType<typeof vi.fn>).mockClear();
    engine.seek(1500);
    expect(fine.play).toHaveBeenCalled();
    engine.destroy();
  });
});
