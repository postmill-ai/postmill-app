'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import ProviderIcon from '@postmill-ai/frontend/components/shared/provider-icon';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { usePermissions } from '@postmill-ai/frontend/components/layout/use-permissions';
import { MEDIA_SETUP_HREF } from '@postmill-ai/frontend/components/layout/use-media-tools-status';
import { EmptyState } from '@postmill-ai/frontend/components/ui/empty-state';
import { LoadingRows } from '@postmill-ai/frontend/components/ui/loading-rows';
import { studioBadgeKey } from '@postmill-ai/frontend/components/media-tools/studio-kit/i18n-keys';
import {
  SORTED_MEDIA_TABS,
  providerIdentifier,
  type MediaTab,
  type StudioBadge,
} from '@postmill-ai/frontend/components/media-tools/media-tools.nav';
import { useEnabledMediaProviders } from '@postmill-ai/frontend/components/media-tools/use-enabled-media-providers';
import { MediaQueuePanel } from '@postmill-ai/frontend/components/media-tools/media-queue';

/**
 * The /media index.
 *
 * Renders inside the media layout, so it inherits the rail, the scrolling
 * content pane and StudioErrorBoundary. Studio visibility uses the exact same
 * predicate as the rail (and the same SWR key, so it costs no extra request) —
 * the two surfaces can't disagree about what's available.
 */

// Below this many studios a filter row is noise, not help.
const MIN_STUDIOS_FOR_FILTER = 5;

const ArrowIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

/**
 * The two platform tools, stated as the two ways to start: from a blank canvas,
 * or from a sentence. They're deliberately not symmetrical — the difference in
 * the tiles is the point.
 */
const HeroPair: React.FC = () => {
  const t = useT();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-[12px]">
      {/* Designer — the manual path. The faint rule grid reads as an artboard. */}
      <Link
        href="/media/designer"
        className="group relative overflow-hidden rounded-[14px] border border-newTableBorder bg-newBgColorInner p-[22px] mobile:p-[18px] flex flex-col gap-[10px] min-h-[188px] hover:border-[#2B5CD3]/50 transition-colors"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.5] group-hover:opacity-100 transition-opacity"
          style={{
            backgroundImage:
              'linear-gradient(to right, color-mix(in srgb, var(--new-btn-primary) 14%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--new-btn-primary) 14%, transparent) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
            maskImage: 'linear-gradient(to bottom right, black, transparent 72%)',
            WebkitMaskImage: 'linear-gradient(to bottom right, black, transparent 72%)',
          }}
        />
        <div className="relative flex flex-col gap-[8px] flex-1">
          <span className="text-[11px] font-[600] uppercase tracking-[0.14em] text-newTableText">
            {t('media_index_hero_manual', 'Start from a canvas')}
          </span>
          <span className="text-[22px] mobile:text-[20px] font-[700] tracking-[-0.02em] text-textColor">
            {t('designer_tab', 'Designer')}
          </span>
          <span className="text-[13px] leading-[1.5] text-newTableText max-w-[34ch]">
            {t(
              'media_index_designer_pitch',
              'Layers, type, brand assets and precise control. Export every size you need from one design.'
            )}
          </span>
        </div>
        <span className="relative inline-flex items-center gap-[6px] text-[13px] font-[600] text-btnPrimaryAccent">
          {t('media_index_open_designer', 'Open Designer')}
          <ArrowIcon />
        </span>
      </Link>

      {/* AI Designer — the generated path. The prompt field carries a real example. */}
      <Link
        href="/media/ai-designer"
        className="group relative overflow-hidden rounded-[14px] border border-newTableBorder bg-newBgColorInner p-[22px] mobile:p-[18px] flex flex-col gap-[10px] min-h-[188px] hover:border-[#2B5CD3]/50 transition-colors"
      >
        <div className="flex flex-col gap-[8px] flex-1">
          <span className="text-[11px] font-[600] uppercase tracking-[0.14em] text-newTableText">
            {t('media_index_hero_generated', 'Start from a sentence')}
          </span>
          <span className="text-[22px] mobile:text-[20px] font-[700] tracking-[-0.02em] text-textColor">
            {t('ai_designer', 'AI Designer')}
          </span>
          <div className="rounded-[10px] border border-newTableBorder bg-newTableHeader px-[12px] py-[9px] text-[13px] text-newTextColor/70 truncate">
            {t(
              'media_index_prompt_example',
              '“Launch post for our autumn coffee blend, warm and editorial”'
            )}
          </div>
        </div>
        <span className="inline-flex items-center gap-[6px] text-[13px] font-[600] text-btnPrimaryAccent">
          {t('media_index_open_ai_designer', 'Describe a design')}
          <ArrowIcon />
        </span>
      </Link>
    </div>
  );
};

const StudioCard: React.FC<{ tab: MediaTab }> = ({ tab }) => {
  const t = useT();
  // Pass the resolved identifier, not the raw slug — `google-ai` has no icon
  // entry but `google` does.
  const identifier = providerIdentifier(tab.href);

  return (
    <Link
      href={tab.href}
      className="group flex items-start gap-[12px] rounded-[12px] border border-newTableBorder bg-newBgColorInner p-[14px] hover:border-[#2B5CD3]/50 transition-colors"
    >
      <span className="shrink-0">
        <ProviderIcon identifier={identifier} name={tab.label} size={34} />
      </span>
      <span className="min-w-0 flex flex-col gap-[6px]">
        <span className="text-[14px] font-[600] text-textColor truncate">{tab.label}</span>
        {!!tab.badges?.length && (
          <span className="flex flex-wrap gap-[4px]">
            {tab.badges.map((badge) => (
              <span
                key={badge}
                className="px-[7px] py-[2px] rounded-full bg-[#2B5CD3]/12 text-[11px] font-[500] text-btnPrimaryAccent"
              >
                {t(studioBadgeKey(badge), badge)}
              </span>
            ))}
          </span>
        )}
      </span>
    </Link>
  );
};

