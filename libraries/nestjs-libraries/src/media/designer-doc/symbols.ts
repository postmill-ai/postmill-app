/**
 * Symbols and template slots.
 *
 * A **symbol** is a reusable group stored once on the document; every instance
 * references it, and editing the definition updates them all. Instances may
 * override TEXT and IMAGE content but never structure — that rule is what
 * keeps "why did my other logo change?" from ever being a question.
 *
 * A **slot** marks an element as a fill-in-the-blank, so a template can open
 * with a short form instead of a canvas of loose layers.
 *
 * Both expand to ordinary elements before anything renders, so no renderer
 * needs to know either concept exists.
 */

import type { DesignerElement } from './designer-doc.schema';

export interface SymbolDefinition {
  id: string;
  name: string;
  /** The symbol's own layer tree, in symbol-local coordinates. */
  children: DesignerElement[];
  width: number;
  height: number;
}

/** What one instance overrides, keyed by the id of the element inside the symbol. */
export type SymbolOverrides = Record<
  string,
  { text?: string; src?: string; fileId?: string; fill?: string }
>;

export interface SlotDefinition {
  /** Shown as the field's label in the template form. */
  name: string;
  kind: 'text' | 'image' | 'color';
  /** Order in the form. Unset sorts last, stably. */
  order?: number;
}

/** The override keys an instance is allowed to set. Structure is never one. */
export const OVERRIDABLE_KEYS = ['text', 'src', 'fileId', 'fill'] as const;

/** Strip anything an instance may not override. */
export const sanitiseOverrides = (overrides: SymbolOverrides): SymbolOverrides => {
  const out: SymbolOverrides = {};
  for (const [id, patch] of Object.entries(overrides || {})) {
    const clean: SymbolOverrides[string] = {};
    for (const key of OVERRIDABLE_KEYS) {
      const value = (patch as Record<string, unknown>)[key];
      if (typeof value === 'string') clean[key] = value;
    }
    if (Object.keys(clean).length) out[id] = clean;
  }
  return out;
};

/**
 * Expand one instance into ordinary elements.
 *
 * Ids are namespaced with the instance's own id so two instances of the same
 * symbol never collide — without that, selecting one would select both.
 */
export const expandSymbolInstance = (
  instance: DesignerElement,
  definition: SymbolDefinition
): DesignerElement[] => {
  const overrides = sanitiseOverrides(instance.symbolOverrides || {});
  // The instance can be resized; the definition is authored at its own size.
  const scaleX = definition.width ? instance.width / definition.width : 1;
  const scaleY = definition.height ? instance.height / definition.height : 1;

  return definition.children.map((child) => {
    const patch = overrides[child.id] || {};
    return {
      ...child,
      ...patch,
      id: `${instance.id}::${child.id}`,
      parentId: child.parentId ? `${instance.id}::${child.parentId}` : instance.parentId,
      x: instance.x + child.x * scaleX,
      y: instance.y + child.y * scaleY,
      width: child.width * scaleX,
      height: child.height * scaleY,
      // Font size scales with the box, as it does everywhere else in the doc.
      ...(child.fontSize ? { fontSize: child.fontSize * Math.min(scaleX, scaleY) } : {}),
      opacity: child.opacity * instance.opacity,
      hidden: child.hidden || instance.hidden,
      // An expanded child is not independently editable; the instance is.
      locked: true,
    };
  });
};

/**
 * Replace every symbol instance in a layer list with its expanded children.
 *
 * Called once before render, so the renderers keep seeing a flat list of
 * ordinary elements. An instance whose definition has gone is dropped rather
 * than drawn as an empty box.
 */
export const expandSymbols = (
  children: DesignerElement[],
  definitions: SymbolDefinition[] | undefined
): DesignerElement[] => {
  if (!definitions?.length) return children.filter((el) => el.type !== 'symbol');
  const byId = new Map(definitions.map((d) => [d.id, d]));

  const out: DesignerElement[] = [];
  for (const el of children) {
    if (el.type !== 'symbol') {
      out.push(el);
      continue;
    }
    const definition = el.symbolId ? byId.get(el.symbolId) : undefined;
    if (!definition) continue;
    out.push(...expandSymbolInstance(el, definition));
  }
  return out;
};

export interface TemplateField {
  elementId: string;
  slot: SlotDefinition;
  /** The element's current content, for seeding the form. */
  value: string;
}

/**
 * The fill-in-the-blanks form for a template, in the author's stated order.
 *
 * An element marked as a slot but of a type the slot kind cannot fill is
 * skipped: a `text` slot on an image is an authoring mistake, and showing an
 * input that writes nowhere is worse than showing nothing.
 */
export const templateFields = (children: DesignerElement[]): TemplateField[] => {
  const fields: TemplateField[] = [];
  children.forEach((el, index) => {
    const slot = el.slot;
    if (!slot?.name) return;
    if (slot.kind === 'text' && el.type !== 'text') return;
    if (slot.kind === 'image' && el.type !== 'image') return;

    fields.push({
      elementId: el.id,
      slot: { ...slot, order: slot.order ?? 1000 + index },
      value:
        slot.kind === 'text'
          ? el.text || ''
          : slot.kind === 'image'
            ? el.src || ''
            : el.fill || '',
    });
  });
  return fields.sort((a, b) => (a.slot.order ?? 0) - (b.slot.order ?? 0));
};

/** The element patch that fills one slot. */
export const fillSlot = (
  kind: SlotDefinition['kind'],
  value: string
): Partial<DesignerElement> => {
  if (kind === 'text') return { text: value };
  if (kind === 'image') return { src: value };
  return { fill: value };
};
