'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface SettingsSubnavItem {
  href: string;
  label: string;
}

// The horizontal sub-tab strip shared by the AI / Content / Storage settings sections.
// Replaces the per-section `useState` sub-tabs with real <Link>s; active follows the path
// (startsWith so a deeper child — e.g. /ai/brands/[id] — keeps "Brands" highlighted).
export const SettingsSubnav: React.FC<{ items: SettingsSubnavItem[] }> = ({ items }) => {
  const pathname = usePathname();
  return (
    <div className="flex gap-[8px] border-b border-newTableBorder pb-[8px] flex-wrap">
      {items.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`text-[13px] px-[16px] py-[8px] rounded-t-[4px] transition-colors ${
              active
                ? 'bg-newBgColorInner border border-newTableBorder border-b-transparent text-textColor'
                : 'text-newTableText hover:text-textColor'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
};
