import type {
  DesignerElement,
  DesignerBlendMode,
} from '../../media/designer-doc/designer-doc.schema';
import { BLEND_MODES } from '../../media/designer-doc/designer-doc.schema';
import { expandEffects, type EffectContext } from './effect-recipes';
import { expandTreatment } from './image-treatments';
import { expandMask } from './mask-recipes';
export { limitDecor } from './decor-recipes';

/**
 * Turning a plan's named recipes into document fields.
 *
 * One place, so the rules about what may be applied to what live together
 * rather than being re-derived at each of the composer's element factories.
 * Every function here is total: an unknown name, a missing palette entry or a
 * treatment on the wrong kind of element degrades to "no change" rather than
 * throwing, because the pipeline's contract is to degrade and never fail.
 */

export interface ApplyContext extends EffectContext {
  /** What kind of element this is, which decides what may be applied. */
  kind: 'text' | 'image' | 'shape' | 'other';
  /** Treatment intensity, from the plan's `depth`. */
  strength?: number;
}

/** At most this many effect recipes on one element. */
const MAX_EFFECTS_PER_ELEMENT = 2;

/**
 * The fields a slot's recipes contribute to its element.
 *
 * Returns a PATCH rather than mutating, so a caller can decide whether a
 * treatment survives its own overrides — the composer's contrast repair, for
 * instance, must be able to win over a plan's chosen fill.
 */
export const applySlotRecipes = (
  slot: {
    effects?: string[];
    treatment?: string;
    mask?: string;
    blend?: string;
    rotation?: number;
  },
  box: { width: number; height: number },
  ctx: ApplyContext,
  text?: string
): Partial<DesignerElement> => {
  const patch: Partial<DesignerElement> = {};

  // Effects apply to anything with a silhouette. Capped hard: a model given a
  // list will reach for three, and three layer styles on one element is the
  // difference between designed and decorated.
  const effects = expandEffects((slot.effects || []).slice(0, MAX_EFFECTS_PER_ELEMENT), ctx);
  if (effects.length) patch.styles = effects;

  // Treatments and masks are pixel operations; they mean nothing on a text or
  // shape layer, and applying them anyway produces a silently broken element
  // rather than an error.
  if (ctx.kind === 'image') {
    const treatment = expandTreatment(slot.treatment, {
      palette: ctx.palette,
      strength: ctx.strength,
    });
    if (treatment.smartFilters.length) patch.smartFilters = treatment.smartFilters;

    const mask = expandMask(slot.mask, box, text);
    if (mask.mask) patch.mask = mask.mask;
    if (mask.borderRadius !== undefined) patch.borderRadius = mask.borderRadius;
  }

  if (slot.blend && isBlendMode(slot.blend)) patch.blendMode = slot.blend;
  if (typeof slot.rotation === 'number' && Number.isFinite(slot.rotation)) {
    patch.rotation = Math.max(-180, Math.min(180, slot.rotation));
  }

  return patch;
};

const isBlendMode = (value: string): value is DesignerBlendMode =>
  (BLEND_MODES as readonly string[]).includes(value);

/**
 * The clipped adjustment layers a treatment needs, as elements.
 *
 * These are separate from the image's own patch because an adjustment is a
 * LAYER, not a property: it sits above the image with `clipped: true` so it
 * reaches only that image's pixels. Returned in paint order, bottom-most first.
 */
export const treatmentAdjustmentLayers = (
  slot: { treatment?: string },
  image: Pick<DesignerElement, 'x' | 'y' | 'width' | 'height' | 'groupId'>,
  ctx: Pick<ApplyContext, 'palette' | 'strength'>
): DesignerElement[] => {
  const { adjustments } = expandTreatment(slot.treatment, {
    palette: ctx.palette,
    strength: ctx.strength,
  });

  return adjustments.map((adjustment, i) => ({
    id: '',
    type: 'adjustment',
    name: `${adjustment.type} ${i + 1}`,
    x: image.x,
    y: image.y,
    width: image.width,
    height: image.height,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    // Bound to the image below it. Without this the adjustment would grade the
    // whole canvas — every layer beneath it, including copy.
    clipped: true,
    adjustment,
    groupId: image.groupId,
  })) as DesignerElement[];
};

/** Treatment intensity implied by the plan's depth intent. */
export const strengthForDepth = (depth: string | undefined): number => {
  if (depth === 'flat') return 0.5;
  if (depth === 'deep') return 1;
  return 0.8;
};
