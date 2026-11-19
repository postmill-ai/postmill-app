import type { KeyframeEase } from '@postmill-ai/nestjs-libraries/media/designer-doc/keyframes';
import type { GraphProp } from './graph-editor';

/** Shared per-property display for the Inspector and timeline keyframe lanes. */

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
