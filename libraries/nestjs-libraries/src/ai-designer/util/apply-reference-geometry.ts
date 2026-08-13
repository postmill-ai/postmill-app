import type {
  DesignPlan,
  DesignSlot,
  DesignSlotGeometry,
  ReferenceLayout,
  ReferenceLayoutLine,
} from '../ai-designer.types';
import { isCopySlot } from '../ai-designer.types';

/**
 * Stamp a reference's MEASURED geometry (per-line vertical bands, size
 * ratios, anchors) onto the copy slots of reference-clone plans.
 *
 * Deterministic by design: the planning LLM is never asked to copy numbers —
 * it plans slots and copy as before, and this pass matches the interpreter's
 * measured lines to those slots by TEXT, falling back to size rank when the
 * plan carries no texts. Non-clone plans are returned untouched, so nothing
 * outside a reference run ever sees a geometry field.
 */
export const applyReferenceGeometry = (
  plans: DesignPlan[],
  layout: ReferenceLayout | undefined
): DesignPlan[] => {
  if (!layout || layout.lines.length === 0) return plans;
  return plans.map((plan) =>
    isCloneSkill(plan.skill) ? stampPlan(plan, layout) : plan
  );
};

const isCloneSkill = (skill: string | undefined): boolean =>
  typeof skill === 'string' && skill.startsWith('reference-clone');

const stampPlan = (plan: DesignPlan, layout: ReferenceLayout): DesignPlan => {
  const copySlots = (plan.slots ?? []).filter(
    (slot) => isCopySlot(slot) && slot.kind !== 'badge'
  );
  const texts = plan.texts && typeof plan.texts === 'object' ? plan.texts : {};

  const assignment = matchLinesToSlots(layout.lines, copySlots, texts);
  const normalized = normalizeBands(assignment);

  const geometryBySlot = new Map<string, DesignSlotGeometry>();
  for (const { slot, line, band } of normalized) {
    geometryBySlot.set(slot.id, {
      yBand: band,
      ...(line.xAnchor ? { xAnchor: line.xAnchor } : {}),
      ...(typeof line.heightRatio === 'number'
        ? { heightRatio: line.heightRatio }
        : {}),
    });
  }

  // The badge is matched structurally, not by text — its label ("1893") is
  // measured as a line only when it reads as copy, but the badge measurement
  // is the authoritative one.
  const badgeSlot = (plan.slots ?? []).find((slot) => slot.kind === 'badge');
  if (badgeSlot && layout.badge?.yBand) {
    geometryBySlot.set(badgeSlot.id, {
      yBand: clampBand(layout.badge.yBand),
      ...(layout.badge.xAnchor ? { xAnchor: layout.badge.xAnchor } : {}),
    });
  }

  if (geometryBySlot.size === 0) return plan;
  return {
    ...plan,
    slots: (plan.slots ?? []).map((slot) => {
      const geometry = geometryBySlot.get(slot.id);
      return geometry ? { ...slot, geometry } : slot;
    }),
  };
};

interface Assigned {
  slot: DesignSlot;
  line: ReferenceLayoutLine;
  band: [number, number];
}

/**
 * Greedy text matching, top line first: every measured line claims the
 * unclaimed slot whose plan text matches it best (echoed words — the same
 * copy at two sizes — resolve in measurement order, which is reading order
 * on both sides). Lines the text matcher cannot place fall back to SIZE
 * RANK: the largest unmatched line pairs with the loudest unmatched slot,
 * mirroring the clone skill's "hierarchy comes from size" rule.
 */
const matchLinesToSlots = (
  lines: ReferenceLayoutLine[],
  slots: DesignSlot[],
  texts: Record<string, string>
): Assigned[] => {
  const out: Assigned[] = [];
  const freeSlots = new Set(slots);
  const freeLines = new Set(lines);

  for (const line of lines) {
    let best: { slot: DesignSlot; score: number } | undefined;
    for (const slot of freeSlots) {
      const score = textSimilarity(line.text, texts[slot.id]);
      if (score >= 0.5 && (!best || score > best.score)) {
        best = { slot, score };
      }
    }
    if (best) {
      out.push({ slot: best.slot, line, band: clampBand(line.yBand) });
      freeSlots.delete(best.slot);
      freeLines.delete(line);
    }
  }

  // Size-rank fallback for whatever text could not place.
  const remainingLines = [...freeLines].sort(
    (a, b) => (b.heightRatio ?? bandHeight(b)) - (a.heightRatio ?? bandHeight(a))
  );
  const remainingSlots = [...freeSlots].sort(
    (a, b) => roleLoudness(b) - roleLoudness(a)
  );
  for (let i = 0; i < remainingLines.length && i < remainingSlots.length; i++) {
    out.push({
      slot: remainingSlots[i],
      line: remainingLines[i],
      band: clampBand(remainingLines[i].yBand),
    });
  }
  return out;
};

const normalize = (value: string | undefined): string =>
  (value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** 1 = same text; token-overlap Jaccard otherwise. */
const textSimilarity = (a: string, b: string | undefined): number => {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  let shared = 0;
  for (const token of ta) if (tb.has(token)) shared++;
  return shared / (ta.size + tb.size - shared);
};

const ROLE_LOUDNESS: Record<string, number> = {
  headline: 5,
  benefit: 4,
  subhead: 4,
  accent: 3,
  'cta-button': 2,
  legal: 1,
};

const roleLoudness = (slot: DesignSlot): number =>
  ROLE_LOUDNESS[slot.role] ?? ROLE_LOUDNESS[slot.kind] ?? 2;

const bandHeight = (line: ReferenceLayoutLine): number =>
  Math.max(0, line.yBand[1] - line.yBand[0]);

const clampBand = (band: [number, number]): [number, number] => {
  const top = Math.min(Math.max(Math.min(band[0], band[1]), 0), 1);
  const bottom = Math.min(Math.max(Math.max(band[0], band[1]), 0), 1);
  return [top, Math.max(bottom, top + 0.01)];
};

/**
 * Sort by band top and nudge genuinely OVERLAPPING bands apart (preserving
 * each band's height) so a slightly-sloppy measurement doesn't hand the
 * overlap guard a pre-collided stack — the guard would immediately re-pack it
 * and the reference placement would be lost to the very mechanism it was
 * meant to survive. Bands that merely abut are legitimate (ink bands touch)
 * and stay untouched.
 */
const normalizeBands = (assigned: Assigned[]): Assigned[] => {
  const sorted = [...assigned].sort((a, b) => a.band[0] - b.band[0]);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].band;
    const cur = sorted[i].band;
    if (cur[0] < prev[1]) {
      const height = cur[1] - cur[0];
      const top = Math.min(prev[1], 1 - height);
      sorted[i] = { ...sorted[i], band: [top, top + height] };
    }
  }
  return sorted;
};
