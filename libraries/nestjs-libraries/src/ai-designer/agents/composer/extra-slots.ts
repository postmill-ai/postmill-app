import type { DesignerElement } from '../../../media/designer-doc/designer-doc.schema';
import type { DesignSlot } from '../../ai-designer.types';
import { expandDecor, decorRecipeById } from '../../design-language/decor-recipes';
import { offsetPath, roundCorners } from '../../../media/designer-doc/path-offset';
import type { DesignerPathNode } from '../../../media/designer-doc/designer-doc.schema';

/**
 * Builders for the slot kinds the composer never learned to draw.
 *
 * `shape`, `icon`, `divider`, `logo` and `frame` were added to `DesignSlot`
 * with the design language and declared across forty-one skills — a divider in
 * `coupon-offer` and `menu-pricing`, a logo in `quote-card`, `milestone` and
 * six others. `_buildElements` reads `plan.slots` in exactly three places
 * (`imageSlot`, `copySlots` via the `isCopySlot` allow-list, and `accents`),
 * and none of them match those kinds, so every one of those slots was dropped
 * before anything was built. The skills asked; nothing arrived.
 *
 * Pure and separate from the service so placement can be tested without
 * composing a document, and so it survives the layout engine taking over — the
 * engine will supply the boxes, and these builders only ever needed one.
 */

export interface ExtraSlotContext {
  /** Canvas. */
  w: number;
  h: number;
  margin: number;
  /** `[surface, ink, accent, ...]`, already resolved. */
  accents: string[];
  ink: string;
  /** The headline's box, when one exists — a divider belongs under it. */
  headline?: { x: number; y: number; width: number; height: number };
  /** Resolved logo asset, when the brand has one. */
  logo?: { src?: string; fileId?: string; naturalWidth?: number; naturalHeight?: number };
}

/** The kinds this module owns. Everything else is somebody else's slot. */
export const EXTRA_SLOT_KINDS = new Set(['shape', 'icon', 'divider', 'logo', 'frame']);

export const isExtraSlot = (slot: Pick<DesignSlot, 'kind'>): boolean =>
  EXTRA_SLOT_KINDS.has(slot.kind);

const base = (slot: DesignSlot, box: { x: number; y: number; width: number; height: number }) => ({
  id: '',
  x: Math.round(box.x),
  y: Math.round(box.y),
  width: Math.round(box.width),
  height: Math.round(box.height),
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  originId: slot.id,
});

/**
 * A corner, cycled by index.
 *
 * Same table `_accentShapeElement` uses, so decoration added through a slot
 * lands where decoration added through an accent already does, rather than
 * inventing a second convention.
 */
const cornerBox = (
  ctx: ExtraSlotContext,
  index: number,
  width: number,
  height: number
) => {
  const positions = [
    { x: ctx.w - ctx.margin - width, y: ctx.margin },
    { x: ctx.margin, y: ctx.h - ctx.margin - height },
    { x: ctx.w - ctx.margin - width, y: ctx.h - ctx.margin - height },
    { x: ctx.margin, y: ctx.margin },
  ];
  return { ...positions[index % positions.length], width, height };
};

/**
 * Build the elements for one non-copy, non-image slot.
 *
 * Returns an ARRAY because a frame is one element and a divider may be several
 * strokes; returning a single element would force every caller to special-case
 * the one kind that is not.
 */
