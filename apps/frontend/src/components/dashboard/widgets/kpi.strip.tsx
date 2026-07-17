'use client';

import { FC, useMemo } from 'react';
import { StatTile } from '@gitroom/frontend/components/analytics-v2/kit/stat-tile';
import { useOverview } from '@gitroom/frontend/components/analytics-v2/hooks/useOverview';
import { useDashboardSummary } from '../hooks/useDashboardSummary';
import { KPI } from '@gitroom/frontend/components/analytics-v2/utils';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const staticKPI = (label: string, total: number): KPI => ({
  metric: label,
  label,
  format: 'number',
  total,
  previousTotal: 0,
  percentageChange: 0,
  sparkline: [],
});

interface KpiStripProps {
  from: string;
  to: string;
  integrationIds: string[];
}

export const KpiStrip: FC<KpiStripProps> = ({ from, to, integrationIds }) => {
  const t = useT();
  const { data: summary, isLoading: summaryLoading } = useDashboardSummary();
  const { data: overview, isLoading: overviewLoading } = useOverview({
    from,
    to,
    integrations: integrationIds,
    compare: false,
  });

  const kpis = useMemo(() => {
    const engagement = overview?.kpis?.[0];
    return [
      {
        kpi: engagement ?? staticKPI(t('kpi_engagement_7d', 'Engagement (7d)'), 0),
        accent: 'var(--chart-1, #2b5cd3)',
      },
      {
        kpi: staticKPI(
          t('kpi_published_7d', 'Published (7d)'),
          summaryLoading ? 0 : (summary?.publishedNext7 ?? 0)
        ),
        accent: 'var(--chart-2, #32d583)',
      },
      {
        kpi: staticKPI(
          t('kpi_scheduled', 'Scheduled'),
          summaryLoading ? 0 : (summary?.scheduledPosts ?? 0)
        ),
        accent: 'var(--chart-5, #ffac30)',
      },
      {
        kpi: staticKPI(
          t('kpi_unread_replies', 'Unread replies'),
          summaryLoading ? 0 : (summary?.commentUnreadCount ?? 0)
        ),
        accent: 'var(--chart-3, #1d9bf0)',
      },
      {
        kpi: staticKPI(
          t('channels', 'Channels'),
          summary?.channelsConnected ?? integrationIds.length
        ),
        accent: 'var(--chart-6, #8b90ff)',
      },
    ];
  }, [
    overview?.kpis,
    summary?.publishedNext7,
    summary?.scheduledPosts,
    summary?.commentUnreadCount,
    summary?.channelsConnected,
    summaryLoading,
    integrationIds.length,
    t,
  ]);

  const loading = summaryLoading || overviewLoading;

  return (
    <div className="grid grid-cols-2 xl:grid-cols-3 gap-[12px]">
      {kpis.map(({ kpi, accent }) => (
        <div key={kpi.metric} data-testid={`kpi-tile-${kpi.metric}`}>
          <StatTile kpi={kpi} accent={accent} />
        </div>
      ))}
      {loading && (
        <>
          <div className="h-[120px] bg-newTableHeader rounded-[12px] animate-pulse" />
          <div className="h-[120px] bg-newTableHeader rounded-[12px] animate-pulse" />
        </>
      )}
    </div>
  );
};