export const MediaIndex: React.FC = () => {
  const t = useT();
  const permissions = usePermissions();
  const { data: enabledProviders } = useEnabledMediaProviders();
  const [filter, setFilter] = useState<StudioBadge | null>(null);

  const stockTabs = useMemo(
    () => SORTED_MEDIA_TABS.filter((tab) => tab.section === 'Content Pack'),
    []
  );

  // Same predicate as the rail (media-tools.nav + the shared hook), so the index
  // and the rail always show the same studios.
  const studios = useMemo(
    () =>
      SORTED_MEDIA_TABS.filter(
        (tab) =>
          tab.section === 'Providers' &&
          (enabledProviders?.has(providerIdentifier(tab.href)) ?? false)
      ),
    [enabledProviders]
  );

  const badges = useMemo(() => {
    const seen = new Set<StudioBadge>();
    for (const studio of studios) for (const badge of studio.badges ?? []) seen.add(badge);
    return [...seen].sort();
  }, [studios]);

  const visibleStudios = filter
    ? studios.filter((studio) => studio.badges?.includes(filter))
    : studios;

  // Three states, not two: `undefined` is still loading, an empty Set means
  // either nothing is configured OR the request 403'd for a member without
  // `media-config:manage` — which is also why the CTA below is gated.
  const loading = enabledProviders === undefined;
  const canConfigure = permissions.hasPermission('media-config', 'manage');
  const showFilters = studios.length >= MIN_STUDIOS_FOR_FILTER && badges.length > 1;

  return (
    <div className="p-[20px] mobile:p-[16px] flex flex-col gap-[28px] max-w-[1180px]">
      <div className="flex flex-col gap-[6px]">
        <h1 className="text-[26px] mobile:text-[22px] font-[700] tracking-[-0.02em] text-textColor">
          {t('media_index_title', 'Make something')}
        </h1>
        <p className="text-[13px] text-newTableText">
          {t(
            'media_index_description',
            'Design it yourself, generate it with AI, or pull from a stock library.'
          )}
        </p>
      </div>

      <HeroPair />

      {/* Renders in flight or recently finished — hidden entirely when there are none. */}
      <MediaQueuePanel />

      <section className="flex flex-col gap-[12px]">
        <div className="flex flex-wrap items-center justify-between gap-[10px]">
          <h2 className="text-[11px] font-[600] uppercase tracking-[0.14em] text-newTableText">
            {t('media_section_ai_media', 'AI Media')}
          </h2>
          {showFilters && (
            <div className="flex flex-wrap gap-[6px]" role="group" aria-label={t('media_index_filter_aria', 'Filter studios by output')}>
              <FilterChip active={filter === null} onClick={() => setFilter(null)}>
                {t('media_index_filter_all', 'All')}
              </FilterChip>
              {badges.map((badge) => (
                <FilterChip
                  key={badge}
                  active={filter === badge}
                  onClick={() => setFilter(filter === badge ? null : badge)}
                >
                  {t(studioBadgeKey(badge), badge)}
                </FilterChip>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <LoadingRows rows={2} columns={4} />
        ) : studios.length === 0 ? (
          <EmptyState
            title={t('media_index_empty_title', 'No AI studios connected')}
            description={
              canConfigure
                ? t(
                    'media_index_empty_description',
                    'Add a provider key and its studio appears here, ready to generate images, video and audio.'
                  )
                : t(
                    'media_index_empty_description_member',
                    'An admin can connect AI providers to unlock image, video and audio studios.'
                  )
            }
            action={
              canConfigure ? (
                <Link
                  href={MEDIA_SETUP_HREF}
                  className="inline-flex items-center gap-[8px] px-[16px] py-[9px] rounded-[8px] bg-[#2B5CD3] text-white text-[13px] font-[600] hover:bg-[#2B5CD3]/85 transition-colors"
                >
                  {t('media_index_empty_cta', 'Connect a provider')}
                  <ArrowIcon />
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-[10px]">
            {visibleStudios.map((tab) => (
              <StudioCard key={tab.href} tab={tab} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-[12px]">
        <h2 className="text-[11px] font-[600] uppercase tracking-[0.14em] text-newTableText">
          {t('media_section_content_pack', 'Content Pack')}
        </h2>
        <div className="flex flex-wrap gap-[8px]">
          {stockTabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className="inline-flex items-center gap-[8px] rounded-[10px] border border-newTableBorder bg-newBgColorInner ps-[12px] pe-[14px] py-[9px] text-[13px] text-textColor hover:border-[#2B5CD3]/50 transition-colors"
            >
              <span className="w-[18px] h-[18px] flex items-center justify-center shrink-0 text-newTableText">
                {tab.icon}
              </span>
              {tab.labelKey ? t(tab.labelKey, tab.label) : tab.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
};

const FilterChip: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={clsx(
      'px-[11px] py-[5px] rounded-full text-[12px] font-[500] border transition-colors',
      active
        ? 'bg-[#2B5CD3] border-[#2B5CD3] text-white'
        : 'bg-newBgColorInner border-newTableBorder text-newTableText hover:text-textColor'
    )}
  >
    {children}
  </button>
);