export const buildExtraSlot = (
  slot: DesignSlot,
  index: number,
  ctx: ExtraSlotContext,
  box?: { x: number; y: number; width: number; height: number }
): DesignerElement[] => {
  const unit = Math.min(ctx.w, ctx.h);
  const accent = slot.style?.fill ?? ctx.accents[index % Math.max(1, ctx.accents.length)] ?? ctx.ink;

  switch (slot.kind) {
    case 'divider': {
      // Under the headline, spanning it — a rule that spans the canvas while
      // the copy it separates spans half of it reads as a mistake.
      const anchor = box ??
        (ctx.headline
          ? {
              x: ctx.headline.x,
              y: ctx.headline.y + ctx.headline.height + Math.max(4, ctx.headline.height * 0.18),
              width: ctx.headline.width,
              height: Math.max(4, ctx.headline.height * 0.16),
            }
          : {
              x: ctx.margin,
              y: ctx.h / 2,
              width: ctx.w - ctx.margin * 2,
              height: Math.max(4, unit * 0.02),
            });

      const recipeId = decorRecipeById(slot.role) ? slot.role : 'rule';
      const nodes = expandDecor(recipeId, anchor);
      if (!nodes.length) return [];
      const recipe = decorRecipeById(recipeId)!;
      const weight = Math.max(1, Math.min(anchor.width, anchor.height) * (recipe.strokeRatio ?? 0.012));
      return [
        {
          ...base(slot, { x: 0, y: 0, width: ctx.w, height: ctx.h }),
          type: 'path',
          name: recipe.label,
          // Path nodes are absolute, so the element box is the CANVAS. Giving
          // it the rule's own box would offset every node a second time.
          nodes,
          closed: recipe.closed,
          stroke: accent,
          strokeWidth: weight,
          ...(recipe.dash ? { strokeStyle: { dash: recipe.dash.map((d) => d * weight) } } : {}),
        } as DesignerElement,
      ];
    }

    case 'frame': {
      // A stroked outline inside the margin. Deliberately unfilled: a filled
      // frame is a panel, and a panel over imagery is the framed-inset defect
      // three separate assertions already forbid.
      const anchor = box ?? {
        x: ctx.margin,
        y: ctx.margin,
        width: ctx.w - ctx.margin * 2,
        height: ctx.h - ctx.margin * 2,
      };
      const weight = Math.max(1, Math.round(unit * 0.008));

      // Rounded corners come from `roundCorners` — Illustrator's Live Corners,
      // already shared and spec-covered and, until now, never called by the
      // composer. A `borderRadius` on a rect would do for a plain frame, but a
      // real path is what lets `offsetPath` produce the inner keyline below.
      const rect: DesignerPathNode[] = [
        { x: anchor.x, y: anchor.y },
        { x: anchor.x + anchor.width, y: anchor.y },
        { x: anchor.x + anchor.width, y: anchor.y + anchor.height },
        { x: anchor.x, y: anchor.y + anchor.height },
      ];
      const radius = Math.min(anchor.width, anchor.height) * 0.04;
      const outline = roundCorners(rect, radius);

      const frame: DesignerElement = {
        ...base(slot, { x: 0, y: 0, width: ctx.w, height: ctx.h }),
        type: 'path',
        name: 'Frame',
        nodes: outline,
        closed: true,
        stroke: accent,
        strokeWidth: weight,
      } as DesignerElement;

      // A double rule when there is room for one: two lines a few pixels apart
      // read as deliberate where a single heavy one reads as a border. Skipped
      // on a small frame, where the inner line would collide with the outer.
      const inset = weight * 3;
      if (Math.min(anchor.width, anchor.height) <= inset * 6) return [frame];

      const inner = offsetPath(outline, -inset);
      if (!inner.length) return [frame];
      return [
        frame,
        {
          ...base(slot, { x: 0, y: 0, width: ctx.w, height: ctx.h }),
          type: 'path',
          name: 'Frame inner',
          originId: `${slot.id}-inner`,
          nodes: inner,
          closed: true,
          stroke: accent,
          strokeWidth: Math.max(1, Math.round(weight / 2)),
        } as DesignerElement,
      ];
    }

    case 'logo': {
      // Aspect-preserved and never cropped: a cropped logo is a trademark
      // problem, not a layout one.
      const height = Math.round(unit * 0.08);
      const aspect =
        ctx.logo?.naturalWidth && ctx.logo?.naturalHeight
          ? ctx.logo.naturalWidth / ctx.logo.naturalHeight
          : 3;
      const width = Math.round(height * aspect);
      const anchor = box ?? {
        x: Math.round((ctx.w - width) / 2),
        y: ctx.h - ctx.margin - height,
        width,
        height,
      };
      if (!ctx.logo?.src) return [];
      return [
        {
          ...base(slot, anchor),
          type: 'image',
          src: ctx.logo.src,
          fileId: ctx.logo.fileId,
          // `contain`, never `cover` — cover would crop it.
          fitMode: 'contain',
          naturalWidth: ctx.logo.naturalWidth,
          naturalHeight: ctx.logo.naturalHeight,
        } as DesignerElement,
      ];
    }

    case 'icon': {
      // DELIBERATELY a shape, not an `icon` element.
      //
      // An `icon` needs a resolvable source and there is no server-side icon
      // resolver — the picker runs in the browser against Iconify. Worse, the
      // two sides disagree about what `src` even is: the Designer's icons panel
      // stores the raw SVG BODY there, while `SrcSchema` requires a `data:` or
      // `http(s)` URL, so a hand-added icon does not survive strict validation
      // either. Emitting one from here would produce a document that fails to
      // compose rather than a design with an icon in it.
      //
      // A filled circle in the accent is an honest stand-in; when an icon
      // resolver exists this becomes a real `icon` element and nothing else
      // changes.
      const size = Math.round(unit * 0.09);
      const anchor = box ?? cornerBox(ctx, index, size, size);
      return [
        {
          ...base(slot, anchor),
          type: 'shape',
          shape: 'ellipse',
          fill: accent,
        } as DesignerElement,
      ];
    }

    case 'shape':
    default: {
      // Honours `sides` and `innerRatio` where the older accent builder only
      // ever cycled rect/ellipse/star by index.
      const size = Math.round(unit * 0.12);
      const anchor = box ?? cornerBox(ctx, index, size, size);
      const shape = (slot.style?.badgeStyle === 'burst' ? 'star' : 'ellipse') as 'star' | 'ellipse';
      return [
        {
          ...base(slot, anchor),
          type: 'shape',
          shape,
          fill: accent,
          ...(shape === 'star' ? { innerRatio: 0.5, sides: 5 } : {}),
        } as DesignerElement,
      ];
    }
  }
};

/** Build every extra slot a plan carries, in plan order. */
export const buildExtraSlots = (
  slots: DesignSlot[],
  ctx: ExtraSlotContext,
  boxes?: Map<string, { x: number; y: number; width: number; height: number }>
): DesignerElement[] => {
  const extras = slots.filter(isExtraSlot);
  return extras.flatMap((slot, i) => buildExtraSlot(slot, i, ctx, boxes?.get(slot.id)));
};
