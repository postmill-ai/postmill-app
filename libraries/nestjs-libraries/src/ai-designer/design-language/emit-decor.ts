import type { DesignerElement } from '../../media/designer-doc/designer-doc.schema';
import { decorRecipeById, expandDecor, limitDecor } from './decor-recipes';

/**
 * Turning a plan's decoration names into real path elements.
 *
 * The hard part is not the geometry — that is already in the recipes — but
 * WHERE each mark goes. A rule belongs under the headline; a frame belongs at
 * the canvas edge; a dot field belongs behind everything. Getting this wrong
 * produces decoration that is technically present and visually meaningless,
 * which is worse than none.
 */

export interface DecorPlacementContext {
  canvas: { width: number; height: number };
  margin: number;
  /** The headline's box, when the design has one. */
  headline?: { x: number; y: number; width: number; height: number };
  /**
   * The script/accent line's box, when the design has one. Swashes frame a
   * WORD — usually the accent, not the headline: anchored to a full-width
   * headline box they stretch into a hairline that reads as a rendering
   * glitch, not an ornament.
   */
  accent?: { x: number; y: number; width: number; height: number };
  /** The headline's ink box (the element box is the full copy column). */
  headlineInk?: { x: number; y: number; width: number; height: number };
  /**
   * The y of whatever sits directly below the headline / accent (the next
   * copy line, the CTA). Without it the under-headline gap is derived from
   * the headline's height alone, and a SHORT headline packs the stack tight
   * enough that the mark strikes through the following line — a green squiggle
   * through "BUY 1 GET 1 PIZZA" shipped exactly that way.
   */
  headlineNextBelow?: number;
  accentNextBelow?: number;
  /** `[surface, ink, accent]`. */
  palette: string[];
}

/** Marks that attach to the copy rather than to the canvas. */
const UNDER_HEADLINE = new Set([
  'rule',
  'short-rule',
  'dashed-rule',
  'double-rule',
  'underline-swash',
  'swash-pair',
  'wavy-rule',
]);

/** Marks that frame a single word — the accent line when there is one. */
const WORD_MARK = new Set(['underline-swash', 'swash-pair']);

/** Marks that want the whole canvas. */
const FULL_CANVAS = new Set(['full-frame', 'dot-grid', 'diagonal-stripes', 'blueprint-grid']);

