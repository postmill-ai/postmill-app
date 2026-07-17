import { describe, it, expect } from 'vitest';
import { detectAnomaly, DEFAULT_ANOMALY_FLOORS } from './anomaly.detection';

// Build an ascending series of `n` flat baseline points then a candidate.
const flatThen = (baseVal: number, n: number, candidate: number) => {
  const arr = Array.from({ length: n }, (_, i) => ({
    date: `2024-06-${String(i + 1).padStart(2, '0')}`,
    value: baseVal,
  }));
  arr.push({ date: `2024-06-${String(n + 1).padStart(2, '0')}`, value: candidate });
  return arr;
};

// Baseline with variance (mean 100, small σ) then a candidate.
const noisyThen = (n: number, candidate: number) => {
  const pattern = [95, 105, 98, 102, 100, 97, 103];
  const arr = Array.from({ length: n }, (_, i) => ({
    date: `2024-06-${String(i + 1).padStart(2, '0')}`,
    value: pattern[i % pattern.length],
  }));
  arr.push({ date: `2024-06-${String(n + 1).padStart(2, '0')}`, value: candidate });
  return arr;
};

describe('detectAnomaly — flow', () => {
  const floor = DEFAULT_ANOMALY_FLOORS.flow;

  it('fires a spike when the latest day is far above a noisy baseline', () => {
    const r = detectAnomaly(noisyThen(28, 500), 'flow', { floor, z: 3 });
    expect(r).not.toBeNull();
    expect(r!.direction).toBe('spike');
    expect(r!.value).toBe(500);
    expect(r!.baseline).toBeGreaterThan(90);
    expect(r!.deviation).toBeGreaterThan(0);
  });

  it('fires a drop when the latest day is far below baseline', () => {
    const r = detectAnomaly(noisyThen(28, 5), 'flow', { floor, z: 3 });
    expect(r).not.toBeNull();
    expect(r!.direction).toBe('drop');
    expect(r!.deviation).toBeLessThan(0);
  });

  it('does not fire on a flat/normal day', () => {
    expect(detectAnomaly(noisyThen(28, 100), 'flow', { floor, z: 3 })).toBeNull();
  });

  it('does not fire with too-short history (< minPoints baseline)', () => {
    // 5 baseline points, need ≥7
    expect(detectAnomaly(noisyThen(5, 9999), 'flow', { floor, z: 3 })).toBeNull();
  });

  it('respects the absolute floor even when z is huge (flat baseline, tiny move)', () => {
    // baseline all 10, candidate 40 → σ=0, |Δ|=30 < floor(50) → suppressed
    expect(detectAnomaly(flatThen(10, 10, 40), 'flow', { floor })).toBeNull();
  });

  it('fires on a flat baseline (σ=0) when the move clears the floor', () => {
    // baseline all 10, candidate 200 → σ=0, |Δ|=190 ≥ floor → spike
    const r = detectAnomaly(flatThen(10, 10, 200), 'flow', { floor });
    expect(r).not.toBeNull();
    expect(r!.direction).toBe('spike');
  });

  it('handles a zero baseline without NaN/Infinity in deviation', () => {
    const r = detectAnomaly(flatThen(0, 10, 300), 'flow', { floor });
    expect(r).not.toBeNull();
    expect(Number.isFinite(r!.deviation)).toBe(true);
    expect(r!.baseline).toBe(0);
  });
});

describe('detectAnomaly — stock (differenced)', () => {
  const floor = DEFAULT_ANOMALY_FLOORS.stock;

  it('fires on an abnormal day-over-day jump in a steadily-growing follower count', () => {
    // followers +2/day for the baseline, then +300 on the last day
    const series = Array.from({ length: 30 }, (_, i) => ({
      date: `2024-06-${String(i + 1).padStart(2, '0')}`,
      value: 1000 + i * 2,
    }));
    // last delta huge
    series[series.length - 1] = {
      date: series[series.length - 1].date,
      value: series[series.length - 2].value + 300,
    };
    const r = detectAnomaly(series, 'stock', { floor, z: 3 });
    expect(r).not.toBeNull();
    expect(r!.direction).toBe('spike');
    expect(r!.value).toBe(300); // the delta, not the absolute
  });

  it('does not fire on steady growth (all deltas equal)', () => {
    const series = Array.from({ length: 30 }, (_, i) => ({
      date: `2024-06-${String(i + 1).padStart(2, '0')}`,
      value: 1000 + i * 5,
    }));
    // steady +5 deltas; last delta also +5 → no anomaly
    expect(detectAnomaly(series, 'stock', { floor, z: 3 })).toBeNull();
  });

  it('returns null for a stock series with < 2 points', () => {
    expect(detectAnomaly([{ date: 'x', value: 1 }], 'stock', { floor })).toBeNull();
  });

  it('reports a signed non-zero deviation for a drop off a flat (μ=0) baseline (R4.4)', () => {
    // Constant followers → all day-over-day deltas 0 (μ=0, σ=0), then a real
    // drop on the last day. Old code clamped deviation to 0 (ranked the drop
    // last); R4.4 keeps the signed candidate delta.
    const series = Array.from({ length: 12 }, (_, i) => ({
      date: `2024-06-${String(i + 1).padStart(2, '0')}`,
      value: 1000,
    }));
    series.push({ date: '2024-06-13', value: 900 }); // last delta = -100
    const r = detectAnomaly(series, 'stock', { floor, z: 3 });
    expect(r).not.toBeNull();
    expect(r!.direction).toBe('drop');
    expect(r!.value).toBe(-100);
    expect(r!.deviation).toBe(-100); // signed, non-zero — not the clamped 0
  });
});
