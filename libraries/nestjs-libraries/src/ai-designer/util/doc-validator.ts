import type {
  DesignerDoc,
  DesignerElement,
  DesignerOutput,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { estimateWrappedLines } from '../agents/composer/measure-text';
import {
  getSafeZoneInset,
  groupKeyOf,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/reflow';
import type { DesignPlan } from '../ai-designer.types';

/**
 * Deterministic output-quality validator for composed/revised design docs.
 *
 * The strict doc schema only checks shape — an off-canvas element, invisible
 * text (contrast), a shape covering the copy, or a starburst label pinned to
 * the star's points are all schema-valid. This pass AUTO-FIXES what is safe
 * (clamping, z-order, contrast flips) and reports everything it fixed or
 * could not fix as human-readable violation strings. It never throws and
 * returns the SAME doc reference when nothing needed fixing.
 *
 * Z-order is children array order (the renderer draws sequentially), so
 * "beneath" = earlier in the array.
 */

export interface DocValidatorResult {
  doc: DesignerDoc;
  violations: string[];
}

/** Violations that could NOT be auto-repaired start with this prefix. */
export const DEGENERATE_VIOLATION_PREFIX = 'Degenerate output';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const isFiniteNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const hasBox = (el: DesignerElement): boolean =>
  isFiniteNum(el.x) &&
  isFiniteNum(el.y) &&
  isFiniteNum(el.width) &&
  isFiniteNum(el.height);

const overlapArea = (a: Box, b: Box): number => {
  const w = Math.max(
    0,
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  );
  const h = Math.max(
    0,
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  );
  return w * h;
};

const overlaps = (a: Box, b: Box): boolean => overlapArea(a, b) > 0;

const boxInside = (inner: Box, outer: Box): boolean =>
  inner.x >= outer.x - 1 &&
  inner.y >= outer.y - 1 &&
  inner.x + inner.width <= outer.x + outer.width + 1 &&
  inner.y + inner.height <= outer.y + outer.height + 1;

/** Star label-safe inner area — the ~60% box a burst badge's copy must fit. */
export const STAR_LABEL_SAFE_RATIO = 0.6;

/**
 * The VISIBLE box of a star badge, as a share of its AABB. A star's glyph only
 * fills its bounding box at the five points; the corners are empty. Collision
 * and label-fit logic that treats the raw AABB as solid either nudges copy that
 * is nowhere near the star (collision, default ~70%) or pins a label onto the
 * points (label fit, `STAR_LABEL_SAFE_RATIO`). Shared by the composer's overlap
 * guard / badge builder and this validator's badge inner-fit so all three use
 * one convention.
 */
export const starVisualBox = (
  star: { x: number; y: number; width: number; height: number },
  ratio = 0.7
): { x: number; y: number; width: number; height: number } => {
  const insetX = Math.round((star.width * (1 - ratio)) / 2);
  const insetY = Math.round((star.height * (1 - ratio)) / 2);
  return {
    x: star.x + insetX,
    y: star.y + insetY,
    width: Math.max(10, star.width - insetX * 2),
    height: Math.max(10, star.height - insetY * 2),
  };
};

const isVisibleText = (el: DesignerElement): boolean =>
  el.type === 'text' &&
  !el.hidden &&
  (el.opacity ?? 1) > 0 &&
  typeof el.text === 'string' &&
  el.text.trim().length > 0;

/**
 * A lockup instance whose overrides carry copy — the CTA's label lives in
 * `symbolOverrides` now, so the degenerate-output check (which predates
 * symbols) would call a CTA-only design empty without looking through.
 */
const isTextBearingInstance = (el: DesignerElement): boolean =>
  el.type === 'symbol' &&
  !el.hidden &&
  (el.opacity ?? 1) > 0 &&
  Object.values(el.symbolOverrides ?? {}).some(
    (override) => !!override.text?.trim()
  );

const isOpaqueShape = (el: DesignerElement): boolean =>
  el.type === 'shape' && !el.hidden && (el.opacity ?? 1) >= 0.9;

const SOLID_HEX = /^#?[0-9a-f]{6}$/i;

const parseSolidHex = (color: unknown): string | undefined => {
  if (typeof color !== 'string') return undefined;
  const trimmed = color.trim();
  if (!SOLID_HEX.test(trimmed)) return undefined;
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
};

/** WCAG relative luminance of a #rrggbb color. */
const hexLuminance = (hex: string): number => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
};

const contrastRatio = (a: string, b: string): number => {
  const l1 = hexLuminance(a);
  const l2 = hexLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/**
 * A shape fill the given TEXT color reads against at `required`:1 — a plan
 * palette color when one clears the bar (design-preserving), else whichever
 * of white/near-black does. Undefined when neither can (an unreachable pair).
 */
const backdropFor = (
  text: string,
  required: number,
  palette?: string[]
): string | undefined => {
  const fromPalette = (palette ?? [])
    .map(parseSolidHex)
    .find((c): c is string => !!c && contrastRatio(text, c) >= required);
  if (fromPalette) return fromPalette;
  const white = contrastRatio(text, '#FFFFFF');
  const black = contrastRatio(text, '#111111');
  if (Math.max(white, black) < required) return undefined;
  return white >= black ? '#FFFFFF' : '#111111';
};

const clamp = (v: number, min: number, max: number) =>
  Math.min(Math.max(v, min), max);

const elLabel = (el: DesignerElement): string => el.originId || el.id;

/**
 * Whether a shape actually puts pixels on the page.
 *
 * `fill`/`fillGradient` are the obvious cases; a glass panel paints through
 * `backdropFilter`, and an element whose only paint is a color/gradient
 * overlay LAYER STYLE is just as visible. The occlusion checks treated all of
 * those as invisible, which flagged (and could strip) perfectly painted
 * elements the new vocabulary emits.
 */
const isPaintedShape = (el: DesignerElement): boolean =>
  !!el.fill ||
  !!el.fillGradient ||
  !!el.backdropFilter ||
  (el.styles ?? []).some(
    (s) =>
      (s.type === 'color-overlay' || s.type === 'gradient-overlay') &&
      s.enabled !== false
  );


/**
 * Validate (and repair) a design doc. `opts.plan` unlocks the degenerate
 * "no visible text although the plan carries copy" detection; without a plan
 * only the structural checks run.
 */
export function validateDesignDoc(
  doc: DesignerDoc,
  opts?: { plan?: DesignPlan }
): DocValidatorResult {
  const violations: string[] = [];
  let changed = false;

  const outputs = doc.outputs.map((out) => {
    if (!('children' in out) || !Array.isArray(out.children)) return out;
    const result = validateOutput(out, opts, violations);
    if (result.changed) changed = true;
    return result.output;
  });

  return {
    doc: changed ? ({ ...doc, outputs } as DesignerDoc) : doc,
    violations,
  };
}

function validateOutput(
  out: DesignerOutput,
  opts: { plan?: DesignPlan } | undefined,
  violations: string[]
): { output: DesignerOutput; changed: boolean } {
  let changed = false;
  const tag = `output "${out.formatId}"`;

  // TEXT is bounded by the title-safe area rather than the raw canvas: a 30px
  // legal line at y=1050 on a 1080 canvas is "in bounds" by the canvas rule
  // and still ships flush with the edge (or, on a story format, under the
  // platform's UI chrome). Per axis and only where the box FITS the safe area
  // — the same rule `smartReflow` applies — so a deliberately full-bleed text
  // box is not shrunk out of its own layout. Non-text keeps the canvas: a
  // scrim is supposed to be able to bleed to the edge.
  const safeZone =
    isFiniteNum(out.width) && isFiniteNum(out.height)
      ? getSafeZoneInset(out.formatId || '', out.width, out.height)
      : undefined;

  // (1) Canvas bounds: nothing clamps today — an element's AABB must stay
  // inside its output rect.
  //
  // Clamped BY MOVE UNIT (`groupKeyOf`: a badge pill and its label, a CTA
  // plate and its label/underline/shadow), not per element. Clamping members
  // independently moved a badge label to y=80 while its pill stayed at 54 —
  // 26px out of register, with the pill still sitting under the very chrome
  // the label was pulled out of — and did the same on the x axis for wide
  // banners. The unit's combined box is clamped under the strictest rule any
  // member needs (the title-safe area as soon as one of them is text) and
  // every member takes the SAME translation. Only sizes stay per element, so
  // an oversized member is the only one shrunk.
  let children: DesignerElement[] = out.children;
  if (isFiniteNum(out.width) && isFiniteNum(out.height)) {
    const sized = out.children.map((el) =>
      hasBox(el)
        ? {
            ...el,
            width: clamp(el.width, 0, out.width),
            height: clamp(el.height, 0, out.height),
          }
        : el
    );
    const units = new Map<string, number[]>();
    sized.forEach((el, idx) => {
      if (!hasBox(el)) return;
      const key = groupKeyOf(el) ?? `#${idx}`;
      const list = units.get(key);
      if (list) list.push(idx);
      else units.set(key, [idx]);
    });
    const next = [...sized];
    for (const indexes of units.values()) {
      const members = indexes.map((i) => sized[i]);
      const bx = Math.min(...members.map((m) => m.x));
      const by = Math.min(...members.map((m) => m.y));
      const bw = Math.max(...members.map((m) => m.x + m.width)) - bx;
      const bh = Math.max(...members.map((m) => m.y + m.height)) - by;
      // A symbol instance (a CTA lockup) counts as text-bearing: its label
      // lives inside the definition, so the unit still clamps to the
      // title-safe area rather than the raw canvas.
      const safe = members.some((m) => m.type === 'text' || m.type === 'symbol')
        ? safeZone
        : undefined;
      const safeX = !!safe && bw <= safe.right - safe.left;
      const safeY = !!safe && bh <= safe.bottom - safe.top;
      const x = safeX
        ? clamp(bx, safe!.left, Math.max(safe!.left, safe!.right - bw))
        : clamp(bx, 0, Math.max(0, out.width - bw));
      const y = safeY
        ? clamp(by, safe!.top, Math.max(safe!.top, safe!.bottom - bh))
        : clamp(by, 0, Math.max(0, out.height - bh));
      const dx = x - bx;
      const dy = y - by;
      for (const i of indexes) {
        const el = out.children[i];
        const moved = { ...sized[i], x: sized[i].x + dx, y: sized[i].y + dy };
        if (
          moved.x === el.x &&
          moved.y === el.y &&
          moved.width === el.width &&
          moved.height === el.height
        ) {
          continue;
        }
        changed = true;
        violations.push(
          `Clamped element "${elLabel(el)}" on ${tag} into the ` +
            `${safeX || safeY ? 'title-safe area' : 'canvas bounds'} ` +
            `(${el.x},${el.y} ${el.width}x${el.height} → ` +
            `${moved.x},${moved.y} ${moved.width}x${moved.height}).`
        );
        next[i] = moved;
      }
    }
    children = changed ? next : out.children;
  }

  // (1b) Identical-element dedupe: repeated critic passes can add the exact
  // same scrim/accent twice (one per pass). Elements identical in (type,
  // originId, box, fill, opacity) collapse to the first occurrence.
  const seen = new Set<string>();
  children = children.filter((el) => {
    const key = [
      el.type,
      el.originId ?? '',
      el.x,
      el.y,
      el.width,
      el.height,
      el.fill ?? '',
      el.opacity ?? 1,
    ].join('|');
    if (seen.has(key)) {
      changed = true;
      violations.push(
        `Dropped duplicate element "${elLabel(el)}" on ${tag} — identical to ` +
          `an element already in the output.`
      );
      return false;
    }
    seen.add(key);
    return true;
  });

  // (1b2) Slot-uniqueness dedupe: repeated critic addElement passes can layer
  // a fresh element on an existing slot (a second "badge-bg" plate over the
  // original star). Two non-image elements sharing an originId whose boxes
  // overlap are one slot painted twice — keep the earlier, drop the later.
  {
    const priorByOrigin = new Map<string, DesignerElement[]>();
    children = children.filter((el) => {
      if (el.type === 'image' || !el.originId || !hasBox(el)) return true;
      const prior = priorByOrigin.get(el.originId);
      if (prior?.some((p) => overlaps(p, el))) {
        changed = true;
        violations.push(
          `Dropped duplicate element "${elLabel(el)}" on ${tag} — it overlaps ` +
            `an earlier element with the same slot id.`
        );
        return false;
      }
      priorByOrigin.set(el.originId, [...(prior ?? []), el]);
      return true;
    });
  }

  // (1c) Duplicate-copy dedupe: two visible text elements with the SAME
  // normalized text (trim, collapse whitespace, lowercase) — the planner put
  // one message in two slots (badge and CTA both "JOIN NOW"). Keep the more
  // prominent one (larger fontSize, else earlier in children) and drop the
  // duplicate. Exact matches only — a badge "BEAN30" inside a subhead
  // "code BEAN30" is emphasis, not duplication, and must not fire.
  //
  // Exception: when the PLAN declares both slots with the same role, the
  // repetition is a design device, not a planner accident — a poster's echo
  // headline ("PIZZA" twice) is a deliberate second hit, and the plan card
  // showed the user exactly that copy before they accepted it.
  const planRoleBySlotId = new Map(
    (opts?.plan?.slots ?? []).map((s) => [s.id, (s.role || '').toLowerCase()])
  );
  const isPlanEcho = (a: DesignerElement, b: DesignerElement): boolean => {
    const roleA = planRoleBySlotId.get(a.originId ?? '');
    const roleB = planRoleBySlotId.get(b.originId ?? '');
    return !!roleA && roleA === roleB;
  };
  {
    const keeperByText = new Map<string, number>();
    const dupDrop = new Set<number>();
    children.forEach((el, idx) => {
      if (!isVisibleText(el)) return;
      const key = (el.text as string)
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
      const keeperIdx = keeperByText.get(key);
      if (keeperIdx === undefined) {
        keeperByText.set(key, idx);
        return;
      }
      const keeper = children[keeperIdx];
      if (isPlanEcho(el, keeper)) return;
      // A later element only wins with a strictly larger fontSize; on a tie
      // the earlier element stays.
      let dropped = el;
      let kept = keeper;
      if ((el.fontSize ?? 16) > (keeper.fontSize ?? 16)) {
        keeperByText.set(key, idx);
        dropped = keeper;
        kept = el;
      }
      dupDrop.add(dropped === el ? idx : keeperIdx);
      violations.push(
        `Dropped text "${elLabel(dropped)}" on ${tag} — its copy duplicates ` +
          `"${elLabel(kept)}".`
      );
    });
    if (dupDrop.size > 0) {
      changed = true;
      children = children.filter((_, idx) => !dupDrop.has(idx));
    }
  }

  // (2) Shape-over-text occlusion: an opaque shape painted AFTER a text
  // element and covering >50% of it — or covering an area larger than half
  // of EITHER box (a small opaque pill 100% inside a wide subhead) — either
  // belongs beneath that text (it carries a label) or is a stray covering
  // shape (dropped).
  for (;;) {
    const occludes = (text: DesignerElement, shape: DesignerElement) =>
      overlapArea(text, shape) >
      0.5 * Math.min(text.width * text.height, shape.width * shape.height);
    const textIdx = children.findIndex(
      (el, i) =>
        isVisibleText(el) &&
        children.some(
          (other, j) =>
            j > i && isOpaqueShape(other) && hasBox(other) && occludes(el, other)
        )
    );
    if (textIdx < 0) break;
    const text = children[textIdx];
    const shapeIdx = children.findIndex(
      (other, j) =>
        j > textIdx && isOpaqueShape(other) && hasBox(other) && occludes(text, other)
    );
    const shape = children[shapeIdx];
    const next = [...children];
    next.splice(shapeIdx, 1);
    const carriesLabel = next.some(
      (el) => isVisibleText(el) && hasBox(el) && boxInside(el, shape)
    );
    if (carriesLabel) {
      next.splice(next.indexOf(text), 0, shape);
      violations.push(
        `Moved opaque shape "${elLabel(shape)}" on ${tag} behind the text ` +
          `"${elLabel(text)}" it was covering.`
      );
    } else {
      violations.push(
        `Dropped opaque shape "${elLabel(shape)}" on ${tag} — it covered the ` +
          `text "${elLabel(text)}" and carried no label of its own.`
      );
    }
    children = next;
    changed = true;
  }

  // (2b) Shape-over-shape occlusion: an opaque shape painted AFTER a smaller
  // `*-bg` companion and covering ≥80% of it is a plate burying a badge chip
  // (a critic "fix" layering a fresh plate over the original) — drop the
  // covering shape.
  {
    const plateDrop = new Set<number>();
    for (let j = 0; j < children.length; j++) {
      const plate = children[j];
      if (!isOpaqueShape(plate) || !hasBox(plate)) continue;
      for (let k = 0; k < j; k++) {
        const chip = children[k];
        if (chip.type !== 'shape' || chip.hidden) continue;
        if (!chip.originId?.endsWith('-bg') || !hasBox(chip)) continue;
        const chipArea = chip.width * chip.height;
        if (plate.width * plate.height <= chipArea) continue;
        if (overlapArea(plate, chip) >= 0.8 * chipArea) {
          plateDrop.add(j);
          violations.push(
            `Dropped opaque shape "${elLabel(plate)}" on ${tag} — it buried ` +
              `the badge chip "${elLabel(chip)}" beneath it.`
          );
          break;
        }
      }
    }
    if (plateDrop.size > 0) {
      changed = true;
      children = children.filter((_, idx) => !plateDrop.has(idx));
    }
  }

  // (3) Badge inner-fit: a star `-bg` companion's visible area is the
  // star's inner ~60% — a label clamped to the raw AABB spills onto the
  // points. Clamp the paired label into the ~20%-inset safe area, then
  // shrink the font (0.9-step estimator, same as the composer's) until the
  // wrapped text fits the inner box, floored at a legibility minimum. If
  // even the floor overflows, GROW the star (bounded by the canvas); if the
  // star cannot grow enough, revert the burst to a pill — illegible badge
  // text never ships.
  for (let si = 0; si < children.length; si++) {
    const el = children[si];
    if (el.type !== 'shape' || el.shape !== 'star') continue;
    if (!el.originId?.endsWith('-bg') || !hasBox(el)) continue;
    const slotId = el.originId.slice(0, -'-bg'.length);
    const labelIdx = children.findIndex(
      (c) =>
        c.type === 'text' &&
        (c.originId === slotId || c.id === slotId) &&
        hasBox(c)
    );
    if (labelIdx < 0) continue;
    let label = children[labelIdx];
    if (typeof label.text !== 'string' || !label.text.trim()) continue;
    const fontFloor = Math.max(
      10,
      Math.round(Math.min(out.width, out.height) * 0.014)
    );
    const innerFor = (star: Box): Box =>
      starVisualBox(star, STAR_LABEL_SAFE_RATIO);
    const fitsAt = (inner: Box, size: number): boolean =>
      estimateWrappedLines(label.text as string, inner.width, size, label.textTransform) *
        (label.lineHeight || 1.2) *
        size <=
      inner.height;

    let star: Box = { x: el.x, y: el.y, width: el.width, height: el.height };
    let starChanged = false;
    let revertedToPill = false;

    // (3a) SQUARE INVARIANT. A star's glyph is drawn in a square frame; a
    // stretched AABB renders as a splayed blob and pins its label onto the
    // points. The ladder below has no aspect term — a 4.59:1 star satisfies
    // `boxInside` perfectly and only the label ever gets shrunk — so the
    // deformation ratcheted across passes (1.22 → 2.04 → 2.75 → 4.59 measured
    // over four re-fits). Square it on the larger axis about its own centre,
    // then clamp back inside the title-safe area.
    if (Math.abs(star.width - star.height) > 2) {
      const safe = getSafeZoneInset(out.formatId || '', out.width, out.height);
      const side = Math.min(
        Math.max(star.width, star.height),
        Math.max(10, Math.floor(safe.right - safe.left)),
        Math.max(10, Math.floor(safe.bottom - safe.top))
      );
      const cx = star.x + star.width / 2;
      const cy = star.y + star.height / 2;
      violations.push(
        `Squared the star badge "${elLabel(el)}" on ${tag} from ` +
          `${star.width}x${star.height} to ${side}x${side} — a star frame is ` +
          `square.`
      );
      star = {
        x: clamp(
          Math.round(cx - side / 2),
          Math.ceil(safe.left),
          Math.max(Math.ceil(safe.left), Math.floor(safe.right - side))
        ),
        y: clamp(
          Math.round(cy - side / 2),
          Math.ceil(safe.top),
          Math.max(Math.ceil(safe.top), Math.floor(safe.bottom - side))
        ),
        width: side,
        height: side,
      };
      starChanged = true;
      changed = true;
    }

    let inner = innerFor(star);

    if (!boxInside(label, inner)) {
      changed = true;
      violations.push(
        `Clamped the star badge label "${elLabel(label)}" on ${tag} into the ` +
          `star's inner safe area.`
      );
      label = { ...label, ...inner };
    }

    let size = label.fontSize ?? 16;
    const shrinkToFit = (target: Box, from: number): number => {
      let s = from;
      while (s > fontFloor && !fitsAt(target, s)) {
        s = Math.max(fontFloor, Math.floor(s * 0.9));
      }
      return s;
    };
    size = shrinkToFit(inner, size);

    if (!fitsAt(inner, size)) {
      // Even the legibility floor overflows the star's inner area: grow the
      // star around its center (bounded by the title-safe zone — a grown
      // star clamped only to the canvas ships with clipped points under
      // platform overlays) until the floor fits.
      const safe = getSafeZoneInset(out.formatId || '', out.width, out.height);
      const safeW = Math.max(10, Math.floor(safe.right - safe.left));
      const safeH = Math.max(10, Math.floor(safe.bottom - safe.top));
      for (let attempt = 0; attempt < 8 && !fitsAt(inner, size); attempt++) {
        const w2 = Math.min(safeW, Math.round(star.width * 1.2));
        const h2 = Math.min(safeH, Math.round(star.height * 1.2));
        if (w2 === star.width && h2 === star.height) break;
        const cx = star.x + star.width / 2;
        const cy = star.y + star.height / 2;
        star = {
          x: clamp(
            Math.round(cx - w2 / 2),
            Math.ceil(safe.left),
            Math.max(Math.ceil(safe.left), Math.floor(safe.right - w2))
          ),
          y: clamp(
            Math.round(cy - h2 / 2),
            Math.ceil(safe.top),
            Math.max(Math.ceil(safe.top), Math.floor(safe.bottom - h2))
          ),
          width: w2,
          height: h2,
        };
        inner = innerFor(star);
        starChanged = true;
      }
      if (starChanged && fitsAt(inner, size)) {
        changed = true;
        violations.push(
          `Grew the star badge "${elLabel(el)}" on ${tag} so its label stays ` +
            `legible.`
        );
      }
    }

    if (!fitsAt(inner, size)) {
      // The star cannot grow enough — revert the burst to a pill, whose
      // inner area is nearly the full box.
      revertedToPill = true;
      starChanged = true;
      changed = true;
      const insetX = Math.max(2, Math.round(size * 0.6));
      inner = {
        x: star.x + insetX,
        y: star.y,
        width: Math.max(10, star.width - insetX * 2),
        height: star.height,
      };
      size = shrinkToFit(inner, size);
      violations.push(
        `Reverted the star badge "${elLabel(el)}" on ${tag} to a pill — the ` +
          `label could not fit the burst at a legible size.`
      );
    }

    const next = [...children];
    if (starChanged) {
      next[si] = {
        ...el,
        ...star,
        ...(revertedToPill
          ? {
              shape: 'rect',
              borderRadius: Math.round(star.height / 2),
              // Stale star geometry must not survive the revert — a later
              // edit switching the shape back would resurrect whatever
              // point count happened to be lying around.
              sides: undefined,
              innerRatio: undefined,
            }
          : {}),
      };
    }
    const originalLabel = children[labelIdx];
    const labelChanged =
      label.x !== originalLabel.x ||
      label.y !== originalLabel.y ||
      label.width !== originalLabel.width ||
      label.height !== originalLabel.height ||
      size !== (originalLabel.fontSize ?? 16) ||
      revertedToPill;
    if (labelChanged) {
      if (size !== (originalLabel.fontSize ?? 16)) {
        changed = true;
        violations.push(
          `Shrunk the star badge label "${elLabel(label)}" on ${tag} to ` +
            `${size}px so it fits its shape's inner area.`
        );
      }
      next[labelIdx] = { ...label, ...inner, fontSize: size };
    }
    children = next;
  }

  // Solid backdrop for the fill-relationship checks below: the output's own
  // background when it is a plain color.
  const bg = out.bg;
  const bgSolid =
    !bg || bg.type === 'color'
      ? parseSolidHex(bg?.type === 'color' ? bg.color : undefined) ??
        parseSolidHex(out.background)
      : undefined;

  // (3.5) Badge/pill visibility: a `*-bg` companion whose fill blends into
  // the fill painted directly beneath it (panel / output background) is
  // invisible — the label floats on nothing. Recolor it to a contrasting
  // palette accent (falling back to whichever of white/near-black reads).
  children = children.map((el, idx) => {
    if (el.type !== 'shape' || !el.originId?.endsWith('-bg')) return el;
    if (el.hidden || (el.opacity ?? 1) === 0 || !hasBox(el)) return el;
    // Large `-bg` shapes (split-panel-bg, editorial-sidebar-bg) are layout
    // panels the copy intentionally sits on, not badge chips — recoloring
    // one recolors half the design. Same ≥25%-of-canvas guard as the
    // composer's overlap check.
    if (el.width * el.height >= out.width * out.height * 0.25) return el;
    const fill = parseSolidHex(el.fill);
    if (!fill) return el;
    let beneath: string | undefined;
    for (let k = idx - 1; k >= 0; k--) {
      const other = children[k];
      if (other.hidden) continue;
      if (other.type !== 'shape' && other.type !== 'image') continue;
      if (!hasBox(other) || !overlaps(el, other)) continue;
      if (other.type === 'image') return el; // imagery beneath — no flat-fill fix
      // A shape with neither `fill` nor `fillGradient` paints nothing across
      // its box, so it is transparent to this scan — keep looking DOWN the
      // stack. Stopping here hid an IMAGE under an unfilled shape and judged
      // the chip against the output background instead (same bug as §4).
      if (!isPaintedShape(other)) continue;
      beneath = parseSolidHex(other.fill);
      break; // a gradient has no single hex to judge: fall through to the bg
    }
    const backdrop = beneath ?? bgSolid;
    if (!backdrop || contrastRatio(fill, backdrop) >= 1.15) return el;
    const accent = (opts?.plan?.palette ?? [])
      .slice(2)
      .map(parseSolidHex)
      .find((c): c is string => !!c && contrastRatio(c, backdrop) >= 2);
    const recolor =
      accent ??
      (contrastRatio('#FFFFFF', backdrop) >= contrastRatio('#111111', backdrop)
        ? '#FFFFFF'
        : '#111111');
    changed = true;
    violations.push(
      `Recolored the badge shape "${elLabel(el)}" on ${tag} from ${fill} to ` +
        `${recolor} — it blended into the fill beneath it.`
    );
    return { ...el, fill: recolor };
  });

  // (3.6) Shape-over-image washout: a heavy shape (opacity ≥ 0.5) washing
  // out >40% of an image element (or the image background) either backs
  // copy (a scrim — keep it subtle, cap at 0.55) or is decorative haze
  // (drop it).
  const bgIsImage = bg?.type === 'image';
  const canvasArea = out.width * out.height;
  const washDrop = new Set<number>();
  const washCap = new Set<number>();
  for (let idx = 0; idx < children.length; idx++) {
    const el = children[idx];
    const opacity = el.opacity ?? 1;
    if (el.type !== 'shape' || el.hidden || opacity < 0.5 || !hasBox(el)) {
      continue;
    }
    let covers = false;
    for (let k = 0; k < idx; k++) {
      const other = children[k];
      if (other.type !== 'image' || other.hidden || !hasBox(other)) continue;
      if (overlapArea(el, other) > 0.4 * other.width * other.height) {
        covers = true;
        break;
      }
    }
    if (!covers && bgIsImage && el.width * el.height > 0.4 * canvasArea) {
      covers = true;
    }
    if (!covers) continue;
    const backsText = children.some(
      (c, j) => j > idx && isVisibleText(c) && hasBox(c) && overlaps(c, el)
    );
    if (!backsText) {
      violations.push(
        `Dropped shape "${elLabel(el)}" on ${tag} — it washed out the ` +
          `imagery and backed no text.`
      );
      washDrop.add(idx);
    } else if (opacity > 0.55) {
      violations.push(
        `Capped the scrim "${elLabel(el)}" on ${tag} at 0.55 opacity — it ` +
          `was washing out the imagery.`
      );
      washCap.add(idx);
    }
  }
  if (washDrop.size > 0 || washCap.size > 0) {
    changed = true;
    children = children
      .map((el, idx) => (washCap.has(idx) ? { ...el, opacity: 0.55 } : el))
      .filter((_, idx) => !washDrop.has(idx));
  }

  // (4) Contrast: text must read against whatever is painted directly
  // beneath it (topmost earlier overlapping shape fill, else a solid output
  // background). Image backdrops can't be pixel-sampled — skipped.
  // Backing shapes to recolor once the text pass is done (see below) —
  // index → new fill.
  const backdropRecolors = new Map<number, string>();
  children = children.map((el, idx) => {
    if (!isVisibleText(el) || !hasBox(el)) return el;

    let underlying: string | undefined;
    let underlyingIdx = -1;
    let unknown = false;
    for (let k = idx - 1; k >= 0; k--) {
      const other = children[k];
      if (other.hidden) continue;
      if (other.type !== 'shape' && other.type !== 'image') continue;
      if (!hasBox(other) || !overlaps(el, other)) continue;
      if (other.type === 'image') {
        unknown = true; // imagery beneath — pixel sampling is out of scope
        break;
      }
      // A shape with neither `fill` nor `fillGradient` paints nothing across
      // its box (a stroke-only outline CTA), so it is transparent to this
      // scan — keep looking DOWN the stack. Stopping here hid the IMAGE under
      // an unfilled button and silently judged the text against the output bg
      // instead: a #FF00E5 label shipped on a magenta photo at 1.73:1.
      if (!isPaintedShape(other)) continue;
      underlying = parseSolidHex(other.fill);
      underlyingIdx = k;
      break; // a gradient has no single hex to judge: fall through to the bg
    }
    const backdrop = underlying ?? bgSolid;
    if (unknown || !backdrop) return el;

    const fontSize = el.fontSize ?? 16;
    const isLarge =
      fontSize >= 24 || ((el.fontWeight ?? 400) >= 700 && fontSize >= 18);
    const required = isLarge ? 3 : 4.5;
    const fill = parseSolidHex(el.fill) ?? '#000000';
    if (contrastRatio(fill, backdrop) >= required) return el;

    const current = contrastRatio(fill, backdrop);
    const white = contrastRatio('#FFFFFF', backdrop);
    const black = contrastRatio('#111111', backdrop);
    const fixed = white >= black ? '#FFFFFF' : '#111111';
    const problem =
      `Low contrast on ${tag}: text "${elLabel(el)}" ${fill} on ${backdrop} ` +
      `(${current.toFixed(2)}:1, needs ${required}:1)`;

    if (Math.max(white, black) >= required && fixed !== fill) {
      changed = true;
      violations.push(`${problem} — flipped the fill to ${fixed}.`);
      return { ...el, fill: fixed };
    }

    // NEITHER candidate reads against this backdrop (a mid-tone fill puts
    // both white and near-black under the ratio), so flipping the TEXT is
    // useless — and when the winner already IS the current fill it is a pure
    // no-op that used to log a "flip" and force a re-save/re-render on every
    // pass. Recolor the backing SHAPE instead, exactly as rule 3.5 does for a
    // blended badge plate; layout-sized panels stay exempt (recoloring one
    // recolors half the design).
    const backing = underlyingIdx >= 0 ? children[underlyingIdx] : undefined;
    if (
      backing &&
      underlying &&
      !backdropRecolors.has(underlyingIdx) &&
      backing.width * backing.height < out.width * out.height * 0.25
    ) {
      const recolor = backdropFor(fill, required, opts?.plan?.palette);
      if (recolor && recolor !== underlying) {
        backdropRecolors.set(underlyingIdx, recolor);
        changed = true;
        violations.push(
          `${problem} — recolored the shape "${elLabel(backing)}" beneath it ` +
            `from ${underlying} to ${recolor}.`
        );
        return el;
      }
    }

    // Nothing recolorable beneath it: take the best candidate anyway, but say
    // what it actually achieves instead of claiming the defect is fixed.
    if (fixed !== fill) {
      changed = true;
      violations.push(
        `${problem} — could not reach ${required}:1; used ${fixed} at ` +
          `${Math.max(white, black).toFixed(2)}:1.`
      );
      return { ...el, fill: fixed };
    }
    violations.push(
      `${problem} — could not reach ${required}:1; kept ${fill} at ` +
        `${current.toFixed(2)}:1 (no recolorable shape beneath it).`
    );
    return el;
  });
  if (backdropRecolors.size > 0) {
    children = children.map((el, idx) => {
      const recolor = backdropRecolors.get(idx);
      return recolor ? { ...el, fill: recolor } : el;
    });
  }

  // (5) Degenerate output — reported, never auto-fixed.
  const planTexts = opts?.plan?.texts;
  const planHasCopy =
    !!planTexts &&
    Object.values(planTexts).some(
      (t) => typeof t === 'string' && t.trim().length > 0
    );
  if (planHasCopy && !children.some(isVisibleText) && !children.some(isTextBearingInstance)) {
    violations.push(
      `${DEGENERATE_VIOLATION_PREFIX} "${out.formatId}": no visible text ` +
        `elements remain although the plan carries copy — could not auto-repair.`
    );
  }
  for (const el of children) {
    if (el.type === 'image' && !el.hidden && !el.src && !el.fileId) {
      violations.push(
        `${DEGENERATE_VIOLATION_PREFIX} "${out.formatId}": image element ` +
          `"${elLabel(el)}" has no resolvable src.`
      );
    }
  }

  // (5c) Display hierarchy — machine-checkable, no vision needed: the
  // headline-role element must carry the largest type on the canvas. A fix
  // chain shrank a live headline to 32px while the subhead kept 35px and the
  // CTA label read louder than the offer. Report-only; badge/CTA labels
  // inside their own plates are exempt (a plate label is sized to its plate,
  // not to the type scale).
  {
    const texts = children.filter(
      (el): el is DesignerElement & { fontSize: number } =>
        el.type === 'text' &&
        !el.hidden &&
        typeof el.fontSize === 'number' &&
        !!(el.text && String(el.text).trim())
    );
    const headline = texts.find((el) => el.originId === 'headline');
    if (headline) {
      const hasPlate = (el: DesignerElement) =>
        !!el.originId &&
        children.some(
          (c) => c.type === 'shape' && c.originId === `${el.originId}-bg`
        );
      for (const el of texts) {
        if (el === headline || el.originId === 'badge' || hasPlate(el)) {
          continue;
        }
        // A 2px allowance for rounding — anything beyond it means the
        // headline no longer leads (a subhead "as loud as its headline" is
        // the type_hierarchy defect, not a style).
        if (el.fontSize > headline.fontSize + 2) {
          violations.push(
            `Display hierarchy on "${out.formatId}": "${elLabel(el)}" ` +
              `(${el.fontSize}px) out-sizes the headline (${headline.fontSize}px) — ` +
              `the offer no longer reads first.`
          );
        }
      }
    }
  }

  // (6) Uncomposed canvas — the plan promised visual interest (decor, or an
  // image ground) but the output is a flat solid with nothing except type on
  // it. Shipped live as the "blank white card". Element census only: any
  // visible non-text visual (image, shape, path, icon, raster, fill) counts
  // as composition; adjustments do not, they grade what isn't there.
  const planPromisedVisuals =
    (Array.isArray(opts?.plan?.decor) &&
      opts!.plan!.decor!.some((id) => typeof id === 'string' && id !== 'none')) ||
    opts?.plan?.background?.kind === 'image' ||
    opts?.plan?.background?.kind === 'gradient';
  const flatSolidGround = !out.bg || out.bg.type === 'color';
  const hasVisual = children.some(
    (el) =>
      !el.hidden &&
      ['image', 'shape', 'path', 'icon', 'raster', 'fill'].includes(el.type)
  );
  if (planPromisedVisuals && flatSolidGround && !hasVisual) {
    violations.push(
      `${DEGENERATE_VIOLATION_PREFIX} "${out.formatId}": uncomposed canvas — ` +
        `the plan declared decor/an image ground but the output is a flat ` +
        `solid with only text on it.`
    );
  }

  return {
    output: changed ? ({ ...out, children } as DesignerOutput) : out,
    changed,
  };
}
