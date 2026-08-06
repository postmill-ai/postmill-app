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

/** Marks that want the whole canvas. */
const FULL_CANVAS = new Set(['full-frame', 'dot-grid', 'diagonal-stripes', 'blueprint-grid']);

const boxFor = (id: string, ctx: DecorPlacementContext) => {
  const { canvas, margin, headline } = ctx;

  if (UNDER_HEADLINE.has(id) && headline) {
    // Sit in the gap below the headline rather than overlapping its descenders
    // — a rule struck through the copy it is meant to underline is the
    // classic version of this mistake.
    const gap = Math.max(4, headline.height * 0.18);
    return {
      x: headline.x,
      y: headline.y + headline.height + gap,
      width: headline.width,
      height: Math.max(4, headline.height * 0.16),
    };
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
