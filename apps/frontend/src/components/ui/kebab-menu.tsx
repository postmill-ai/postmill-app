'use client';

import { FC, ReactNode, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

export type KebabMenuItem =
  | { divider: true }
  /**
   * Non-interactive group label, for menus long enough to need scanning — e.g.
   * the `/media` overflow, which can hold 40+ studios grouped by section.
   */
  | { header: ReactNode }
  | {
      divider?: false;
      header?: undefined;
      label: ReactNode;
      onClick?: () => void;
      /** Render as a link (e.g. a download) instead of a button. */
      href?: string;
      download?: boolean;
      danger?: boolean;
    };

interface KebabMenuProps {
  items: KebabMenuItem[];
  ariaLabel: string;
  /** Menu edge alignment relative to the trigger. */
  align?: 'left' | 'right';
  /** Menu width in px. */
  width?: number;
  /** When the trigger sits inside a clickable parent (e.g. a card <Link>),
   *  cancel that parent's click/navigation. */
  insideLink?: boolean;
  /** Highlight the trigger in the accent colour (e.g. when a hidden item is "active"). */
  active?: boolean;
  className?: string;
  /** Trigger button size in px (square). Default 28. */
  size?: number;
  /** Extra classes for the trigger button (e.g. `text-white!` on a coloured bar). */
  triggerClassName?: string;
  /**
   * Replaces the kebab icon — e.g. a labelled "New Design" button. `size` and
   * the icon-button styling are skipped, so `triggerClassName` owns the look.
   */
  trigger?: ReactNode;
}

const KebabIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="5" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="12" cy="19" r="1.6" />
  </svg>
);

const itemCls =
  'w-full text-left px-[12px] py-[8px] text-[13px] hover:bg-newTableBorder/40 transition-colors';

export const KebabMenu: FC<KebabMenuProps> = ({
  items,
  ariaLabel,
  align = 'right',
  width = 176,
  insideLink = false,
  active = false,
  className,
  size = 28,
  triggerClassName,
  trigger,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const cancel = (e: React.MouseEvent) => {
    if (insideLink) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <div className={clsx('relative shrink-0', className)} ref={ref}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          cancel(e);
          setOpen((v) => !v);
        }}
        style={trigger ? undefined : { width: size, height: size }}
        className={clsx(
          'flex items-center justify-center rounded-[6px] transition-colors',
          !trigger && 'hover:bg-newTableBorder/40',
          !trigger && (active ? 'text-btnPrimary' : 'text-newTableText hover:text-textColor'),
          triggerClassName
        )}
      >
        {trigger ?? KebabIcon}
      </button>
      {open && (
        <div
          role="menu"
          style={{ width }}
          className={clsx(
            // Capped and scrollable: a grouped overflow menu can hold 40+ entries,
            // which would otherwise run straight off the bottom of a phone.
            'absolute top-[calc(100%+4px)] z-50 py-[4px] bg-newBgColorInner border border-newTableBorder rounded-[8px] shadow-lg max-h-[70vh] overflow-y-auto',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          {items.map((item, i) => {
            if ('divider' in item && item.divider) {
              return <div key={`d-${i}`} className="my-[4px] border-t border-newTableBorder" />;
            }
            if ('header' in item && item.header !== undefined) {
              return (
                <div
                  key={`h-${i}`}
                  className="px-[12px] pt-[8px] pb-[4px] text-[10px] font-semibold uppercase tracking-wider text-newTableText select-none"
                >
                  {item.header}
                </div>
              );
            }
            const it = item as Exclude<KebabMenuItem, { divider: true } | { header: ReactNode }>;
            const cls = clsx(itemCls, it.danger ? 'text-red-700 dark:text-red-400 hover:bg-red-500/10' : 'text-textColor');
            const itemKey = it.href || (typeof it.label === 'string' ? it.label : `item-${i}`);
            if (it.href) {
              return (
                <a
                  key={itemKey}
                  role="menuitem"
                  href={it.href}
                  download={it.download}
                  onClick={(e) => {
                    if (insideLink) e.stopPropagation();
                    setOpen(false);
                    it.onClick?.();
                  }}
                  className={clsx(cls, 'block')}
                >
                  {it.label}
                </a>
              );
            }
            return (
              <button
                key={itemKey}
                type="button"
                role="menuitem"
                onClick={(e) => {
                  cancel(e);
                  setOpen(false);
                  it.onClick?.();
                }}
                className={cls}
              >
                {it.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
