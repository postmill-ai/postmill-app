'use client';

import { FC, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// Controlled multi-select campaign picker — mirrors the channel filter's
// dropdown display (pill + searchable checklist), wired to the calendar
// campaign filter. Opens inline so it renders inside the drawer scroll area.
export const CampaignFilterSelect: FC<{
  campaigns: { id: string; name: string }[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}> = ({ campaigns, selectedIds, onToggle }) => {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return campaigns;
    const q = search.trim().toLowerCase();
    return campaigns.filter((c) => c.name?.toLowerCase().includes(q));
  }, [campaigns, search]);

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
            ? t('all_campaigns', 'All campaigns')
            : `${selectedCount} ${
                selectedCount === 1
                  ? t('campaign', 'campaign')
                  : t('campaigns', 'Campaigns')
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
          aria-label={t('campaigns', 'Campaigns')}
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
                placeholder={t('search_campaigns', 'Search campaigns...')}
                className="w-full h-[40px] pl-[38px] pr-[12px] rounded-[8px] bg-newBgColorInner border border-newColColor text-[14px] text-textColor outline-none focus:border-[#2B5CD3]"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-[8px]">
            {filtered.length === 0 && (
              <div className="text-[13px] text-newTableText text-center py-[16px]">
                {t('no_campaigns_found', 'No campaigns found')}
              </div>
            )}
            <div className="flex flex-col gap-[2px]">
              {filtered.map((campaign) => {
                const selected = selectedIds.includes(campaign.id);
                return (
                  <button
                    key={campaign.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => onToggle(campaign.id)}
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
                    <span className="flex-1 text-[13px] truncate">
                      {campaign.name}
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
