'use client';

import { FC, useMemo, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { OverviewResponse, FetchError } from '../utils';
import { StatTile } from '../kit/stat-tile';
import { TabSkeleton, EmptyState, ErrorState } from '../kit/states';
import { LineChart, CampaignBand } from '../charts/line.chart';
import { PieChart } from '../charts/pie.chart';
import { BarChart } from '../charts/bar.chart';
import { MetricDetailPanel } from '../drill/metric.detail.panel';
import { useMetricDrill } from '../hooks/useMetricDrill';
import { DayDetailPanel } from '../drill/day.detail.panel';
import { useDayDrill } from '../hooks/useDayDrill';
import { CHART_PALETTE } from '../kit/palette';
import { AnomalyOverviewStrip } from './alerts.section';
import { DerivedMetricTiles } from '../kit/derived-metrics';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useAiActive } from '@gitroom/frontend/components/layout/use-ai-active';
import { NarrateModal } from './narrate.modal';

interface OverviewTabProps {
  data?: OverviewResponse;
  loading: boolean;
  error?: Error;
  from: string;
  to: string;
  integrations: string[];
  compare: boolean;
  /** Campaign filter (1.6) — threaded into the metric/day drills so they stay scoped. */
  campaigns?: string[];
  /** Campaign date ranges for the overview chart annotations (6.5). */
  campaignBands?: CampaignBand[];
  selectedMetric?: string;
  selectedDate?: string;
  focusIntegration?: string;
  onSelectMetric: (metric: string) => void;
  onSelectDate?: (date: string) => void;
  onSelectChannel?: (integrationId: string) => void;
}

