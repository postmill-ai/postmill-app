'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { OverflowTabs } from '@postmill-ai/frontend/components/ui/overflow-tabs';

export interface SettingsSubnavItem {
  href: string;
  label: string;
}

// The horizontal sub-tab strip shared by the AI / Content / Storage settings sections.
// Replaces the per-section `useState` sub-tabs with real <Link>s; active follows the path
// (startsWith so a deeper child — e.g. /ai/brands/[id] — keeps "Brands" highlighted).
export const SettingsSubnav: React.FC<{ items: SettingsSubnavItem[] }> = ({ items }) => {
  const pathname = usePathname();
  const t = useT();
  // Active follows the path with startsWith, so a deeper child (/ai/brands/[id])
  // keeps "Brands" highlighted — hence the key is the href.
  const activeItem = items.find((item) => pathname.startsWith(item.href));

  return (
    <OverflowTabs
      items={items.map((item) => ({ key: item.href, label: item.label, href: item.href }))}
      activeKey={activeItem?.href}
      semantics="nav"
      ariaLabel={t('more_settings_sections', 'More settings')}
      listAriaLabel={t('settings_sections', 'Settings sections')}
      className="pb-[8px]"
      // Keeps this section's folder-tab look rather than the shared underline.
      renderItem={(item, { active, slotProps }) => (
        <Link
          key={item.key}
          href={item.href || '#'}
          aria-current={active ? 'page' : undefined}
          data-overflow-slot={slotProps['data-overflow-slot']}
          className={clsx(
            'text-[13px] px-[16px] py-[8px] rounded-t-[4px] whitespace-nowrap transition-colors',
            slotProps.className,
            active
              ? 'bg-newBgColorInner border border-newTableBorder border-b-transparent text-textColor'
              : 'text-newTableText hover:text-textColor'
          )}
        >
          {item.label}
        </Link>
      )}
    />
  );
};
