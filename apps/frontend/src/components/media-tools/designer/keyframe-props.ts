import type { KeyframeEase } from '@postmill-ai/nestjs-libraries/media/designer-doc/keyframes';
import type { GraphProp } from './graph-editor';

/**
 * Shared per-property display for keyframes: the inspector's mini timeline
 * dots, the keyframe lane under the video timeline, and the copy/paste merge
 * all agree on prop order and colour from here.
 */

/** The clip keyframe shape as the doc schema stores it (props is a loose map). */
export interface ClipKeyframe {
  tMs: number;
  props: Record<string, number>;
  ease?: KeyframeEase;
}

/**
 * Stable colour per animatable property. The chart tokens are
 * theme-INDEPENDENT by design (declared once at bare `:root` in colors.scss),
 * so a dot means the same property in dark and light mode.
 */
export const PROP_DOT_COLORS: Record<GraphProp, string> = {
  x: 'var(--chart-1)',
  y: 'var(--chart-2)',
  width: 'var(--chart-3)',
  height: 'var(--chart-4)',
  rotation: 'var(--chart-5)',
  opacity: 'var(--chart-6)',
  fontSize: 'var(--chart-7)',
  volume: 'var(--chart-8)',
};

/** Two keyframes at the same prop within this window are the SAME keyframe. */
export const KEYFRAME_MERGE_TOLERANCE_MS = 1;

/**
 * Merge-by-prop paste: for each incoming keyframe, a target keyframe within
 * KEYFRAME_MERGE_TOLERANCE_MS absorbs its props (incoming values overwrite
 * props the target already carries; the incoming ease replaces the target's
 * when set). Anything else is appended. The result is sorted by tMs.
 *
 * Neither input is mutated — the returned keyframes are fresh objects, so
 * editing a pasted keyframe can never reach back into the clipboard or the
 * source clip.
 */
export const mergeKeyframes = (
  target: readonly ClipKeyframe[],
  incoming: readonly ClipKeyframe[]
): ClipKeyframe[] => {
  const out: ClipKeyframe[] = target.map((kf) => ({
    ...kf,
    props: { ...kf.props },
  }));
  for (const kf of incoming) {
    const hit = out.find(
      (o) => Math.abs(o.tMs - kf.tMs) <= KEYFRAME_MERGE_TOLERANCE_MS
    );
    if (hit) {
      hit.props = { ...hit.props, ...kf.props };
      if (kf.ease !== undefined) hit.ease = kf.ease;
    } else {
      out.push({
        tMs: kf.tMs,
        props: { ...kf.props },
        ...(kf.ease !== undefined ? { ease: kf.ease } : {}),
      });
    }
  }
  return out.sort((a, b) => a.tMs - b.tMs);
};
