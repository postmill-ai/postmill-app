'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface MenuBarProps {
  actions: DesignerAction[];
  /** How many top-level menus stay inline on mobile before the ☰ overflow. */
  visibleOnMobile?: number;
}

type Entry =
  | { type: 'leaf'; action: DesignerAction; group?: string }
  | { type: 'sub'; name: string; items: DesignerAction[]; group?: string };

const buildEntries = (items: DesignerAction[]): Entry[] => {
  const entries: Entry[] = [];
  const subs = new Map<string, Extract<Entry, { type: 'sub' }>>();
  for (const item of items) {
    if (item.submenu) {
      let e = subs.get(item.submenu);
      if (!e) {
        e = { type: 'sub', name: item.submenu, items: [], group: item.group };
        subs.set(item.submenu, e);
        entries.push(e);
      }
      e.items.push(item);
    } else {
      entries.push({ type: 'leaf', action: item, group: item.group });
    }
  }
  return entries;
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
        disabled
          ? 'text-textColor/30 cursor-default'
          : 'text-textColor hover:bg-studioBorder/30'
      )}
    >
      <span className="w-[14px] shrink-0 text-btnPrimaryAccent text-[12px]">
        {checked ? '✓' : ''}
      </span>
      <span className="flex-1 truncate">{t(actionLabelKey(action), actionLabel(action))}</span>
      {action.shortcut && (
        <span className="text-[11px] text-textColor/40 shrink-0">{action.shortcut}</span>
      )}
    </button>
  );
};

const Dropdown: FC<{ items: DesignerAction[]; onClose: () => void }> = ({ items, onClose }) => {
  const t = useT();
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
      {entries.map((entry, i) => {
        const divider = i > 0 && entry.group !== entries[i - 1].group;
        return (
          <React.Fragment key={entry.type === 'sub' ? `sub-${entry.name}` : entry.action.id}>
            {divider && <div className="my-1 border-t border-studioBorder" />}
            {entry.type === 'leaf' ? (
              <ItemButton action={entry.action} onRun={onClose} />
            ) : (
              <div>
                <div className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-textColor/35">
                  {t(submenuLabelKey(entry.name), entry.name)}
                </div>
                {entry.items.map((it) => (
                  <ItemButton key={it.id} action={it} onRun={onClose} indent />
                ))}
              </div>
            )}
          </React.Fragment>
        );
      })}
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
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpen(null);
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
      {entries.map((entry, i) => {
        const divider = i > 0 && entry.group !== entries[i - 1].group;
        return (
          <React.Fragment key={entry.type === 'sub' ? `sub-${entry.name}` : entry.action.id}>
            {divider && <div className="my-1 border-t border-studioBorder" />}
            {entry.type === 'leaf' ? (
              <ItemButton action={entry.action} onRun={onClose} />
            ) : (
              <div>
                <div className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-textColor/35">
                  {t(submenuLabelKey(entry.name), entry.name)}
                </div>
                {entry.items.map((it) => (
                  <ItemButton key={it.id} action={it} onRun={onClose} indent />
                ))}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};
