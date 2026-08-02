'use client';

import React, { FC, ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

export type ContextMenuItem =
  | { divider: true }
  | {
      divider?: false;
      label: ReactNode;
      onClick: () => void;
      danger?: boolean;
      disabled?: boolean;
    };

interface ContextMenuProps {
  /** Viewport coordinates of the invoking gesture. */
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  ariaLabel: string;
  /** Menu width in px. Default 190. */
  width?: number;
}

const isAction = (
  item: ContextMenuItem
): item is Exclude<ContextMenuItem, { divider: true }> => !('divider' in item && item.divider);

/**
 * Pointer-anchored menu for right-click (desktop) and long-press (mobile).
 *
 * Sibling of `KebabMenu`, which anchors to its own trigger; this one anchors to
 * an arbitrary viewport point. Rendered through a portal because the surfaces
 * that use it (the scrollable folder sidebar, the transformed mobile drawer)
 * would otherwise clip or re-anchor a `position: fixed` descendant.
 */
export const ContextMenu: FC<ContextMenuProps> = ({
  x,
  y,
  items,
  onClose,
  ariaLabel,
  width = 190,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  // Render-time guard rather than a mounted flag: this only ever renders in
  // response to a user gesture, and skipping the extra render means the layout
  // effect can measure on the first commit.
  const canPortal = typeof document !== 'undefined';

  const actionIndexes = items.reduce<number[]>((acc, item, i) => {
    if (isAction(item) && !item.disabled) acc.push(i);
    return acc;
  }, []);

  useEffect(() => {
    openerRef.current = document.activeElement;
    return () => {
      // Return focus where the user left it, so a menu opened by keyboard
      // (Shift+F10 / Menu key) doesn't strand the caret at the top of the page.
      const opener = openerRef.current as HTMLElement | null;
      if (opener && document.contains(opener)) opener.focus?.();
    };
  }, []);

  // Flip/clamp against both edges once we can measure. RTL-safe: the menu is
  // positioned in viewport coordinates, so it simply never overflows either side.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const { width: w, height: h } = el.getBoundingClientRect();
    const margin = 8;
    setPos({
      left: Math.max(margin, Math.min(x, window.innerWidth - w - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - h - margin)),
    });
  }, [x, y, items.length]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    // mousedown, not click: closing on click would swallow the first click of
    // whatever the user is reaching for underneath.
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  const focusItem = useCallback((index: number) => {
    const el = menuRef.current?.querySelector<HTMLElement>(`[data-item-index="${index}"]`);
    el?.focus();
  }, []);

  const firstActionIndex = actionIndexes[0];
  useEffect(() => {
    if (firstActionIndex !== undefined) focusItem(firstActionIndex);
  }, [firstActionIndex, focusItem]);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (!actionIndexes.length) return;
    const current = Number(
      (document.activeElement as HTMLElement | null)?.dataset?.itemIndex ?? -1
    );
    const at = actionIndexes.indexOf(current);

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const next = (at + delta + actionIndexes.length) % actionIndexes.length;
      focusItem(actionIndexes[at === -1 ? 0 : next]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem(actionIndexes[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusItem(actionIndexes[actionIndexes.length - 1]);
    } else if (e.key === 'Tab') {
      // A context menu is modal-ish; keep focus inside until it closes.
      e.preventDefault();
    }
  };

  if (!canPortal) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      aria-label={ariaLabel}
      onKeyDown={onMenuKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: pos.left, top: pos.top, width }}
      className="fixed z-[1000] py-[4px] bg-newBgColorInner border border-newTableBorder rounded-[8px] shadow-menu"
    >
      {items.map((item, i) => {
        if (!isAction(item)) {
          return <div key={`d-${i}`} className="my-[4px] border-t border-newTableBorder" />;
        }
        return (
          <button
            key={typeof item.label === 'string' ? item.label : `item-${i}`}
            type="button"
            role="menuitem"
            data-item-index={i}
            tabIndex={-1}
            disabled={item.disabled}
            aria-disabled={item.disabled || undefined}
            onClick={() => {
              if (item.disabled) return;
              item.onClick();
              onClose();
            }}
            className={clsx(
              'w-full text-left px-[12px] py-[8px] text-[13px] transition-colors',
              'focus-visible:outline-none focus:bg-boxHover',
              item.disabled
                ? 'opacity-40 cursor-not-allowed'
                : 'hover:bg-boxHover cursor-pointer',
              item.danger ? 'text-dangerText' : 'text-textColor'
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>,
    document.body
  );
};
