'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import {
  actionLabel,
  actionLabelKey,
  menuLabel,
  menuLabelKey,
  MENU_ORDER,
  submenuLabelKey,
  type DesignerAction,
  type DesignerMenu,
} from './actions';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

interface MenuBarProps {
  actions: DesignerAction[];
  /** How many top-level menus stay inline on mobile before the ☰ overflow. */
  visibleOnMobile?: number;
}

type Entry =
  | { type: 'leaf'; action: DesignerAction; group?: string }
  // `items` is Entry[], not DesignerAction[], so submenus nest arbitrarily —
  // the Layer menu needs three levels (Layer ▸ New ▸ Layer).
  | { type: 'sub'; name: string; items: Entry[]; group?: string };

/** An action's submenu chain, from `submenu` and the optional deeper path. */
const pathOf = (action: DesignerAction): string[] =>
  action.submenuPath?.length
    ? action.submenuPath
    : action.submenu
      ? [action.submenu]
      : [];

const buildEntries = (items: DesignerAction[]): Entry[] => {
  const roots: Entry[] = [];

  for (const item of items) {
    const path = pathOf(item);
    if (!path.length) {
      roots.push({ type: 'leaf', action: item, group: item.group });
      continue;
    }

    // Walk (creating as needed) down to the leaf's parent submenu.
    let level = roots;
    let parentGroup = item.group;
    for (const name of path) {
      let sub = level.find(
        (e): e is Extract<Entry, { type: 'sub' }> => e.type === 'sub' && e.name === name
      );
      if (!sub) {
        sub = { type: 'sub', name, items: [], group: parentGroup };
        level.push(sub);
      }
      level = sub.items;
      // Only the outermost level draws a divider for this action's group.
      parentGroup = undefined;
    }
    level.push({ type: 'leaf', action: item, group: item.group });
  }

  return roots;
};

const ItemButton: FC<{ action: DesignerAction; onRun: () => void; indent?: boolean }> = ({
  action,
  onRun,
  indent,
}) => {
  const t = useT();
  const disabled = action.enabled ? !action.enabled() : false;
  const checked = action.checked ? action.checked() : undefined;
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked === undefined ? undefined : checked}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        action.run();
        onRun();
      }}
      className={clsx(
        'w-full flex items-center gap-3 px-3 py-1.5 text-left text-[13px] rounded transition-colors',
        indent && 'pl-6',
        // Disabled still has to be READABLE, just clearly inert — it names the
        // command you'd get if you selected something first.
        disabled
          ? 'text-textColor/45 cursor-default'
          : 'text-textColor hover:bg-studioBorder/30'
      )}
    >
      <span className="w-[14px] shrink-0 text-btnPrimaryAccent text-[12px]">
        {checked ? '✓' : ''}
      </span>
      <span className="flex-1 truncate">{t(actionLabelKey(action), actionLabel(action))}</span>
      {action.shortcut && (
        <span
          className={clsx(
            'text-[11px] shrink-0',
            // Never brighter than the label it belongs to.
            disabled ? 'text-textColor/30' : 'text-textColor/40'
          )}
        >
          {action.shortcut}
        </span>
      )}
    </button>
  );
};

/**
 * A nested submenu: a row that opens a real flyout beside it on hover or
 * focus. Previously "submenus" were inline section headers, which cannot
 * express the three-level Layer menu.
 */
