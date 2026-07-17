'use client';

import { FC, useMemo } from 'react';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { LineChart } from '@gitroom/frontend/components/analytics-v2/charts/line.chart';
import { BarChart } from '@gitroom/frontend/components/analytics-v2/charts/bar.chart';
import { TabSkeleton, EmptyState, ErrorState } from '@gitroom/frontend/components/analytics-v2/kit/states';
import { metricLabelT } from '@gitroom/frontend/components/campaigns/metric-labels';
import {
  useCampaignAnalytics,
  resolveCampaignAnalyticsRange,
} from '@gitroom/frontend/components/campaigns/hooks/campaign.hooks';

interface CampaignAnalyticsSectionProps {
  campaignId?: string;
  startDate?: string | null;
  endDate?: string | null;
}

// Metric preference for the headline trend line.
const PRIMARY_METRIC_ORDER = ['views', 'impressions', 'video_views', 'likes', 'comments', 'clicks'];

export const CampaignAnalyticsSection: FC<CampaignAnalyticsSectionProps> = ({
  campaignId,
  startDate,
  endDate,
}) => {
  const t = useT();
  const { from, to } = useMemo(
    () => resolveCampaignAnalyticsRange(startDate, endDate),
    [startDate, endDate]
  );
  const { data, isLoading, error, mutate } = useCampaignAnalytics(campaignId, from, to);

  // The metric that drives the trend chart: first preferred metric with data,
  // else the first series that has points.
  const primary = useMemo(() => {
    const series = data?.series || {};
    const keys = Object.keys(series);
    if (!keys.length) return null;
    const pick =
      PRIMARY_METRIC_ORDER.find((m) => (series[m]?.length ?? 0) > 0) ||
      keys.find((k) => (series[k]?.length ?? 0) > 0);
    if (!pick) return null;
    return { metric: pick, series: series[pick] };
  }, [data]);

  const channelBars = useMemo(() => {
    if (!data?.byChannel?.length) return { labels: [] as string[], values: [] as number[] };
    return {
      labels: data.byChannel.map((c) => c.name),
      values: data.byChannel.map((c) => c.kpis?.[0]?.total || 0),
    };
  }, [data]);

  const windowLabel = useMemo(() => {
    if (!data?.window) return '';
    const fromFmt = t('campaign_analytics_window_from_format', 'MMM D');
    const toFmt = t('campaign_date_format', 'MMM D, YYYY');
    return `${dayjs(data.window.from).format(fromFmt)} – ${dayjs(data.window.to).format(toFmt)}`;
  }, [data, t]);

  // 6.1 — weekly rollup lets the series extend past the 90-day daily window, so
  // the label is honest: plain "last 90 days" only while every point is daily,
  // otherwise it names the daily/weekly seam.
  const hasWeekly = useMemo(
    () =>
      Object.values(data?.series || {}).some((points) =>
        points?.some((p) => p.granularity === 'weekly')
      ),
    [data]
  );

  const header = (
    <div className="flex flex-wrap items-baseline justify-between gap-[8px]">
      <h3 className="text-[14px] font-semibold text-textColor">
        {t('campaign_performance', 'Performance')}
      </h3>
      <span className="text-[12px] text-newTableText">
        {hasWeekly
          ? t('campaign_analytics_window_rollup', 'post metrics · daily ≤90d · weekly beyond')
          : t('campaign_analytics_window', 'post metrics · last 90 days')}
        {windowLabel ? ` · ${windowLabel}` : ''}
      </span>
    </div>
  );

  return (
    <div className="p-[16px] border border-newTableBorder rounded-[12px] bg-newBgColor flex flex-col gap-[16px]">
      {header}
      {isLoading ? (
        <TabSkeleton variant="chart" />
      ) : error ? (
        <ErrorState
          title={t('campaign_analytics_failed', 'Failed to load campaign analytics')}
          message={(error as Error)?.message}
          onRetry={() => mutate()}
        />
      ) : !primary ? (
        <EmptyState
          title={t('campaign_analytics_empty_title', 'No performance data yet')}
          description={t(
            'campaign_analytics_empty_desc',
            'Analytics appear once this campaign’s posts publish and daily snapshots accumulate.'
          )}
        />
      ) : (
        <div className="flex flex-col gap-[16px]">
          <div>
            <div className="text-[12px] font-medium text-newTableText mb-[8px]">
              {metricLabelT(primary.metric, t)}
            </div>
            <div className="w-full aspect-[16/9] sm:aspect-[21/9] max-h-[320px]">
              <LineChart series={primary.series} height={300} />
            </div>
          </div>

          {channelBars.labels.length > 0 && (
            <div>
              <div className="text-[12px] font-medium text-newTableText mb-[8px]">
                {t('by_channel', 'By Channel')}
              </div>
              <div className="w-full aspect-[4/3] max-h-[260px]">
                <BarChart labels={channelBars.labels} values={channelBars.values} height={250} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
