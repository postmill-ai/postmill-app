import type { DesignerElement } from '../../media/designer-doc/designer-doc.schema';

/**
 * Turn the composer's move-units into real layer folders.
 *
 * The composer already marks companions with a shared `groupId` — a CTA's plate
 * and its label, a badge and its number — because they must travel together
 * when a design is re-fitted to another canvas. What it never did was emit a
 * `group` ELEMENT, so an AI design opened in the manual Designer as a flat pile
 * of loose layers: a CTA was two unrelated rows in the layers panel, and
 * selecting one to restyle it left the other behind.
 *
 * This wraps each unit exactly the way `groupLayers` in the editor store does —
 * a `group` element plus `parentId` on every member, with `groupId` left in
 * place, since the two mean different things (see the field's own docs).
 *
 * Kept pure and out of the composer service so the z-order rules can be tested
 * without building a document.
 */

/** Members fewer than this are left alone: a folder of one is panel noise. */
const MIN_GROUP_MEMBERS = 2;

export interface WrapOptions {
  /** Stable id source. The group's id is referenced by `parentId`, so unlike
   *  every other element the composer emits it cannot be left blank for the
   *  ops layer to fill in — the reference would dangle. */
  genId: () => string;
  /** Human label for a unit, shown in the layers panel. */
  nameFor?: (groupId: string, members: DesignerElement[]) => string;
}

const defaultName = (groupId: string) =>
  groupId
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ') || 'Group';

export const wrapMoveUnitsInGroups = (
  children: DesignerElement[],
  options: WrapOptions
): DesignerElement[] => {
  const { genId, nameFor = defaultName } = options;

  // Which move-units are worth a folder. An element that already has a
  // `parentId` belongs to someone else's group and is left entirely alone —
  // re-parenting it here would silently move it out of a group a previous pass
  // (or the user) built.
  const counts = new Map<string, DesignerElement[]>();
  for (const el of children) {
    if (!el.groupId || el.parentId) continue;
    const list = counts.get(el.groupId);
    if (list) list.push(el);
    else counts.set(el.groupId, [el]);
  }

  const wrap = new Map<string, { id: string; members: Set<string> }>();
  for (const [groupId, members] of counts) {
    if (members.length < MIN_GROUP_MEMBERS) continue;
    wrap.set(groupId, {
      id: genId(),
      members: new Set(members.map((m) => m.id)),
    });
  }
  if (!wrap.size) return children;

  const out: DesignerElement[] = [];
  const emitted = new Set<string>();

  for (const el of children) {
    const unit = el.groupId ? wrap.get(el.groupId) : undefined;

    // The container is inserted just below its lowest member, so the group's
    // members keep the exact z-order they already had relative to everything
    // else. Appending it instead would silently re-stack the design.
    if (unit && !emitted.has(el.groupId!)) {
      emitted.add(el.groupId!);
      out.push({
        id: unit.id,
        type: 'group',
        name: nameFor(el.groupId!, counts.get(el.groupId!) || []),
        // Derived from the move-unit rather than from `genId`, so the container
        // links to its counterpart on every other output the way content
        // elements do. A random per-output originId would make each format's
        // folder a stranger to the others.
        originId: `${el.groupId}-group`,
        // Zero-sized, as the editor's own groups are: `groupBounds` derives the
        // real extent from the members, so a stored box would go stale the
        // moment a re-fit moved one of them.
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
      } as DesignerElement);
    }

    out.push(unit && unit.members.has(el.id) ? { ...el, parentId: unit.id } : el);
  }

  return out;
};
