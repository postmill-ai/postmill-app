import { describe, it, expect } from 'vitest';
import { capCompositionDuration } from './composition-cap';
import type { VideoOutput } from './designer-doc.schema';

const makeOutput = (durationMs = 10000): VideoOutput => ({
  id: 'vo-1',
  formatId: 'reel',
  name: 'Reel',
  width: 1080,
  height: 1920,
  fps: 30,
  durationMs,
  tracks: [
    {
      id: 't1',
      type: 'video',
      clips: [
        { id: 'c1', startMs: 0, endMs: 4000, src: 'a.mp4', trimInMs: 500 },
        { id: 'c2', startMs: 4000, endMs: 8000, src: 'b.mp4' },
        { id: 'c3', startMs: 8000, endMs: 10000, src: 'c.mp4' },
      ],
    },
    {
      id: 't2',
      type: 'audio',
      clips: [{ id: 'a1', startMs: 0, endMs: 10000, src: 'song.mp3' }],
    },
  ],
});

describe('capCompositionDuration', () => {
  it('caps durationMs and truncates the straddling clip', () => {
    const capped = capCompositionDuration(makeOutput(), 3000);
    expect(capped.durationMs).toBe(3000);
    const clips = capped.tracks[0].clips;
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({ id: 'c1', startMs: 0, endMs: 3000, trimInMs: 500 });
    // Audio truncates the same way.
    expect(capped.tracks[1].clips[0]).toMatchObject({ id: 'a1', endMs: 3000 });
  });

  it('drops clips starting at or after the cap', () => {
    // c2 starts exactly at 4000 — a cap of 4000 drops it, 4001 keeps it.
    expect(
      capCompositionDuration(makeOutput(), 4000).tracks[0].clips.map((c) => c.id),
    ).toEqual(['c1']);
    const capped = capCompositionDuration(makeOutput(), 4001);
    expect(capped.tracks[0].clips.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('keeps in-clip timelines (keyframes, speed curves) untouched', () => {
    const output = makeOutput();
    output.tracks[0].clips[0].keyframes = [
      { tMs: 0, props: { x: 0 } },
      { tMs: 3900, props: { x: 100 } },
    ];
    output.tracks[0].clips[0].speedCurve = [
      { atMs: 0, speed: 1 },
      { atMs: 2000, speed: 2 },
      { atMs: 3900, speed: 0.5 },
    ];
    const capped = capCompositionDuration(output, 3000);
    expect(capped.tracks[0].clips[0].keyframes).toHaveLength(2);
    expect(capped.tracks[0].clips[0].speedCurve).toHaveLength(3);
  });

  it('clamps a freeze tail so endMs + freezeAtMs never exceeds the cap', () => {
    const output = makeOutput();
    output.tracks[0].clips[0] = { ...output.tracks[0].clips[0], endMs: 2000, freezeAtMs: 5000 };
    const capped = capCompositionDuration(output, 3000);
    const clip = capped.tracks[0].clips[0];
    expect(clip.endMs).toBe(2000);
    expect(clip.freezeAtMs).toBe(1000);
  });

  it('zeroes the freeze tail of a clip truncated at the cap', () => {
    const output = makeOutput();
    output.tracks[0].clips[0].freezeAtMs = 2000;
    const capped = capCompositionDuration(output, 3000);
    expect(capped.tracks[0].clips[0]).toMatchObject({ endMs: 3000, freezeAtMs: 0 });
  });

  it('is a no-op copy when the composition is already shorter than the cap', () => {
    const output = makeOutput(2000);
    const capped = capCompositionDuration(output, 20000);
    expect(capped.durationMs).toBe(2000);
    expect(capped).not.toBe(output);
    expect(capped.tracks[0].clips.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('does not mutate the input', () => {
    const output = makeOutput();
    const before = JSON.stringify(output);
    capCompositionDuration(output, 3000);
    expect(JSON.stringify(output)).toBe(before);
  });

  it('drops everything when the cap is 0', () => {
    const capped = capCompositionDuration(makeOutput(), 0);
    expect(capped.durationMs).toBe(0);
    expect(capped.tracks.every((t) => t.clips.length === 0)).toBe(true);
  });
});
