/**
 * Pure anomaly detector (STATS_UPGRADE 4.2). No I/O, no `Date.now()` — the caller
 * passes an ascending-by-date series whose LAST point is the candidate day
 * ("today"). Flow metrics test the latest value against the trailing baseline;
 * stock metrics are differenced (day-over-day) first, then tested the same way.
 *
 * A point fires only when BOTH the z-test (|z| ≥ z) AND the absolute floor
 * (|value − baseline| ≥ floor) pass — the floor suppresses statistically-large
 * but practically-tiny wobbles on low-volume channels.
 */

export type MetricKind = 'flow' | 'stock';

export interface AnomalyPoint {
  date: string | Date;
  value: number;
}

export interface DetectOptions {
  /** z-score threshold (default 3). */
  z?: number;
  /** minimum baseline points required to test at all (default 7). */
  minPoints?: number;
  /** absolute floor on |value − baseline| — required (per-kind constant). */
  floor: number;
  /** trailing window length for the baseline (default 28). */
  window?: number;
}

export interface AnomalyResult {
  direction: 'spike' | 'drop';
  /** the candidate day's value (for stock: the day-over-day delta). */
  value: number;
  /** trailing baseline mean the value was tested against. */
  baseline: number;
  /** signed deviation ratio (value − baseline) / |baseline|; magnitude ranks alerts. */
  deviation: number;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[], mu: number): number {
  if (values.length === 0) return 0;
  const variance =
    values.reduce((a, b) => a + (b - mu) * (b - mu), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * @returns an AnomalyResult when the candidate day is anomalous, else null.
 */
export function detectAnomaly(
  series: AnomalyPoint[],
  kind: MetricKind,
  opts: DetectOptions,
): AnomalyResult | null {
  const z = opts.z ?? 3;
  const minPoints = opts.minPoints ?? 7;
  const window = opts.window ?? 28;
  const floor = opts.floor;

  // Build the tested series: raw for flow, day-over-day deltas for stock.
  let points: number[];
  if (kind === 'stock') {
    if (series.length < 2) return null;
    points = [];
    for (let i = 1; i < series.length; i++) {
      points.push(series[i].value - series[i - 1].value);
    }
  } else {
    points = series.map((p) => p.value);
  }

  if (points.length < minPoints + 1) return null; // need baseline + candidate

  const candidate = points[points.length - 1];
  // Trailing baseline EXCLUDING the candidate, capped at `window`.
  const baselineAll = points.slice(0, points.length - 1);
  const baseline = baselineAll.slice(Math.max(0, baselineAll.length - window));

  if (baseline.length < minPoints) return null;

  const mu = mean(baseline);
  const sigma = stddev(baseline, mu);
  const absDelta = Math.abs(candidate - mu);

  // Floor gate first (cheap, kills low-volume noise).
  if (absDelta < floor) return null;

  // z gate. σ === 0 (flat baseline) → any floor-clearing move is anomalous.
  const zScore = sigma === 0 ? (candidate === mu ? 0 : Infinity) : absDelta / sigma;
  if (zScore < z) return null;

  // R4.4: off a flat (μ=0) baseline the deviation IS the candidate delta — keep
  // its sign. The old `candidate > 0 ? candidate : 0` clamp reported 0 for a real
  // drop, sinking it to last in the |deviation| notification ranking.
  const deviation = mu !== 0 ? (candidate - mu) / Math.abs(mu) : candidate;

  return {
    direction: candidate >= mu ? 'spike' : 'drop',
    value: candidate,
    baseline: mu,
    deviation,
  };
}

/** Sensible per-kind floors (risk-2 in the plan): flow 50, stock-delta 25. */
export const DEFAULT_ANOMALY_FLOORS: Record<MetricKind, number> = {
  flow: 50,
  stock: 25,
};
