import { describe, it, expect } from 'vitest';
import type { VideoTrack } from './designer.store';
import {
  isMarqueeClick,
  marqueeHitClips,
  normalizeMarquee,
  type MarqueeGeometry,
} from './timeline-marquee';

const GEOM: MarqueeGeometry = { rulerHeight: 22, trackHeight: 36, trackGap: 4, labelWidth: 64 };
const PPM = 0.1; // 1000 ms = 100 px

const track = (id: string, clips: { id: string; startMs: number; endMs: number; freezeAtMs?: number }[]): VideoTrack =>
  ({ id, type: 'video', clips } as unknown as VideoTrack);

describe('timeline marquee', () => {
  it('normalizes a rect dragged in any direction', () => {
    expect(normalizeMarquee(100, 50, 20, 10)).toEqual({ left: 20, right: 100, top: 10, bottom: 50 });
  });

  it('treats sub-slop drags as a click on empty area', () => {
    expect(isMarqueeClick(normalizeMarquee(10, 10, 12, 11))).toBe(true);
    expect(isMarqueeClick(normalizeMarquee(10, 10, 30, 11))).toBe(false);
  });

  it('hit-tests clips by [startMs, effectiveEnd] × track row', () => {
    const tracks = [
      track('t1', [
        { id: 'a', startMs: 0, endMs: 1000 }, // x 64–164, row 0 (y 22–62)
        { id: 'b', startMs: 2000, endMs: 3000 }, // x 264–364
      ]),
      track('t2', [{ id: 'c', startMs: 0, endMs: 1000 }]), // row 1 (y 62–102)
    ];

    // Horizontal overlap but wrong row: only row-0 clips can hit.
    const row0 = marqueeHitClips(tracks, { left: 200, right: 300, top: 30, bottom: 40 }, PPM, GEOM);
    expect(row0).toEqual([{ trackId: 't1', clipId: 'b' }]);

    // Same x range over row 1 hits c.
    const row1 = marqueeHitClips(tracks, { left: 64, right: 164, top: 70, bottom: 90 }, PPM, GEOM);
    expect(row1).toEqual([{ trackId: 't2', clipId: 'c' }]);

    // A rect spanning both rows and all x hits everything.
    const all = marqueeHitClips(tracks, { left: 0, right: 1000, top: 0, bottom: 200 }, PPM, GEOM);
    expect(all).toHaveLength(3);
  });

  it('extends the hit range by the freeze hold, like the rendered clip', () => {
    const tracks = [track('t1', [{ id: 'a', startMs: 0, endMs: 1000, freezeAtMs: 500 }])];
    // x 214 = 1500 ms — past endMs (164 px) but inside the frozen tail.
    const hits = marqueeHitClips(tracks, { left: 200, right: 220, top: 30, bottom: 40 }, PPM, GEOM);
    expect(hits).toEqual([{ trackId: 't1', clipId: 'a' }]);
  });

  it('misses when the rect only touches the ruler or the gaps', () => {
    const tracks = [track('t1', [{ id: 'a', startMs: 0, endMs: 1000 }])];
    // Entirely within the ruler band.
    expect(marqueeHitClips(tracks, { left: 0, right: 500, top: 0, bottom: 20 }, PPM, GEOM)).toEqual([]);
    // Entirely left of the clip (label column).
    expect(marqueeHitClips(tracks, { left: 0, right: 60, top: 30, bottom: 40 }, PPM, GEOM)).toEqual([]);
  });
});
