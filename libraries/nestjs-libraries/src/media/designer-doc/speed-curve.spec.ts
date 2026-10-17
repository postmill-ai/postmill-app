import { describe, it, expect } from 'vitest';
import {
  averageSpeedForClip,
  clipTimeForSourceTime,
  curveIntegratedMs,
  hasSpeedCurve,
  normalizeSpeedCurve,
  sourceTimeForClipTime,
  sourceTimeForPlayhead,
  speedAt,
  speedCurveSource,
  splitSpeedCurveForClip,
  type SpeedClipLike,
} from './speed-curve';

/**
 * The speed mapping is evaluated in exactly one place, and the frame renderer
 * is handed that place as source. These pin both halves: the integration
 * maths, and the fact that the stringified copy still runs and agrees.
 */

const clip = (over: Partial<SpeedClipLike> = {}): SpeedClipLike => ({
  startMs: 0,
  endMs: 4000,
  ...over,
});

// A two-segment ramp: 1× ramping linearly to 3× by 1000ms, then holding 3×.
const RAMP = [
  { atMs: 0, speed: 1 },
  { atMs: 1000, speed: 3 },
];

describe('normalizeSpeedCurve', () => {
  it('sorts points and clamps speeds into the schema bounds', () => {
    const pts = normalizeSpeedCurve([
      { atMs: 500, speed: 99 },
      { atMs: 0, speed: -3 },
    ])!;
    expect(pts[0]).toEqual({ atMs: 0, speed: 0.1 });
    expect(pts[1]).toEqual({ atMs: 500, speed: 10 });
  });

  it('drops malformed points and reports an empty curve as absent', () => {
    expect(normalizeSpeedCurve(undefined)).toBeUndefined();
    expect(normalizeSpeedCurve([])).toBeUndefined();
    expect(normalizeSpeedCurve([{ atMs: NaN, speed: 1 }] as never)).toBeUndefined();
  });
});

describe('speedAt', () => {
  it('holds the first speed before the curve and the last after it', () => {
    expect(speedAt(RAMP, -50)).toBe(1);
    expect(speedAt(RAMP, 5000)).toBe(3);
  });

  it('interpolates linearly between points', () => {
    expect(speedAt(RAMP, 500)).toBeCloseTo(2, 9);
  });

  it('is constant for a single point', () => {
    expect(speedAt([{ atMs: 100, speed: 2 }], 0)).toBe(2);
    expect(speedAt([{ atMs: 100, speed: 2 }], 900)).toBe(2);
  });
});

describe('curveIntegratedMs (the trapezoid integral)', () => {
  it('integrates a ramping segment as a trapezoid', () => {
    // Speed runs 1 → 3 over [0, 1000]: area = (1 + 3) / 2 * 1000.
    expect(curveIntegratedMs(RAMP, 1000)).toBeCloseTo(2000, 9);
  });

  it('cuts a segment short with the quadratic partial area', () => {
    // At 500ms the speed is 2: area = (1 + 2) / 2 * 500.
    expect(curveIntegratedMs(RAMP, 500)).toBeCloseTo(750, 9);
  });

  it('extends past the last point at its constant speed', () => {
    expect(curveIntegratedMs(RAMP, 2000)).toBeCloseTo(2000 + 3 * 1000, 9);
  });

  it('holds the first speed before the first point', () => {
    const late = [
      { atMs: 500, speed: 2 },
      { atMs: 1000, speed: 4 },
    ];
    // [0,500] at 2× = 1000, then a quarter of the 2→4 segment's width
    // (250ms, speed reaching 3): (2+3)/2 * 250 = 625.
    expect(curveIntegratedMs(late, 750)).toBeCloseTo(1000 + 625, 9);
  });
});

describe('sourceTimeForClipTime', () => {
  it('EXACTLY matches the legacy constant-speed math when there is no curve', () => {
    // legacy: relativeMs * clip.speed + trimInMs
    expect(sourceTimeForClipTime(clip({ speed: 2 }), 1500)).toBe(3000);
    expect(sourceTimeForClipTime(clip({ trimInMs: 500, speed: 0.5 }), 1000)).toBe(1000);
    // Unset speed is 1×.
    expect(sourceTimeForClipTime(clip(), 1234)).toBe(1234);
  });

  it('integrates a two-segment ramp', () => {
    const c = clip({ speedCurve: RAMP });
    expect(sourceTimeForClipTime(c, 0)).toBe(0);
    expect(sourceTimeForClipTime(c, 1000)).toBeCloseTo(2000, 9);
    // Past the last point the 3× hold runs to the clip end (4000ms).
    expect(sourceTimeForClipTime(c, 4000)).toBeCloseTo(2000 + 3 * 3000, 9);
  });

  it('honours the trimInMs offset', () => {
    const c = clip({ trimInMs: 700, speedCurve: RAMP });
    expect(sourceTimeForClipTime(c, 1000)).toBeCloseTo(2700, 9);
  });

  it('consumes from the tail when reversed', () => {
    const c = clip({ reverse: true, speedCurve: RAMP });
    const total = curveIntegratedMs(RAMP, 4000);
    // Playhead 0 shows the END of the consumed window; playhead end its start.
    expect(sourceTimeForClipTime(c, 0)).toBeCloseTo(total, 9);
    expect(sourceTimeForClipTime(c, 4000)).toBeCloseTo(0, 9);
    // Mid-playhead mirrors mid-curve.
    expect(sourceTimeForClipTime(c, 1000)).toBeCloseTo(
      sourceTimeForClipTime(clip({ speedCurve: RAMP }), 3000),
      9
    );
  });

  it('clamps localMs to the clip duration', () => {
    const c = clip({ speedCurve: RAMP });
    expect(sourceTimeForClipTime(c, 99999)).toBe(sourceTimeForClipTime(c, 4000));
    expect(sourceTimeForClipTime(c, -50)).toBe(0);
  });

  it('ignores the curve on a speed:0 freeze clip', () => {
    const c = clip({ speed: 0, trimInMs: 250, speedCurve: RAMP });
    expect(sourceTimeForClipTime(c, 2000)).toBe(250);
  });
});

