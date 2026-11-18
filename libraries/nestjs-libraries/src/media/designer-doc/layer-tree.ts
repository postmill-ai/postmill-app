import { MAX_FONT_SIZE } from './designer-doc.limits';
import { MIN_FIT_FONT_SIZE } from './fit-text';
import type { DesignerElement } from './designer-doc.schema';

/**
 * The layer tree, derived from the flat `output.children` array.
 *
 * Groups are expressed as a `group` ELEMENT plus a `parentId` on each member,
 * rather than by nesting arrays inside the group. That keeps `children` flat, so
 * the ~87 places that iterate it — reflow, linked outputs, brand compliance,
 * export, the AI composer — keep seeing every layer and need no changes. Only
 * the renderers and the layers panel build a tree.
 *
 * Z-ORDER: array order is still the global z-order (index 0 = bottom). A group
 * renders at the position of its FIRST member, then all of its members in array
 * order. Nothing in the document enforces that a group's members are contiguous,
 * so this rule is what makes a scattered group render sanely instead of
 * disappearing or drawing twice.
 */

export interface LayerNode {
  element: DesignerElement;
  /** Depth from the root, for panel indentation. */
  depth: number;
  /** Group members, bottom-first, matching array order. Empty for leaves. */
  children: LayerNode[];
}

const isGroup = (el: DesignerElement) => el.type === 'group';

/**
 * Build the tree for one output's children.
 *
 * Defensive by construction: a `parentId` pointing at a missing element, at a
 * non-group, or at itself degrades to a root-level layer rather than vanishing.
 * Cycles (A parents B parents A, possible after a bad edit or a merge) are
 * broken the same way.
 */
export const buildLayerTree = (children: DesignerElement[]): LayerNode[] => {
  const byId = new Map(children.map((el) => [el.id, el]));

  /** Resolve the effective parent, ignoring dangling, non-group and cyclic links. */
  const parentOf = (el: DesignerElement): string | undefined => {
    const pid = el.parentId;
    if (!pid || pid === el.id) return undefined;
    const parent = byId.get(pid);
    if (!parent || !isGroup(parent)) return undefined;

    // Walk up; if we come back to `el`, the link is cyclic.
    const seen = new Set<string>([el.id]);
    let cursor: DesignerElement | undefined = parent;
    while (cursor) {
      if (seen.has(cursor.id)) return undefined;
      seen.add(cursor.id);
      const next: string | undefined = cursor.parentId;
      cursor = next ? byId.get(next) : undefined;
    }
    return pid;
  };

  const nodes = new Map<string, LayerNode>();
  for (const el of children) {
    nodes.set(el.id, { element: el, depth: 0, children: [] });
  }

  const roots: LayerNode[] = [];
  // A group is emitted at the position of its first member OR its own position,
  // whichever comes first in array order — so iterate once and attach on sight.
  const emitted = new Set<string>();

  const attach = (node: LayerNode) => {
    if (emitted.has(node.element.id)) return;
    emitted.add(node.element.id);
    const pid = parentOf(node.element);
    if (!pid) {
      roots.push(node);
      return;
    }
    const parentNode = nodes.get(pid);
    if (!parentNode) {
      roots.push(node);
      return;
    }
    // Make sure the group itself is placed before its first member.
    attach(parentNode);
    parentNode.children.push(node);
  };

  for (const el of children) attach(nodes.get(el.id) as LayerNode);

  const setDepth = (list: LayerNode[], depth: number) => {
    for (const n of list) {
      n.depth = depth;
      setDepth(n.children, depth + 1);
    }
  };
  setDepth(roots, 0);

  return roots;
};

/** Depth-first walk in render order (bottom-first), groups before their members. */
export const walkLayerTree = (
  nodes: LayerNode[],
  visit: (node: LayerNode) => void
): void => {
  for (const n of nodes) {
    visit(n);
    walkLayerTree(n.children, visit);
  }
};

/** Flatten a tree back to display order, TOP-first (what the panel shows). */
export const flattenForDisplay = (nodes: LayerNode[]): LayerNode[] => {
  const out: LayerNode[] = [];
  const visit = (list: LayerNode[]) => {
    // Reverse: the panel shows the topmost layer first.
    for (let i = list.length - 1; i >= 0; i--) {
      out.push(list[i]);
      visit(list[i].children);
    }
  };
  visit(nodes);
  return out;
};

/** Every descendant id of a group, for select/move/delete of a whole group. */
export const descendantIds = (
  children: DesignerElement[],
  groupId: string,
  seen: Set<string> = new Set()
): string[] => {
  const out: string[] = [];
  const direct = children.filter((c) => c.parentId === groupId);
  for (const child of direct) {
    // A cyclic parentId chain (possible after a bad edit or a merge — see
    // buildLayerTree) must terminate here too, not stack-overflow.
    if (seen.has(child.id)) continue;
    seen.add(child.id);
    out.push(child.id);
    if (isGroup(child)) out.push(...descendantIds(children, child.id, seen));
  }
  return out;
};

/**
 * A group's bounding box, derived from its members — a group element carries no
 * geometry of its own, so its box is always whatever it contains.
 */
