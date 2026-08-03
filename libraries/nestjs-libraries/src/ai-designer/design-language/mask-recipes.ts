import type { DesignerMask } from '../../media/designer-doc/designer-doc.schema';

/**
 * Named ways of cutting a shape out of imagery.
 *
 * Two mechanisms sit behind these, and the difference matters:
 *
 *  - A SILHOUETTE mask (`DesignerMask`) is declarative — a shape or a word the
 *    renderers clip to. Free, and it round-trips into the manual Designer's
 *    mask controls untouched.
 *  - A KNOCKOUT is a real cut-out of the photograph's subject, which needs the
 *    Remove Background media op and produces a bitmap. Expensive, occasionally
 *    unavailable, and the single most recognisable "a designer made this" move
 *    there is — text that runs behind a subject's shoulder cannot be faked.
 *
 * A recipe declares which it wants. The composer decides whether it can afford
 * the second, and falls back to the first — so a plan asking for a knockout on
 * an org with no background-removal provider still composes.
 */

export interface MaskRecipe {
  id: string;
  label: string;
  /** One line, shown to the planning model. Say what it LOOKS like. */
  description: string;
  /** The declarative mask, when this recipe is a silhouette. */
  mask?: DesignerMask;
  /** Corner rounding as a share of the box's SHORT side, for soft rectangles. */
  borderRadiusRatio?: number;
  /**
   * Cut the photograph's subject out of its background. Needs a media op, so
   * the composer may decline; `fallbackId` names what to do instead.
   */
  knockout?: boolean;
  fallbackId?: string;
}

export const MASK_RECIPES: MaskRecipe[] = [
  {
    id: 'none',
    label: 'Untouched',
    description: 'A plain rectangular frame. Correct far more often than not.',
  },
  {
    id: 'soft-corners',
    label: 'Soft Corners',
    description: 'Gently rounded corners; modern, app-like, unobtrusive.',
    borderRadiusRatio: 0.04,
  },
  {
    id: 'squircle',
    label: 'Squircle',
    description: 'Heavily rounded corners approaching a superellipse; friendly and contemporary.',
    borderRadiusRatio: 0.18,
  },
  {
    id: 'pill',
    label: 'Pill',
    description: 'Fully rounded ends; editorial pull-quotes and profile crops.',
    borderRadiusRatio: 0.5,
  },
  {
    id: 'circle',
    label: 'Circle',
    description: 'A circular crop; portraits, avatars, badge-like emblems.',
    mask: { type: 'shape', shape: 'ellipse' },
  },
  {
    id: 'arch',
    label: 'Arch',
    description: 'Rounded at the top, square at the base; architectural, editorial, current.',
    // The renderers' silhouette set has no arch, so it is expressed as a
    // rounded rectangle whose radius exceeds half the width — which is exactly
    // an arch, and needs no new mask kind in three renderers.
    mask: { type: 'shape', shape: 'rounded-rect', cornerRadius: 0.5 },
  },
  {
    id: 'hexagon',
    label: 'Hexagon',
    description: 'A six-sided crop; technical, modular, sporty.',
    mask: { type: 'shape', shape: 'hexagon' },
  },
  {
    id: 'triangle',
    label: 'Triangle',
    description: 'A triangular crop; dynamic and directional, used sparingly.',
    mask: { type: 'shape', shape: 'triangle' },
  },
  {
    id: 'star',
    label: 'Star',
    description: 'A star crop; promotional and loud. Rarely the right answer.',
    mask: { type: 'shape', shape: 'star' },
  },
  {
    id: 'heart',
    label: 'Heart',
    description: 'A heart crop; greetings, charity, Valentine campaigns.',
    mask: { type: 'shape', shape: 'heart' },
  },
  {
    id: 'text-knockout',
    label: 'Text Knockout',
    description:
      'The photograph shows only through the letterforms of a word. Needs short, heavy copy to read at all.',
    // `text` is filled in by the composer from the slot's own copy — a recipe
    // cannot know the word.
    mask: { type: 'text', fontWeight: 900 },
  },
  {
    id: 'subject-knockout',
    label: 'Subject Knockout',
    description:
      'Cuts the subject out of its background so type can pass behind it. The strongest depth cue available; costs a background-removal call.',
    knockout: true,
    fallbackId: 'none',
  },
];

export const MASK_RECIPE_IDS: string[] = MASK_RECIPES.map((m) => m.id);

export const maskRecipeById = (id: string): MaskRecipe | undefined =>
  MASK_RECIPES.find((m) => m.id === id);

/**
 * Resolve a mask recipe against a concrete box.
 *
 * `cornerRadius` on a `rounded-rect` silhouette is a RATIO in the recipe and
 * absolute pixels in the document, so it is converted here against the short
 * side — the one place that conversion happens.
 */
export const expandMask = (
  id: string | undefined,
  box: { width: number; height: number },
  text?: string
): { mask?: DesignerMask; borderRadius?: number; knockout?: boolean } => {
  const recipe = id ? maskRecipeById(id) : undefined;
  if (!recipe) return {};

  const shortSide = Math.max(1, Math.min(box.width, box.height));

  if (recipe.borderRadiusRatio !== undefined) {
    return { borderRadius: shortSide * recipe.borderRadiusRatio };
  }

  if (recipe.mask?.type === 'text') {
    // A text mask with no word is an invisible layer, which is worse than no
    // mask at all — so it degrades rather than erasing the image.
    if (!text?.trim()) return {};
    return { mask: { ...recipe.mask, text: text.trim() } };
  }

  if (recipe.mask?.type === 'shape' && recipe.mask.shape === 'rounded-rect') {
    return {
      mask: {
        ...recipe.mask,
        cornerRadius: shortSide * (recipe.mask.cornerRadius ?? 0.5),
      },
    };
  }

  if (recipe.knockout) return { knockout: true };
  return recipe.mask ? { mask: recipe.mask } : {};
};

/** The catalog as the planning model sees it — generated, never hand-listed. */
export const maskCatalogPrompt = (): string =>
  MASK_RECIPES.map((m) => `- ${m.id}: ${m.description}`).join('\n');
