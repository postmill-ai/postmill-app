import { describe, it, expect } from 'vitest';
import { composeClipsAtPlayhead, sourceTimeForPlayhead } from './video-preview';
import type { VideoClip, VideoOutput } from './designer.store';

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
