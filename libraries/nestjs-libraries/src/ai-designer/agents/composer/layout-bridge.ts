import {
  arrange,
  measure as measureNode,
  type Box,
  type LayoutNode,
  type LeafNode,
  type MeasureContext,
} from '../../layout/box-model';
import { columnBox, type Grid } from '../../layout/grid';
import {
  compositionFits,
  type Composition,
  type CompositionContext,
  type SlotRole as CompositionRole,
} from '../../layout/composition';
import { COMPOSITIONS, compositionById } from '../../layout/compositions';
import type { DesignSlot } from '../../ai-designer.types';

/**
 * The join between the plan and the layout engine.
 *
 * A composition names ROLES — one `headline`, one `image`. A plan carries
 * SLOTS, and may well have three that all read as supporting copy. Binding is
 * therefore one-role-to-many-slots, and the order of slots within a role has to
 * stay the plan's order, because `_slotRole` decides the headline by INDEX:
 * the first copy slot is the headline whatever it is called.
 *
 * Kept out of the composer service so the binding rules can be tested without
 * building a document, and so the service keeps its element factories private.
 */

/** The composer's own role vocabulary, which is narrower than a composition's. */
export type ComposerRole =
  | 'headline'
  | 'subhead'
  | 'cta'
  | 'badge'
  | 'legal'
  | 'body'
  | 'accent';

export interface BoundSlot {
  slot: DesignSlot;
  role: ComposerRole;
  /** Resolved copy, already looked up. Empty for imagery and decoration. */
  text: string;
}

/**
 * Composer role → composition role.
 *
 * `body` has no composition equivalent: a composition that wanted to place
 * every kind of supporting copy separately would need a role per copy slot,
 * which is the template thinking this replaces. Body copy stacks with the
 * subhead, which is where it has always gone.
 */
const ROLE_MAP: Record<ComposerRole, CompositionRole> = {
  headline: 'headline',
  subhead: 'subhead',
  body: 'subhead',
  cta: 'cta',
  badge: 'badge',
  legal: 'legal',
  // A composition that names no accent leaf simply drops the role, which is
  // how the kicker stays with the subhead stack everywhere but poster-left.
  accent: 'accent',
};

/** Slot kinds that are imagery rather than copy. */
const IMAGE_KINDS = new Set(['image', 'logo']);

export const compositionRoleFor = (bound: BoundSlot): CompositionRole => {
  if (bound.slot.kind === 'logo') return 'logo';
  if (IMAGE_KINDS.has(bound.slot.kind)) return 'image';
  if (bound.slot.kind === 'accent-shape' || bound.slot.kind === 'divider') return 'decor';
  return ROLE_MAP[bound.role] ?? 'subhead';
};

export const groupByRole = (slots: BoundSlot[]): Map<CompositionRole, BoundSlot[]> => {
  const out = new Map<CompositionRole, BoundSlot[]>();
  for (const bound of slots) {
    const role = compositionRoleFor(bound);
    const list = out.get(role);
    if (list) list.push(bound);
    else out.set(role, [bound]);
  }
  return out;
};

/**
 * Replace each role leaf with the actual slots bound to it.
 *
 * A role with one slot becomes that slot's leaf, carrying the composition's own
 * hints (aspect, fill, rigid) so a composition can still say "the image fills
 * what is left". A role with several becomes a stack of them, in plan order. A
 * role with none disappears, which is what lets one composition serve a meme
 * and a sale post.
 */
export const expandRoles = (
  node: LayoutNode,
  byRole: Map<CompositionRole, BoundSlot[]>
): LayoutNode | null => {
  if (node.kind === 'leaf') {
    const bound = byRole.get(node.slotId as CompositionRole);
    if (!bound?.length) return null;
    if (bound.length === 1) return { ...node, slotId: bound[0].slot.id };
    return {
      kind: 'stack',
      gap: 2,
      children: bound.map((b) => ({ ...node, slotId: b.slot.id }) as LeafNode),
    };
  }

  const children = node.children
    .map((child) => expandRoles(child, byRole))
    .filter((child): child is LayoutNode => child !== null);
  if (!children.length) return null;
  return { ...node, children };
};

export interface LayoutRequest {
  composition: Composition;
  grid: Grid;
  slots: BoundSlot[];
  /** Intrinsic height of a slot's content at a given width. */
  measureSlot: (bound: BoundSlot, width: number) => number;
}

/**
 * Run a composition and return where every slot landed.
 *
 * Placements are keyed by slot id, so the caller can hand each box straight to
 * the element factory that owns that slot — which is why nothing here knows how
 * an element is built.
 */
