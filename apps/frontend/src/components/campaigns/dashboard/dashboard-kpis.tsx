'use client';

import { FC, useMemo } from 'react';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { StatTile } from '@gitroom/frontend/components/analytics-v2/kit/stat-tile';
import { CHART_PALETTE } from '@gitroom/frontend/components/analytics-v2/kit/palette';
import { KPI } from '@gitroom/frontend/components/analytics-v2/utils';
import { metricLabelT } from '@gitroom/frontend/components/campaigns/metric-labels';
import {
  useCampaignAnalytics,
  resolveCampaignAnalyticsRange,
  CampaignAnalytics,
} from '@gitroom/frontend/components/campaigns/hooks/campaign.hooks';

interface DashboardKpisProps {
  dashboard: {
    engagement?: {
      totalViews?: number;
      totalLikes?: number;
      totalComments?: number;
      avgViews?: number;
      avgLikes?: number;
      avgComments?: number;
      clickTotal?: number;
    };
    stateCounts?: Record<string, number>;
    clickTotal?: number;
    goals?: Array<{ metric: string; target: number; current: number; pct: number }>;
    campaign?: {
      id?: string;
      startDate?: string | null;
      endDate?: string | null;
      goals?: Array<{ metric: string; target: number }>;
    };
  };
}

// Each headline lifetime tile maps to one or more analytics metrics; the first
// metric with a series present drives the sparkline + %-change. When none is
// present (all posts on no-analytics providers) the tile degrades to a plain
// value with no crash.
const TILE_METRICS: Record<string, string[]> = {
  views: ['views', 'impressions', 'video_views', 'post_impressions'],
  likes: ['likes', 'reactions', 'favorites', 'total_likes'],
  replies: ['comments', 'replies'],
  clicks: ['clicks', 'outbound_clicks', 'website_clicks'],
};

