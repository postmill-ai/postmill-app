'use client';

import { FC, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export interface SimpleOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

// Generic controlled multi-select with the same inline dropdown display as the
// campaign/tag filters — used for platform, creation-method and approval filters.
export const SimpleMultiSelect: FC<{
  options: SimpleOption[];
  selectedIds: string[];
  onToggle: (value: string) => void;
  emptyLabel: string;
  searchable?: boolean;
}> = ({ options, selectedIds, onToggle, emptyLabel, searchable }) => {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!searchable || !search.trim()) return options;
    const q = search.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search, searchable]);

  const selectedCount = selectedIds.length;

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-[10px] px-[12px] h-[38px] rounded-full border border-newColColor bg-newBgColor hover:bg-boxHover transition-colors"
      >
        <span className="text-[13px] text-textColor">
          {selectedCount === 0
            ? emptyLabel
            : t('n_selected_count', '{{count}} selected', {
                count: selectedCount,
              })}
        </span>
        <div className="flex-1" />
        <svg
          className={clsx(
            'w-[14px] h-[14px] text-textColor transition-transform',
            open && 'rotate-180'
          )}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="mt-[8px] w-full max-h-[300px] bg-newBgColor border border-newBorder rounded-[12px] shadow-lg flex flex-col"
        >
          {searchable && (
            <div className="p-[12px] border-b border-newBorder">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('search', 'Search...')}
                className="w-full h-[36px] px-[12px] rounded-[8px] bg-newBgColorInner border border-newColColor text-[14px] text-textColor outline-none focus:border-[#2B5CD3]"
              />
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-[8px]">
            {filtered.length === 0 && (
              <div className="text-[13px] text-newTableText text-center py-[16px]">
                {t('no_results', 'No results')}
              </div>
            )}
            <div className="flex flex-col gap-[2px]">
              {filtered.map((option) => {
                const selected = selectedIds.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => onToggle(option.value)}
                    className={clsx(
                      'flex items-center gap-[10px] w-full px-[8px] py-[8px] rounded-[8px] text-left transition-colors',
                      selected
                        ? 'bg-[#2B5CD3]/15 text-textColor'
                        : 'hover:bg-boxHover text-textColor'
                    )}
                  >
                    <div
                      className={clsx(
                        'w-[18px] h-[18px] rounded-[4px] border flex items-center justify-center shrink-0',
                        selected
                          ? 'bg-[#2B5CD3] border-[#2B5CD3]'
                          : 'border-newColColor'
                      )}
                    >
                      {selected && (
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="white"
                          strokeWidth={3}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 12l5 5L20 7" />
                        </svg>
                      )}
                    </div>
                    {option.icon}
                    <span className="flex-1 text-[13px] truncate">
                      {option.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
