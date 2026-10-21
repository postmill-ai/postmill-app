/**
 * Progressive text reveal ("typewriter") — the per-frame maths both video
 * renderers share.
 *
 * The canvas preview imports these; the video frame renderer, which runs in a
 * headless page and cannot import, is handed the same functions as source (see
 * `textRevealSource`) — the same parity discipline as `keyframes.ts`,
 * `speed-curve.ts` and `transitions.ts`. A hand-written second copy is how an
 * exported mp4 ends up revealing text differently from the preview it was
 * authored in.
 *
 * This is deliberately NOT a keyframe channel: keyframes animate numeric props
 * only, and reveal state is derived per frame from the playhead, so both
 * renderers stay in lockstep by construction.
 *
 * This module must stay dependency-free: its functions are stringified into
 * the injected frame-renderer script.
 */

export type TextRevealMode = 'chars' | 'words';

export interface TextReveal {
  mode: TextRevealMode;
  /**
   * Reveal window in ms, measured from the clip's TIMELINE start. Absent (or
   * non-positive) = the whole clip duration.
   */
  durationMs?: number;
}

/**
 * Reveal progress 0→1 at `relativeMs` into the clip. Clamped, and 1 for a
 * degenerate span so a zero-length window never hides the text.
 */
export const textRevealProgress = (
  reveal: TextReveal,
  relativeMs: number,
  clipDurationMs: number
): number => {
  const span =
    reveal.durationMs && reveal.durationMs > 0 ? reveal.durationMs : clipDurationMs;
  if (!(span > 0)) return 1;
  const p = relativeMs / span;
  return p < 0 ? 0 : p > 1 ? 1 : p;
};

/**
 * The clip's text as it should be drawn at `relativeMs` into the clip: a
 * growing prefix — `ceil(progress × length)` characters, or the leading
 * `ceil(progress × wordCount)` words (split on single spaces, the same token
 * boundary both renderers' wrappers use). With no reveal the text is returned
 * unchanged; progress 0 draws nothing.
 */
export const applyTextReveal = (
  text: string,
  reveal: TextReveal | undefined,
  relativeMs: number,
  clipDurationMs: number
): string => {
  if (!reveal || !text) return text;
  const p = textRevealProgress(reveal, relativeMs, clipDurationMs);
  if (p <= 0) return '';
  if (p >= 1) return text;
  if (reveal.mode === 'words') {
    const words = text.split(' ');
    return words.slice(0, Math.ceil(p * words.length)).join(' ');
  }
  return text.slice(0, Math.ceil(p * text.length));
};

/**
 * These same functions as JavaScript source, for the injected frame renderer.
 * Both are self-contained (no closure over module state), so the block can
 * simply be prepended to the script.
 */
export const textRevealSource = (): string => {
  const decl = (name: string, value: unknown) => `const ${name} = ${String(value)};`;
  return [
    decl('textRevealProgress', textRevealProgress),
    decl('applyTextReveal', applyTextReveal),
  ].join('\n');
};
