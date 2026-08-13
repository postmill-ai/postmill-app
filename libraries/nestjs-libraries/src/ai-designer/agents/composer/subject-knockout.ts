import type { DesignerElement } from '../../../media/designer-doc/designer-doc.schema';
import { maskRecipeById } from '../../design-language/mask-recipes';
import type { DesignSlot } from '../../ai-designer.types';

/**
 * Cutting the subject out of its background so type can pass behind it.
 *
 * The strongest depth cue a static design has, and the one move that most
 * reliably reads as "a person made this" rather than "a template filled this
 * in" — a headline that runs behind a shoulder cannot be faked with a shadow.
 *
 * `mask-recipes.ts` has been returning `knockout: true` since the design
 * language landed and nothing consumed it: the composer applied the silhouette
 * masks and dropped this one on the floor. It needs a real background-removal
 * call, which is why it could not live in the pure recipe table.
 */

export interface KnockoutRequest {
  /** The image element to cut out. */
  element: DesignerElement;
  /** The slot that asked, for the fallback. */
  slot: DesignSlot;
}

/** Which image slots asked for a knockout, and can have one. */
export const knockoutRequests = (
  slots: DesignSlot[],
  elements: DesignerElement[]
): KnockoutRequest[] => {
  const out: KnockoutRequest[] = [];
  for (const slot of slots) {
    if (!slot.mask) continue;
    if (!maskRecipeById(slot.mask)?.knockout) continue;
    const element = elements.find(
      (el) => el.type === 'image' && (el.originId || el.id) === slot.id
    );
    // A knockout with no source is not a degraded design, it is a wasted call.
    if (element?.src) out.push({ element, slot });
  }
  return out;
};

export interface KnockoutDeps {
  /** `AiMediaService.removeBackground`, or whatever stands in for it. */
  removeBackground(url: string, orgId?: string): Promise<string | undefined>;
  /** Bring the cut-out back under our own storage, as every other asset is. */
  importFromUrl(url: string, orgId?: string): Promise<{ path: string; id?: string } | undefined>;
  warn(message: string): void;
}

/**
 * How many knockouts one design may pay for.
 *
 * Each is a provider call with real cost and latency, and a design with two
 * cut-out subjects is not twice as good — it is a collage.
 */
export const MAX_KNOCKOUTS_PER_DESIGN = 1;

/**
 * Apply every requested knockout, returning the patches to merge.
 *
 * Failure is ALWAYS the fallback the recipe declared, never an exception: the
 * org may have no background-removal provider, the provider may be down, the
 * budget may be spent. A design with an uncut photograph is the same design
 * with less depth; a design that threw is no design at all.
 */
export const applyKnockouts = async (
  requests: KnockoutRequest[],
  deps: KnockoutDeps,
  orgId?: string
): Promise<Map<string, Partial<DesignerElement>>> => {
  const patches = new Map<string, Partial<DesignerElement>>();

  for (const request of requests.slice(0, MAX_KNOCKOUTS_PER_DESIGN)) {
    const source = request.element.src;
    if (!source) continue;

    try {
      const cut = await deps.removeBackground(source, orgId);
      if (!cut) {
        deps.warn(
          `Subject knockout unavailable for "${request.slot.id}" — no provider returned a cut-out; using the photograph as supplied.`
        );
        continue;
      }

      const imported = await deps.importFromUrl(cut, orgId);
      if (!imported?.path) {
        deps.warn(
          `Subject knockout for "${request.slot.id}" could not be stored; using the photograph as supplied.`
        );
        continue;
      }

      patches.set(request.element.id || request.slot.id, {
        src: imported.path,
        fileId: imported.id,
        // A cut-out has transparency, so `cover` would crop the subject to fill
        // a box it no longer fills. `contain` keeps the whole silhouette.
        fitMode: 'contain',
        // The ORIGINAL stays reachable: a knockout is a treatment, and the
        // Designer must be able to show what it was applied to.
        originalSrc: request.element.originalSrc || source,
      });
    } catch (err) {
      deps.warn(
        `Subject knockout failed for "${request.slot.id}": ${(err as Error)?.message}. Using the photograph as supplied.`
      );
    }
  }

  return patches;
};
