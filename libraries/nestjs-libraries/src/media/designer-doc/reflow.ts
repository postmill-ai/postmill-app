import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';
import type { DesignerBackground, DesignerElement } from './designer-doc.schema';
import { subjectPointToFocalPoint } from './focal-point';

// Scale (natW × natH) down to fit inside (maxW × maxH) using a single uniform
// factor, so the image's real aspect ratio (and orientation) is preserved.
export const fitWithin = (
  natW: number,
  natH: number,
  maxW: number,
  maxH: number
) => {
  const scale = Math.min(maxW / natW, maxH / natH, 1);
  return { width: Math.round(natW * scale), height: Math.round(natH * scale) };
};

export type Anchor =
  | 'top-left' | 'top-center' | 'top-right'
  | 'center-left' | 'center' | 'center-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

export const deriveAnchor = (
  el: DesignerElement,
  source: { width: number; height: number }
): Anchor => {
  if (el.anchor) return el.anchor;
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const h =
    cx < source.width * 0.33 ? 'left' : cx > source.width * 0.67 ? 'right' : 'center';
  const v =
    cy < source.height * 0.33 ? 'top' : cy > source.height * 0.67 ? 'bottom' : 'center';
  if (h === 'left' && v === 'top') return 'top-left';
  if (h === 'center' && v === 'top') return 'top-center';
  if (h === 'right' && v === 'top') return 'top-right';
  if (h === 'left' && v === 'center') return 'center-left';
  if (h === 'right' && v === 'center') return 'center-right';
  if (h === 'left' && v === 'bottom') return 'bottom-left';
  if (h === 'center' && v === 'bottom') return 'bottom-center';
  if (h === 'right' && v === 'bottom') return 'bottom-right';
  return 'center';
};

const anchorX = (anchor: Anchor, targetW: number, w: number): number => {
  if (anchor.includes('left')) return 0;
  if (anchor.includes('right')) return targetW - w;
  return (targetW - w) / 2;
};

const anchorY = (anchor: Anchor, targetH: number, h: number): number => {
  if (anchor.includes('top')) return 0;
  if (anchor.includes('bottom')) return targetH - h;
  return (targetH - h) / 2;
};

export interface GroupBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Anchor shared by EVERY member of the group — a placement CONTRACT that
   * survives the reflow (the composer stamps one on a plan-positioned badge).
   *
   * An anchor on a SINGLE member is incidental (a previous per-element reflow
   * left it there) and must never re-split the pair, so it is ignored in
   * favour of the combined bbox. Only unanimity counts as deliberate.
   */
  anchor?: Anchor;
}

/**
 * `originId`s the composer gives its solid layout panels. An element sitting
 * inside one of these reflows against the PANEL, not the canvas — see
 * `computeContainerBoxes`.
 */
export const PANEL_ORIGIN_IDS = new Set([
  'split-panel-bg',
  'editorial-sidebar-bg',
]);

/**
 * A box is treated as FILLING its container (and therefore follows the
 * container's per-axis width) rather than being content-sized, once it spans
 * this much of the container. The composer's panel copy boxes span
 * `panelW - 2·margin` ≈ 78%; a badge chip or a text-sized CTA button is well
 * under half.
 */
export const CONTAINER_FILL_RATIO = 0.7;

/**
 * Scale a pixel-valued STYLE (corner radius, stroke width, shadow offset,
 * tracking) by the factor the element's own size took. A non-zero value never
 * collapses to nothing — a 1px hairline is still a hairline — but an authored
 * `0` stays `0`, and a negative value (tight letter-spacing, an up/left shadow
 * offset) keeps its sign.
 */
const scalePx = (value: number, factor: number): number => {
  if (!Number.isFinite(value) || value === 0) return value;
  return Math.sign(value) * Math.max(1, Math.round(Math.abs(value) * factor));
};

// Generic minimum dimension for a reflowed element — anything thinner reads as
// a degenerate sliver.
const MIN_DIMENSION_PX = 10;
// …except a hairline rule (a CTA underline bar, a thin divider): a source
// dimension already under the generic floor is intentionally thin, and pushing
// it up to 10px turns a 2px rule into a slab sitting across the copy.
const HAIRLINE_FLOOR_PX = 2;

/**
 * The MOVE UNIT an element belongs to: its explicit `groupId`, or the slot id
 * it shares with its `${slotId}-bg` / `${slotId}-underline` companions.
 * Ungrouped elements key on their own `originId` — a group of one. Elements
 * with neither carry no group semantics.
 *
 * Shared by the composer's overlap guard and the doc validator's bounds clamp:
 * two passes that disagree about what moves together tear a badge label off
 * its pill (a live clamp put the label at y=80 and left the pill at 54).
 */
