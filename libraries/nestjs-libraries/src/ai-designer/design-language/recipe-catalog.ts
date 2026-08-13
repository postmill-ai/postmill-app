import { EFFECT_RECIPE_IDS, effectCatalogPrompt } from './effect-recipes';
import { IMAGE_TREATMENT_IDS, treatmentCatalogPrompt } from './image-treatments';
import { MASK_RECIPE_IDS, maskCatalogPrompt } from './mask-recipes';
import { DECOR_RECIPE_IDS, decorCatalogPrompt } from './decor-recipes';
import { WARP_RECIPE_IDS, warpCatalogPrompt } from './warp-recipes';

/**
 * The design vocabulary, as the planning model is shown it.
 *
 * GENERATED from the recipe tables rather than written beside them. A prompt
 * that lists capabilities by hand drifts the moment a recipe is renamed or
 * removed, and the failure is silent and expensive: the model keeps confidently
 * asking for an effect that no longer does anything, the composer drops it, and
 * the design is quietly plainer than the plan said it would be. Generating the
 * text means the vocabulary offered and the vocabulary implemented cannot
 * disagree.
 */

export const designLanguagePrompt = (): string =>
  [
    'EFFECTS — layer styles, given by name. Combine at most two per element.',
    effectCatalogPrompt(),
    '',
    'TREATMENTS — how a photograph is graded. One per image.',
    treatmentCatalogPrompt(),
    '',
    'MASKS — how imagery is cut. One per image.',
    maskCatalogPrompt(),
    '',
    'DECOR — vector marks carrying no content. At most one "loud" mark per design.',
    decorCatalogPrompt(),
    '',
    'WARPS — bends applied to a shape/badge/CTA plate, given by name on the slot as `warp`.',
    warpCatalogPrompt(),
  ].join('\n');

/** Every id the plan schema will accept, for validation and for specs. */
export const DESIGN_LANGUAGE_IDS = {
  effects: EFFECT_RECIPE_IDS,
  treatments: IMAGE_TREATMENT_IDS,
  masks: MASK_RECIPE_IDS,
  decor: DECOR_RECIPE_IDS,
  warps: WARP_RECIPE_IDS,
} as const;
