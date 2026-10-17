'use client';
import React, { useEffect, useRef } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { defaultTextBox } from './measure-text';
import {
  combinableElements,
  combineElements,
  PATHFINDER_OPS,
} from './layer-actions';
import type { DesignerElement } from './designer.store';

interface ContextMenuProps {
  x: number;
  y: number;
  targetType: 'element' | 'canvas';
  elementId?: string;
  store: ReturnType<typeof import('./designer.store').createDesignerStore>;
  onClose: () => void;
  onAddImage?: () => void;
}

interface MenuItem {
  label: string;
  action: (() => void) | null;
  /** A hover flyout — the canvas context menu's answer to the menu bar's
      submenuPath (used by Pathfinder). */
  children?: { label: string; action: () => void }[];
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, targetType, elementId, store, onClose, onAddImage }) => {
  const t = useT();
  const menuRef = useRef<HTMLDivElement>(null);
  const s = store.getState();
  const out = s.doc.outputs[s.currentOutput];
  const imageOut = 'children' in out ? out : null;
  const el = elementId
    ? imageOut?.children.find((c: { id: string }) => c.id === elementId) ?? null
    : null;

  // Selection order matters to Pathfinder (Minus Front consumes the top one),
  // so the ops read the selected elements in selectedIds order, like the
  // Layer menu does.
  const selectedEls = ((s.selectedIds || [])
    .map((id: string) => imageOut?.children.find((c: { id: string }) => c.id === id))
    .filter(Boolean) || []) as DesignerElement[];
  const pathfinderReady = combinableElements(selectedEls).length === 2;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', escHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', escHandler);
    };
  }, [onClose]);

  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0] as HTMLElement | undefined;
    const last = focusable[focusable.length - 1] as HTMLElement | undefined;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    el.addEventListener('keydown', handler);
    first?.focus();
    return () => el.removeEventListener('keydown', handler);
  }, []);

  const items: MenuItem[] =
    targetType === 'element' && el
      ? (() => {
          // Right-clicking a member of a multi-selection keeps the selection —
          // collapsing it made Cut/Copy/Group act on one layer out of five.
          const effIds = s.selectedIds.includes(el.id) ? s.selectedIds : [el.id];
          const ensureSelected = () => {
            if (!store.getState().selectedIds.includes(el.id)) store.getState().setSelectedIds([el.id]);
          };
          const elementItems: MenuItem[] = [
          { label: t('designer_action_cut_cut', 'Cut'), action: () => { ensureSelected(); s.cutSelection(); } },
          { label: t('copy', 'Copy'), action: () => { ensureSelected(); s.copySelection(); } },
          { label: t('designer_action_paste_paste', 'Paste'), action: () => s.paste() },
          { label: t('designer_action_duplicate_duplicate', 'Duplicate'), action: () => s.duplicateElement(el.id) },
          { label: '-', action: null },
          { label: t('delete', 'Delete'), action: () => s.removeElement(el.id) },
          { label: '-', action: null },
          { label: t('designer_action_bring_front_bring_to_front', 'Bring to Front'), action: () => s.reorder([el.id], 'front') },
          { label: t('designer_action_bring_forward_bring_forward', 'Bring Forward'), action: () => s.reorder([el.id], 'forward') },
          { label: t('designer_action_send_backward_send_backward', 'Send Backward'), action: () => s.reorder([el.id], 'backward') },
          { label: t('designer_action_send_back_send_to_back', 'Send to Back'), action: () => s.reorder([el.id], 'back') },
          { label: '-', action: null },
          { label: el.locked ? t('designer_action_lock_toggle_unlock', 'Unlock') : t('designer_action_lock_toggle_lock', 'Lock'), action: () => s.updateElement(el.id, { locked: !el.locked }) },
          { label: el.hidden ? t('designer_context_show', 'Show') : t('designer_context_hide', 'Hide'), action: () => s.updateElement(el.id, { hidden: !el.hidden }) },
          { label: '-', action: null },
          { label: t('group', 'Group'), action: () => s.groupSelection(effIds) },
          { label: t('designer_action_ungroup_ungroup', 'Ungroup'), action: () => s.ungroupSelection(effIds) },
          // The same six ops the Layer ▸ Pathfinder submenu runs, surfaced
          // where a two-shape selection actually right-clicks.
          ...(pathfinderReady
            ? [{
                label: t('designer_context_pathfinder', 'Pathfinder'),
                action: null,
                children: PATHFINDER_OPS.map((p) => ({
                  label: t(`designer_pathfinder_${p.op}`, p.label),
                  action: () => combineElements(store, selectedEls, p.op),
                })),
              }]
            : []),
          { label: '-', action: null },
          ...(el.originId
            ? [{ label: t('designer_context_unlink', 'Unlink'), action: () => s.unlinkElement(el.id) }]
            : el.type !== 'icon'
              ? [{
                  label: t('designer_context_apply_all_formats', 'Apply to All Formats'),
                  // Same deterministic group id the Layers footer uses — a
                  // wall-clock id here trips the render-purity lint.
                  action: () => s.relinkElement(el.id, `relink-${el.id}`),
                }]
              : []),
          ...(el.type === 'image' ? [{ label: t('designer_context_set_as_background', 'Set as Background'), action: () => { s.setOutputBackground({ type: 'image', src: el.src! }); } }] : []),
          ];
          return elementItems;
        })()
      : [
          { label: t('designer_action_paste_paste', 'Paste'), action: () => s.paste() },
          { label: '-', action: null },
          { label: t('designer_action_select_all_select_all', 'Select All'), action: () => s.setSelectedIds(imageOut?.children.map((c) => c.id) ?? []) },
          { label: '-', action: null },
          { label: t('designer_context_add_text', 'Add Text'), action: () => s.addElement({ id: '', type: 'text', x: 100, y: 100, ...defaultTextBox({ text: 'Text', fontSize: 16 }), rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Text' }) },
          { label: t('designer_context_add_shape', 'Add Shape'), action: () => s.addElement({ id: '', type: 'shape', x: 100, y: 100, width: 200, height: 200, rotation: 0, opacity: 1, locked: false, hidden: false, shape: 'rect' }) },
          { label: t('designer_context_add_image', 'Add Image'), action: () => onAddImage?.() },
        ];

  return (
    <div
      ref={menuRef}
      className="fixed z-150 bg-newBgColorInner border border-studioBorder rounded-lg py-1 min-w-[200px] shadow-xl"
      style={{ left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - 400) }}
    >
      {items.map((item, i) => {
        if (item.label === '-')
          return <div key={`divider-${i}`} className="border-t border-studioBorder my-1" />;
        if (item.children) {
          return (
            <div key={item.label} className="relative group">
              <button
                type="button"
                aria-haspopup="menu"
                className="w-full text-left px-3 py-1.5 text-sm text-textColor/80 hover:bg-studioBorder/40 hover:text-textColor focus-visible:bg-studioBorder/40 focus-visible:text-textColor focus-visible:outline-hidden flex items-center justify-between gap-3"
              >
                {item.label}
                <span aria-hidden="true">▸</span>
              </button>
              <div className="absolute left-full top-[-4px] hidden group-hover:block group-focus-within:block bg-newBgColorInner border border-studioBorder rounded-lg py-1 min-w-[160px] shadow-xl">
                {item.children.map((child) => (
                  <button
                    key={child.label}
                    className="w-full text-left px-3 py-1.5 text-sm text-textColor/80 hover:bg-studioBorder/40 hover:text-textColor focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent focus-visible:ring-inset"
                    onClick={() => {
                      child.action();
                      onClose();
                    }}
                  >
                    {child.label}
                  </button>
                ))}
              </div>
            </div>
          );
        }
        return (
          <button
            key={item.label}
            className="w-full text-left px-3 py-1.5 text-sm text-textColor/80 hover:bg-studioBorder/40 hover:text-textColor focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent focus-visible:ring-inset"
            onClick={() => {
              item.action?.();
              onClose();
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
};