export const OverviewTab: FC<OverviewTabProps> = ({
  data,
  loading,
  error,
  from,
  to,
  integrations,
  compare,
  campaigns,
  campaignBands,
  selectedMetric,
  selectedDate,
  focusIntegration,
  onSelectMetric,
  onSelectDate,
  onSelectChannel,
}) => {
  const t = useT();
  const modal = useModals();
  const aiActive = useAiActive();
  // Campaign annotations toggle (6.5) — default on when any band intersects.
  const [showBands, setShowBands] = useState(true);

  const openNarrate = () => {
    modal.openModal({
      title: t('analytics_explain_period', 'Explain this period'),
      withCloseButton: true,
      children: <NarrateModal from={from} to={to} />,
    });
  };

  const { data: metricDrillData } = useMetricDrill({
    metric: selectedMetric || '',
    from,
    to,
    integrations,
    compare,
    campaigns,
  });

  const { data: dayDrillData } = useDayDrill({
    date: selectedDate || '',
    metric: selectedMetric || '',
    integrations,
    campaigns,
  });

  const mainMetric = useMemo(() => {
    if (!data?.kpis?.length) return undefined;
    return data.kpis[0];
  }, [data]);

  const series = useMemo(() => {
    if (!data?.series || !mainMetric) return [];
    const s = data.series[mainMetric.metric];
    return s || [];
  }, [data, mainMetric]);

  const comparisonSeries = useMemo(() => {
    if (!data?.series || !mainMetric || !compare) return undefined;
    const s = data.series[mainMetric.metric];
    if (!s?.length) return undefined;
    const hasPrev = s.some((p) => p.previousValue !== undefined);
    if (!hasPrev) return undefined;
    return s.map((p) => ({ date: p.date, value: p.previousValue ?? 0 }));
  }, [data, mainMetric, compare]);

  const breakdownData = useMemo(() => {
    if (!data?.breakdown?.byPlatform?.length) return [];
    return data.breakdown.byPlatform.map((b) => ({
      label: b.identifier,
      value: b.value,
    }));
  }, [data]);

  const channelBarData = useMemo(() => {
    if (!data?.byChannel?.length)
      return {
        labels: [] as string[],
        values: [] as number[],
        integrationIds: [] as string[],
      };
    return {
      labels: data.byChannel.map((c) => c.name),
      values: data.byChannel.map((c) => {
        if (!c.kpis?.length) return 0;
        return c.kpis[0]?.total || 0;
      }),
      integrationIds: data.byChannel.map((c) => c.integrationId),
    };
  }, [data]);

  if (loading) {
    return <TabSkeleton variant="cards" />;
  }

  if (error) {
    const fe = error as FetchError;
    return (
      <ErrorState
        title={t('analytics_load_failed', 'Failed to load analytics data')}
        message={fe.messageKey ? t(fe.messageKey, fe.message) : fe.message}
      />
    );
  }

  if (!data) {
    return (
      <EmptyState
        title={t('analytics_no_data_title', 'No data available yet')}
        description={t(
          'analytics_no_data_desc',
          'Analytics will appear once snapshots start accumulating.'
        )}
      />
    );
  }

  if (!data.kpis?.length && !data.byChannel?.length && !data.series) {
    return (
      <EmptyState
        title={t('analytics_no_channels_title', 'No channels connected')}
        description={t(
          'analytics_no_channels_desc',
          'Connect social media channels to see analytics.'
        )}
      />
    );
  }

  const hasBands = !!campaignBands?.length;

  return (
    <div className="space-y-[16px]">
      <AnomalyOverviewStrip />

      {/* 7.5 — "Explain this period" is only rendered when AI is configured. */}
      {aiActive === true && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={openNarrate}
            className="inline-flex items-center gap-[6px] px-[12px] py-[6px] text-[13px] font-medium rounded-[8px] bg-newTableHeader border border-newTableBorder text-newTableText hover:text-textColor hover:border-newTableText transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1" strokeLinecap="round" />
            </svg>
            {t('analytics_explain_period', 'Explain this period')}
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-[12px] mobile:gap-[8px]">
        {data.kpis.map((kpi, i) => (
          <StatTile
            key={kpi.metric}
            kpi={kpi}
            accent={CHART_PALETTE[i % CHART_PALETTE.length]}
            onClick={() => {
              onSelectMetric(kpi.metric);
            }}
          />
        ))}
      </div>

      {/* 6.2 — derived secondary metrics (engagement rate, reach/follower). */}
      <DerivedMetricTiles derived={data.derived} />

      <div className="bg-newTableHeader border border-newTableBorder rounded-[12px] p-[16px]">
        {hasBands && (
          <div className="flex justify-end mb-[8px]">
            <button
              type="button"
              onClick={() => setShowBands((v) => !v)}
              aria-pressed={showBands}
              className="inline-flex items-center gap-[6px] px-[10px] py-[5px] text-[12px] font-medium rounded-[8px] border border-newTableBorder text-newTableText hover:text-textColor transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60"
            >
              <span
                className={`inline-block w-[10px] h-[10px] rounded-[2px] ${
                  showBands ? 'bg-btnPrimary' : 'bg-newTableBorder'
                }`}
              />
              {t('analytics_campaign_bands', 'Campaign bands')}
            </button>
          </div>
        )}
        <div className="w-full aspect-[16/10] sm:aspect-[21/9] max-h-[360px]">
          <LineChart
            series={series}
            comparisonSeries={comparisonSeries}
            height={320}
            format={mainMetric?.format}
            onPointClick={(date) => onSelectDate?.(date)}
            campaignBands={showBands ? campaignBands : undefined}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[12px]">
        {breakdownData.length > 0 && (
          <div className="bg-newTableHeader border border-newTableBorder rounded-[12px] p-[16px]">
            <h3 className="text-[13px] font-medium text-newTableText mb-[12px]">
              {t('by_platform', 'By Platform')}
            </h3>
            <PieChart
              data={breakdownData}
              height={250}
              centerLabel={t('total', 'Total')}
              onSliceClick={(identifier) => {
                const integrationId = data?.byChannel?.find(
                  (c) => c.identifier === identifier
                )?.integrationId;
                if (integrationId) onSelectChannel?.(integrationId);
              }}
            />
          </div>
        )}
        {channelBarData.labels.length > 0 && (
          <div className="bg-newTableHeader border border-newTableBorder rounded-[12px] p-[16px]">
            <h3 className="text-[13px] font-medium text-newTableText mb-[12px]">
              {t('channel_comparison', 'Channel Comparison')}
            </h3>
            <div className="w-full aspect-[4/3] max-h-[260px]">
              <BarChart
                labels={channelBarData.labels}
                values={channelBarData.values}
                height={250}
                onBarClick={(index) => {
                  const integrationId = channelBarData.integrationIds[index];
                  if (integrationId) onSelectChannel?.(integrationId);
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* A chart point click sets focusDate + a defaulted metric; while the day
          drawer is open the metric panel stays closed so they don't stack. */}
      <MetricDetailPanel
        data={metricDrillData}
        open={!!selectedMetric && !selectedDate}
        onClose={() => {
          onSelectMetric('');
        }}
      />
      <DayDetailPanel
        data={dayDrillData}
        open={!!selectedDate}
        onClose={() => onSelectDate?.('')}
      />
    </div>
  );
};