const SubmenuItem: FC<{ entry: Extract<Entry, { type: 'sub' }>; onClose: () => void }> = ({
  entry,
  onClose,
}) => {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The parent dropdown is `max-h-[70vh] overflow-y-auto`, which computes to
  // `overflow: hidden auto` — so anything positioned beside it (left: 100%) is
  // CLIPPED on the x-axis and simply never appears. The flyout therefore has to
  // leave that box entirely: portal to <body> and position it as `fixed` from
  // the trigger's rect.
  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = 230;
    const spillsRight = r.right + width > window.innerWidth - 8;
    setPos({
      left: spillsRight ? Math.max(8, r.left - width) : r.right,
      // Keep the flyout on screen when the trigger sits near the bottom.
      top: Math.min(r.top, Math.max(8, window.innerHeight - 240)),
    });
  }, []);

  const openNow = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    place();
    setOpen(true);
  }, [place]);

  // A short grace period so moving the pointer from the row across to the
  // flyout doesn't dismiss it mid-travel.
  const closeSoon = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 180);
  }, []);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  return (
    <div onMouseEnter={openNow} onMouseLeave={closeSoon}>
      <button
        ref={triggerRef}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          if (open) setOpen(false);
          else openNow();
        }}
        onFocus={openNow}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openNow();
          }
          if (e.key === 'ArrowLeft' || e.key === 'Escape') setOpen(false);
        }}
        className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] text-start text-textColor hover:bg-studioBorder/30"
      >
        <span className="w-[14px] shrink-0" />
        <span className="flex-1 truncate">
          {t(submenuLabelKey(entry.name), entry.name)}
        </span>
        <span className="shrink-0 text-[10px] text-textColor/40">▶</span>
      </button>

      {open && pos && typeof document !== 'undefined' &&
        createPortal(
          <div
            role="menu"
            data-submenu-flyout
            tabIndex={-1}
            onMouseEnter={openNow}
            onMouseLeave={closeSoon}
            style={{ left: pos.left, top: pos.top, width: 230 }}
            className="fixed max-h-[70vh] overflow-y-auto bg-newBgColorInner border border-studioBorder rounded-lg shadow-xl py-1.5 px-1 z-[400]"
          >
            <EntryList entries={entry.items} onClose={onClose} />
          </div>,
          document.body
        )}
    </div>
  );
};

/**
 * Render one level of entries, with dividers between `group` changes.
 *
 * `inline` is the mobile ☰ sheet: nesting shows as indented sections rather
 * than hover flyouts, since there is no hover on touch and a flyout would run
 * off the sheet.
 */
const EntryList: FC<{
  entries: Entry[];
  onClose: () => void;
  inline?: boolean;
  depth?: number;
}> = ({ entries, onClose, inline, depth = 0 }) => {
  const t = useT();
  return (
    <>
      {entries.map((entry, i) => {
        const divider = i > 0 && entry.group !== entries[i - 1].group;
        return (
          <React.Fragment key={entry.type === 'sub' ? `sub-${entry.name}` : entry.action.id}>
            {divider && <div className="my-1 border-t border-studioBorder" />}
            {entry.type === 'leaf' ? (
              <ItemButton action={entry.action} onRun={onClose} indent={inline && depth > 0} />
            ) : inline ? (
              <div style={{ paddingInlineStart: depth * 8 }}>
                <div className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-textColor/35">
                  {t(submenuLabelKey(entry.name), entry.name)}
                </div>
                <EntryList
                  entries={entry.items}
                  onClose={onClose}
                  inline
                  depth={depth + 1}
                />
              </div>
            ) : (
              <SubmenuItem entry={entry} onClose={onClose} />
            )}
          </React.Fragment>
        );
      })}
    </>
  );
};

const Dropdown: FC<{ items: DesignerAction[]; onClose: () => void }> = ({ items, onClose }) => {
  const entries = buildEntries(items);
  // Flip to right-aligned if a left-aligned dropdown would spill off the right
  // edge (the designer root is overflow-hidden, so spillover gets clipped).
  // Done via a ref callback + direct style to avoid setState-in-effect.
  const measure = (el: HTMLDivElement | null) => {
    if (!el) return;
    el.style.left = '0px';
    el.style.right = 'auto';
    if (el.getBoundingClientRect().right > window.innerWidth - 8) {
      el.style.left = 'auto';
      el.style.right = '0px';
    }
  };
  return (
    <div
      ref={measure}
      role="menu"
      className="absolute top-full mt-1 min-w-[220px] max-w-[min(300px,calc(100vw-16px))] max-h-[70vh] overflow-y-auto bg-newBgColorInner border border-studioBorder rounded-lg shadow-xl py-1.5 px-1 z-[120]"
    >
      <EntryList entries={entries} onClose={onClose} />
    </div>
  );
};

