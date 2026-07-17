'use client';

import { FC, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';
import dayjs from 'dayjs';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useOverview } from './hooks/useOverview';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import { AnalyticsFilterBar } from './filters/filter.bar';
import { OverviewTab } from './views/overview.tab';
import { ChannelsTab } from './views/channels.tab';
import { PostsTab } from './views/posts.tab';
import { DrillBreadcrumb } from './drill/drill.breadcrumb';
import { DrillState, OverviewResponse } from './utils';
import { usePosts } from './hooks/usePosts';
import { ErrorBoundary } from './error.boundary';
import { ExportButton } from './export.button';
import { ShareButton } from './share.button';
import { CampaignBand } from './charts/line.chart';
import { InsightsTab } from './views/insights.tab';
import { WatchlistTab } from './views/watchlist.tab';
import { ShortlinksTab } from './views/shortlinks.tab';
import { PostAnalyticsDrawer } from './post-analytics.drawer';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

function getDefaultFrom(): string {
  return dayjs().subtract(30, 'day').format('YYYY-MM-DD');
}

function getDefaultTo(): string {
  return dayjs().format('YYYY-MM-DD');
}

function isDataEmpty(data: OverviewResponse | undefined): boolean {
  if (!data) return true;
  const hasKpis = !!data.kpis?.length;
  const hasSeries = !!data.series && Object.keys(data.series).length > 0;
  const hasChannels = !!data.byChannel?.length;
  return !hasKpis && !hasSeries && !hasChannels;
}

interface CampaignListItem {
  id: string;
  name: string;
  integrationIds?: string[];
  startDate?: string | null;
  endDate?: string | null;
  color?: string | null;
}

// One hook per resource (repo SWR convention) — the org's campaign list used
// for the filter dropdown and the overview chart's campaign bands (6.5).
const useAnalyticsCampaigns = () => {
  const fetch = useFetch();
  return useSWR<CampaignListItem[]>('/campaigns', (url: string) =>
    fetch(url).then((r: Response) => r.json())
  );
};

