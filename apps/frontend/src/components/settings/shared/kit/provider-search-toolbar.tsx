'use client';

import React from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { CapabilityChip } from './provider-surface.types';

/**
 * Search toolbar + optional capability chip filter (plan Step 1.4). Extracted
 * verbatim from `shortlinks.tab.tsx` (search + clear) and `ai.tab.tsx`
 * (capability chip row) so every surface shares one toolbar.
 */
export interface ProviderSearchToolbarProps {
  search: string;
  onSearch: (value: string) => void;
  chips?: CapabilityChip[];
  selected?: string[];
  onToggleChip?: (key: string) => void;
  /** Optional trailing control, e.g. an "Add" button. */
  trailing?: React.ReactNode;
  placeholder?: string;
}

export const ProviderSearchToolbar: React.FC<ProviderSearchToolbarProps> = ({
  search,
  onSearch,
  chips,
  selected = [],
  onToggleChip,
  trailing,
  placeholder,
}) => {
  const t = useT();
  return (
    <div className="flex items-center gap-[12px] mobile:flex-col mobile:items-stretch">
      <div className="flex-1 relative">
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={placeholder || t('search_providers', 'Search providers...')}
          className="w-full px-[12px] py-[8px] pr-[36px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] outline-none [&::-webkit-search-cancel-button]:appearance-none"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearch('')}
            aria-label={t('clear_search', 'Clear search')}
            className="absolute right-[8px] top-1/2 -translate-y-1/2 w-[20px] h-[20px] flex items-center justify-center rounded-full text-newTableText hover:text-textColor hover:bg-boxHover transition-colors"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      {chips && chips.length > 0 && (
        <div className="flex items-center gap-[8px] flex-wrap">
          {chips.map((f) => {
            const active = selected.includes(f.key);
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => onToggleChip?.(f.key)}
                aria-pressed={active}
                className={`text-[13px] px-[12px] py-[8px] rounded-[8px] border transition-colors ${
                  active
                    ? f.activeClass
                    : 'bg-newBgColor border-newTableBorder text-newTableText hover:bg-boxHover'
                }`}
              >
                {t('provider_chip_' + f.key, f.label)}
              </button>
            );
          })}
        </div>
      )}
      {trailing}
    </div>
  );
};