export const MenuBar: FC<MenuBarProps> = ({ actions, visibleOnMobile = 4 }) => {
  const t = useT();
  const [open, setOpen] = useState<DesignerMenu | 'more' | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Group actions by menu, preserving MENU_ORDER and dropping empty menus.
  const menus = useMemo(() => {
    return MENU_ORDER.map((m) => ({
      menu: m,
      label: t(menuLabelKey(m), menuLabel(m)),
      items: actions.filter((a) => a.menu === m),
    })).filter((g) => g.items.length > 0);
  }, [actions, t]);

  const overflowMenus = menus.slice(visibleOnMobile);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!barRef.current || barRef.current.contains(target)) return;
      // Submenu flyouts are portalled to <body> to escape the dropdown's
      // overflow clipping, so they are NOT inside barRef — without this a
      // click on any nested item would dismiss the menu before it ran.
      if ((target as HTMLElement).closest?.('[data-submenu-flyout]')) return;
      setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const trigger = useCallback(
    (menu: DesignerMenu, label: string, items: DesignerAction[], mobileHidden: boolean) => (
      <div key={menu} role="none" className={clsx('relative', mobileHidden && 'mobile:hidden')}>
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={open === menu}
          onClick={() => setOpen((cur) => (cur === menu ? null : menu))}
          onMouseEnter={() => setOpen((cur) => (cur !== null ? menu : cur))}
          className={clsx(
            'px-2.5 py-1 rounded text-[13px] transition-colors',
            open === menu
              ? 'bg-studioBorder/30 text-textColor'
              : 'text-textColor/70 hover:bg-studioBorder/20 hover:text-textColor'
          )}
        >
          {label}
        </button>
        {open === menu && <Dropdown items={items} onClose={() => setOpen(null)} />}
      </div>
    ),
    [open]
  );

  return (
    <div ref={barRef} role="menubar" className="flex items-center gap-0.5">
      {menus.map((g, i) => trigger(g.menu, g.label, g.items, i >= visibleOnMobile))}
      {overflowMenus.length > 0 && (
        <div role="none" className="relative hidden mobile:block">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === 'more'}
            aria-label={t('designer_more_menus', 'More menus')}
            onClick={() => setOpen((cur) => (cur === 'more' ? null : 'more'))}
            className={clsx(
              'px-2.5 py-1 rounded text-[15px] leading-none transition-colors',
              open === 'more'
                ? 'bg-studioBorder/30 text-textColor'
                : 'text-textColor/70 hover:bg-studioBorder/20 hover:text-textColor'
            )}
          >
            ☰
          </button>
          {open === 'more' && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-1 min-w-[230px] max-w-[300px] bg-newBgColorInner border border-studioBorder rounded-lg shadow-xl py-1.5 px-1 z-[120] max-h-[70vh] overflow-y-auto"
            >
              {overflowMenus.map((g) => (
                <div key={g.menu} className="mb-1">
                  <div className="px-3 pt-1.5 pb-1 text-[11px] font-bold uppercase tracking-wider text-textColor/45">
                    {g.label}
                  </div>
                  <DropdownInline items={g.items} onClose={() => setOpen(null)} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Inline variant (no absolute positioning) for the mobile ☰ overflow sheet.
const DropdownInline: FC<{ items: DesignerAction[]; onClose: () => void }> = ({ items, onClose }) => {
  const t = useT();
  const entries = buildEntries(items);
  return (
    <div>
      <EntryList entries={entries} onClose={onClose} inline />
    </div>
  );
};
