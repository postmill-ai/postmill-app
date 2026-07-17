'use client';

import { FC, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import type { Campaign } from '@gitroom/frontend/components/campaigns/campaign-types';

export type CampaignSort =
  | 'created'
  | 'oldest'
  | 'name'
  | 'name_desc'
  | 'posts'
  | 'posts_asc';
export type CampaignStatus = 'all' | 'active' | 'archived';

export interface CampaignFilters {
  search: string;
  status: CampaignStatus;
  client: string; // '' = all clients
  tags: string[];
  sort: CampaignSort;
}

export const DEFAULT_CAMPAIGN_FILTERS: CampaignFilters = {
  search: '',
  status: 'active',
  client: '',
  tags: [],
  sort: 'created',
};

const uniqSorted = (values: (string | null | undefined)[]) =>
  Array.from(new Set(values.filter((v): v is string => !!v))).sort((a, b) =>
    a.localeCompare(b)
  );

const FilterIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
  </svg>
);

interface CampaignFilterBarProps {
  campaigns: Campaign[];
  filters: CampaignFilters;
  onChange: (next: CampaignFilters) => void;
}

export const CampaignFilterBar: FC<CampaignFilterBarProps> = ({
  campaigns,
  filters,
  onChange,
}) => {
  const t = useT();
  const [sheetOpen, setSheetOpen] = useState(false);

  const clients = useMemo(() => uniqSorted(campaigns.map((c) => c.client)), [campaigns]);
  const allTags = useMemo(
    () => uniqSorted(campaigns.flatMap((c) => c.tags || [])),
    [campaigns]
  );

  const set = (patch: Partial<CampaignFilters>) => onChange({ ...filters, ...patch });
  const toggleTag = (tag: string) =>
    set({
      tags: filters.tags.includes(tag)
        ? filters.tags.filter((x) => x !== tag)
        : [...filters.tags, tag],
    });

  const activeCount =
    (filters.status !== DEFAULT_CAMPAIGN_FILTERS.status ? 1 : 0) +
    (filters.client ? 1 : 0) +
    filters.tags.length;

  const sortOptions: { value: CampaignSort; label: string }[] = [
    { value: 'created', label: t('sort_newest', 'Newest') },
    { value: 'oldest', label: t('sort_oldest', 'Oldest') },
    { value: 'name', label: t('sort_name_az', 'Name A–Z') },
    { value: 'name_desc', label: t('sort_name_za', 'Name Z–A') },
    { value: 'posts', label: t('sort_most_posts', 'Most posts') },
    { value: 'posts_asc', label: t('sort_fewest_posts', 'Fewest posts') },
  ];

  const statusOptions: { value: CampaignStatus; label: string }[] = [
    { value: 'all', label: t('status_all', 'All') },
    { value: 'active', label: t('status_active', 'Active') },
    { value: 'archived', label: t('archived', 'Archived') },
  ];

  const inputCls =
    'px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] outline-none';

  return (
    <div className="flex flex-col gap-[12px]">
      {/* Search + filters trigger */}
      <div className="flex flex-wrap items-center gap-[8px]">
        <input
          type="text"
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
          placeholder={t('search_campaigns', 'Search name, client, project or tag...')}
          className={clsx(inputCls, 'flex-1 min-w-[180px]')}
        />
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className={clsx(
            'shrink-0 flex items-center gap-[6px] px-[12px] py-[8px] rounded-[8px] border text-[14px] transition-colors',
            activeCount > 0
              ? 'border-btnPrimary text-btnPrimary bg-btnPrimary/10'
              : 'border-newTableBorder text-textColor bg-newBgColor hover:bg-newTableBorder/30'
          )}
          aria-label={t('filters', 'Filters')}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
        >
          {FilterIcon}
          {activeCount > 0 && (
            <span className="min-w-[18px] h-[18px] px-[4px] flex items-center justify-center rounded-full bg-btnPrimary text-white text-[11px] font-[600]">
              {activeCount}
            </span>
          )}
        </button>
      </div>

      {/* Active filter chips */}
      {activeCount > 0 && (
        <div className="flex flex-wrap items-center gap-[6px]">
          {filters.status !== DEFAULT_CAMPAIGN_FILTERS.status && (
            <Chip onRemove={() => set({ status: DEFAULT_CAMPAIGN_FILTERS.status })}>
              {statusOptions.find((s) => s.value === filters.status)?.label}
            </Chip>
          )}
          {filters.client && (
            <Chip onRemove={() => set({ client: '' })}>
              {t('client', 'Client')}: {filters.client}
            </Chip>
          )}
          {filters.tags.map((tag) => (
            <Chip key={tag} onRemove={() => toggleTag(tag)}>
              #{tag}
            </Chip>
          ))}
          <button
            type="button"
            onClick={() => set({ status: DEFAULT_CAMPAIGN_FILTERS.status, client: '', tags: [] })}
            className="text-[12px] text-newTableText hover:text-textColor underline"
          >
            {t('clear_all', 'Clear all')}
          </button>
        </div>
      )}

      {/* Right-side filter drawer */}
      <div
        aria-hidden={!sheetOpen}
        inert={!sheetOpen}
        className={clsx(
          'fixed inset-0 z-[210] flex justify-end',
          !sheetOpen && 'pointer-events-none'
        )}
      >
        <div
          className={clsx(
            'absolute inset-0 bg-black/50 transition-opacity duration-200',
            sheetOpen ? 'opacity-100' : 'opacity-0'
          )}
          onClick={() => setSheetOpen(false)}
        />
        <div
          className={clsx(
            'relative h-full w-[380px] max-w-[90vw] bg-newBgColor border-s border-studioBorder shadow-2xl flex flex-col text-textColor',
            'transition-transform duration-300 ease-out will-change-transform',
            sheetOpen ? 'translate-x-0' : 'translate-x-full rtl:-translate-x-full'
          )}
        >
          <div className="h-[56px] shrink-0 flex items-center justify-between px-[16px] bg-studioBg border-b border-studioBorder">
            <div className="flex items-center gap-[8px]">
              <div className="text-[16px] font-[600]">{t('filters', 'Filters')}</div>
              {activeCount > 0 && (
                <span className="min-w-[20px] h-[20px] px-[6px] rounded-full bg-[#2B5CD3] text-white text-[11px] font-[600] flex items-center justify-center">
                  {activeCount}
                </span>
              )}
            </div>
            <button
              type="button"
              aria-label={t('close', 'Close')}
              onClick={() => setSheetOpen(false)}
              className="w-[32px] h-[32px] flex items-center justify-center rounded-[8px] text-newTableText hover:bg-[#2B5CD3]/15 hover:text-textColor transition-all"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M1 1L13 13M13 1L1 13"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-auto px-[16px] py-[16px] flex flex-col gap-[16px]">
            {/* Sort */}
            <div>
              <div className="text-[12px] font-[600] text-newTableText mb-[6px]">
                {t('sort_by', 'Sort by')}
              </div>
              <select
                value={filters.sort}
                onChange={(e) => set({ sort: e.target.value as CampaignSort })}
                className="w-full h-[42px] px-[12px] rounded-[8px] text-[14px] bg-newBgColorInner border border-newTableBorder outline-none"
                aria-label={t('sort_by', 'Sort by')}
              >
                {sortOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div>
              <div className="flex items-center justify-between min-h-[16px] mb-[6px]">
                <div className="flex items-center gap-[6px]">
                  {filters.status !== DEFAULT_CAMPAIGN_FILTERS.status && (
                    <span className="w-[6px] h-[6px] rounded-full bg-[#2B5CD3]" />
                  )}
                  <div className="text-[12px] font-[600] text-newTableText">
                    {t('status', 'Status:')}
                  </div>
                </div>
                {filters.status !== DEFAULT_CAMPAIGN_FILTERS.status && (
                  <button
                    type="button"
                    onClick={() => set({ status: DEFAULT_CAMPAIGN_FILTERS.status })}
                    className="text-[11px] font-[600] text-btnPrimaryAccent hover:underline"
                  >
                    {t('clear', 'Clear')}
                  </button>
                )}
              </div>
              <div className="flex gap-[6px]">
                {statusOptions.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => set({ status: o.value })}
                    className={clsx(
                      'flex-1 h-[42px] px-[12px] flex justify-center items-center rounded-[8px] transition-all cursor-pointer text-[14px] font-[500] border',
                      filters.status === o.value
                        ? 'border-[#2B5CD3] bg-[#2B5CD3]/15 text-btnPrimaryAccent'
                        : 'bg-newBgColorInner border-newTableBorder text-textColor hover:border-[#2B5CD3]/50 hover:text-btnPrimaryAccent'
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Client */}
            {clients.length > 0 && (
              <div>
                <div className="flex items-center justify-between min-h-[16px] mb-[6px]">
                  <div className="flex items-center gap-[6px]">
                    {filters.client && (
                      <span className="w-[6px] h-[6px] rounded-full bg-[#2B5CD3]" />
                    )}
                    <div className="text-[12px] font-[600] text-newTableText">
                      {t('client', 'Client')}
                    </div>
                  </div>
                  {filters.client && (
                    <button
                      type="button"
                      onClick={() => set({ client: '' })}
                      className="text-[11px] font-[600] text-btnPrimaryAccent hover:underline"
                    >
                      {t('clear', 'Clear')}
                    </button>
                  )}
                </div>
                <select
                  value={filters.client}
                  onChange={(e) => set({ client: e.target.value })}
                  className="w-full h-[42px] px-[12px] rounded-[8px] text-[14px] bg-newBgColorInner border border-newTableBorder outline-none"
                >
                  <option value="">{t('all_clients', 'All clients')}</option>
                  {clients.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Tags */}
            {allTags.length > 0 && (
              <div>
                <div className="flex items-center justify-between min-h-[16px] mb-[6px]">
                  <div className="flex items-center gap-[6px]">
                    {filters.tags.length > 0 && (
                      <span className="w-[6px] h-[6px] rounded-full bg-[#2B5CD3]" />
                    )}
                    <div className="text-[12px] font-[600] text-newTableText">
                      {t('tags', 'Tags')}
                    </div>
                  </div>
                  {filters.tags.length > 0 && (
                    <button
                      type="button"
                      onClick={() => set({ tags: [] })}
                      className="text-[11px] font-[600] text-btnPrimaryAccent hover:underline"
                    >
                      {t('clear', 'Clear')}
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-[6px]">
                  {allTags.map((tag) => {
                    const on = filters.tags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={clsx(
                          'px-[12px] py-[6px] rounded-full text-[12px] border transition-all',
                          on
                            ? 'border-[#2B5CD3] bg-[#2B5CD3]/15 text-btnPrimaryAccent'
                            : 'bg-newBgColorInner border-newTableBorder text-newTableText hover:border-[#2B5CD3]/50 hover:text-btnPrimaryAccent'
                        )}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Sticky footer */}
          <div className="shrink-0 bg-studioBg border-t border-studioBorder p-[14px] pb-[calc(env(safe-area-inset-bottom)+14px)] flex items-center gap-[10px]">
            <button
              type="button"
              onClick={() => set({ status: DEFAULT_CAMPAIGN_FILTERS.status, client: '', tags: [] })}
              disabled={activeCount === 0}
              className="flex-1 h-[40px] rounded-[8px] border border-newTableBorder text-[14px] font-[500] text-textColor hover:bg-[#2B5CD3]/10 transition-all disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent"
            >
              {activeCount > 0
                ? t('clear_all_count', 'Clear all ({{count}})', { count: activeCount })
                : t('clear_all', 'Clear all')}
            </button>
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              className="flex-1 h-[40px] rounded-[8px] bg-[#2B5CD3] text-white text-[14px] font-[600] hover:opacity-90 transition-all"
            >
              {t('done', 'Done')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const Chip: FC<{ onRemove: () => void; children: React.ReactNode }> = ({
  onRemove,
  children,
}) => (
  <span className="flex items-center gap-[4px] pl-[10px] pr-[6px] py-[3px] rounded-full bg-btnPrimary/15 text-btnPrimaryAccent text-[12px]">
    {children}
    <button
      type="button"
      onClick={onRemove}
      aria-label="Remove filter"
      className="w-[16px] h-[16px] flex items-center justify-center rounded-full hover:bg-btnPrimary/20"
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M1 1l8 8M9 1l-8 8" />
      </svg>
    </button>
  </span>
);
