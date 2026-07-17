'use client';

import { FC, useMemo } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { PublicAnalyticsReport } from '../hooks/usePublicAnalyticsReport';
import { StatTile } from '../kit/stat-tile';
import { LineChart } from '../charts/line.chart';
import { ChannelAvatar } from '../kit/channel-avatar';
import { CHART_PALETTE } from '../kit/palette';
import { KPI } from '../utils';

// Read-only public org analytics report (7.6). Reuses the kit charts/tiles the
// authed dashboard uses; no auth cookies, no drill interactions, no ids.
export const PublicAnalyticsReportView: FC<{ report: PublicAnalyticsReport }> = ({
  report,
}) => {
  const t = useT();

  const mainMetric = report.kpis?.[0];
  const series = useMemo(() => {
    if (!mainMetric) return [];
    return report.series?.[mainMetric.metric] || [];
  }, [report.series, mainMetric]);

  return (
    <div className="min-h-screen bg-newBgColor text-textColor">
      <div className="max-w-[1000px] mx-auto px-[24px] py-[32px] mobile:px-[16px] flex flex-col gap-[20px]">
        <div className="flex items-baseline justify-between gap-[12px] flex-wrap">
          <h1 className="text-[22px] font-semibold">
            {t('public_analytics_title', 'Analytics report')}
          </h1>
          <span className="text-[13px] text-newTableText">
            {report.range?.from} → {report.range?.to}
          </span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-[12px] mobile:gap-[8px]">
          {(report.kpis || []).map((kpi, i) => (
            <StatTile
              key={kpi.metric}
              kpi={kpi as KPI}
              accent={CHART_PALETTE[i % CHART_PALETTE.length]}
            />
          ))}
        </div>

        {series.length > 0 && (
          <div className="bg-newTableHeader border border-newTableBorder rounded-[12px] p-[16px]">
            <div className="w-full aspect-[16/10] sm:aspect-[21/9] max-h-[360px]">
              <LineChart series={series} height={320} format={mainMetric?.format} />
            </div>
          </div>
        )}

        {(report.byChannel || []).length > 0 && (
          <div className="flex flex-col gap-[8px]">
            <h2 className="text-[14px] font-medium text-newTableText">
              {t('public_analytics_channels', 'By channel')}
            </h2>
            {report.byChannel.map((ch) => (
              <div
                key={`${ch.identifier}-${ch.name}`}
                className="flex items-center gap-[12px] px-[16px] py-[12px] bg-newBgColorInner border border-newTableBorder rounded-[10px]"
              >
                <ChannelAvatar name={ch.name} identifier={ch.identifier} size={32} />
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium truncate">{ch.name}</div>
                  <div className="text-[12px] text-newTableText">{ch.identifier}</div>
                </div>
                {ch.kpis?.[0] && (
                  <div className="text-right">
                    <div className="text-[16px] font-semibold tabular-nums">
                      {new Intl.NumberFormat().format(Math.round(ch.kpis[0].total ?? 0))}
                    </div>
                    <div className="text-[11px] text-newTableText">{ch.kpis[0].label}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
