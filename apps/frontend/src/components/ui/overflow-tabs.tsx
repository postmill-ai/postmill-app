'use client';

import React, { FC, Fragment, ReactNode } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { KebabMenu, KebabMenuItem } from '@postmill-ai/frontend/components/ui/kebab-menu';

/**
 * One horizontal tab/chip bar for the whole app.
 *
 * Every bar used to overflow on mobile by hiding its tail behind a scrollbar
 * that is itself hidden by CSS — on /analytics two tabs were clipped with no
 * affordance at all, and the /settings and /media strips pushed 1000-1500px of
 * items off-screen. Below `mobile:` (≤1025px) this shows three items inline and
 * folds the rest into a ⋮ menu; at desktop widths everything stays inline.
 *
 * The split is pure CSS (`mobile:hidden` on the tail, `hidden mobile:flex` on
 * the kebab) rather than a `matchMedia` hook, so it is SSR-safe and can't flash
 * or mismatch on hydration. `display:none` also removes the desktop-only copies
 * from the a11y tree, so no tab is ever announced twice.
 *
 * TESTING NOTE: jsdom loads no Tailwind, so `mobile:hidden` does nothing there
 * and BOTH copies are queryable. Assert against `data-overflow-slot` (or the
 * pure `splitOverflowItems` below) rather than visibility — do not "fix" a spec
 * by mocking matchMedia, the component deliberately doesn't use it.
 */

export interface OverflowTabItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  /** Renders a `Link` (navigation strips). Mutually exclusive with `onClick`. */
  href?: string;
  onClick?: () => void;
  /** Already-translated group label; groups the item in the overflow menu. */
  section?: string;
}

export interface OverflowTabsProps {
  items: OverflowTabItem[];
  activeKey?: string;
  onSelect?: (key: string) => void;
  /** Underline tabs (analytics, campaigns), rounded pills (nav strips), or the studio outline. */
  variant?: 'underline' | 'pill' | 'outline';
  /**
   * `tabs` switches a panel in place (role=tablist/tab); `nav` navigates
   * (aria-current="page"). These bars are genuinely both, and the roles have
   * been inconsistent — `SubmenuStrip` put role="tab" on Links that navigate.
   */
  semantics?: 'tabs' | 'nav' | 'toolbar';
  /** Accessible name for the ⋮ trigger. */
  ariaLabel: string;
  /** Accessible name for the tablist/navigation itself. */
  listAriaLabel?: string;
  /**
   * Replace the default item rendering (bars with a bespoke selected style).
   * `className` already carries the mobile-hide class — a bespoke look must
   * compose it (or use `hiddenOnMobile`), or its overflow items would stay
   * visible on mobile and defeat the whole component.
   */
  renderItem?: (
    item: OverflowTabItem,
    state: {
      active: boolean;
      className: string;
      hiddenOnMobile: boolean;
      slotProps: { 'data-overflow-slot': string; className: string };
    }
  ) => ReactNode;
  /**
   * The host is already mobile-only (`SubmenuStrip`), so skip the desktop-only
   * inline copies entirely — for the 47-item media strip that is 44 DOM nodes
   * that could never be seen.
   */
  mobileOnly?: boolean;
  className?: string;
}

/** How many items stay inline on mobile. */
export const VISIBLE_ON_MOBILE = 3;

/**
 * The first three items — except that the active item always takes the last
 * slot when it would otherwise be hidden. Without this you land on
 * `/analytics?tab=usage` and see three tabs, none of them selected.
 */
export const splitOverflowItems = (
  items: OverflowTabItem[],
  activeKey?: string
): { visible: OverflowTabItem[]; overflow: OverflowTabItem[] } => {
  if (items.length <= VISIBLE_ON_MOBILE) return { visible: items, overflow: [] };

  const head = items.slice(0, VISIBLE_ON_MOBILE);
  const tail = items.slice(VISIBLE_ON_MOBILE);
  const activeIsHidden = !!activeKey && tail.some((i) => i.key === activeKey);
  if (!activeIsHidden) return { visible: head, overflow: tail };

  const active = tail.find((i) => i.key === activeKey)!;
  return {
    visible: [...head.slice(0, VISIBLE_ON_MOBILE - 1), active],
    overflow: items.filter((i) => i.key !== active.key).slice(VISIBLE_ON_MOBILE - 1),
  };
};

/** Section headers are emitted whenever the group changes, as in the nav rails. */
const toMenuItems = (
  items: OverflowTabItem[],
  select: (item: OverflowTabItem) => void
): KebabMenuItem[] =>
  items.flatMap((item, i) => {
    const entry: KebabMenuItem = item.href
      ? { label: item.label, href: item.href }
      : { label: item.label, onClick: () => select(item) };
    const startsSection = !!item.section && item.section !== items[i - 1]?.section;
    return startsSection ? [{ header: item.section }, entry] : [entry];
  });

