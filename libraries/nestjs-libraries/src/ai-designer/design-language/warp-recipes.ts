import type { DesignerWarp } from '../../media/designer-doc/designer-doc.schema';

/**
 * Named warps the AI Designer can ask for by name.
 *
 * Same contract as every other catalog: the plan says `warp: 'arc-banner'`,
 * never `{ preset: 'arc', bend: 26 }` — a model given raw numbers produces a
 * bend that looked right at the canvas size it imagined, and there is no way
 * to spec-check "is 47 a good bend". The names come from here, the maths from
 * `designer-doc/warp`, and both renderers already draw them identically.
 *
 * The starter set is the banner family — the shapes commercial poster work
 * actually reaches for (the "1893" ribbon on the pizza template is
 * `arc-banner` exactly).
 */

export interface WarpRecipe {
  id: string;
  label: string;
  /** One line, shown to the planning model. Say what it LOOKS like. */
  description: string;
  warp: DesignerWarp;
}

export const WARP_RECIPES: WarpRecipe[] = [
  {
    id: 'arc-banner',
    label: 'Arched Banner',
    description:
      'The classic ribbon arch — the plate bows upward like a badge banner or a varsity chest arc.',
    warp: { preset: 'arc', bend: 26 },
  },
  {
    id: 'arc-down-banner',
    label: 'Arched-Down Banner',
    description:
      'The counter-arch — the plate bows downward, the closing half of a two-ribbon lockup.',
    warp: { preset: 'arc', bend: -26 },
  },
  {
    id: 'flag-wave',
    label: 'Flag Wave',
    description:
      'A gentle S-curve along the plate, like fabric in a light wind — softer than an arch.',
    warp: { preset: 'flag', bend: 18 },
  },
  {
    id: 'rise-banner',
    label: 'Rising Banner',
    description:
      'The plate climbs from left to right — momentum without a rotation, for streaks and swooshes.',
    warp: { preset: 'rise', bend: 22 },
  },
];

export const WARP_RECIPE_IDS: string[] = WARP_RECIPES.map((r) => r.id);

export const warpRecipeById = (id: string): WarpRecipe | undefined =>
  WARP_RECIPES.find((r) => r.id === id);

/**
 * Expand a warp name into the document field, or undefined for an unknown
 * name — a stored plan may name a warp a later build removed, and a flat
 * banner beats a failed pipeline.
 */
export const expandWarp = (id: string | undefined): DesignerWarp | undefined =>
  id ? warpRecipeById(id)?.warp && { ...warpRecipeById(id)!.warp } : undefined;

/** The catalog as the planning model sees it — generated, so it cannot drift. */
export const warpCatalogPrompt = (): string =>
  WARP_RECIPES.map((r) => `- ${r.id}: ${r.description}`).join('\n');