const boxFor = (id: string, ctx: DecorPlacementContext) => {
  const { canvas, margin, headline } = ctx;

  // Cap a mark placed under an anchor by the room actually there: when the
  // next element crowds the anchor, the mark shrinks into the gap — and with
  // no gap at all it is skipped rather than struck through the line below.
  const capToRoom = (
    box: { x: number; y: number; width: number; height: number },
    anchorBottom: number,
    nextBelow: number | undefined
  ): typeof box | null => {
    if (nextBelow === undefined) return box;
    const room = nextBelow - anchorBottom - 2;
    if (box.y + box.height <= nextBelow - 2) return box;
    if (room < 8) return null;
    const height = Math.min(box.height, Math.max(3, room * 0.55));
    return {
      ...box,
      y: anchorBottom + Math.max(2, (room - height) / 2),
      height,
    };
  };

  if (WORD_MARK.has(id)) {
    const anchor = ctx.accent ?? headline;
    if (anchor) {
      const gap = Math.max(4, anchor.height * 0.12);
      return capToRoom(
        {
          x: anchor.x,
          y: anchor.y + anchor.height + gap,
          width: anchor.width,
          height: Math.max(8, anchor.height * 0.35),
        },
        anchor.y + anchor.height,
        ctx.accent ? ctx.accentNextBelow : ctx.headlineNextBelow
      );
    }
  }

  if (id === 'wavy-rule' && headline) {
    // A wave reads as a wave only when its period is a few times its
    // amplitude. Stretched across a full-width headline box the same recipe
    // flattens into a hairline (observed live: a 972px "wave" 11px tall).
    // Key the width to the height and centre the mark under the headline's
    // INK — the element box is the full copy column.
    const centre = ctx.headlineInk ?? headline;
    const height = Math.max(12, headline.height * 0.22);
    const width = Math.min(centre.width, height * 10);
    const capped = capToRoom(
      {
        x: centre.x + Math.round((centre.width - width) / 2),
        y: headline.y + headline.height + Math.max(4, headline.height * 0.18),
        width,
        height,
      },
      headline.y + headline.height,
      ctx.headlineNextBelow
    );
    if (!capped) return null;
    // capToRoom shrinks HEIGHT only, which broke the ratio a second way: a
    // tight stack capped the wave to 6.6px tall while its width stayed 389px
    // — the hairline again, and the stroke (scaled off the box's short side)
    // thinned to 1.65px with it. Re-narrow the width to the wave ratio, and
    // when even the capped amplitude cannot read as a wave, skip the mark
    // rather than shipping a scribble.
    if (capped.height < 8) return null;
    if (capped.width > capped.height * 10) {
      const w = Math.round(capped.height * 10);
      capped.x = capped.x + Math.round((capped.width - w) / 2);
      capped.width = w;
    }
    return capped;
  }

  if (UNDER_HEADLINE.has(id) && headline) {
    // Sit in the gap below the headline rather than overlapping its descenders
    // — a rule struck through the copy it is meant to underline is the
    // classic version of this mistake.
    const gap = Math.max(4, headline.height * 0.18);
    return capToRoom(
      {
        x: headline.x,
        y: headline.y + headline.height + gap,
        width: headline.width,
        height: Math.max(4, headline.height * 0.16),
      },
      headline.y + headline.height,
      ctx.headlineNextBelow
    );
  }

  if (FULL_CANVAS.has(id)) {
    return { x: margin, y: margin, width: canvas.width - margin * 2, height: canvas.height - margin * 2 };
  }

  // Everything else is a corner or edge accent, kept to a corner of the canvas
  // so it decorates rather than competes.
  const size = Math.min(canvas.width, canvas.height) * 0.22;
  return { x: canvas.width - margin - size, y: margin, width: size, height: size };
};

/**
 * Emit the decoration a plan asked for.
 *
 * Returns elements meant to sit BENEATH the copy — decoration that lands on top
 * of a headline is not decoration. The caller inserts them at the bottom of the
 * stack.
 */
export const emitDecor = (
  ids: string[] | undefined,
  ctx: DecorPlacementContext
): DesignerElement[] => {
  const out: DesignerElement[] = [];

  for (const id of limitDecor(ids)) {
    const recipe = decorRecipeById(id);
    if (!recipe) continue;

    const box = boxFor(id, ctx);
    // Null box: no room under the anchor — the mark is skipped rather than
    // struck through the line below.
    if (!box) continue;
    const nodes = expandDecor(id, box);
    if (!nodes.length) continue;

    const accent = ctx.palette[2] || ctx.palette[1] || '#111111';
    const weight = Math.max(1, Math.min(box.width, box.height) * (recipe.strokeRatio ?? 0.01));

    out.push({
      id: '',
      type: 'path',
      name: recipe.label,
      originId: `decor-${id}`,
      x: 0,
      y: 0,
      // A path carries absolute node coordinates, so its box is the canvas.
      // Giving it the mark's bounding box instead would offset every node by
      // that box's origin a second time.
      width: ctx.canvas.width,
      height: ctx.canvas.height,
      rotation: 0,
      opacity: recipe.restraint === 'quiet' ? 0.9 : 1,
      locked: false,
      hidden: false,
      nodes,
      closed: recipe.closed,
      ...(recipe.filled
        ? { fill: accent }
        : { stroke: accent, strokeWidth: weight, ...(recipe.dash ? { strokeStyle: { dash: recipe.dash.map((d) => d * weight) } } : {}) }),
    } as DesignerElement);
  }

  return out;
};
