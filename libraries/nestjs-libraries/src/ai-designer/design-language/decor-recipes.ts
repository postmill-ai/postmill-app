import { polygonToNodes, type Point } from '../../media/designer-doc/path-boolean';
import { polygonPoints, starPoints } from '../../media/designer-doc/shape-geometry';
import type { DesignerPathNode } from '../../media/designer-doc/designer-doc.schema';

/**
 * Named vector decoration — the marks a designer adds that carry no content.
 *
 * Rules, brackets, bursts and dot fields are what stop a layout reading as a
 * form someone filled in. They are also the easiest thing for a generative
 * system to overdo, which is why each recipe declares its own `restraint`: the
 * critic uses it, and the composer refuses to stack two loud ones.
 *
 * Geometry is emitted as `path` nodes in a UNIT BOX (0..1 on both axes) and
 * scaled by the composer against the box it is placed in. Keeping recipes
 * unit-scaled is what lets one definition serve a 1080 square and a 1600x400
 * banner without a second set of numbers.
 */

export type DecorRestraint = 'quiet' | 'moderate' | 'loud';

export interface DecorRecipe {
  id: string;
  label: string;
  /** One line, shown to the planning model. Say what it LOOKS like. */
  description: string;
  restraint: DecorRestraint;
  /** Whether the path is filled (`true`) or stroked. */
  filled: boolean;
  /** Path in a 0..1 unit box. */
  nodes(): DesignerPathNode[];
  closed: boolean;
  /** Suggested stroke weight as a share of the box's short side. */
  strokeRatio?: number;
  /** Dash pattern, in multiples of the stroke weight. */
  dash?: number[];
}

const pt = (x: number, y: number): Point => ({ x, y });

/** A straight run of points as an open path. */
const line = (points: Point[]): DesignerPathNode[] => polygonToNodes(points);

