import type { DesignerElement } from '../../media/designer-doc/designer-doc.schema';
import type { DesignSlot } from '../ai-designer.types';

/**
 * Marking a delivered design as a re-runnable template.
 *
 * The AI Designer already saves every accepted design as a `DesignTemplate`
 * row, but the document behind it was a canvas of loose layers: opening it
 * meant finding the headline among fifteen elements and editing it in place.
 * The manual Designer has a Template Fill panel that lists named slots and
 * takes new content for each — a design that declares its slots opens into
 * that panel instead, which is the difference between "a design you made once"
 * and "a template you can re-run".
 *
 * The composer knows exactly which elements carry copy and imagery, because it
 * placed them from named plan slots. That knowledge is thrown away today; this
 * writes it down.
 */

/** Slot kinds the Designer's fill panel understands. */
type SlotKind = 'text' | 'image' | 'color';

/**
 * The fill-panel kind a plan slot becomes.
 *
 * Decorative and structural elements are deliberately NOT slots: a fill panel
 * offering to change the divider is noise, and the value of the panel is that
 * everything in it is worth editing.
 */
const slotKindFor = (slot: DesignSlot): SlotKind | null => {
  switch (slot.kind) {
    case 'text':
    case 'cta-button':
    case 'badge':
      return 'text';
    case 'image':
    case 'logo':
      return 'image';
    default:
      return null;
  }
};

/** A readable field name from a slot id: `bottom-caption` → `Bottom caption`. */
export const slotLabel = (slot: DesignSlot): string => {
  const source = (slot.role || slot.id).replace(/[-_]/g, ' ').trim();
  if (!source) return 'Field';
  return source.charAt(0).toUpperCase() + source.slice(1);
};

/**
 * Mark the elements a plan's slots produced as template fields.
 *
 * Matched by `originId`, which the composer sets from the slot id — the same
 * key the copywriter, the critic and the cross-format link all use, so a slot
 * that can be re-filled here is exactly one that can be revised elsewhere.
 *
 * `order` follows the plan's own slot order rather than z-order, so the fill
 * panel reads headline-then-subhead-then-CTA regardless of what the layout did
 * with them.
 */
export const markTemplateSlots = (
  children: DesignerElement[],
  slots: DesignSlot[]
): DesignerElement[] => {
  const byId = new Map<string, { slot: DesignSlot; order: number }>();
  slots.forEach((slot, order) => {
    if (slotKindFor(slot)) byId.set(slot.id, { slot, order });
  });
  if (!byId.size) return children;

  let changed = false;
  const out = children.map((el) => {
    const key = el.originId || el.id;
    const entry = byId.get(key);
    if (!entry || el.slot) return el;

    const kind = slotKindFor(entry.slot);
    if (!kind) return el;

    // An image element with no source is a placeholder the composer could not
    // fill; offering it as a template field is right, but a TEXT element with
    // no text is an empty box nobody wants in the panel. A lockup instance
    // (a CTA composed as a symbol) carries its label in `symbolOverrides`
    // instead of `text` — look through to it, or every composed CTA would
    // silently drop out of the fill panel.
    const overrideText = Object.values(el.symbolOverrides ?? {})
      .map((override) => override.text)
      .find((text) => !!text?.trim());
    if (kind === 'text' && !el.text?.trim() && !overrideText) return el;

    changed = true;
    return {
      ...el,
      slot: { name: slotLabel(entry.slot), kind, order: entry.order },
    } as DesignerElement;
  });

  return changed ? out : children;
};
