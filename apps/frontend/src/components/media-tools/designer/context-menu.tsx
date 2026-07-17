'use client';
import React, { useEffect, useRef } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface ContextMenuProps {
  x: number;
  y: number;
  targetType: 'element' | 'canvas';
  elementId?: string;
  store: ReturnType<typeof import('./designer.store').createDesignerStore>;
  onClose: () => void;
  onAddImage?: () => void;
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

  const items =
    targetType === 'element' && el
      ? [
          { label: t('designer_action_cut_cut', 'Cut'), action: () => { s.setSelectedIds([el.id]); s.cutSelection(); } },
          { label: t('copy', 'Copy'), action: () => { s.setSelectedIds([el.id]); s.copySelection(); } },
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
          { label: t('group', 'Group'), action: () => { s.setSelectedIds([el.id]); setTimeout(() => s.groupSelection(), 0); } },
          { label: t('designer_action_ungroup_ungroup', 'Ungroup'), action: () => { s.setSelectedIds([el.id]); setTimeout(() => s.ungroupSelection(), 0); } },
          { label: '-', action: null },
          ...(el.originId
            ? [{ label: t('designer_context_unlink', 'Unlink'), action: () => s.unlinkElement(el.id) }]
            : el.type !== 'icon'
              ? [{
                  label: t('designer_context_apply_all_formats', 'Apply to All Formats'),
                  action: () => {
                    const newOriginId = `relink-${Date.now()}`;
                    s.relinkElement(el.id, newOriginId);
                  },
                }]
              : []),
          ...(el.type === 'image' ? [{ label: t('designer_context_set_as_background', 'Set as Background'), action: () => { s.setOutputBackground({ type: 'image', src: el.src! }); } }] : []),
        ]
      : [
          { label: t('designer_action_paste_paste', 'Paste'), action: () => s.paste() },
          { label: '-', action: null },
          { label: t('designer_action_select_all_select_all', 'Select All'), action: () => s.setSelectedIds(imageOut?.children.map((c) => c.id) ?? []) },
          { label: '-', action: null },
          { label: t('designer_context_add_text', 'Add Text'), action: () => s.addElement({ id: '', type: 'text', x: 100, y: 100, width: 200, height: 40, rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Text' }) },
          { label: t('designer_context_add_shape', 'Add Shape'), action: () => s.addElement({ id: '', type: 'shape', x: 100, y: 100, width: 200, height: 200, rotation: 0, opacity: 1, locked: false, hidden: false, shape: 'rect' }) },
          { label: t('designer_context_add_image', 'Add Image'), action: () => onAddImage?.() },
        ];

  return (
    <div
      ref={menuRef}
      className="fixed z-[150] bg-[#1a1a2e] border border-[#2a2a4a] rounded-lg py-1 min-w-[200px] shadow-xl"
      style={{ left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - 400) }}
    >
      {items.map((item, i) => {
        if (item.label === '-')
          return <div key={`divider-${i}`} className="border-t border-[#2a2a4a] my-1" />;
        return (
          <button
            key={item.label}
            className="w-full text-left px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent focus-visible:ring-inset"
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
