import type { VideoClip, VideoOutput } from './designer-doc.schema';

/**
 * Cap a video composition to its first `capMs` milliseconds — used by the
 * template animated-preview render, which encodes only the opening seconds.
 *
 * Pure: returns a NEW VideoOutput; the input is never mutated. Clips starting
 * at/after the cap are dropped; a clip straddling the cap is truncated
 * (`endMs = capMs`). Because the playhead→source mapping is relative to the
 * clip's own start (`trimInMs` + elapsed × speed, or the speed-curve
 * integral), truncating `endMs` simply plays less of the source — the
 * retained portion renders identically in both engines. In-clip timelines
 * (keyframes, speed curves, caption words, beats) are left untouched: points
 * beyond the new end are never evaluated. A freeze tail (`freezeAtMs`) is
 * clamped so `endMs + freezeAtMs` never exceeds the cap — the encoder draws
 * the frozen frame for that whole window (`getEffectiveEnd`).
 */
export function capCompositionDuration(output: VideoOutput, capMs: number): VideoOutput {
  const cap = Math.max(0, Math.floor(capMs));
  const durationMs = Math.min(output.durationMs ?? 0, cap);

  const capClip = (clip: VideoClip): VideoClip | null => {
    if (clip.startMs >= cap) return null;
    const endMs = Math.min(clip.endMs, cap);
    const next: VideoClip = { ...clip, endMs };
    if (next.freezeAtMs != null) {
      next.freezeAtMs = Math.max(0, Math.min(next.freezeAtMs, cap - endMs));
    }
    return next;
  };

  return {
    ...output,
    durationMs,
    tracks: (output.tracks ?? []).map((track) => ({
      ...track,
      clips: (track.clips ?? [])
        .map(capClip)
        .filter((clip): clip is VideoClip => clip !== null),
    })),
  };
}