describe('sourceTimeForPlayhead', () => {
  it('keeps the legacy boundary semantics', () => {
    expect(sourceTimeForPlayhead(clip({ trimInMs: 500 }), 0)).toBe(500);
    expect(sourceTimeForPlayhead(clip(), 4000)).toBe(4000);
    expect(sourceTimeForPlayhead(clip(), 4001)).toBeNull();
    expect(sourceTimeForPlayhead(clip(), -1)).toBeNull();
  });

  it('holds a freeze clip at its trim-in', () => {
    expect(sourceTimeForPlayhead(clip({ speed: 0, trimInMs: 900 }), 2000)).toBe(900);
  });

  it('keeps the historic constant-speed freeze-tail formula', () => {
    // duration + trimInMs, speed deliberately NOT applied (unchanged behavior).
    expect(sourceTimeForPlayhead(clip({ freezeAtMs: 1000, speed: 2, trimInMs: 100 }), 4500)).toBe(
      4000 + 100
    );
  });

  it('holds the INTEGRATED source end through a ramped freeze tail', () => {
    const c = clip({ freezeAtMs: 1000, speedCurve: RAMP });
    expect(sourceTimeForPlayhead(c, 4500)).toBeCloseTo(curveIntegratedMs(RAMP, 4000), 9);
  });

  it('maps through the curve inside the clip', () => {
    const c = clip({ startMs: 2000, endMs: 6000, speedCurve: RAMP });
    expect(sourceTimeForPlayhead(c, 3000)).toBeCloseTo(2000, 9);
  });
});

describe('clipTimeForSourceTime (the inverse)', () => {
  it('round-trips through sourceTimeForClipTime on a ramp', () => {
    const c = clip({ trimInMs: 300, speedCurve: RAMP });
    for (const l of [0, 250, 500, 999, 1000, 1500, 4000]) {
      expect(clipTimeForSourceTime(c, sourceTimeForClipTime(c, l))).toBeCloseTo(l, 6);
    }
  });

  it('round-trips reversed', () => {
    const c = clip({ trimInMs: 300, reverse: true, speedCurve: RAMP });
    for (const l of [0, 1000, 2500, 4000]) {
      expect(clipTimeForSourceTime(c, sourceTimeForClipTime(c, l))).toBeCloseTo(l, 6);
    }
  });

  it('inverts the constant-speed path exactly', () => {
    const c = clip({ trimInMs: 100, speed: 2 });
    expect(clipTimeForSourceTime(c, 100 + 800)).toBe(400);
  });

  it('clamps source times outside the consumed window to the clip edges', () => {
    const c = clip({ trimInMs: 300, speedCurve: RAMP });
    expect(clipTimeForSourceTime(c, 0)).toBe(0);
    expect(clipTimeForSourceTime(c, 999999)).toBe(4000);
    // …and to the mirrored edges when reversed.
    const r = clip({ reverse: true, speedCurve: RAMP });
    expect(clipTimeForSourceTime(r, 999999)).toBe(0);
    expect(clipTimeForSourceTime(r, -5)).toBe(4000);
  });
});

describe('averageSpeedForClip', () => {
  it('is the consumed source over the timeline duration', () => {
    // 2000 + 3*3000 = 11000 source ms over 4000 timeline ms → 2.75×.
    expect(averageSpeedForClip(clip({ speedCurve: RAMP }))).toBeCloseTo(2.75, 9);
  });

  it('falls back to the constant speed without a curve', () => {
    expect(averageSpeedForClip(clip({ speed: 4 }))).toBe(4);
    expect(averageSpeedForClip(clip())).toBe(1);
    expect(averageSpeedForClip(clip({ speed: 0 }))).toBe(1);
  });
});