export const groupBounds = (
  children: DesignerElement[],
  groupId: string
): { x: number; y: number; width: number; height: number } | null => {
  const ids = new Set(descendantIds(children, groupId));
  const members = children.filter((c) => ids.has(c.id) && c.type !== 'group');
  if (!members.length) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const m of members) {
    minX = Math.min(minX, m.x);
    minY = Math.min(minY, m.y);
    maxX = Math.max(maxX, m.x + m.width);
    maxY = Math.max(maxY, m.y + m.height);
  }
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
};

export const selectionLeafIds = (
  children: DesignerElement[],
  ids: string[]
): string[] => {
  const byId = new Map(children.map((el) => [el.id, el]));
  const leaves = new Set<string>();
  for (const id of ids) {
    const el = byId.get(id);
    if (!el) continue;
    if (el.type !== 'group') {
      leaves.add(el.id);
      continue;
    }
    for (const descendantId of descendantIds(children, el.id)) {
      const descendant = byId.get(descendantId);
      if (descendant && descendant.type !== 'group') leaves.add(descendant.id);
    }
  }
  return children.filter((el) => leaves.has(el.id)).map((el) => el.id);
};

export const selectionBounds = (
  children: DesignerElement[],
  ids: string[]
): { x: number; y: number; width: number; height: number } | null => {
  const leaves = new Set(selectionLeafIds(children, ids));
  const members = children.filter((el) => leaves.has(el.id));
  if (!members.length) return null;
  const minX = Math.min(...members.map((el) => el.x));
  const minY = Math.min(...members.map((el) => el.y));
  const maxX = Math.max(...members.map((el) => el.x + el.width));
  const maxY = Math.max(...members.map((el) => el.y + el.height));
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
};

export const groupGeometryPatches = (
  children: DesignerElement[],
  groupId: string,
  updates: Partial<DesignerElement>
): { id: string; updates: Partial<DesignerElement> }[] => {
  const bounds = groupBounds(children, groupId);
  if (!bounds) return [];
  const scaleX = updates.width === undefined ? 1 : Math.max(1, updates.width) / bounds.width;
  const scaleY = updates.height === undefined ? 1 : Math.max(1, updates.height) / bounds.height;
  const originX = updates.x ?? bounds.x;
  const originY = updates.y ?? bounds.y;
  const resizeType = updates.width !== undefined && updates.height !== undefined;
  const typeScale = Math.sqrt(scaleX * scaleY);
  const ids = new Set(descendantIds(children, groupId));
  return children.flatMap((el) => {
    if (!ids.has(el.id) || el.type === 'group') return [];
    const patch: Partial<DesignerElement> = {
      x: originX + (el.x - bounds.x) * scaleX,
      y: originY + (el.y - bounds.y) * scaleY,
      width: Math.max(1, el.width * scaleX),
      height: Math.max(1, el.height * scaleY),
    };
    if (
      resizeType && typeScale > 0 && el.type === 'text' && el.fontSize &&
      !el.richText?.length && !el.textPath && (el.curve || 0) === 0
    ) {
      patch.fontSize = Math.min(
        MAX_FONT_SIZE,
        Math.max(MIN_FIT_FONT_SIZE, Math.round(el.fontSize * typeScale))
      );
    }
    return [{ id: el.id, updates: patch }];
  });
};

/**
 * Effective visibility: a layer inside a hidden group is hidden even when its
 * own `hidden` flag is false. Renderers must consult this, not `el.hidden`.
 */
export const isEffectivelyHidden = (
  children: DesignerElement[],
  el: DesignerElement
): boolean => {
  const byId = new Map(children.map((c) => [c.id, c]));
  let cursor: DesignerElement | undefined = el;
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor.id)) return false;
    seen.add(cursor.id);
    if (cursor.hidden) return true;
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return false;
};

/** Same for lock — a layer in a locked group cannot be edited. */
export const isEffectivelyLocked = (
  children: DesignerElement[],
  el: DesignerElement
): boolean => {
  const byId = new Map(children.map((c) => [c.id, c]));
  let cursor: DesignerElement | undefined = el;
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor.id)) return false;
    seen.add(cursor.id);
    if (cursor.locked) return true;
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return false;
};

/**
 * Move `ids` so they sit at `targetIndex` in the flat array, optionally
 * reparenting them. This is what drag-to-reorder needs and what the existing
 * `reorder` (front/back/forward/backward only) cannot express.
 *
 * Moving a group carries its whole subtree, and a group can never be dropped
 * inside itself.
 */
export const moveLayers = (
  children: DesignerElement[],
  ids: string[],
  targetIndex: number,
  newParentId?: string
): DesignerElement[] => {
  const moving = new Set(ids);
  // Dragging a group takes everything under it.
  for (const id of ids) {
    const el = children.find((c) => c.id === id);
    if (el && isGroup(el)) descendantIds(children, id).forEach((d) => moving.add(d));
  }

  // Refuse to drop a group into its own subtree.
  if (newParentId && moving.has(newParentId)) return children;

  const picked = children.filter((c) => moving.has(c.id));
  if (!picked.length) return children;
  const rest = children.filter((c) => !moving.has(c.id));

  const clamped = Math.max(0, Math.min(targetIndex, rest.length));
  const reparented = picked.map((c) =>
    // Only the dragged tops change parent; descendants keep their own.
    ids.includes(c.id) ? { ...c, parentId: newParentId } : c
  );

  return [...rest.slice(0, clamped), ...reparented, ...rest.slice(clamped)];
};
