'use client';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { addText } from './add-text';
import {
  combinableElements,
  combineElements,
  PATHFINDER_OPS,
} from './layer-actions';
import type { DesignerElement, DesignerOutput } from './designer.store';
import { pageChildren } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.pages';
import {
  getContextMenuPlacement,
  getSubmenuPlacement,
  type MenuPlacement,
} from './context-menu-position';

interface ContextMenuProps {
  x: number;
  y: number;
  targetType: 'element' | 'canvas' | 'clip';
  elementId?: string;
  canvasPoint?: { x: number; y: number };
  store: ReturnType<typeof import('./designer.store').createDesignerStore>;
  onClose: () => void;
  onAddImage?: () => void;
}

interface MenuItem {
  label: string;
  action: (() => void) | null;
  /** A hover/focus/touch flyout — the canvas context menu's answer to the
      menu bar's submenuPath (used by Pathfinder). */
  children?: { label: string; action: () => void }[];
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, targetType, elementId, canvasPoint, store, onClose, onAddImage }) => {
  const t = useT();
  const toaster = useToaster();
  const menuRef = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const flyoutTriggerRefs = useRef(new Map<number, HTMLButtonElement>());
  const flyoutCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flyoutFocusReturn = useRef(false);
  const menuSizeRef = useRef<{ width: number; height: number } | null>(null);
  const flyoutSizeRef = useRef<{ width: number; height: number } | null>(null);
  const [openFlyout, setOpenFlyout] = useState<number | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<MenuPlacement | null>(null);
  const [flyoutPlacement, setFlyoutPlacement] = useState<MenuPlacement | null>(null);
  const s = store.getState();
  const out = s.doc.outputs[s.currentOutput];
  const pageEls: DesignerElement[] = 'children' in out ? pageChildren(out as DesignerOutput, s.currentPage) : [];
  const imageOut = 'children' in out ? { ...(out as DesignerOutput), children: pageEls } : null;
  const el = elementId
    ? imageOut?.children.find((c: { id: string }) => c.id === elementId) ?? null
    : null;
  const clipTrack = targetType === 'clip' && 'tracks' in out
    ? out.tracks.find((track) => track.clips.some((clip) => clip.id === elementId))
    : undefined;
  const videoClip = clipTrack?.clips.find((clip) => clip.id === elementId);

  // Selection order matters to Pathfinder (Minus Front consumes the top one),
  // so the ops read the selected elements in selectedIds order, like the
  // Layer menu does.
  const selectedEls = ((s.selectedIds || [])
    .map((id: string) => imageOut?.children.find((c: { id: string }) => c.id === id))
    .filter(Boolean) || []) as DesignerElement[];
  const pathfinderReady = combinableElements(selectedEls).length >= 2;

  const cancelFlyoutClose = useCallback(() => {
    if (flyoutCloseTimer.current) clearTimeout(flyoutCloseTimer.current);
    flyoutCloseTimer.current = null;
  }, []);

  const scheduleFlyoutClose = useCallback(() => {
    cancelFlyoutClose();
    flyoutCloseTimer.current = setTimeout(() => setOpenFlyout(null), 120);
  }, [cancelFlyoutClose]);

  const showFlyout = useCallback((index: number) => {
    cancelFlyoutClose();
    if (index !== openFlyout) {
      flyoutSizeRef.current = null;
      setFlyoutPlacement(null);
    }
    setOpenFlyout(index);
  }, [cancelFlyoutClose, openFlyout]);

  const updatePlacements = useCallback(() => {
    const menu = menuRef.current;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    if (menu) {
      const rect = menu.getBoundingClientRect();
      const borderWidth = Math.max(0, rect.width - menu.clientWidth);
      const borderHeight = Math.max(0, rect.height - menu.clientHeight);
      const measured = menuSizeRef.current ?? { width: 0, height: 0 };
      menuSizeRef.current = {
        width: Math.max(measured.width, menu.scrollWidth + borderWidth),
        height: Math.max(measured.height, menu.scrollHeight + borderHeight),
      };
      setMenuPlacement(getContextMenuPlacement({ x, y }, menuSizeRef.current, viewport));
    }

    const flyout = flyoutRef.current;
    const trigger = openFlyout === null ? null : flyoutTriggerRefs.current.get(openFlyout);
    if (flyout && trigger) {
      const rect = flyout.getBoundingClientRect();
      const borderWidth = Math.max(0, rect.width - flyout.clientWidth);
      const borderHeight = Math.max(0, rect.height - flyout.clientHeight);
      const measured = flyoutSizeRef.current ?? { width: 0, height: 0 };
      flyoutSizeRef.current = {
        width: Math.max(measured.width, flyout.scrollWidth + borderWidth),
        height: Math.max(measured.height, flyout.scrollHeight + borderHeight),
      };
      setFlyoutPlacement(getSubmenuPlacement(
        trigger.getBoundingClientRect(),
        flyoutSizeRef.current,
        viewport
      ));
    }
  }, [openFlyout, x, y]);

  useLayoutEffect(() => {
    updatePlacements();
  }, [targetType, elementId, pathfinderReady, updatePlacements]);

  useEffect(() => {
    const handler = () => updatePlacements();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [updatePlacements]);

  useEffect(() => {
    const downHandler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        !flyoutRef.current?.contains(target)
      ) {
        onClose();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !menuRef.current) return;

      const rootItems = Array.from(menuRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ));
      const trigger = openFlyout === null ? null : flyoutTriggerRefs.current.get(openFlyout);
      const flyoutItems = flyoutRef.current
        ? Array.from(flyoutRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'))
        : [];
      const triggerIndex = trigger ? rootItems.indexOf(trigger) : -1;
      const focusable = triggerIndex >= 0
        ? [...rootItems.slice(0, triggerIndex + 1), ...flyoutItems, ...rootItems.slice(triggerIndex + 1)]
        : rootItems;
      if (!focusable.length) return;

      const current = focusable.indexOf(document.activeElement as HTMLElement);
      const direction = e.shiftKey ? -1 : 1;
      const next = current < 0
        ? (e.shiftKey ? focusable.length - 1 : 0)
        : (current + direction + focusable.length) % focusable.length;
      e.preventDefault();
      focusable[next].focus();
    };
    document.addEventListener('mousedown', downHandler);
    document.addEventListener('keydown', keyHandler, true);
    return () => {
      document.removeEventListener('mousedown', downHandler);
      document.removeEventListener('keydown', keyHandler, true);
    };
  }, [onClose, openFlyout]);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('button')?.focus();
    return () => {
      if (flyoutCloseTimer.current) clearTimeout(flyoutCloseTimer.current);
    };
  }, []);

  const items: MenuItem[] =
    targetType === 'clip' && clipTrack && videoClip
      ? [
          {
            label: t('copy', 'Copy'),
            action: () => store.getState().copySelectedClips(),
          },
          {
            label: t('designer_action_paste_paste', 'Paste'),
            action: () => store.getState().pasteClips(store.getState().playheadMs),
          },
          {
            label: t('designer_action_duplicate_duplicate', 'Duplicate'),
            action: () => {
              const state = store.getState();
              if (state.selectedClips.length > 1) {
                state.copySelectedClips();
                store.getState().pasteClips(state.playheadMs);
              } else {
                state.duplicateClip(s.currentOutput, clipTrack.id, videoClip.id);
              }
            },
          },
          { label: '-', action: null },
          {
            label: t('group', 'Group'),
            action: () => store.getState().groupSelection(),
          },
          {
            label: t('designer_action_ungroup_ungroup', 'Ungroup'),
            action: () => store.getState().ungroupSelection(),
          },
        ]
      : targetType === 'element' && el
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
          { label: t('designer_action_paste_paste', 'Paste'), action: () => s.paste(canvasPoint) },
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
          // where a multi-shape selection actually right-clicks.
          ...(pathfinderReady
            ? [{
                label: t('designer_context_pathfinder', 'Pathfinder'),
                action: null,
                children: PATHFINDER_OPS.map((p) => ({
                  label: t(`designer_pathfinder_${p.op}`, p.label),
                  action: () => {
                    if (!combineElements(store, selectedEls, p.op)) {
                      toaster.show(t('designer_pathfinder_failed', 'Pathfinder could not combine the selected shapes. Try a different selection or operation.'), 'warning');
                    }
                  },
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
          { label: t('designer_action_paste_paste', 'Paste'), action: () => s.paste(canvasPoint) },
          { label: '-', action: null },
          { label: t('designer_action_select_all_select_all', 'Select All'), action: () => s.setSelectedIds(imageOut?.children.map((c) => c.id) ?? []) },
          { label: '-', action: null },
          { label: t('designer_context_add_text', 'Add Text'), action: () => addText(store, {}, { at: { x: 100, y: 100 } }) },
          { label: t('designer_context_add_shape', 'Add Shape'), action: () => s.addElement({ id: '', type: 'shape', x: 100, y: 100, width: 200, height: 200, rotation: 0, opacity: 1, locked: false, hidden: false, shape: 'rect' }) },
          { label: t('designer_context_add_image', 'Add Image'), action: () => onAddImage?.() },
        ];

  return (
    <div
      ref={menuRef}
      data-testid="designer-context-menu"
      className="fixed z-150 bg-newBgColorInner border border-studioBorder rounded-lg py-1 shadow-xl overflow-y-auto overflow-x-hidden overscroll-contain"
      style={{
        left: menuPlacement?.left ?? x,
        top: menuPlacement?.top ?? y,
        minWidth: menuPlacement ? Math.min(200, menuPlacement.maxWidth) : 'min(200px, calc(100vw - 16px))',
        maxWidth: menuPlacement?.maxWidth,
        maxHeight: menuPlacement?.maxHeight ?? 'calc(100vh - 16px)',
      }}
    >
      {items.map((item, i) => {
        if (item.label === '-')
          return <div key={`divider-${i}`} className="border-t border-studioBorder my-1" />;
        if (item.children) {
          return (
            <div key={item.label}>
              <button
                ref={(node) => {
                  if (node) flyoutTriggerRefs.current.set(i, node);
                  else flyoutTriggerRefs.current.delete(i);
                }}
                type="button"
                aria-haspopup="menu"
                aria-expanded={openFlyout === i}
                aria-controls={openFlyout === i ? 'designer-context-flyout' : undefined}
                className="w-full text-left px-3 py-1.5 text-sm text-textColor/80 hover:bg-studioBorder/40 hover:text-textColor focus-visible:bg-studioBorder/40 focus-visible:text-textColor focus-visible:outline-hidden flex items-center justify-between gap-3"
                onMouseEnter={() => showFlyout(i)}
                onMouseLeave={scheduleFlyoutClose}
                onFocus={() => {
                  if (flyoutFocusReturn.current) {
                    flyoutFocusReturn.current = false;
                    cancelFlyoutClose();
                    return;
                  }
                  showFlyout(i);
                }}
                onBlur={scheduleFlyoutClose}
                onClick={() => showFlyout(i)}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowRight') return;
                  e.preventDefault();
                  showFlyout(i);
                  requestAnimationFrame(() => flyoutRef.current?.querySelector<HTMLElement>('button')?.focus());
                }}
              >
                {item.label}
                <span aria-hidden="true">▸</span>
              </button>
              {openFlyout === i && createPortal(
                <div
                  id="designer-context-flyout"
                  ref={flyoutRef}
                  role="menu"
                  tabIndex={-1}
                  aria-label={item.label}
                  data-testid="designer-context-flyout"
                  className="fixed z-150 bg-newBgColorInner border border-studioBorder rounded-lg py-1 shadow-xl overflow-y-auto overflow-x-hidden overscroll-contain"
                  style={{
                    left: flyoutPlacement?.left ?? 0,
                    top: flyoutPlacement?.top ?? 0,
                    minWidth: flyoutPlacement ? Math.min(160, flyoutPlacement.maxWidth) : 160,
                    maxWidth: flyoutPlacement?.maxWidth,
                    maxHeight: flyoutPlacement?.maxHeight ?? 'calc(100vh - 16px)',
                    visibility: flyoutPlacement ? 'visible' : 'hidden',
                  }}
                  onMouseEnter={cancelFlyoutClose}
                  onMouseLeave={scheduleFlyoutClose}
                  onFocus={cancelFlyoutClose}
                  onBlur={scheduleFlyoutClose}
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowLeft') return;
                    e.preventDefault();
                    flyoutFocusReturn.current = true;
                    setOpenFlyout(null);
                    flyoutTriggerRefs.current.get(i)?.focus();
                  }}
                >
                  {item.children.map((child) => (
                    <button
                      key={child.label}
                      role="menuitem"
                      className="w-full text-left px-3 py-1.5 text-sm text-textColor/80 hover:bg-studioBorder/40 hover:text-textColor focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent focus-visible:ring-inset"
                      onClick={() => {
                        child.action();
                        onClose();
                      }}
                    >
                      {child.label}
                    </button>
                  ))}
                </div>,
                document.body
              )}
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
