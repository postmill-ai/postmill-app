'use client';

import { FC, ReactNode } from 'react';
import { OverflowTabs } from '@postmill-ai/frontend/components/ui/overflow-tabs';

export interface StripItem {
  label: string;
  href?: string;
  icon?: ReactNode;
  active?: boolean;
  onClick?: () => void;
  /** Already-translated group label; groups the item in the overflow menu. */
  section?: string;
}

/**
 * Mobile-only horizontal pill strip for page sub-menus (it replaces the desktop
 * side rail on narrow screens).
 *
 * It used to scroll horizontally and auto-centre the active pill, which pushed
 * most of the list off-screen with the scrollbar hidden — /settings hid 1462px
 * of its 14 items and /media 1014px of 12 (up to 47 configured). Now three pills
 * stay inline and the rest fold into the ⋮ menu, grouped by section.
 *
 * `mobileOnly` because this whole strip is `hidden mobile:block`: rendering the
 * desktop-only copies would add up to 44 nodes that can never be seen.
 */
export const SubmenuStrip: FC<{ items: StripItem[]; ariaLabel?: string; overflowLabel?: string }> = ({
  items,
  ariaLabel,
  overflowLabel,
}) => {
  const activeItem = items.find((it) => it.active);
  const keyOf = (it: StripItem) => it.href ?? it.label;

  return (
    <div className="hidden mobile:block shrink-0 border-b border-newTableBorder bg-newBgColorInner">
      <OverflowTabs
        items={items.map((it) => ({
          key: keyOf(it),
          label: it.label,
          icon: it.icon,
          href: it.href,
          onClick: it.onClick,
          section: it.section,
        }))}
        activeKey={activeItem ? keyOf(activeItem) : undefined}
        variant="pill"
        // These navigate the route — they were announced as tabs before.
        semantics="nav"
        mobileOnly
        ariaLabel={overflowLabel ?? ariaLabel ?? ''}
        listAriaLabel={ariaLabel}
        className="px-[12px] py-[10px]"
      />
    </div>
  );
};
