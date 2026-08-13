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
  DesignerBlendMode,
  DesignerPattern,
  DesignerLayerStyle,
  DesignerFillStyle,
  DesignerAdjustment,
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
 * One deterministic render-audit failure. Historically only
 * `DesignRenderService.auditTextContrast` produced these; the reason union is
 * additive (downstream consumers switch on `reason` and must treat unknown
 * reasons as report-only), so the collision and imagery audits reuse the shape.
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
 *
 * `reason: 'overlap'` — from `auditTextCollisions`: the painted ink of this
 * element intersects the ink of a DIFFERENT element (`otherElementId`).
 * Measured geometrically from the renderer's own line metrics, no pixels
 * sampled — so `ratio`/`backdropLuma` carry 0 and `fill` may be empty.
 *
 * `reason: 'washed-out'` — from `auditImageryVisibility`: the doc declares
 * imagery (an image background, or an image element covering a large share of
 * the canvas) but the RENDERED pixels over that region are near-uniform and
 * extreme (washed to white or crushed to black) — the imagery is effectively
 * invisible in the deliverable. `backdropLuma` carries the sampled region's
 * WCAG luminance, `backdropStdev` its luma spread; `ratio` carries 0 and
 * `fill` is empty.
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
  reason?: 'contrast' | 'busy' | 'overlap' | 'washed-out';
  /** For `reason: 'overlap'`: the other element/instance in the colliding pair. */
  otherElementId?: string;
  /**
   * For `reason: 'overlap'`: bounding union of THIS element's measured ink
   * rects, in canvas coordinates. A fitted/overflowing line paints ink OUTSIDE
   * the element's declared box, so a consumer separating the pair by BOX
   * geometry must first widen each box to cover its ink rect — otherwise the
   * boxes need not intersect and the repair never converges.
   */
  inkRect?: { x: number; y: number; width: number; height: number };
  /** For `reason: 'overlap'`: bounding union of the OTHER element's ink rects. */
  otherInkRect?: { x: number; y: number; width: number; height: number };
  /** Human-readable description (collision and imagery audits). */
  message?: string;
  /** Largest per-channel standard deviation of the sampled backdrop (0..255). */
  backdropStdev?: number;
  /**
   * Fraction (0..1) of the sampled backdrop's pixels whose WCAG ratio against
   * `fill` is below the text's size-class requirement — the share of the box
   * where the glyphs are unreadable.
   */
  crossingFraction?: number;
  /**
   * The element's glyph LINES sit on divergent backdrops (lightest vs darkest
   * per-line backdrop luminance ≥ 2.5:1 apart — a pale band above a dark
   * photo). No single flat fill can read on every line, so a repair must
   * separate the glyphs (halo/stroke) rather than merely flip the fill.
   * `ratio`/`backdropLuma` carry the WORST line's values.
   */
  straddle?: boolean;
}
