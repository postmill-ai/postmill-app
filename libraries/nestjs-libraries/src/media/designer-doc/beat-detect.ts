/**
 * Beat detection, for snapping cuts and keyframes to the music.
 *
 * Onset detection over a short-term energy envelope: loudness is summed into
 * small windows, and a window that is markedly louder than its own local
 * neighbourhood is an onset. That is deliberately simpler than a full spectral
 * flux analysis — it finds percussive beats reliably, which is what a cut needs
 * to land on, and it runs on a plain sample array with no FFT.
 */

export interface BeatDetectOptions {
  /** Window length in ms. ~20 ms is short enough to place a kick precisely. */
  windowMs?: number;
  /** How many windows either side form the local average. */
  neighbourhood?: number;
  /** How far above the local average a window must be to count. */
  threshold?: number;
  /** Minimum gap between beats — 300 ms caps detection at 200 BPM. */
  minGapMs?: number;
}

export const DEFAULT_BEAT_OPTIONS: Required<BeatDetectOptions> = {
  windowMs: 20,
  neighbourhood: 20,
  threshold: 1.4,
  minGapMs: 300,
};

/** Mean square energy per window. Exported so the envelope can be drawn. */
export const energyEnvelope = (
  samples: Float32Array | number[],
  sampleRate: number,
  windowMs: number
): number[] => {
  const size = Math.max(1, Math.round((sampleRate * windowMs) / 1000));
  const out: number[] = [];
  for (let i = 0; i < samples.length; i += size) {
    let sum = 0;
    const end = Math.min(samples.length, i + size);
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    out.push(sum / Math.max(1, end - i));
  }
  return out;
};

/**
 * Beat times in milliseconds.
 *
 * Silence and steady tones return nothing rather than a stream of false
 * positives: with no window standing out from its neighbourhood, there is
 * nothing to snap to, and inventing beats there is worse than offering none.
 */
export const detectBeats = (
  samples: Float32Array | number[],
  sampleRate: number,
  options: BeatDetectOptions = {}
): number[] => {
  const opts = { ...DEFAULT_BEAT_OPTIONS, ...options };
  if (!samples.length || sampleRate <= 0) return [];

  const envelope = energyEnvelope(samples, sampleRate, opts.windowMs);
  if (envelope.length < 3) return [];

  const beats: number[] = [];
  let lastMs = -Infinity;

  for (let i = 0; i < envelope.length; i++) {
    const from = Math.max(0, i - opts.neighbourhood);
    const to = Math.min(envelope.length, i + opts.neighbourhood + 1);
    let sum = 0;
    for (let j = from; j < to; j++) sum += envelope[j];
    const local = sum / (to - from);
    if (local <= 0) continue;
    if (envelope[i] < local * opts.threshold) continue;

    // A rising edge only: the peak of a drum hit spans several windows, and
    // every one of them beats the local average.
    if (i > 0 && envelope[i] <= envelope[i - 1]) continue;

    const ms = i * opts.windowMs;
    if (ms - lastMs < opts.minGapMs) continue;
    beats.push(ms);
    lastMs = ms;
  }

  return beats;
};

/**
 * The nearest beat to `ms`, or null when none is within `tolerance`.
 *
 * Returning null rather than the nearest-at-any-distance is what stops a clip
 * edge from leaping across a bar when the user is nowhere near a beat.
 */
export const nearestBeat = (
  beats: number[],
  ms: number,
  tolerance = 120
): number | null => {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const beat of beats) {
    const d = Math.abs(beat - ms);
    // Strictly closer, so a time exactly between two beats resolves to the
    // earlier one every time rather than depending on iteration order.
    if (d <= tolerance && d < bestDistance) {
      bestDistance = d;
      best = beat;
    }
  }
  return best;
};

/** Snap a time to a beat when one is close enough, else leave it alone. */
export const snapToBeat = (beats: number[], ms: number, tolerance = 120): number =>
  nearestBeat(beats, ms, tolerance) ?? ms;

/** Rough tempo from the detected beats, for display. Null when unknowable. */
export const estimateBpm = (beats: number[]): number | null => {
  if (beats.length < 3) return null;
  const gaps: number[] = [];
  for (let i = 1; i < beats.length; i++) gaps.push(beats[i] - beats[i - 1]);
  gaps.sort((a, b) => a - b);
  // The median, not the mean: one missed beat doubles a gap and would drag an
  // average halfway to nonsense.
  const median = gaps[Math.floor(gaps.length / 2)];
  if (!median) return null;
  return Math.round(60000 / median);
};