export const DECOR_RECIPES: DecorRecipe[] = [
  {
    id: 'rule',
    label: 'Rule',
    description: 'A single horizontal line; separates a headline from what follows.',
    restraint: 'quiet',
    filled: false,
    closed: false,
    strokeRatio: 0.012,
    nodes: () => line([pt(0, 0.5), pt(1, 0.5)]),
  },
  {
    id: 'short-rule',
    label: 'Short Rule',
    description: 'A stubby accent rule under a kicker; editorial, restrained.',
    restraint: 'quiet',
    filled: false,
    closed: false,
    strokeRatio: 0.03,
    nodes: () => line([pt(0, 0.5), pt(0.22, 0.5)]),
  },
  {
    id: 'dashed-rule',
    label: 'Dashed Rule',
    description: 'A dashed separator; tickets, coupons, itineraries.',
    restraint: 'quiet',
    filled: false,
    closed: false,
    strokeRatio: 0.01,
    dash: [3, 3],
    nodes: () => line([pt(0, 0.5), pt(1, 0.5)]),
  },
  {
    id: 'double-rule',
    label: 'Double Rule',
    description: 'Two parallel lines; classical, masthead-like.',
    restraint: 'quiet',
    filled: false,
    closed: false,
    strokeRatio: 0.008,
    nodes: () => [...line([pt(0, 0.42), pt(1, 0.42)]), ...line([pt(0, 0.58), pt(1, 0.58)])],
  },
  {
    id: 'underline-swash',
    label: 'Underline Swash',
    description: 'A hand-drawn-feeling sweep beneath a word; emphatic, informal.',
    restraint: 'moderate',
    filled: false,
    closed: false,
    strokeRatio: 0.05,
    nodes: () => [
      { x: 0, y: 0.62, outX: 0.25, outY: 0.95 },
      { x: 0.5, y: 0.72, inX: 0.3, inY: 0.42, outX: 0.72, outY: 0.95 },
      { x: 1, y: 0.5, inX: 0.85, inY: 0.62 },
    ],
  },
  {
    id: 'corner-brackets',
    label: 'Corner Brackets',
    description: 'Right-angle marks at opposite corners; frames a subject without boxing it in.',
    restraint: 'moderate',
    filled: false,
    closed: false,
    strokeRatio: 0.014,
    nodes: () => [
      ...line([pt(0, 0.28), pt(0, 0), pt(0.28, 0)]),
      ...line([pt(1, 0.72), pt(1, 1), pt(0.72, 1)]),
    ],
  },
  {
    id: 'full-frame',
    label: 'Full Frame',
    description: 'A rule around the whole composition; poster-like and formal.',
    restraint: 'moderate',
    filled: false,
    closed: true,
    strokeRatio: 0.01,
    nodes: () => line([pt(0, 0), pt(1, 0), pt(1, 1), pt(0, 1)]),
  },
  {
    id: 'dot-grid',
    label: 'Dot Grid',
    description: 'A field of small dots; technical, textural, sits behind content.',
    restraint: 'quiet',
    filled: true,
    closed: true,
    nodes: () => {
      // A 5x5 field of tiny diamonds. Cheap to trace and reads as dots at any
      // realistic size; a true circle per dot would be 25 beziers for nothing.
      const out: DesignerPathNode[] = [];
      const r = 0.012;
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 5; col++) {
          const cx = 0.1 + col * 0.2;
          const cy = 0.1 + row * 0.2;
          out.push(
            ...line([pt(cx, cy - r), pt(cx + r, cy), pt(cx, cy + r), pt(cx - r, cy)])
          );
        }
      }
      return out;
    },
  },
  {
    id: 'burst',
    label: 'Burst',
    description: 'A many-pointed star behind a price or claim; loud, promotional.',
    restraint: 'loud',
    filled: true,
    closed: true,
    nodes: () =>
      polygonToNodes(
        starPoints(1, 1, 12, 0.72).map((p) => pt(p.x, p.y))
      ),
  },
  {
    id: 'chevron',
    label: 'Chevron',
    description: 'A directional arrow mark; motion, next-step, urgency.',
    restraint: 'moderate',
    filled: false,
    closed: false,
    strokeRatio: 0.06,
    nodes: () => line([pt(0.3, 0.15), pt(0.7, 0.5), pt(0.3, 0.85)]),
  },
  {
    id: 'blob',
    label: 'Blob',
    description: 'An organic rounded shape behind content; soft, friendly, modern.',
    restraint: 'moderate',
    filled: true,
    closed: true,
    nodes: () => [
      { x: 0.5, y: 0.02, inX: 0.22, inY: 0.06, outX: 0.78, outY: 0.06 },
      { x: 0.97, y: 0.45, inX: 0.99, inY: 0.18, outX: 0.95, outY: 0.72 },
      { x: 0.55, y: 0.98, inX: 0.82, inY: 0.99, outX: 0.28, outY: 0.97 },
      { x: 0.03, y: 0.52, inX: 0.02, inY: 0.8, outX: 0.04, outY: 0.24 },
    ],
  },
  {
    id: 'arc',
    label: 'Arc',
    description: 'A single sweeping curve; elegant, architectural.',
    restraint: 'quiet',
    filled: false,
    closed: false,
    strokeRatio: 0.014,
    nodes: () => [
      { x: 0, y: 1, outX: 0, outY: 0 },
      { x: 1, y: 1, inX: 1, inY: 0 },
    ],
  },
  {
    id: 'ticket-notches',
    label: 'Ticket Notches',
    description: 'Semicircular bites out of both edges; coupons, passes, stubs.',
    restraint: 'moderate',
    filled: true,
    closed: true,
    nodes: () => [
      ...polygonToNodes(polygonPoints(0.16, 0.16, 12).map((p) => pt(p.x, p.y + 0.42))),
      ...polygonToNodes(polygonPoints(0.16, 0.16, 12).map((p) => pt(p.x + 0.84, p.y + 0.42))),
    ],
  },
  {
    id: 'diagonal-stripes',
    label: 'Diagonal Stripes',
    description: 'A band of angled lines; hazard tape, sale energy, retro sportswear.',
    restraint: 'loud',
    filled: false,
    closed: false,
    strokeRatio: 0.04,
    nodes: () => {
      // The stripes shear by SHEAR across the box height, so the run of start
      // positions has to stop that far short of the right edge or the last few
      // stripes leave the box entirely — there is no clip on a path, so they
      // would simply draw across whatever sits beside them.
      const SHEAR = 0.28;
      const count = 7;
      const out: DesignerPathNode[] = [];
      for (let i = 0; i < count; i++) {
        const x = (i / (count - 1)) * (1 - SHEAR);
        out.push(...line([pt(x, 1), pt(x + SHEAR, 0)]));
      }
      return out;
    },
  },
  {
    id: 'quote-marks',
    label: 'Quote Marks',
    description: 'An oversized opening quotation mark; testimonials and pull-quotes.',
    restraint: 'moderate',
    filled: true,
    closed: true,
    nodes: () => [
      ...polygonToNodes([pt(0.06, 0.1), pt(0.3, 0.1), pt(0.22, 0.6), pt(0.06, 0.6)]),
      ...polygonToNodes([pt(0.4, 0.1), pt(0.64, 0.1), pt(0.56, 0.6), pt(0.4, 0.6)]),
    ],
  },
  {
    id: 'none',
    label: 'No Decoration',
    description: 'Add nothing. The right answer whenever the imagery and type already carry the design.',
    restraint: 'quiet',
    filled: false,
    closed: false,
    nodes: () => [],
  },
];