export const groupKeyOf = (
  el: Pick<DesignerElement, 'groupId' | 'originId'>
): string | undefined => {
  if (el.groupId) return el.groupId;
  const origin = el.originId;
  if (!origin) return undefined;
  if (origin.endsWith('-bg')) return origin.slice(0, -'-bg'.length);
  if (origin.endsWith('-underline')) {
    return origin.slice(0, -'-underline'.length);
  }
  return origin;
};

/**
 * Combined bounding boxes of every `groupId` present in `elements` — the
 * shared anchor frame a CTA/badge pair is reflowed through so the pair keeps
 * its relative offsets instead of each element anchoring independently.
 */
export const computeGroupBoxes = (
  elements: DesignerElement[]
): Map<string, GroupBox> => {
  const boxes = new Map<string, GroupBox>();
  for (const el of elements) {
    if (!el.groupId) continue;
    const box = boxes.get(el.groupId);
    if (!box) {
      boxes.set(el.groupId, {
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
      });
      continue;
    }
    const right = Math.max(box.x + box.width, el.x + el.width);
    const bottom = Math.max(box.y + box.height, el.y + el.height);
    box.x = Math.min(box.x, el.x);
    box.y = Math.min(box.y, el.y);
    box.width = right - box.x;
    box.height = bottom - box.y;
  }
  // Unanimous-anchor pass — see `GroupBox.anchor`. `null` marks a group that
  // has been disqualified (a member without an anchor, or a disagreement).
  const consensus = new Map<string, Anchor | null>();
  for (const el of elements) {
    if (!el.groupId) continue;
    const seen = consensus.get(el.groupId);
    if (seen === null) continue;
    if (!el.anchor || (seen !== undefined && seen !== el.anchor)) {
      consensus.set(el.groupId, null);
      continue;
    }
    consensus.set(el.groupId, el.anchor);
  }
  for (const [groupId, anchor] of consensus) {
    const box = boxes.get(groupId);
    if (anchor && box) box.anchor = anchor;
  }
  return boxes;
};

/**
 * Share of `inner`'s own area that lies inside `outer` — the containment test
 * used for panel membership.
 *
 * STRICT containment is too brittle to decide where copy belongs: a live
 * 1584×396 sidebar had its headline clamped 59px past the panel edge by the
 * doc validator, failed containment by that 59px, got no container and reflowed
 * against the CANVAS — the seeded story then spanned `x=0 w=1080` across an
 * empty sidebar. A box that is overwhelmingly inside a panel IS in that panel.
 */