export const OverflowTabs: FC<OverflowTabsProps> = ({
  items,
  activeKey,
  onSelect,
  variant = 'underline',
  semantics = 'tabs',
  ariaLabel,
  listAriaLabel,
  renderItem,
  mobileOnly,
  className,
}) => {
  const { visible, overflow } = splitOverflowItems(items, activeKey);
  const visibleKeys = new Set(visible.map((i) => i.key));

  const select = (item: OverflowTabItem) => {
    item.onClick?.();
    onSelect?.(item.key);
  };

  // The focus ring is carried over from analytics — it was the only bar that had one.
  const focusRing =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-designerAccent/60';

  const itemClass = (active: boolean) => {
    if (variant === 'underline') {
      return clsx(
        'px-[16px] py-[10px] text-[14px] font-[500] whitespace-nowrap border-b-2 -mb-[1px] transition-colors',
        focusRing,
        active
          ? 'border-btnPrimary text-textColor'
          : 'border-transparent text-newTableText hover:text-textColor'
      );
    }
    if (variant === 'outline') {
      return clsx(
        'flex items-center gap-[6px] shrink-0 px-[12px] h-[34px] rounded-[8px] text-[13px] whitespace-nowrap border transition-all',
        focusRing,
        active
          ? 'bg-[#2B5CD3]/20 text-textColor border-transparent'
          : 'border-studioBorder text-newTextColor/70 hover:bg-boxHover hover:text-textColor hover:border-[#2B5CD3]'
      );
    }
    return clsx(
      'flex items-center gap-[8px] shrink-0 px-[14px] py-[8px] rounded-full text-[13px] font-[600] whitespace-nowrap transition-colors border',
      focusRing,
      active
        ? 'bg-btnPrimary text-btnText border-btnPrimary'
        : 'bg-transparent text-textColor/70 border-newTableBorder hover:text-textColor'
    );
  };

  const renderOne = (item: OverflowTabItem, hideOnMobile: boolean) => {
    const active = item.key === activeKey;
    const cls = clsx(itemClass(active), hideOnMobile && 'mobile:hidden');
    if (renderItem) {
      return (
        <Fragment key={item.key}>
          {renderItem(item, {
            active,
            className: cls,
            hiddenOnMobile: hideOnMobile,
            slotProps: {
              'data-overflow-slot': hideOnMobile ? 'desktop-only' : 'inline',
              className: hideOnMobile ? 'mobile:hidden' : '',
            },
          })}
        </Fragment>
      );
    }

    const inner = (
      <>
        {item.icon && (
          <span className="w-[16px] h-[16px] flex items-center justify-center shrink-0">
            {item.icon}
          </span>
        )}
        <span>{item.label}</span>
      </>
    );
    const a11y =
      semantics === 'tabs'
        ? { role: 'tab' as const, 'aria-selected': active }
        : semantics === 'toolbar'
          ? { 'aria-pressed': active }
          : { 'aria-current': active ? ('page' as const) : undefined };
    // jsdom renders both copies (no CSS), so specs need this to tell them apart.
    const slot = { 'data-overflow-slot': hideOnMobile ? 'desktop-only' : 'inline' };

    return item.href ? (
      <Link key={item.key} href={item.href} className={cls} {...a11y} {...slot}>
        {inner}
      </Link>
    ) : (
      <button
        key={item.key}
        type="button"
        onClick={() => select(item)}
        className={cls}
        {...a11y}
        {...slot}
      >
        {inner}
      </button>
    );
  };

  return (
    <div
      className={clsx(
        'flex items-stretch',
        variant === 'underline' && 'border-b border-newTableBorder',
        className
      )}
    >
      {/*
        role="tablist" belongs to the scrolling track, never the wrapper — the
        kebab is a role="menu", which is not a valid child of a tablist. Keeping
        it outside also stops the popup being clipped by overflow-x.
        The track stays scrollable as a safety valve: three long translated
        labels can still exceed a 390px row.
      */}
      <div
        className="flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-slot="tabs-track"
        {...(semantics === 'tabs'
          ? { role: 'tablist' as const, 'aria-label': listAriaLabel }
          : semantics === 'toolbar'
            ? { role: 'group' as const, 'aria-label': listAriaLabel }
            : { role: 'navigation' as const, 'aria-label': listAriaLabel })}
      >
        {/*
          Rendered in the ORIGINAL order with the overflow marked `mobile:hidden`,
          not as "visible then overflow" — otherwise pulling the active item
          forward would visibly reshuffle the tab order on desktop, where every
          item is inline.
        */}
        <div role="presentation" className="flex items-center gap-[2px] min-w-max">
          {(mobileOnly ? visible : items).map((item) =>
            renderOne(item, !visibleKeys.has(item.key))
          )}
        </div>
      </div>
      {overflow.length > 0 && (
        <div className="hidden mobile:flex items-center shrink-0 ps-[8px]">
          {/* No `active` tint and no radio semantics: the active item is always
              pulled into the visible three, so the menu never holds it. */}
          <KebabMenu ariaLabel={ariaLabel} align="right" items={toMenuItems(overflow, select)} />
        </div>
      )}
    </div>
  );
};
