import { describe, it, expect } from 'vitest';
import {
  aggregatePostSnapshotTotal,
  buildPostSnapshotSeries,
  PostSnapshotLike,
} from './analytics-aggregation';

// Helper: build ascending daily post-snapshot rows for one post/metric from a
// start date, one level per day.
function rowsFor(
  postId: string,
  metric: string,
  start: string,
  levels: number[],
  integrationId = 'int1'
): PostSnapshotLike[] {
  const base = new Date(`${start}T00:00:00.000Z`).getTime();
  return levels.map((value, i) => ({
    postId,
    integrationId,
    metric,
    value,
    date: new Date(base + i * 86400000),
  }));
}

describe('aggregatePostSnapshotTotal (level semantics)', () => {
  it('(a) one post, cumulative levels minus baseline', () => {
    const rows = rowsFor('p1', 'likes', '2026-01-01', [100, 150, 150, 220]);
    const baselines = new Map([['p1', 90]]);
    expect(aggregatePostSnapshotTotal(rows, baselines, 'likes')).toBe(130);
  });

  it('(b) two posts summed', () => {
    const rows = [
      ...rowsFor('p1', 'likes', '2026-01-01', [100, 150, 220]),
      ...rowsFor('p2', 'likes', '2026-01-01', [50, 60, 90]),
    ];
    const baselines = new Map([
      ['p1', 90],
      ['p2', 50],
    ]);
    // p1: 220-90=130 ; p2: 90-50=40 ; total 170
    expect(aggregatePostSnapshotTotal(rows, baselines, 'likes')).toBe(170);
  });

  it('(c) no baseline row ⇒ baseline 0 ⇒ total = last level', () => {
    const rows = rowsFor('p1', 'likes', '2026-01-01', [100, 150, 220]);
    expect(aggregatePostSnapshotTotal(rows, new Map(), 'likes')).toBe(220);
  });

  it('(d) percent metric ⇒ average of per-post last levels, never summed', () => {
    const rows = [
      ...rowsFor('p1', 'upvote_ratio', '2026-01-01', [0.9, 0.97]),
      ...rowsFor('p2', 'upvote_ratio', '2026-01-01', [0.8, 0.83]),
    ];
    // average of lasts (0.97, 0.83) = 0.90 — never 1.80
    expect(aggregatePostSnapshotTotal(rows, new Map(), 'upvote_ratio')).toBeCloseTo(
      0.9,
      10
    );
  });

  it('(d2) single-post percent ⇒ last level', () => {
    const rows = rowsFor('p1', 'upvote_ratio', '2026-01-01', [0.9, 0.97]);
    expect(aggregatePostSnapshotTotal(rows, new Map(), 'upvote_ratio')).toBe(0.97);
  });

  it('(e) dipping level ⇒ total = last − baseline (clamped ≥ 0)', () => {
    const rows = rowsFor('p1', 'likes', '2026-01-01', [100, 80]);
    // last 80 − baseline 0 = 80 (not the 100 peak)
    expect(aggregatePostSnapshotTotal(rows, new Map(), 'likes')).toBe(80);
  });

  it('(e2) baseline above last level clamps the total to 0', () => {
    const rows = rowsFor('p1', 'likes', '2026-01-01', [100, 80]);
    const baselines = new Map([['p1', 200]]);
    expect(aggregatePostSnapshotTotal(rows, baselines, 'likes')).toBe(0);
  });
});

describe('buildPostSnapshotSeries (per-day deltas of levels)', () => {
  const toArr = (m: Record<string, number>) => Object.values(m);

  it('(a) per-day deltas, first day off the baseline', () => {
    const rows = rowsFor('p1', 'likes', '2026-01-01', [100, 150, 150, 220]);
    const baselines = new Map([['p1', 90]]);
    const series = buildPostSnapshotSeries(
      rows,
      baselines,
      'likes',
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-04T00:00:00.000Z')
    );
    expect(toArr(series)).toEqual([10, 50, 0, 70]);
  });

  it('(e) day-2 delta clamps when the level dips', () => {
    const rows = rowsFor('p1', 'likes', '2026-01-01', [100, 80]);
    const series = buildPostSnapshotSeries(
      rows,
      new Map(),
      'likes',
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-02T00:00:00.000Z')
    );
    expect(toArr(series)).toEqual([100, 0]);
  });

  it('(d) percent series = per-day average of carried levels', () => {
    const rows = rowsFor('p1', 'upvote_ratio', '2026-01-01', [0.9, 0.97]);
    const series = buildPostSnapshotSeries(
      rows,
      new Map(),
      'upvote_ratio',
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-02T00:00:00.000Z')
    );
    expect(toArr(series)).toEqual([0.9, 0.97]);
  });

  it('(b) two posts summed per day', () => {
    const rows = [
      ...rowsFor('p1', 'likes', '2026-01-01', [100, 150]),
      ...rowsFor('p2', 'likes', '2026-01-01', [10, 40]),
    ];
    const baselines = new Map([
      ['p1', 90],
      ['p2', 0],
    ]);
    const series = buildPostSnapshotSeries(
      rows,
      baselines,
      'likes',
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-02T00:00:00.000Z')
    );
    // day1: (100-90)+(10-0)=20 ; day2: (150-100)+(40-10)=80
    expect(toArr(series)).toEqual([20, 80]);
  });

  it('carries the previous level across gap days (delta 0, not a re-drop)', () => {
    // levels on day1 and day3, day2 missing
    const rows: PostSnapshotLike[] = [
      { postId: 'p1', integrationId: 'int1', metric: 'likes', value: 100, date: new Date('2026-01-01T00:00:00.000Z') },
      { postId: 'p1', integrationId: 'int1', metric: 'likes', value: 130, date: new Date('2026-01-03T00:00:00.000Z') },
    ];
    const series = buildPostSnapshotSeries(
      rows,
      new Map(),
      'likes',
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-03T00:00:00.000Z')
    );
    // day1: 100-0=100 ; day2: gap → 0 ; day3: 130-100=30
    expect(toArr(series)).toEqual([100, 0, 30]);
  });
});