export const boxOverlapRatio = (
  inner: { x: number; y: number; width: number; height: number },
  outer: { x: number; y: number; width: number; height: number }
): number => {
  const area = inner.width * inner.height;
  if (!(area > 0)) return 0;
  const w = Math.min(inner.x + inner.width, outer.x + outer.width) -
    Math.max(inner.x, outer.x);
  const h = Math.min(inner.y + inner.height, outer.y + outer.height) -
    Math.max(inner.y, outer.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / area;
};

/** Area share of itself a box must have inside a container to count as living
 *  in it — see `boxOverlapRatio`. */
export const CONTAINED_RATIO = 0.8;

/**
 * Map every element that lives INSIDE a composer layout panel
 * (`split-panel-bg`, `editorial-sidebar-bg`) to that panel's source-space
 * rect.
 *
 * The panel itself matches `fullBleedShape` and so scales PER-AXIS, while its
 * contents take the uniform (min-axis) branch: on a 1080²→1200×675 reflow the
 * panel widened 497→552 while the copy inside it shrank 389→243, opening a
 * 249px dead gutter against a 60px one on the other side. Elements handed a
 * container reflow their horizontal geometry through the panel's transform
 * instead of the canvas's.
 */
export const computeContainerBoxes = (
  elements: DesignerElement[]
): Map<DesignerElement, GroupBox> => {
  const panels = elements.filter(
    (el) => !!el.originId && PANEL_ORIGIN_IDS.has(el.originId)
  );
  const boxes = new Map<DesignerElement, GroupBox>();
  if (!panels.length) return boxes;
  for (const el of elements) {
    if (panels.includes(el)) continue;
    const panel = panels.find((p) => boxOverlapRatio(el, p) >= CONTAINED_RATIO);
    if (panel) {
      boxes.set(el, {
        x: panel.x,
        y: panel.y,
        width: panel.width,
        height: panel.height,
      });
    }
  }
  return boxes;
};

/**
 * The canvas size a px type scale is derived from — the GEOMETRIC MEAN of the
 * two sides, never the short edge.
 *
 * `Math.min(w, h)` is what a channel variant used to be typeset for, and it is
 * the root cause of "the secondary formats are not adjusted to the aspect
 * ratio": a 1200×675 seeded from a 1080² carries 11% MORE width and got type
 * sized for 675 — a lone 41px headline in a 432px panel. The geometric mean
 * moves with both sides (1080² → 1080 unchanged, 1200×675 → 900), so re-fitting
 * a design onto a wider canvas grows the type instead of shrinking it.
 *
 * `typeBudget` is the VERTICAL BUDGET of the design's copy stack, as a multiple
 * of the canvas HEIGHT: the stack has to fit, and on a 4:1 banner the geometric
 * mean sizes a headline whose headline+subhead+CTA rhythm no longer does. It
 * replaces a layout-blind √-aspect cap that suppressed EVERY canvas past 2:1 by
 * the same amount regardless of what was standing on it — and, being the weaker
 * of the two rules, always won over the composer's real layout-aware budget.
 * A caller with no layout knowledge (the manual designer, a bare reflow) omits
 * it and gets the plain geometric mean.
 *
 * Never returns less than the short edge, so no canvas is ever typeset SMALLER
 * than it was before this basis existed.
 */
export const typeBasisPx = (
  width: number,
  height: number,
  typeBudget?: number
): number => {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (!(short > 0) || !Number.isFinite(long)) return short;
  const geometric = Math.sqrt(short * long);
  if (!(typeof typeBudget === 'number' && typeBudget > 0)) return geometric;
  return Math.max(short, Math.min(geometric, height * typeBudget));
};

/** A canvas the type basis is derived for. `typeBudget` (see `typeBasisPx`) is
 *  a property of the DESIGN, not of one canvas — the composer stamps it on the
 *  outputs it composes and `addOutput` carries it onto every seeded format, so
 *  both sides of a re-fit are measured with the same rule. */
export interface TypeBasisCanvas {
  width: number;
  height: number;
  typeBudget?: number;
}

/**
 * The factor a px value authored against `source` takes to be re-fit onto
 * `target`. THE single basis for every cross-output type/size adjustment —
 * seeding (`smartReflow`), linked propagation (`applyLinked`), shared-scope
 * critic fixes and the conductor's variant re-fit all route through it, so a
 * later pass can never silently re-impose the old `min(scaleX, scaleY)` and
 * undo the per-format typography.
 *
 * BOTH canvases are measured with the design's own vertical budget — a hero
 * banner that COMPOSED at 486 must not seed its siblings from 792.
 */
export const typeScaleRatio = (
  source: TypeBasisCanvas,
  target: TypeBasisCanvas
): number => {
  const budget = source.typeBudget ?? target.typeBudget;
  const from = typeBasisPx(source.width, source.height, budget);
  if (!(from > 0)) return 1;
  return typeBasisPx(target.width, target.height, budget) / from;
};

/**
 * Canvas frame: every layout insets its copy by this share of the canvas TYPE
 * BASIS. RE-DERIVED per canvas (never scaled across formats) so a re-fit
 * output's frame reads evenly on all four sides.
 */
export const CANVAS_MARGIN_RATIO = 0.05;

/**
 * The margin a canvas is framed with.
 *
 * Off the TYPE BASIS, not the short edge: `min(w, h) * 0.05` gave a 1584×396
 * banner a 20px (1.26% of its width) frame — the copy ran nearly edge to edge
 * on the long axis while the same rule left a 54px frame on a square. The
 * second term keeps a margin from eating the short axis of an extreme canvas.
 */
export const canvasMarginPx = (width: number, height: number): number =>
  Math.min(
    Math.round(typeBasisPx(width, height) * CANVAS_MARGIN_RATIO),
    Math.round(Math.min(width, height) * 0.1)
  );

/**
 * Role-aware minimum legible font size on a canvas: a badge/CTA group label
 * (anything carrying a reflow `groupId`) floors at 12px scaled with the
 * canvas's short side (1080 basis); other text keeps the flat 10px floor.
 * Shared with the composer's text-fit clamps so repeated clamp passes can
 * never ratchet a label below legibility.
 */
export const roleFontFloorPx = (
  el: Pick<DesignerElement, 'groupId'>,
  canvasW: number,
  canvasH: number
): number =>
  el.groupId
    ? Math.max(10, Math.round((12 * Math.min(canvasW, canvasH)) / 1080))
    : 10;

/**
 * Synthetic shared anchor frames for copy stacks: text units in the same
 * column — x-ranges overlapping ≥60% of the narrower box — within a normal
 * stack rhythm (vertical gap ≤8% of the source height) reflow through one
 * combined frame, exactly like `computeGroupBoxes` members. Without this,
 * `deriveAnchor`'s thirds-bucketing can split a stack whose members straddle a
 * 0.33 boundary onto different anchors, tearing a subhead hundreds of px away
 * from its headline on aspect change.
 *
 * Stack membership is computed over GROUP boxes: a grouped pair (a CTA label +
 * its pill/underline) collapses to one unit and joins the stack like any
 * ungrouped text. Excluding grouped elements structurally dropped every CTA
 * out of its stack and into a different anchor bucket, leaving a dead vertical
 * band between the copy and the button on aspect change. Every member of a
 * joined group maps to the stack frame, so the pair still moves as one.
 */
export const computeTextStackBoxes = (
  elements: DesignerElement[],
  source: { width: number; height: number }
): Map<DesignerElement, GroupBox> => {
  const groupBoxes = computeGroupBoxes(elements);
  // One stackable unit = an ungrouped visible text, or a whole group that
  // carries visible text (its combined bbox, so a pill/underline rides along).
  const units: { box: GroupBox; members: DesignerElement[] }[] = [];
  const seenGroups = new Set<string>();
  for (const el of elements) {
    if (el.groupId) {
      if (seenGroups.has(el.groupId)) continue;
      const box = groupBoxes.get(el.groupId);
      if (!box) continue;
      // A unit carrying a unanimous, deliberately-authored anchor places
      // ITSELF (see `GroupBox.anchor`). Folding it into a copy stack would
      // override that contract with the stack's shared frame — which is
      // exactly how a plan-positioned badge lost its corner: the badge sits
      // one stack-gap above the headline in a panel, joined the copy stack,
      // and got dragged to the stack's left edge on aspect change.
      if (box.anchor) {
        seenGroups.add(el.groupId);
        continue;
      }
      const members = elements.filter((m) => m.groupId === el.groupId);
      // A lockup instance (a CTA composed as one symbol) stands for its
      // label here: its text lives in the definition's overrides, but it is
      // still the copy unit that must ride the stack — excluding it drops the
      // CTA out of its column exactly like the ungrouped-pair bug above.
      if (
        !members.some(
          (m) => (m.type === 'text' || m.type === 'symbol') && !m.hidden
        )
      )
        continue;
      seenGroups.add(el.groupId);
      units.push({ box, members });
      continue;
    }
    if (el.type !== 'text' || el.hidden) continue;
    units.push({
      box: { x: el.x, y: el.y, width: el.width, height: el.height },
      members: [el],
    });
  }
  units.sort((a, b) => a.box.y - b.box.y);
  const result = new Map<DesignerElement, GroupBox>();
  const maxGap = source.height * 0.08;
  const sameColumn = (a: GroupBox, b: GroupBox): boolean => {
    const overlap =
      Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    return overlap >= 0.6 * Math.min(a.width, b.width);
  };
  let stack: typeof units = [];
  const flush = () => {
    if (stack.length >= 2) {
      const right = Math.max(...stack.map((m) => m.box.x + m.box.width));
      const bottom = Math.max(...stack.map((m) => m.box.y + m.box.height));
      const x = Math.min(...stack.map((m) => m.box.x));
      const y = Math.min(...stack.map((m) => m.box.y));
      const box: GroupBox = { x, y, width: right - x, height: bottom - y };
      for (const unit of stack) {
        for (const member of unit.members) result.set(member, box);
      }
    }
    stack = [];
  };
  for (const unit of units) {
    const prev = stack[stack.length - 1];
    if (
      !prev ||
      (sameColumn(prev.box, unit.box) &&
        unit.box.y - (prev.box.y + prev.box.height) <= maxGap)
    ) {
      stack.push(unit);
      continue;
    }
    flush();
    stack.push(unit);
  }
  flush();
  return result;
};

/**
 * Focal point for a cover image re-placed into a `boxW`x`boxH` box.
 *
 * `focalPoint` is BOX-ASPECT-DEPENDENT (it is the crop window's position in
 * the leftover slack), so inheriting it across an aspect change is wrong — a
 * value computed for a 583×1080 column crops somewhere else entirely in a
 * 648×675 tile. When the element carries the source-space subject centroid the
 * point is re-derived for the new box; otherwise the previous value is all
 * there is to go on.
 */
const coverFocalPoint = (
  el: Pick<
    DesignerElement,
    'subjectPoint' | 'naturalWidth' | 'naturalHeight' | 'focalPoint'
  >,
  boxW: number,
  boxH: number
): { x: number; y: number } => {
  if (el.subjectPoint && el.naturalWidth && el.naturalHeight) {
    return subjectPointToFocalPoint(
      el.subjectPoint,
      el.naturalWidth,
      el.naturalHeight,
      boxW,
      boxH
    );
  }
  return el.focalPoint || { x: 0.5, y: 0.5 };
};

/**
 * Re-place an output BACKGROUND on a new canvas.
 *
 * A full-bleed image background is cover-cropped exactly like an image
 * element, so its `focalPoint` is just as box-aspect-dependent — and a seeded
 * output inherited the primary's verbatim. When the background carries the
 * source-space subject centroid the point is re-derived here (same helper as
 * the element path); without it there is nothing better than what is stored,
 * so the background is returned untouched.
 */
export const reflowBackground = (
  bg: DesignerBackground | undefined,
  target: { width: number; height: number }
): DesignerBackground | undefined => {
  if (
    !bg ||
    bg.type !== 'image' ||
    !bg.subjectPoint ||
    !bg.naturalWidth ||
    !bg.naturalHeight
  ) {
    return bg;
  }
  return { ...bg, focalPoint: coverFocalPoint(bg, target.width, target.height) };
};

export const smartReflow = (
  el: DesignerElement,
  source: TypeBasisCanvas,
  target: TypeBasisCanvas & { formatId?: string },
  groupBox?: GroupBox,
  containerBox?: GroupBox
): Partial<DesignerElement> => {
  // A group container has no geometry of its own to re-fit: `groupBounds`
  // derives a folder's extent from its members and explicitly ignores the
  // container's stored box. Re-fitting it anyway is not just wasted work — the
  // minimum-size clamp below inflates a deliberately zero-sized container to
  // 2x2, which leaves a second, stale source of truth for the same geometry
  // sitting in the document waiting for someone to trust it.
  if (el.type === 'group') return {};

  const scaleX = target.width / source.width;
  const scaleY = target.height / source.height;
  const scale = Math.min(scaleX, scaleY);
  // Anything sized BY THE TYPE — every text box, and the chip/pill/underline
  // grouped with a label — re-fits at the aspect-aware type basis rather than
  // the min-axis scale, so a wider canvas gets BIGGER copy instead of the same
  // design typeset for its short edge (see `typeScaleRatio`). Imagery, panels
  // and loose decorative shapes keep the uniform min-axis scale.
  const typeScale = typeScaleRatio(source, target);
  const contentScale = el.type === 'text' || el.groupId ? typeScale : scale;

  // A grouped element (CTA label + pill/underline, badge + label) anchors as
  // ONE unit: the anchor is re-derived from the group's combined bbox (a
  // member's own stored anchor would re-split the pair) so every member is
  // placed by the same transform and their relative offsets survive. A
  // unanimous group anchor is the one exception — it is deliberate, so it
  // wins over the bbox derivation (see `GroupBox.anchor`).
  const anchor = groupBox
    ? groupBox.anchor ??
      deriveAnchor({ ...el, ...groupBox, anchor: undefined }, source)
    : deriveAnchor(el, source);
  let newW: number;
  let newH: number;
  const result: Partial<DesignerElement> = { anchor };

  // A shape that spans (≈) the full source canvas on an axis — split-panel
  // and editorial-sidebar background panels — must scale per-axis and keep
  // its fractional position like a cover image; the uniform scale below
  // would shrink a full-height panel into a floating rect on aspect change.
  const fullBleedShape =
    el.type === 'shape' &&
    (el.width >= source.width * 0.95 || el.height >= source.height * 0.95);

  // Elements sized/positioned per-axis (cover images, full-bleed shapes)
  // already track the canvas fractionally — a panel IS one of these, so it is
  // never re-homed into itself.
  const perAxis =
    (el.type === 'image' && (el.fitMode || 'cover') === 'cover') ||
    fullBleedShape;
  const container = perAxis ? undefined : containerBox;
  // The container's own per-axis transform (identical to the transform the
  // panel shape itself takes above).
  const containerScaleX = container
    ? Math.max(1, Math.round(container.width * scaleX)) / container.width
    : scaleX;
  const containerFills = (box: { width: number }): boolean =>
    !!container && box.width >= container.width * CONTAINER_FILL_RATIO;
  /**
   * Place `box` (an element or its group/stack frame) horizontally inside the
   * container, preserving the alignment it was authored with: a box centred in
   * the panel stays centred, otherwise the TIGHTER of its two side insets is
   * the load-bearing margin and is what gets scaled. Deriving a left/right
   * bucket from thirds instead would flip alignment on a box that drifts
   * across a boundary.
   */
  const placeInContainer = (box: GroupBox, boxTargetW: number): number => {
    const c = container as GroupBox;
    const cx = Math.round(c.x * scaleX);
    const cw = Math.max(1, Math.round(c.width * scaleX));
    const left = box.x - c.x;
    const right = c.x + c.width - (box.x + box.width);
    const placed =
      Math.abs(left - right) <= c.width * 0.02
        ? cx + Math.round((cw - boxTargetW) / 2)
        : left <= right
        ? cx + Math.round(left * containerScaleX)
        : cx + cw - Math.round(right * containerScaleX) - boxTargetW;
    // A box handed a container belongs INSIDE it. The source inset can arrive
    // NEGATIVE — the doc validator clamps text into the title-safe area, and
    // on a wide banner that pushed a sidebar's headline 59px past the panel
    // edge — and scaling that up onto the new canvas would carry the escape
    // across every format instead of ending it here.
    if (boxTargetW > cw) return placed;
    return Math.min(Math.max(placed, cx), cx + cw - boxTargetW);
  };

  // Hairline rules keep a 2px floor instead of the generic 10px one: a CTA
  // underline bar (or any dimension already under the floor at source) is
  // deliberately thin, and the generic floor fattens a 2px rule 5×.
  const isUnderlineRule =
    el.type === 'shape' && !!el.originId?.endsWith('-underline');
  const scaleDim = (src: number, factor: number): number =>
    Math.max(
      isUnderlineRule || src < MIN_DIMENSION_PX
        ? HAIRLINE_FLOOR_PX
        : MIN_DIMENSION_PX,
      Math.round(src * factor)
    );

  if (el.type === 'image') {
    const mode = el.fitMode || 'cover';
    if (mode === 'cover') {
      // Cover images keep their template-assigned box, scaled per-axis to the
      // target canvas (the render-time cover-crop handles aspect). Sizing to
      // the full target here turned partial-area covers — e.g. a split-panel
      // image column — into full-canvas backgrounds on seeded outputs,
      // burying the panel and copy under the image.
      newW = scaleDim(el.width, scaleX);
      newH = scaleDim(el.height, scaleY);
      result.width = newW;
      result.height = newH;
      result.fitMode = mode;
      result.focalPoint = coverFocalPoint(el, newW, newH);
    } else if (mode === 'contain') {
      const { width: w, height: h } = fitWithin(
        el.naturalWidth || el.width || source.width,
        el.naturalHeight || el.height || source.height,
        target.width,
        target.height
      );
      newW = w;
      newH = h;
      result.width = newW;
      result.height = newH;
      result.fitMode = mode;
      result.focalPoint = el.focalPoint || { x: 0.5, y: 0.5 };
    } else {
      newW = scaleDim(el.width, scaleX);
      newH = scaleDim(el.height, scaleY);
      result.width = newW;
      result.height = newH;
    }
  } else if (fullBleedShape) {
    newW = scaleDim(el.width, scaleX);
    newH = scaleDim(el.height, scaleY);
    result.width = newW;
    result.height = newH;
  } else {
    // Inside a panel, a box that FILLS its container is a container itself —
    // a wrap frame authored against the panel's margins — so it follows the
    // panel's per-axis width instead of shrinking away from those margins.
    // Grouped composites (badge chip + label, CTA button + label) are authored
    // as one content-sized unit and stay uniform, so a label can never outgrow
    // its chip. Height and fontSize are ALWAYS uniform: text must not stretch.
    const widthFactor =
      container && !el.groupId && containerFills(el)
        ? containerScaleX
        : contentScale;
    newW = scaleDim(el.width, widthFactor);
    newH = scaleDim(el.height, contentScale);
    result.width = newW;
    result.height = newH;

    if (el.fontSize) {
      const newFontSize = Math.round(el.fontSize * contentScale);
      // Role-aware floor: a badge/CTA group label must stay legible — 12px
      // at a 1080 canvas (scaled with the output), vs the flat 10px floor
      // for ungrouped text.
      const floor = roleFontFloorPx(el, target.width, target.height);
      result.fontSize = Math.max(floor, newFontSize);
    }
  }

  // Cover images and full-bleed shapes keep their fractional position
  // (per-axis scale); an element inside a panel resolves HORIZONTALLY against
  // that panel (its vertical anchor still resolves against the canvas — a
  // panel is full-height, so panel-bottom and canvas-bottom coincide); a
  // grouped element (explicit groupId or a synthetic copy-stack frame) follows
  // its group's anchor transform; everything else snaps to the derived anchor.
  let x: number;
  let y: number;
  if (perAxis) {
    x = Math.round(el.x * scaleX);
    y = Math.round(el.y * scaleY);
  } else if (groupBox) {
    const frameFills = containerFills(groupBox);
    const groupW = frameFills
      ? Math.round(groupBox.width * containerScaleX)
      : groupBox.width * contentScale;
    const groupH = groupBox.height * contentScale;
    // A frame that follows the container keeps its members' offsets
    // proportional to the frame, not to the (smaller) uniform ratio.
    const offsetFactor = frameFills ? containerScaleX : contentScale;
    x = Math.round(
      (container
        ? placeInContainer(groupBox, groupW)
        : anchorX(anchor, target.width, groupW)) +
        (el.x - groupBox.x) * offsetFactor
    );
    y = Math.round(
      anchorY(anchor, target.height, groupH) + (el.y - groupBox.y) * contentScale
    );
  } else {
    x = container
      ? placeInContainer(
          { x: el.x, y: el.y, width: el.width, height: el.height },
          newW
        )
      : anchorX(anchor, target.width, newW);
    y = anchorY(anchor, target.height, newH);
  }

  // Pixel-valued STYLE (as opposed to geometry) rides the element's own size
  // change. `smartReflow` used to return geometry only, so a 26px pill radius,
  // a 3px CTA stroke and every text shadow/stroke offset came through the
  // seed-copy deep clone verbatim and stayed authored for the source canvas.
  const styleScale = el.height > 0 ? newH / el.height : scale;
  if (typeof el.borderRadius === 'number' && el.borderRadius !== 0) {
    // Pill invariant: scale-then-round breaks it — round(26 × 0.625) = 16 on a
    // round(52 × 0.625) = 33px chip that needs 17. A radius authored AS a pill
    // is recomputed from the new height; anything else scales proportionally.
    result.borderRadius =
      el.height > 0 && Math.abs(el.borderRadius - el.height / 2) <= 1
        ? Math.max(1, Math.round(newH / 2))
        : scalePx(el.borderRadius, styleScale);
  }
  if (typeof el.strokeWidth === 'number') {
    result.strokeWidth = scalePx(el.strokeWidth, styleScale);
  }
  if (typeof el.letterSpacing === 'number') {
    result.letterSpacing = scalePx(el.letterSpacing, styleScale);
  }
  if (el.textStroke) {
    result.textStroke = {
      ...el.textStroke,
      width: scalePx(el.textStroke.width, styleScale),
    };
  }
  if (el.textShadow) {
    result.textShadow = {
      ...el.textShadow,
      blur: scalePx(el.textShadow.blur, styleScale),
      offsetX: scalePx(el.textShadow.offsetX, styleScale),
      offsetY: scalePx(el.textShadow.offsetY, styleScale),
    };
  }

  // Keep text, images, and shapes inside the title-safe area so they remain
  // readable / uncropped by platform overlays. For images and shapes we only
  // nudge when the element actually overlaps a safe-zone edge, preserving the
  // user's intentional edge-to-edge placements when possible. A symbol
  // instance (a CTA lockup) clamps like a shape — its plate+label expand
  // from its box, so nudging the box nudges the whole unit.
  if (
    el.type === 'text' ||
    el.type === 'image' ||
    el.type === 'shape' ||
    el.type === 'symbol'
  ) {
    const safe = getSafeZoneInset(target.formatId || '', target.width, target.height);
    if (el.type === 'text') {
      // A box wider than the title-safe area still overflows the right edge
      // after x-clamping — shrink the width to fit first.
      const safeW = safe.right - safe.left;
      if (newW > safeW) {
        newW = Math.max(10, Math.floor(safeW));
        result.width = newW;
      }
      if (x < safe.left) x = safe.left;
      if (x + newW > safe.right) x = Math.max(safe.left, safe.right - newW);
      if (y < safe.top) y = safe.top;
      if (y + newH > safe.bottom) y = Math.max(safe.top, safe.bottom - newH);
    } else {
      const safeW = safe.right - safe.left;
      const safeH = safe.bottom - safe.top;
      // Full-bleed per-axis elements (cover images, panel bands) and any
      // side already flush with the canvas edge are exempt: pulling a flush
      // edge inward leaves a background-colored "frame" strip behind it.
      // (`perAxis` is hoisted above — same rule.)
      // Grouped pairs (CTA/badge) are never flush-exempt — their label
      // clamps identically, so an exempted side would unglue the pair.
      // Neither are badge chips (`*-bg` companions and small accents under
      // 6% of the source canvas): a chip flush with an edge is a clipped
      // badge, not an intentional bleed — bands/panels keep their exemption
      // through the perAxis/fullBleedShape path above.
      const isChip =
        !!el.originId?.endsWith('-bg') ||
        el.width * el.height < source.width * source.height * 0.06;
      const flushLeft = !el.groupId && !isChip && x === 0;
      const flushRight =
        !el.groupId && !isChip && Math.abs(x + newW - target.width) <= 1;
      const flushTop = !el.groupId && !isChip && y === 0;
      const flushBottom =
        !el.groupId && !isChip && Math.abs(y + newH - target.height) <= 1;
      if (newW <= safeW && !perAxis) {
        if (x < safe.left && !flushLeft) x = safe.left;
        if (x + newW > safe.right && !flushRight) {
          x = Math.max(safe.left, safe.right - newW);
        }
      }
      if (newH <= safeH && !perAxis) {
        if (y < safe.top && !flushTop) y = safe.top;
        if (y + newH > safe.bottom && !flushBottom) {
          y = Math.max(safe.top, safe.bottom - newH);
        }
      }
    }
  }

  // A path's nodes are element-local, so transforming only the box left the
  // DRAWN pixels at their source-canvas coordinates — a rule authored under a
  // square's copy floated mid-canvas on the story, detached from everything.
  // Scale the nodes (and their handles, which are absolute control points)
  // with the box; the box's own x/y carries the translation.
  if (el.type === 'path' && el.nodes?.length && el.width > 0 && el.height > 0) {
    const nodeScaleX = newW / el.width;
    const nodeScaleY = newH / el.height;
    if (nodeScaleX !== 1 || nodeScaleY !== 1) {
      result.nodes = el.nodes.map((n) => ({
        ...n,
        x: n.x * nodeScaleX,
        y: n.y * nodeScaleY,
        inX: n.inX !== undefined ? n.inX * nodeScaleX : undefined,
        inY: n.inY !== undefined ? n.inY * nodeScaleY : undefined,
        outX: n.outX !== undefined ? n.outX * nodeScaleX : undefined,
        outY: n.outY !== undefined ? n.outY * nodeScaleY : undefined,
      }));
    }
  }

  result.x = x;
  result.y = y;
  return result;
};

export const estimateFocalPoint = (
  naturalWidth: number,
  naturalHeight: number
): { x: number; y: number } => {
  const ratio = naturalWidth / naturalHeight;
  if (ratio < 1) {
    return { x: 0.5, y: 0.35 };
  }
  return { x: 0.5, y: 0.5 };
};

export const getSafeZoneInset = (
  formatId: string,
  width: number,
  height: number
) => {
  const fallback = {
    left: width * 0.05,
    top: height * 0.05,
    right: width * 0.95,
    bottom: height * 0.95,
  };
  const preset = CHANNEL_PRESETS.find((p) => p.id === formatId);
  if (!preset?.safeZones?.length) {
    return fallback;
  }
  // `safeZones` are UNSAFE overlay rects (platform UI chrome — see
  // channel-presets.ts). Each zone hugging a canvas edge shrinks the safe
  // area from that edge; zones floating in the interior can't be expressed
  // as an inset box and are ignored.
  let left = 0;
  let top = 0;
  let right = width;
  let bottom = height;
  for (const z of preset.safeZones) {
    const spansWidth = z.x <= 0 && z.x + z.width >= width;
    const spansHeight = z.y <= 0 && z.y + z.height >= height;
    if (spansWidth && z.y <= 0) top = Math.max(top, z.y + z.height);
    if (spansWidth && z.y + z.height >= height) {
      bottom = Math.min(bottom, z.y);
    }
    if (spansHeight && z.x <= 0) left = Math.max(left, z.x + z.width);
    if (spansHeight && z.x + z.width >= width) right = Math.min(right, z.x);
  }
  // Degenerate zone data (overlays covering the canvas) — fall back rather
  // than clamp everything into a zero-area box.
  if (left >= right || top >= bottom) {
    return fallback;
  }
  return { left, top, right, bottom };
};