describe('splitSpeedCurveForClip', () => {
  it('returns null without an effective curve (legacy split math then applies)', () => {
    expect(splitSpeedCurveForClip(clip(), 1000)).toBeNull();
    expect(splitSpeedCurveForClip(clip({ speedCurve: [{ atMs: 0, speed: 1 }] }), 1000)).toBeNull();
    expect(splitSpeedCurveForClip(clip({ speed: 0, speedCurve: RAMP }), 1000)).toBeNull();
  });

  it('splits a forward ramp so the two halves compose to the original', () => {
    const c = clip({ trimInMs: 300, speedCurve: RAMP });
    const split = splitSpeedCurveForClip(c, 1500)!;
    const first: SpeedClipLike = { startMs: 0, endMs: 1500, ...split.first };
    const second: SpeedClipLike = { startMs: 0, endMs: 2500, ...split.second };

    // The first half plays the same source as the original over [0, 1500]…
    for (const l of [0, 500, 1000, 1500]) {
      expect(sourceTimeForClipTime(first, l)).toBeCloseTo(sourceTimeForClipTime(c, l), 9);
    }
    // …and the second half resumes exactly where the cut landed.
    expect(split.second.trimInMs).toBeCloseTo(sourceTimeForClipTime(c, 1500), 9);
    for (const l of [0, 800, 2500]) {
      expect(sourceTimeForClipTime(second, l)).toBeCloseTo(sourceTimeForClipTime(c, 1500 + l), 9);
    }
    // Both sides keep a usable (≥2-point) curve.
    expect(hasSpeedCurve(first)).toBe(true);
    expect(hasSpeedCurve(second)).toBe(true);
  });

  it('splits a reversed ramp so the two halves compose to the original', () => {
    const c = clip({ trimInMs: 300, reverse: true, speedCurve: RAMP });
    const split = splitSpeedCurveForClip(c, 1500)!;
    const first: SpeedClipLike = { startMs: 0, endMs: 1500, reverse: true, ...split.first };
    const second: SpeedClipLike = { startMs: 0, endMs: 2500, reverse: true, ...split.second };

    for (const l of [0, 500, 1500]) {
      expect(sourceTimeForClipTime(first, l)).toBeCloseTo(sourceTimeForClipTime(c, l), 9);
    }
    for (const l of [0, 1200, 2500]) {
      expect(sourceTimeForClipTime(second, l)).toBeCloseTo(sourceTimeForClipTime(c, 1500 + l), 9);
    }
    // Reversed, the SECOND half keeps the original trim-in (it plays the
    // earlier source); the first half took the advanced one.
    expect(split.second.trimInMs).toBe(300);
    expect(split.first.trimInMs).toBeCloseTo(sourceTimeForClipTime(c, 1500), 9);
  });

  it('keeps a degenerate side constant at the cut speed instead of falling back to clip.speed', () => {
    // Cut beyond the last curve point: the tail side is a flat 3× hold.
    const c = clip({ speed: 1, speedCurve: RAMP });
    const split = splitSpeedCurveForClip(c, 3000)!;
    expect(split.second.speedCurve).toHaveLength(2);
    const second: SpeedClipLike = { startMs: 0, endMs: 1000, ...split.second };
    expect(sourceTimeForClipTime(second, 1000)).toBeCloseTo(split.second.trimInMs + 3000, 9);
  });
});

describe('speedCurveSource (injected parity)', () => {
  it('runs standalone and agrees with the imported functions', () => {
    // The frame page gets this text. If it stops evaluating, or drifts from
    // the module, an exported mp4 ramps differently from the preview.
    const fn = new Function(
      `${speedCurveSource()}
      return { sourceTimeForPlayhead, clipTimeForSourceTime, speedAt };`
    ) as () => {
      sourceTimeForPlayhead: typeof sourceTimeForPlayhead;
      clipTimeForSourceTime: typeof clipTimeForSourceTime;
      speedAt: typeof speedAt;
    };
    const injected = fn();

    const cases: SpeedClipLike[] = [
      clip(),
      clip({ speed: 2, trimInMs: 100 }),
      clip({ speed: 0, trimInMs: 50 }),
      clip({ reverse: true, speed: 0.5 }),
      clip({ freezeAtMs: 500, speed: 2 }),
      clip({ speedCurve: RAMP }),
      clip({ speedCurve: RAMP, reverse: true, trimInMs: 300 }),
      clip({ speedCurve: RAMP, freezeAtMs: 500 }),
    ];
    for (const c of cases) {
      for (const ms of [-1, 0, 500, 1000, 2000, 3999, 4000, 4500, 5000]) {
        const a = sourceTimeForPlayhead(c, ms);
        const b = injected.sourceTimeForPlayhead(c, ms);
        if (a === null || b === null) expect(b).toBe(a);
        else expect(b).toBeCloseTo(a, 9);
      }
      for (const s of [0, 500, 5000, 12000]) {
        expect(injected.clipTimeForSourceTime(c, s)).toBeCloseTo(
          clipTimeForSourceTime(c, s),
          9
        );
      }
    }
    for (const ms of [-10, 0, 500, 1000, 9999]) {
      expect(injected.speedAt(RAMP, ms)).toBeCloseTo(speedAt(RAMP, ms), 9);
    }
  });
});