export const AnalyticsDashboard: FC = () => {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();

  const from = searchParams.get('from') || getDefaultFrom();
  const to = searchParams.get('to') || getDefaultTo();
  const compare = searchParams.get('compare') !== 'false';
  const rawTab = searchParams.get('tab') || 'overview';
  // Legacy compat: old ?tab=best-time|recommendations deep-links now resolve to
  // the Insights tab, scrolled to the matching section (2.10).
  const legacyInsights = rawTab === 'best-time' || rawTab === 'recommendations';
  const tab = (legacyInsights ? 'insights' : rawTab) as DrillState['tab'];
  const insightsSection = legacyInsights
    ? rawTab
    : searchParams.get('section') || undefined;
  const drillMetric = searchParams.get('metric') || undefined;
  const focusIntegration = searchParams.get('focusIntegration') || undefined;
  const focusDate = searchParams.get('focusDate') || undefined;
  const focusPost = searchParams.get('focusPost') || undefined;

  const { data: integrationsData } = useIntegrationList();
  const integrations = useMemo(
    () => (integrationsData || []) as Integrations[],
    [integrationsData]
  );
  const allIntegrationIds = useMemo(
    () => integrations.map((i) => i.id),
    [integrations]
  );
  // Display shape consumed by ChannelsTab (name/picture lookup).
  const channels = useMemo(
    () =>
      integrations.map((i) => ({
        integrationId: i.id,
        name: i.name,
        identifier: i.identifier,
        picture: i.picture,
      })),
    [integrations]
  );

  // Channels & campaigns are URL-driven; empty selection means "all".
  const urlIntegrations = searchParams.get('integrations');
  const selectedChannels = useMemo(
    () => (urlIntegrations ? urlIntegrations.split(',') : []),
    [urlIntegrations]
  );

  const urlCampaigns = searchParams.get('campaigns');
  const selectedCampaigns = useMemo(
    () => (urlCampaigns ? urlCampaigns.split(',') : []),
    [urlCampaigns]
  );

  const { data: campaignData } = useAnalyticsCampaigns();
  const campaignList = useMemo(() => campaignData || [], [campaignData]);
  const campaigns = useMemo(
    () => campaignList.map((c) => ({ id: c.id, name: c.name })),
    [campaignList]
  );

  // 6.5 — campaign date ranges for the overview chart annotations. The chart
  // plugin filters to intersecting bands + clamps, so we pass all dated
  // campaigns (ongoing ones extend to the visible end).
  const campaignBands = useMemo<CampaignBand[]>(
    () =>
      campaignList
        .filter((c) => c.startDate)
        .map((c) => ({
          name: c.name,
          from: (c.startDate as string).slice(0, 10),
          to: c.endDate ? (c.endDate as string).slice(0, 10) : to,
          color: c.color || undefined,
        })),
    [campaignList, to]
  );

  // The user's explicit channel selection rides into the fetches unchanged —
  // the server intersects campaign posts with the integration filter itself.
  // Client-side intersecting with the campaigns' channels sent an EMPTY
  // `integrations=` when the sets were disjoint, which the backend reads as
  // "no restriction" and silently returned every channel's campaign data.
  const activeIntegrations = useMemo(
    () => (selectedChannels.length ? selectedChannels : allIntegrationIds),
    [selectedChannels, allIntegrationIds]
  );

  const {
    data: overviewData,
    isLoading: overviewLoading,
    error: overviewError,
  } = useOverview({
    from,
    to,
    integrations: activeIntegrations,
    compare,
    campaigns: selectedCampaigns,
  });

  // Campaign scope (1.6): the overview response flags itself `campaign-posts`
  // when campaign-filtered, so metrics derive from post snapshots only.
  const campaignScoped = overviewData?.scope === 'campaign-posts';

  const {
    data: postsData,
    isLoading: postsLoading,
    error: postsError,
  } = usePosts(
    tab === 'posts'
      ? {
          from,
          to,
          integrations: activeIntegrations,
          sort: searchParams.get('sort') || 'publishedAt',
          dir: (searchParams.get('dir') as 'asc' | 'desc') || 'desc',
          page: +(searchParams.get('page') || 1),
          limit: 25,
          campaigns: selectedCampaigns,
        }
      : undefined
  );

  const updateParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (value === undefined || value === '') {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      });
      router.replace(`/analytics?${params.toString()}`);
    },
    [router, searchParams]
  );

  const handleChannelChange = useCallback(
    (ids: string[]) => {
      updateParams({
        integrations:
          ids.length && ids.length < allIntegrationIds.length
            ? ids.join(',')
            : undefined,
      });
    },
    [allIntegrationIds, updateParams]
  );

  const handleCampaignsChange = useCallback(
    (ids: string[]) => {
      updateParams({ campaigns: ids.length ? ids.join(',') : undefined });
    },
    [updateParams]
  );

  const handleRangeChange = useCallback(
    (range: { from: string; to: string; compare: boolean }) => {
      updateParams({
        from: range.from,
        to: range.to,
        compare: String(range.compare),
      });
    },
    [updateParams]
  );

  const handleTabChange = useCallback(
    (newTab: string) => {
      updateParams({ tab: newTab });
    },
    [updateParams]
  );

  const handleSelectMetric = useCallback(
    (metric: string) => {
      updateParams({ metric: metric || undefined });
    },
    [updateParams]
  );

  const handleSelectChannel = useCallback(
    (integrationId: string) => {
      updateParams({ focusIntegration: integrationId, tab: 'channels' });
    },
    [updateParams]
  );

  const handleSelectDate = useCallback(
    (date: string) => {
      if (date) {
        // The day drill needs a metric — a chart point click only carries the
        // date, so default to the chart's displayed metric (the first KPI) or
        // the drawer would never open while the URL still gained ?focusDate.
        updateParams({
          focusDate: date,
          metric: drillMetric || overviewData?.kpis?.[0]?.metric,
        });
        return;
      }
      // Closing the day drawer clears what the click set (date + metric).
      updateParams({ focusDate: undefined, metric: undefined });
    },
    [updateParams, drillMetric, overviewData]
  );

  const handleSelectPost = useCallback(
    (postId: string) => {
      updateParams({ focusPost: postId || undefined });
    },
    [updateParams]
  );

  // 6.1 — the post drawer is opened by a `focusPost` deep-link (alert "View top
  // post" / anomaly notification). Closing it clears `focusPost`; `metric` only
  // ever rides in via that same link, so drop it too.
  const handleCloseFocusPost = useCallback(() => {
    updateParams({ focusPost: undefined, metric: undefined });
  }, [updateParams]);

  const handleReset = useCallback(() => {
    updateParams({
      metric: undefined,
      focusIntegration: undefined,
      focusDate: undefined,
      focusPost: undefined,
      tab: undefined,
    });
  }, [updateParams]);

  const handlePageChange = useCallback(
    (page: number) => {
      updateParams({ page: String(page) });
    },
    [updateParams]
  );

  const handleSortChange = useCallback(
    (sort: string, dir: 'asc' | 'desc') => {
      updateParams({ sort, dir, page: '1' });
    },
    [updateParams]
  );

  // When the org-level empty block is shown, the tab content is skipped so the
  // user doesn't get a second, redundant empty chart card beneath it.
  const showEmptyBlock =
    !overviewLoading &&
    !overviewError &&
    (tab === 'overview' || tab === 'channels') &&
    isDataEmpty(overviewData);

  const drill: DrillState = {
    metric: drillMetric,
    focusIntegration,
    focusDate,
    focusPost,
    tab,
  };
  const tabLabels: Record<string, string> = {
    overview: t('analytics_tab_overview', 'Overview'),
    channels: t('analytics_tab_channels', 'Channels'),
    posts: t('analytics_tab_posts', 'Posts'),
    insights: t('analytics_tab_insights', 'Insights'),
    shortlinks: t('analytics_tab_shortlinks', 'Links'),
    watchlist: t('analytics_tab_watchlist', 'Watchlist'),
  };

  // Tabs — all inline (D4 / 2.10): Insights absorbs Best time + Recommendations,
  // so the kebab overflow is gone.
  const tabItems = (
    ['overview', 'channels', 'posts', 'insights', 'shortlinks', 'watchlist'] as const
  ).map((key) => ({ key, label: tabLabels[key] }));

  const renderTab = (item: { key: string; label: string }) => (
    <button
      key={item.key}
      type="button"
      role="tab"
      aria-selected={tab === item.key}
      onClick={() => handleTabChange(item.key)}
      className={clsx(
        'px-[16px] py-[10px] text-[14px] font-[500] whitespace-nowrap border-b-2 -mb-[1px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-designerAccent/60',
        tab === item.key
          ? 'border-btnPrimary text-textColor'
          : 'border-transparent text-newTableText hover:text-textColor'
      )}
    >
      {item.label}
    </button>
  );

  return (
    <ErrorBoundary>
      <div
        className="flex-1 flex flex-col min-h-0 min-w-0"
      >
        <div className="sticky top-0 z-40 bg-newBgColor border-b border-newTableBorder px-[24px] py-[12px] mobile:px-[16px]">
          <AnalyticsFilterBar
            from={from}
            to={to}
            compare={compare}
            onRangeChange={handleRangeChange}
            integrations={integrations}
            selectedChannels={selectedChannels}
            onChannelsChange={handleChannelChange}
            campaigns={campaigns}
            selectedCampaigns={selectedCampaigns}
            onCampaignsChange={handleCampaignsChange}
            exportSlot={
              <div className="flex items-center gap-[8px]">
                <ShareButton />
                <ExportButton
                  from={from}
                  to={to}
                  integrations={activeIntegrations}
                  compare={compare}
                  campaigns={selectedCampaigns}
                />
              </div>
            }
          />
        </div>

        <div className="flex-1 min-w-0 overflow-y-auto px-[24px] py-[16px] mobile:px-[16px]">
          {campaignScoped && (
            <div className="flex items-center gap-[8px] mb-[16px] px-[14px] py-[10px] rounded-[10px] bg-newTableHeader border border-newTableBorder text-[13px] text-newTableText">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-600 shrink-0">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4m0 4h.01" strokeLinecap="round" />
              </svg>
              <span>
                {t(
                  'analytics_campaign_scope_note',
                  "Post metrics only — channel metrics like followers aren't campaign-scoped."
                )}
              </span>
            </div>
          )}
          <DrillBreadcrumb
            drill={drill}
            onReset={handleReset}
            onNavigate={(updates) =>
              updateParams(updates as Record<string, string>)
            }
          />

          <div className="flex items-stretch border-b border-newTableBorder mb-[16px]">
            <div
              className="flex-1 overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
              role="tablist"
            >
              <div role="presentation" className="flex items-center gap-[2px] min-w-max">
                {tabItems.map((item) => renderTab(item))}
              </div>
            </div>
          </div>

          {showEmptyBlock && (
            <div className="flex flex-col items-center justify-center py-[48px] px-[24px] mb-[16px] bg-newBgColorInner border border-newTableBorder rounded-[12px]">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-newTableText mb-[16px]">
                <path d="M18 20V10" />
                <path d="M12 20V4" />
                <path d="M6 20v-6" />
              </svg>
              <div className="text-[16px] font-[600] text-textColor mb-[8px]">
                {t('analytics_empty_title', 'No analytics data yet')}
              </div>
              <div className="text-[13px] text-newTableText text-center max-w-[420px] mb-[20px]">
                {t('analytics_empty_desc', 'Analytics appears after your first scheduled collection (requires connected channels and background jobs configured).')}
              </div>
              <Link
                href="/settings/channels"
                className="inline-flex items-center gap-[8px] px-[16px] py-[8px] bg-btnPrimary text-white text-[13px] font-[500] rounded-[8px] hover:opacity-90 transition-opacity"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                </svg>
                {t('analytics_connect_channels', 'Connect channels')}
              </Link>
            </div>
          )}

          {tab === 'overview' && !showEmptyBlock && (
            <ErrorBoundary>
              <OverviewTab
                data={overviewData}
                loading={overviewLoading}
                error={overviewError}
                from={from}
                to={to}
                integrations={activeIntegrations}
                compare={compare}
                campaigns={selectedCampaigns}
                campaignBands={campaignBands}
                selectedMetric={drillMetric}
                selectedDate={focusDate}
                focusIntegration={focusIntegration}
                onSelectMetric={handleSelectMetric}
                onSelectDate={handleSelectDate}
                onSelectChannel={handleSelectChannel}
              />
            </ErrorBoundary>
          )}
          {tab === 'channels' && !showEmptyBlock && (
            <ErrorBoundary>
              <ChannelsTab
                data={overviewData}
                loading={overviewLoading}
                error={overviewError}
                focusIntegration={focusIntegration}
                from={from}
                to={to}
                compare={compare}
                integrations={activeIntegrations}
                channels={channels}
                onSelectChannel={handleSelectChannel}
              />
            </ErrorBoundary>
          )}
          {tab === 'insights' && (
            <ErrorBoundary>
              <InsightsTab
                integrations={activeIntegrations}
                section={insightsSection}
              />
            </ErrorBoundary>
          )}
          {tab === 'watchlist' && (
            <ErrorBoundary>
              <WatchlistTab />
            </ErrorBoundary>
          )}
          {tab === 'shortlinks' && (
            <ErrorBoundary>
              <ShortlinksTab from={from} to={to} />
            </ErrorBoundary>
          )}
          {tab === 'posts' && (
            <ErrorBoundary>
              <PostsTab
                posts={postsData?.posts}
                total={postsData?.total || 0}
                loading={postsLoading}
                error={postsError}
                page={+(searchParams.get('page') || 1)}
                limit={25}
                sort={searchParams.get('sort') || 'publishedAt'}
                dir={(searchParams.get('dir') as 'asc' | 'desc') || 'desc'}
                onPageChange={handlePageChange}
                onSortChange={handleSortChange}
              />
            </ErrorBoundary>
          )}
        </div>
      </div>
      {focusPost && (
        <PostAnalyticsDrawer
          postId={focusPost}
          open
          onClose={handleCloseFocusPost}
        />
      )}
    </ErrorBoundary>
  );
};
