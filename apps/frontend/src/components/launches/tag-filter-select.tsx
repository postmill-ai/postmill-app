'use client';

import { FC, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// Controlled multi-select post-tag picker — same dropdown display as the
// campaign/channel filters, with each tag's colour swatch. Opens inline so it
// renders inside the filter drawer's scroll container.
export const TagFilterSelect: FC<{
  tags: { id: string; name: string; color: string }[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}> = ({ tags, selectedIds, onToggle }) => {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return tags;
    const q = search.trim().toLowerCase();
    return tags.filter((tg) => tg.name?.toLowerCase().includes(q));
  }, [tags, search]);

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
            ? t('all_tags', 'All tags')
            : `${selectedCount} ${
                selectedCount === 1 ? t('tag', 'tag') : t('tags', 'Tags')
              }`}
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
          aria-label={t('tags', 'Tags')}
          className="mt-[8px] w-full max-h-[300px] bg-newBgColor border border-newBorder rounded-[12px] shadow-lg flex flex-col"
        >
          <div className="p-[12px] border-b border-newBorder">
            <div className="relative">
              <svg
                className="absolute left-[12px] top-1/2 -translate-y-1/2 w-[16px] h-[16px] text-newTextColor/60"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"
                />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('search_tags', 'Search tags...')}
                className="w-full h-[40px] pl-[38px] pr-[12px] rounded-[8px] bg-newBgColorInner border border-newColColor text-[14px] text-textColor outline-none focus:border-[#2B5CD3]"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-[8px]">
            {filtered.length === 0 && (
              <div className="text-[13px] text-newTableText text-center py-[16px]">
                {t('no_tags_found', 'No tags found')}
              </div>
            )}
            <div className="flex flex-col gap-[2px]">
              {filtered.map((tag) => {
                const selected = selectedIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => onToggle(tag.id)}
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
                    <span
                      className="w-[12px] h-[12px] rounded-full shrink-0"
                      style={{ backgroundColor: tag.color || '#888' }}
                    />
                    <span className="flex-1 text-[13px] truncate">{tag.name}</span>
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
