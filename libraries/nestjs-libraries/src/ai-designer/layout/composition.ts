import type { LayoutNode, LeafNode } from './box-model';

/**
 * A composition: the arrangement of a design, independent of its content and of
 * its canvas.
 *
 * This is what replaces `LayoutId`. The six templates were each a method with
 * its own constants, so adding a seventh meant writing another one and adding
 * another table of numbers; a composition is data, so adding one is adding a
 * row. More importantly the art director can be shown the whole gallery in a
 * generated prompt, exactly as it is shown the effect and treatment catalogs.
 *
 * A composition names SLOT ROLES, not slot ids. The plan's own slots are bound
 * to roles when the composition is instantiated, so one composition serves a
 * meme (image + two captions) and a sale post (image + headline + CTA + badge)
 * without knowing about either.
 */

/** The roles a composition can position. */
export type SlotRole =
  | 'image'
  | 'headline'
  | 'subhead'
  | 'cta'
  | 'badge'
  | 'legal'
  | 'logo'
  | 'decor';

export interface Composition {
  id: string;
  label: string;
  /** One line, shown to the planning model. Say what it LOOKS like. */
  description: string;
  /**
   * Which roles this composition can place. A plan carrying a role the
   * composition does not list still composes — the role is dropped — so the
   * gallery never has to be exhaustive to be safe.
   */
  roles: SlotRole[];
  /**
   * Roles without which the composition makes no sense. A sidebar with no
   * image is just a column of text, so it should not be chosen.
   */
  requires: SlotRole[];
  /**
   * Aspect range this composition is good at, as width/height. A split panel
   * on a 9:16 story gives two unusably narrow columns.
   */
  aspect?: { min?: number; max?: number };
  /**
   * Share of the canvas HEIGHT this arrangement leaves for its copy stack.
   *
   * Feeds `typeBudget`, which is stamped on every output and consumed by
   * `reflow.ts` to re-fit type onto other formats. It is a CONTRACT with the
   * re-fit, not an internal detail: get it wrong and every channel variant is
   * typeset for the wrong canvas.
   */
  copyBandRatio: number;
  /**
   * Headline multiplier against the canvas type basis. A two-column layout has
   * half the width, so its headline has to be smaller to say the same thing.
   */
  typeScale: number;
  /** The tree, built against a canvas whose aspect is known. */
  build(ctx: CompositionContext): LayoutNode;
}

export interface CompositionContext {
  /** width / height of the canvas being composed. */
  aspect: number;
  /** Which roles the plan actually supplies. */
  has(role: SlotRole): boolean;
}

/** Convenience for building trees: a leaf bound to a role. */
export const slot = (role: SlotRole, over: Partial<LeafNode> = {}): LeafNode => ({
  kind: 'leaf',
  slotId: role,
  ...over,
});

/** Drop nodes whose role the plan does not supply. */
export const present = (
  ctx: CompositionContext,
  nodes: (LayoutNode | null | false | undefined)[]
): LayoutNode[] =>
  nodes.filter((n): n is LayoutNode => {
    if (!n) return false;
    if (n.kind === 'leaf') return ctx.has(n.slotId as SlotRole);
    return n.children.length > 0;
  });

/**
 * Whether a composition can be used for a canvas and a set of roles.
 *
 * Checked before a composition is chosen rather than after it has produced a
 * bad layout — the failure mode being a split panel on a story canvas, which
 * technically lays out and is unreadable.
 */
export const compositionFits = (
  composition: Composition,
  ctx: CompositionContext
): boolean => {
  if (composition.aspect?.min !== undefined && ctx.aspect < composition.aspect.min) return false;
  if (composition.aspect?.max !== undefined && ctx.aspect > composition.aspect.max) return false;
  return composition.requires.every((role) => ctx.has(role));
};