export const DECOR_RECIPE_IDS: string[] = DECOR_RECIPES.map((d) => d.id);

export const decorRecipeById = (id: string): DecorRecipe | undefined =>
  DECOR_RECIPES.find((d) => d.id === id);

/**
 * Scale a recipe's unit-box path into a concrete box.
 *
 * Handles the bezier handles as well as the anchors: a handle left in unit
 * space while its anchor moves produces a path that whips across the canvas,
 * which is the obvious way to get this wrong.
 */
export const expandDecor = (
  id: string | undefined,
  box: { x: number; y: number; width: number; height: number }
): DesignerPathNode[] => {
  const recipe = id ? decorRecipeById(id) : undefined;
  if (!recipe) return [];
  const sx = (v: number) => box.x + v * box.width;
  const sy = (v: number) => box.y + v * box.height;
  return recipe.nodes().map((n) => ({
    x: sx(n.x),
    y: sy(n.y),
    ...(n.inX !== undefined ? { inX: sx(n.inX) } : {}),
    ...(n.inY !== undefined ? { inY: sy(n.inY) } : {}),
    ...(n.outX !== undefined ? { outX: sx(n.outX) } : {}),
    ...(n.outY !== undefined ? { outY: sy(n.outY) } : {}),
  }));
};

/**
 * How many loud marks a single composition may carry.
 *
 * One is a decision; two is noise. The composer drops the rest rather than
 * asking the model to show restraint, which it will not reliably do.
 */
export const MAX_LOUD_DECOR = 1;

export const decorRestraint = (id: string): DecorRestraint =>
  decorRecipeById(id)?.restraint ?? 'quiet';

/** The catalog as the planning model sees it — generated, never hand-listed. */
export const decorCatalogPrompt = (): string =>
  DECOR_RECIPES.map((d) => `- ${d.id} (${d.restraint}): ${d.description}`).join('\n');

/**
 * Trim a plan's decoration to what a design can carry.
 *
 * One loud mark is a decision; two is noise. Enforced in code rather than asked
 * for in the prompt, because a model told to show restraint will not reliably
 * comply, and the cost of it not complying is every design looking shouty.
 */
export const limitDecor = (ids: string[] | undefined): string[] => {
  const out: string[] = [];
  let loud = 0;
  for (const id of ids || []) {
    if (decorRestraint(id) === 'loud') {
      if (loud >= MAX_LOUD_DECOR) continue;
      loud++;
    }
    out.push(id);
  }
  return out;
};
