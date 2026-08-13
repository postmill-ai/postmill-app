import type { DesignerElement } from '../../../media/designer-doc/designer-doc.schema';
import type {
  SymbolDefinition,
  SymbolOverrides,
} from '../../../media/designer-doc/symbols';

/**
 * Repeated lockups as symbol instances.
 *
 * A lockup is a small composite the composer repeats on every output — the
 * CTA is the first one: a plate shape plus its label, duplicated across up to
 * thirty channel formats with nothing tying the copies together, so restyling
 * it meant editing it once per format.
 *
 * The answer is NOT to keep duplicating plate+label: the primary output's
 * pair is authored once as a `SymbolDefinition` on `doc.symbols` (children
 * `plate` and `label`, in symbol-local coordinates), and EVERY output — the
 * primary included — carries an instance of it. The instance keeps the slot's
 * `originId`, so the addressing every downstream system already uses keeps
 * working: geometry operations (re-fit, safe-zone clamps, critic geometry
 * fixes) patch the instance's own box and `expandSymbolInstance` scales the
 * children from it, exactly like a group; content/style operations write
 * `symbolOverrides` keyed by the child ids inside the definition.
 *
 * Kept pure and out of the composer service so the define → instantiate →
 * expand round trip can be tested without building a document.
 */

/** Child ids inside a lockup definition — the keys fixes target overrides by. */
export const LOCKUP_PLATE = 'plate';
export const LOCKUP_LABEL = 'label';

/** One definition per slot: `cta` and a second `cta-2` never share a symbol. */
export const lockupSymbolId = (slotId: string): string => `lockup-${slotId}`;

/**
 * The copy an instance stands in for, when it carries one — the first text
 * override with content. Collision and stack-order passes are text-driven and
 * predate symbols; this lets them treat a lockup'd CTA as the label it
 * contains instead of as a opaque box.
 */
export const lockupOverrideText = (
  el: Pick<DesignerElement, 'type' | 'symbolOverrides'>
): string | undefined =>
  el.type === 'symbol'
    ? Object.values(el.symbolOverrides ?? {})
        .map((override) => override.text)
        .find((text) => !!text?.trim())
    : undefined;

/**
 * Author a lockup definition from a composed plate+label pair.
 *
 * The pair is built by the ordinary `_ctaElements` path (all of its styling —
 * accent resolution, contrast-checked label fill, per-preset corner treatment —
 * stays there); this only re-roots it: coordinates become symbol-local, the
 * children are renamed to the fix-targetable ids `plate`/`label`, and the
 * per-output addressing (originId/groupId/parentId/slot) is stripped — an
 * expanded child is not independently addressable, the instance is.
 */
export const defineLockup = (
  slotId: string,
  plate: DesignerElement,
  label: DesignerElement
): SymbolDefinition => {
  const box = { x: plate.x, y: plate.y };
  const child = (el: DesignerElement, id: string): DesignerElement =>
    ({
      ...el,
      id,
      x: el.x - box.x,
      y: el.y - box.y,
      originId: undefined,
      groupId: undefined,
      parentId: undefined,
      slot: undefined,
    }) as DesignerElement;
  return {
    id: lockupSymbolId(slotId),
    name: `${slotId} lockup`,
    width: plate.width,
    height: plate.height,
    children: [child(plate, LOCKUP_PLATE), child(label, LOCKUP_LABEL)],
  };
};

/**
 * One output's copy of a lockup.
 *
 * The instance is deliberately unremarkable apart from its type: same box the
 * plate would have had, same `originId`/`groupId` the pair would have carried
 * (so move-units, linked propagation and template slots all keep working),
 * and the label text as an override even when it matches the definition —
 * pinned per instance, a later definition edit can never silently reword copy
 * the user approved.
 */
export const instantiateLockup = (
  definition: SymbolDefinition,
  opts: {
    originId: string;
    groupId?: string;
    box: { x: number; y: number; width: number; height: number };
    overrides?: SymbolOverrides;
    anchor?: DesignerElement['anchor'];
  }
): DesignerElement =>
  ({
    id: '',
    type: 'symbol',
    symbolId: definition.id,
    ...opts.box,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    anchor: opts.anchor,
    originId: opts.originId,
    groupId: opts.groupId,
    symbolOverrides: opts.overrides,
  }) as DesignerElement;
