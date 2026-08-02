// Server-side types for the Designer render pipeline. The canonical contract now
// lives in ../designer-doc/designer-doc.schema.ts; this file re-exports it to
// preserve existing import paths while keeping a single source of truth.

export type {
  DesignerDoc,
  DesignerElement,
  DesignerOutput,
  VideoOutput,
  VideoTrack,
  VideoClip,
  DesignerBackground,
  DesignerGradient,
  DesignerMask,
  TextRun,
  DesignerAttribution,
  DesignerPage,
  DesignerPageBackground,
} from '../designer-doc/designer-doc.schema';

export interface RenderOptions {
  pixelRatio?: number;
  transparent?: boolean;
  orgId?: string;
  /**
   * Skip every `type === 'text'` element. Used by `auditTextContrast` to
   * render the BACKDROP a text box sits on without the box's own glyphs —
   * sampled variance is otherwise dominated by the text itself. Never used
   * for a deliverable.
   */
  hideText?: boolean;
}

/**
 * One text-over-imagery legibility failure from
 * `DesignRenderService.auditTextContrast`.
 *
 * `reason: 'contrast'` — the painted backdrop sampled under the text's box
 * fails the WCAG ratio for its size class.
 *
 * `reason: 'busy'` — the ratio PASSES but only because it is computed against
 * the sampled box's MEAN: the backdrop is high-variance imagery and a
 * measurable share of it fails the ratio against the fill, so some glyphs land
 * on backdrop they cannot be read against. Flipping the fill ALONE cannot
 * rescue this case (that is what shipped a headline legible only through its
 * text shadow), so the fixer routes it straight to the type halo — the fill
 * flip ships together with a zero-offset shadow in the opposite colour. It used
 * to route to a scrim; round 8 (D2) deleted that remedy. See the composer's
 * `fixContrast`.
 */
export interface TextContrastViolation {
  outputIndex: number;
  elementId: string;
  originId?: string;
  fill: string;
  /** Achieved contrast ratio vs the sampled backdrop. */
  ratio: number;
  /** WCAG relative luminance of the sampled backdrop (0..1). */
  backdropLuma: number;
  /** Why the text was flagged. Absent is read as `'contrast'`. */
  reason?: 'contrast' | 'busy';
  /** Largest per-channel standard deviation of the sampled backdrop (0..255). */
  backdropStdev?: number;
  /**
   * Fraction (0..1) of the sampled backdrop's pixels whose WCAG ratio against
   * `fill` is below the text's size-class requirement — the share of the box
   * where the glyphs are unreadable.
   */
  crossingFraction?: number;
}
