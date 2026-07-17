'use client';

import { FC, Fragment, ReactNode, RefObject, useEffect, useRef } from 'react';
import Link from 'next/link';
import clsx from 'clsx';

export interface StripItem {
  label: string;
  href?: string;
  icon?: ReactNode;
  active?: boolean;
  onClick?: () => void;
  section?: string;
}

// Mobile-only horizontal pill strip for page sub-menus (replaces the desktop
// side rail on narrow screens). Scrolls horizontally; sections render as small
// inline labels between pill clusters.
export const SubmenuStrip: FC<{ items: StripItem[]; ariaLabel?: string }> = ({
  items,
  ariaLabel,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLElement | null>(null);
  const firstRun = useRef(true);
  const activeIndex = items.findIndex((it) => it.active);

  // Center the active pill in the scroll container — instantly on first paint,
  // smoothly when the active tab changes afterwards.
  useEffect(() => {
    const c = scrollRef.current;
    const a = activeRef.current;
    if (!c || !a) return;
    const cRect = c.getBoundingClientRect();
    const aRect = a.getBoundingClientRect();
    const target =
      c.scrollLeft + (aRect.left - cRect.left) - (c.clientWidth - aRect.width) / 2;
    c.scrollTo({
      left: Math.max(0, target),
      behavior: firstRun.current ? 'auto' : 'smooth',
    });
    firstRun.current = false;
  }, [activeIndex]);

  return (
    <div className="hidden mobile:block shrink-0 border-b border-newTableBorder bg-newBgColorInner">
      <div
        ref={scrollRef}
        className="flex items-center gap-[8px] overflow-x-auto px-[12px] py-[10px] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label={ariaLabel}
      >
        {items.map((it, i) => {
          // Show a section label when this item starts a new section (pure —
          // derived from the previous item, no render-time mutation).
          const showSection = !!it.section && it.section !== items[i - 1]?.section;

          const className = clsx(
            'flex items-center gap-[8px] shrink-0 snap-start px-[14px] py-[8px] rounded-full text-[13px] font-[600] whitespace-nowrap transition-colors border',
            it.active
              ? 'bg-btnPrimary text-btnText border-btnPrimary'
              : 'bg-transparent text-textColor/70 border-newTableBorder hover:text-textColor'
          );
          const inner = (
            <>
              {it.icon && (
                <span className="w-[16px] h-[16px] flex items-center justify-center">
                  {it.icon}
                </span>
              )}
              <span>{it.label}</span>
            </>
          );

          return (
            <Fragment key={it.label}>
              {showSection && (
                <span className="shrink-0 pl-[6px] pr-[2px] text-[10px] font-semibold uppercase tracking-wider text-newTableText select-none">
                  {it.section}
                </span>
              )}
              {it.onClick ? (
                <button
                  type="button"
                  ref={it.active ? (activeRef as RefObject<HTMLButtonElement>) : undefined}
                  onClick={it.onClick}
                  className={className}
                  role="tab"
                  aria-selected={it.active}
                >
                  {inner}
                </button>
              ) : (
                <Link
                  href={it.href || '#'}
                  ref={it.active ? (activeRef as RefObject<HTMLAnchorElement>) : undefined}
                  className={className}
                  role="tab"
                  aria-selected={it.active}
                >
                  {inner}
                </Link>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
};
