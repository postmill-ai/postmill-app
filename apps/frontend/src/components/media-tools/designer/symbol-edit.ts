/**
 * Text editing for symbol instances.
 *
 * The canvas renders symbol instances by expanding them inline, so the node a
 * user double-clicks carries a phantom id like `instance::label` that does not
 * exist in `output.children` — the generic edit path finds nothing and the CTA
 * label looks "not editable". This resolves such an id back to the real
 * instance + definition child, builds the expanded pseudo-element the overlay
 * can sit on, and commits the new text through `symbolOverrides` (the only
 * channel an instance is allowed to write — structure stays definition-owned).
 */

import type { DesignerElement, DesignerOutput } from './designer.store';
import {
  expandSymbolInstance,
  type SymbolDefinition,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/symbols';
import { applyTextTransform } from '@postmill-ai/nestjs-libraries/media/designer-doc/fit-text';

export interface TextEditTarget {
  /** The element the overlay should edit — expanded geometry for a symbol child. */
  element: DesignerElement;
  /** Set when the target is a child inside a symbol instance. */
  instanceId?: string;
  childId?: string;
}

const splitPhantomId = (
  id: string
): { instanceId: string; childId: string } | null => {
  const sep = id.indexOf('::');
  if (sep === -1) return null;
  const instanceId = id.slice(0, sep);
  const childId = id.slice(sep + 2);
  if (!instanceId || !childId) return null;
  return { instanceId, childId };
};

/** The real element a canvas click id belongs to (instance for expanded children). */
export const resolveSelectableId = (
  output: Pick<DesignerOutput, 'children'> | undefined,
  id: string
): string => {
  const children = output?.children || [];
  if (children.some((c) => c.id === id)) return id;
  const phantom = splitPhantomId(id);
  if (phantom && children.some((c) => c.id === phantom.instanceId)) {
    return phantom.instanceId;
  }
  return id;
};

/**
 * Resolve an edit id to an overlay target. Plain text elements pass through;
 * a symbol instance's TEXT child becomes the expanded pseudo-element whose
 * commit lands in the instance's overrides. Anything else returns null.
 */
export const resolveTextEditTarget = (
  output: Pick<DesignerOutput, 'children'> | undefined,
  symbols: SymbolDefinition[] | undefined,
  id: string
): TextEditTarget | null => {
  const children = output?.children || [];
  const direct = children.find((c) => c.id === id);
  if (direct) {
    return direct.type === 'text' ? { element: direct } : null;
  }

  const phantom = splitPhantomId(id);
  if (!phantom) return null;
  const instance = children.find(
    (c) => c.id === phantom.instanceId && c.type === 'symbol'
  );
  const definition = instance?.symbolId
    ? symbols?.find((d) => d.id === instance.symbolId)
    : undefined;
  if (!instance || !definition) return null;

  const child = definition.children.find((c) => c.id === phantom.childId);
  if (!child || child.type !== 'text') return null;

  const expanded = expandSymbolInstance(instance, definition).find(
    (c) => c.id === id
  );
  if (!expanded) return null;

  // An override replaces the child's text wholesale, so a stale richText from
  // the definition must not seed the editor when one is in force.
  const overridden = instance.symbolOverrides?.[phantom.childId]?.text;
  return {
    element: {
      ...expanded,
      locked: false,
      ...(overridden !== undefined ? { richText: undefined } : {}),
    },
    instanceId: phantom.instanceId,
    childId: phantom.childId,
  };
};

/**
 * The element patch that commits an edited symbol-child text to the instance.
 * `fill` rides along only when the editor actually changed it — writing a fill
 * the user did not touch would freeze it against future definition edits.
 */
export const symbolTextCommit = (
  instance: DesignerElement,
  childId: string,
  text: string,
  fill?: string
): Partial<DesignerElement> => ({
  symbolOverrides: {
    ...(instance.symbolOverrides || {}),
    [childId]: {
      ...(instance.symbolOverrides?.[childId] || {}),
      text,
      ...(fill !== undefined ? { fill } : {}),
    },
  },
});

/**
 * The element patch that commits a symbol child's fill to the instance. Kept
 * separate from `symbolTextCommit` so a colour change does not also pin the
 * child's CURRENT text as an override (which would orphan it from later
 * definition edits).
 */
export const symbolFillCommit = (
  instance: DesignerElement,
  childId: string,
  fill: string
): Partial<DesignerElement> => ({
  symbolOverrides: {
    ...(instance.symbolOverrides || {}),
    [childId]: { ...(instance.symbolOverrides?.[childId] || {}), fill },
  },
});

/** Breathing room either side of the measured glyphs, in canvas px. */
const LABEL_REFIT_SLACK = 8;

/**
 * The geometry patch that grows an instance when a longer committed label
 * would overflow its pill.
 *
 * The CTA lockup fits text to the label box by SHRINKING the font; retyping
 * "Shop now" as "Get 20% off today" painted the new copy at half size inside
 * the same button. Refitting widens the instance instead — expansion scales
 * the plate and the label box proportionally from the instance size, so the
 * pill grows around the text at its authored font size. Grow-only, and grown
 * about the centre: shrinking on a shorter edit (or growing one-sided) would
 * walk the button away from where the user placed it.
 *
 * `measure` is the browser measurement primitive (`measureForElement`); null
 * when no canvas is available (jsdom, locked-down environments), in which case
 * the instance keeps its size.
 */
export const refitSymbolToText = (
  instance: DesignerElement,
  definition: SymbolDefinition,
  childId: string,
  text: string,
  measure: ((line: string, fontSize: number) => number) | undefined
): Partial<DesignerElement> | null => {
  if (!measure || !definition.width) return null;
  const child = definition.children.find((c) => c.id === childId);
  if (!child || child.type !== 'text' || !(child.width > 0)) return null;

  // The same scales expansion applies, so the measurement happens at the font
  // size the label will actually paint at.
  const scaleX = instance.width / definition.width;
  const scaleY = definition.height ? instance.height / definition.height : 1;
  const fontSize = (child.fontSize || 16) * Math.min(scaleX, scaleY);
  const measured =
    measure(applyTextTransform(text, child.textTransform), fontSize) +
    (child.letterSpacing || 0) * text.length;
  const required = measured + LABEL_REFIT_SLACK * 2;

  // The expanded label box is child.width * scaleX; the copy already fits.
  if (required <= child.width * scaleX) return null;

  const width = Math.ceil((definition.width * required) / child.width);
  const x = Math.round(instance.x - (width - instance.width) / 2);
  return { x, width };
};