export const DashboardKpis: FC<DashboardKpisProps> = ({ dashboard }) => {
  const t = useT();

  const campaignId = dashboard?.campaign?.id;
  const { from, to } = useMemo(
    () =>
      resolveCampaignAnalyticsRange(
        dashboard?.campaign?.startDate,
        dashboard?.campaign?.endDate
      ),
    [dashboard?.campaign?.startDate, dashboard?.campaign?.endDate]
  );
  const { data: analytics } = useCampaignAnalytics(campaignId, from, to);

  const goals = useMemo(() => {
    if (dashboard?.goals) {
      return dashboard.goals;
    }
    // Fallback for older dashboard responses without computed progress.
    const engagement = dashboard?.engagement || {};
    const stateCounts = dashboard?.stateCounts || {};
    const clickTotal = dashboard?.clickTotal ?? engagement?.clickTotal ?? 0;
    const list = dashboard?.campaign?.goals || [];
    return list.map((g) => {
      let current = 0;
      switch (g.metric) {
        case 'impressions':
          current = engagement.totalViews || 0;
          break;
        case 'likes':
          current = engagement.totalLikes || 0;
          break;
        case 'comments':
          current = engagement.totalComments || 0;
          break;
        case 'clicks':
          current = clickTotal;
          break;
        case 'posts':
          current = (stateCounts.DRAFT || 0) + (stateCounts.QUEUE || 0) + (stateCounts.PUBLISHED || 0);
          break;
        default:
          current = 0;
      }
      const target = Number(g.target) || 0;
      const pct = target ? Math.min(100, Math.round((current / target) * 100)) : 0;
      return { metric: g.metric, target, current, pct };
    });
  }, [dashboard]);

  const engagement = dashboard?.engagement || {};
  const stateCounts = dashboard?.stateCounts || {};
  const clickTotal = dashboard?.clickTotal ?? engagement?.clickTotal ?? 0;

  // Headline lifetime totals (D5 — unchanged source: dashboard.engagement), each
  // enriched with the analytics window's sparkline + %-change when available.
  const tiles = useMemo(() => {
    const defs = [
      { key: 'views', label: t('views', 'Views'), total: engagement.totalViews || 0 },
      { key: 'likes', label: t('likes', 'Likes'), total: engagement.totalLikes || 0 },
      { key: 'replies', label: t('replies', 'Replies'), total: engagement.totalComments || 0 },
      { key: 'clicks', label: t('clicks', 'Clicks'), total: clickTotal || 0 },
    ];
    return defs.map((def) => {
      const rich = buildRichKpi(def.key, def.label, def.total, analytics);
      return { ...def, rich };
    });
  }, [analytics, engagement.totalViews, engagement.totalLikes, engagement.totalComments, clickTotal, t]);

  // Freshest data point behind the analytics window — the "as of" date used to
  // signal daily-granularity staleness on the goals (3.5).
  const asOf = useMemo(() => {
    let latest = '';
    for (const points of Object.values(analytics?.series || {})) {
      for (const p of points) {
        if (p.date > latest) latest = p.date;
      }
    }
    return latest || analytics?.window?.to || '';
  }, [analytics]);
  const asOfLabel = asOf ? dayjs(asOf).format(t('campaign_kpis_asof_format', 'MMM D')) : '';

  const states = [
    { key: 'DRAFT', label: t('draft', 'Draft'), color: 'bg-newTableText/20 text-newTableText' },
    { key: 'QUEUE', label: t('scheduled', 'Scheduled'), color: 'bg-designerAccent/10 text-btnPrimaryAccent' },
    { key: 'PUBLISHED', label: t('published', 'Published'), color: 'bg-green-500/10 text-green-800 dark:text-green-400' },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[16px]">
        {tiles.map((tile, i) =>
          tile.rich ? (
            <StatTile
              key={tile.key}
              kpi={tile.rich}
              accent={CHART_PALETTE[i % CHART_PALETTE.length]}
            />
          ) : (
            <StatTile
              key={tile.key}
              label={tile.label}
              value={Math.round(tile.total).toLocaleString()}
              accent={CHART_PALETTE[i % CHART_PALETTE.length]}
            />
          )
        )}
      </div>

      <div className="flex flex-wrap gap-[12px]">
        {states.map((s) => (
          <div
            key={s.key}
            className={`flex items-center gap-[8px] px-[12px] py-[6px] rounded-[8px] text-[13px] ${s.color}`}
          >
            <span className="font-semibold">{stateCounts[s.key] || 0}</span>
            <span>{s.label}</span>
          </div>
        ))}
      </div>

      {goals.length > 0 && (
        <div className="p-[16px] border border-newTableBorder rounded-[12px] bg-newBgColor flex flex-col gap-[12px]">
          <h3 className="text-[14px] font-semibold text-textColor">{t('goals', 'Goals')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-[12px]">
            {goals.map((g, idx) => (
              <div key={`${g.metric}-${g.target}-${idx}`} className="flex flex-col gap-[4px]">
                <div className="flex justify-between text-[12px] text-newTableText">
                  <span>{metricLabelT(g.metric, t)}</span>
                  <span>
                    {Math.round(g.current).toLocaleString()} / {Math.round(g.target).toLocaleString()}
                  </span>
                </div>
                <div className="h-[8px] bg-newTableBorder/30 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-btnPrimary rounded-full transition-all"
                    style={{ width: `${g.pct}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-newTableText">
                  {asOfLabel ? (
                    <span>{t('as_of', 'as of')} {asOfLabel}</span>
                  ) : (
                    <span />
                  )}
                  <span>{g.pct}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Build a rich KPI (animated total + sparkline + %-change) for a headline tile,
// or return null when the campaign has no analytics series for the metric.
function buildRichKpi(
  tileKey: string,
  label: string,
  lifetimeTotal: number,
  analytics?: CampaignAnalytics
): KPI | null {
  if (!analytics) return null;
  const candidates = TILE_METRICS[tileKey] || [];
  const metricKey = candidates.find((m) => (analytics.series?.[m]?.length ?? 0) > 0);
  if (!metricKey) return null;
  const series = analytics.series[metricKey] || [];
  const akpi = analytics.kpis?.find((k) => k.metric === metricKey);
  return {
    metric: metricKey,
    label,
    format: 'number',
    // Headline number stays the lifetime total (D5); trend rides the window.
    total: lifetimeTotal,
    previousTotal: akpi?.previousTotal ?? 0,
    percentageChange: akpi?.percentageChange ?? 0,
    sparkline: series.map((p) => ({ date: p.date, value: p.value })),
  };
}