export const layoutSlots = (request: LayoutRequest): Map<string, Box> => {
  // Which slots asked to run to the canvas edge, collected before binding
  // rewrites the leaf ids.
  const bleeding = new Set<string>();
  const { composition, grid, slots, measureSlot } = request;
  const byRole = groupByRole(slots);
  const bySlotId = new Map(slots.map((b) => [b.slot.id, b]));

  const ctx: CompositionContext = {
    aspect: grid.width / Math.max(1, grid.height),
    has: (role) => (byRole.get(role)?.length ?? 0) > 0,
  };

  const tree = expandRoles(composition.build(ctx), byRole);
  const out = new Map<string, Box>();
  if (!tree) return out;

  const measureCtx: MeasureContext = {
    grid,
    measureLeaf: (leaf, width) => {
      const bound = bySlotId.get(leaf.slotId);
      return bound ? measureSlot(bound, width) : 0;
    },
  };

  const canvas: Box = {
    x: grid.left,
    y: grid.top,
    width: Math.max(1, grid.right - grid.left),
    height: Math.max(1, grid.bottom - grid.top),
  };

  collectBleeding(tree, bleeding);

  for (const placement of arrange(tree, canvas, measureCtx)) {
    // A slot placed twice would mean the composition bound it in two branches;
    // the first wins, which is the branch nearer the top of the tree.
    if (out.has(placement.slotId)) continue;
    out.set(
      placement.slotId,
      bleeding.has(placement.slotId)
        ? // Keep the vertical band the engine computed; take the width out to
          // the canvas edges. Imagery is edge-to-edge or it is a framed inset.
          { x: 0, y: placement.box.y <= grid.top + 1 ? 0 : placement.box.y, width: grid.width, height: placement.box.height + (placement.box.y <= grid.top + 1 ? placement.box.y : 0) }
        : placement.box
    );
  }

  // Reference-measured placement (clone runs): a slot carrying `geometry`
  // takes its measured vertical band and horizontal anchor as the STARTING
  // placement, overriding the composition's box. Width stays the engine's —
  // bands are a vertical spec, and horizontal safety (margins, panel widths)
  // stays with the grid. Imagery (and anything bleeding) keeps the engine's
  // box: a photo is full-bleed or a deliberate band per the COMPOSITION, and
  // shrinking it to a measured strip would tear the design's ground apart.
  // The overlap guard and safe-zone refit downstream stay authoritative.
  for (const bound of slots) {
    const geometry = bound.slot.geometry;
    if (
      !geometry?.yBand ||
      bleeding.has(bound.slot.id) ||
      bound.slot.kind === 'image' ||
      bound.slot.kind === 'logo'
    ) {
      continue;
    }
    const prev = out.get(bound.slot.id);
    if (!prev) continue;
    const y = Math.round(grid.top + geometry.yBand[0] * (grid.bottom - grid.top));
    const height = Math.max(
      1,
      Math.round((geometry.yBand[1] - geometry.yBand[0]) * (grid.bottom - grid.top))
    );
    const x =
      geometry.xAnchor === 'right'
        ? grid.right - prev.width
        : geometry.xAnchor === 'center'
          ? Math.round(grid.left + (grid.right - grid.left - prev.width) / 2)
          : geometry.xAnchor === 'left'
            ? grid.left
            : prev.x;
    out.set(bound.slot.id, { x, y, width: prev.width, height });
  }
  return out;
};

/** Slot ids whose leaf asked to bleed. */
const collectBleeding = (node: LayoutNode, into: Set<string>): void => {
  if (node.kind === 'leaf') {
    if (node.bleed) into.add(node.slotId);
    return;
  }
  for (const child of node.children) collectBleeding(child, into);
};

/**
 * Choose the composition to lay a plan out with.
 *
 * Falls through the plan's own field, then the legacy `formatTemplate`, then a
 * caller-supplied default. A named composition that does not suit the canvas or
 * lacks its centrepiece is REPLACED rather than forced: a split panel on a
 * story lays out perfectly well and is unreadable, which is the failure that
 * never raises an error and always reaches a user.
 */
export const resolveCompositionFor = (
  requested: (string | undefined)[],
  ctx: CompositionContext,
  fallbackId: string
): Composition => {
  for (const id of requested) {
    const candidate = id ? compositionById(id) : undefined;
    if (candidate && compositionFits(candidate, ctx)) return candidate;
  }
  const fallback = compositionById(fallbackId);
  if (fallback && compositionFits(fallback, ctx)) return fallback;
  return COMPOSITIONS.find((c) => compositionFits(c, ctx)) || COMPOSITIONS[0];
};

/** Full-bleed imagery ignores the grid — the margin is for copy, not photos. */
export const fullBleedBox = (grid: Grid): Box => ({
  x: 0,
  y: 0,
  width: grid.width,
  height: grid.height,
});

export { columnBox, measureNode };
