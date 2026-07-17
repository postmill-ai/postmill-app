'use client';

import { FC, useCallback, useState } from 'react';
import { ChannelDetailResponse, SeriesPoint } from '../utils';
import { AreaChart } from '../charts/area.chart';
import { useChannelMetric } from '../hooks/useChannelMetric';
import { CHART_PALETTE } from '../kit/palette';
import { Drawer } from '../kit/drawer';
import { ChannelAvatar } from '../kit/channel-avatar';
import { RefreshButton } from '../kit/refresh-button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface ChannelDetailPanelProps {
  channel: {
    integrationId: string;
    name: string;
    identifier: string;
    picture: string;
  };
  data?: ChannelDetailResponse;
  open: boolean;
  onClose: () => void;
  from: string;
  to: string;
  compare: boolean;
}

export const ChannelDetailPanel: FC<ChannelDetailPanelProps> = ({
  channel,
  data,
  open,
  onClose,
  from,
  to,
  compare,
}) => {
  const t = useT();
  const [drillMetric, setDrillMetric] = useState<string | null>(null);

  const { data: metricData, isLoading: metricLoading } = useChannelMetric({
    integrationId: drillMetric ? channel.integrationId : '',
    metric: drillMetric || '',
    from,
    to,
    compare,
  });

  // Close always resets the inner drill so the next open starts at the KPI list.
  const handleClose = useCallback(() => {
    setDrillMetric(null);
    onClose();
  }, [onClose]);

  // Esc closes the inner metric drill first, then the whole drawer.
  const handleEscape = useCallback(() => {
    if (drillMetric) setDrillMetric(null);
    else handleClose();
  }, [drillMetric, handleClose]);

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      onEscape={handleEscape}
      ariaLabel={channel.name}
    >
        <div className="sticky top-0 bg-newBgColorInner border-b border-newTableBorder px-[20px] py-[14px] flex items-center justify-between z-10">
          <div className="flex items-center gap-[10px]">
            <ChannelAvatar
              src={channel.picture}
              name={channel.name}
              identifier={channel.identifier}
              size={28}
            />
            <div>
              <h3 className="text-[16px] font-semibold">{channel.name}</h3>
              <p className="text-[11px] text-newTableText">
                {channel.identifier}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-[4px] shrink-0">
            {channel.integrationId && (
              <RefreshButton integrationId={channel.integrationId} />
            )}
            <button
              onClick={onClose}
              className="p-[6px] hover:bg-boxHover rounded-[6px] transition-colors shrink-0"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
              >
                <path
                  d="M4 4L12 12M12 4L4 12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-[20px] space-y-[20px]">
          {!data && (
            <div className="animate-pulse space-y-[12px]">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-[160px] bg-newTableHeader rounded-[10px]"
                />
              ))}
            </div>
          )}

          {drillMetric && metricData ? (
            <div>
              <button
                onClick={() => setDrillMetric(null)}
                className="flex items-center gap-[6px] text-[13px] text-newTableText hover:text-newTableText transition-colors mb-[16px]"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                >
                  <path
                    d="M10 4L5 8L10 12"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {t('back_to_channel', 'Back to {{name}}', { name: channel.name })}
              </button>

              <div className="bg-newTableHeader border border-newTableBorder rounded-[10px] p-[14px] mb-[16px]">
                <span className="text-[13px] font-medium text-newTableText uppercase tracking-wide">
                  {metricData.label}
                </span>
                <div className="flex items-center justify-between mt-[4px]">
                  <div className="text-[28px] font-semibold tabular-nums">
                    {(() => {
                      if (metricData.format === 'percent')
                        return metricData.total.toFixed(1) + '%';
                      if (metricData.format === 'currency')
                        return new Intl.NumberFormat('en-US', {
                          style: 'currency',
                          currency: 'USD',
                          minimumFractionDigits: 0,
                        }).format(Math.round(metricData.total));
                      return new Intl.NumberFormat().format(
                        Math.round(metricData.total)
                      );
                    })()}
                  </div>
                  {metricData.percentageChange !== 0 && (
                    <div
                      className={`flex items-center gap-[4px] text-[12px] font-medium ${
                        metricData.percentageChange >= 0
                          ? 'text-[var(--positive,#32d583)]'
                          : 'text-[var(--negative,#f97066)]'
                      }`}
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 12 12"
                        fill="none"
                        className={
                          metricData.percentageChange >= 0
                            ? ''
                            : 'rotate-180'
                        }
                      >
                        <path
                          d="M6 2.5L10 7.5H2L6 2.5Z"
                          fill="currentColor"
                        />
                      </svg>
                      <span className="tabular-nums">
                        {Math.abs(
                          metricData.percentageChange
                        ).toFixed(1)}
                        {metricData.format === 'percent'
                          ? 'pp'
                          : '%'}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {metricData.series && metricData.series.length > 1 && (
                <div className="bg-newTableHeader border border-newTableBorder rounded-[10px] p-[14px] mb-[16px]">
                  <h4 className="text-[13px] font-medium text-newTableText mb-[8px]">
                    {t('time_series', 'Time Series')}
                  </h4>
                  <div className="h-[200px]">
                    <AreaChart
                      data={metricData.series}
                      color={CHART_PALETTE[0]}
                      height={200}
                      format={
                        metricData.format === 'percent'
                          ? 'percent'
                          : 'number'
                      }
                    />
                  </div>
                </div>
              )}

              {metricData.topPosts &&
                metricData.topPosts.length > 0 && (
                  <div className="bg-newTableHeader border border-newTableBorder rounded-[10px] p-[14px] mb-[16px]">
                    <h4 className="text-[13px] font-medium text-newTableText mb-[8px]">
                      {t('top_posts', 'Top Posts')}
                    </h4>
                    <div className="space-y-[6px]">
                      {metricData.topPosts
                        .slice(0, 5)
                        .map((post) => (
                          <div
                            key={post.postId}
                            className="px-[12px] py-[8px] bg-newBgColorInner rounded-[8px]"
                          >
                            <div className="text-[13px] truncate">
                              {post.content}
                            </div>
                            <div className="text-[11px] text-newTableText mt-[4px]">
                              {post.integration.name}
                              {' · '}
                              {new Intl.NumberFormat().format(
                                Math.round(
                                  post.metrics[
                                    metricData.metric
                                  ] || 0
                                )
                              )}{' '}
                              {metricData.label}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

              {metricData.byDay &&
                metricData.byDay.length > 0 && (
                  <div className="bg-newTableHeader border border-newTableBorder rounded-[10px] p-[14px]">
                    <h4 className="text-[13px] font-medium text-newTableText mb-[8px]">
                      {t('by_day', 'By Day')}
                    </h4>
                    <div className="max-h-[300px] overflow-y-auto space-y-[4px]">
                      {metricData.byDay.map((day) => (
                        <div
                          key={day.date}
                          className="flex items-center justify-between px-[8px] py-[6px] bg-newBgColorInner rounded-[6px]"
                        >
                          <span className="text-[12px] text-newTableText">
                            {day.date}
                          </span>
                          <span className="text-[13px] font-medium tabular-nums">
                            {new Intl.NumberFormat().format(
                              Math.round(day.value)
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
            </div>
          ) : (
            data?.kpis?.map((kpi, i) => {
              const displayValue = (() => {
                if (kpi.format === 'percent')
                  return kpi.total.toFixed(1) + '%';
                if (kpi.format === 'currency')
                  return new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: 'USD',
                    minimumFractionDigits: 0,
                  }).format(Math.round(kpi.total));
                return new Intl.NumberFormat().format(
                  Math.round(kpi.total)
                );
              })();

              const series: SeriesPoint[] =
                (data.series?.[kpi.metric] as SeriesPoint[]) || [];
              const isPositive = kpi.percentageChange >= 0;

              return (
                <div
                  key={kpi.metric}
                  role="button"
                  tabIndex={0}
                  aria-label={t('view_metric_details', 'View {{label}} details', {
                    label: kpi.label,
                  })}
                  onClick={() => setDrillMetric(kpi.metric)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setDrillMetric(kpi.metric);
                    }
                  }}
                  className="bg-newTableHeader border border-newTableBorder rounded-[10px] p-[14px] cursor-pointer hover:border-newTableText transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60"
                >
                  <div className="flex items-center justify-between mb-[8px]">
                    <span className="text-[13px] font-medium text-newTableText uppercase tracking-wide">
                      {kpi.label}
                    </span>
                    {kpi.percentageChange !== 0 && (
                      <div
                        className={`flex items-center gap-[4px] text-[12px] font-medium ${
                          isPositive
                            ? 'text-[var(--positive,#32d583)]'
                            : 'text-[var(--negative,#f97066)]'
                        }`}
                      >
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 12 12"
                          fill="none"
                          className={isPositive ? '' : 'rotate-180'}
                        >
                          <path
                            d="M6 2.5L10 7.5H2L6 2.5Z"
                            fill="currentColor"
                          />
                        </svg>
                        <span className="tabular-nums">
                          {Math.abs(kpi.percentageChange).toFixed(1)}
                          {kpi.format === 'percent' ? 'pp' : '%'}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="text-[28px] font-semibold tabular-nums mb-[8px]">
                    {displayValue}
                  </div>
                  {series.length > 1 && (
                    <div className="h-[100px]">
                      <AreaChart
                        data={series}
                        color={CHART_PALETTE[i % CHART_PALETTE.length]}
                        height={100}
                        format={
                          kpi.format === 'percent' ? 'percent' : 'number'
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}

          {drillMetric && !metricData && metricLoading && (
            <div className="animate-pulse space-y-[12px]">
              <div className="h-[24px] bg-newTableHeader rounded-[6px] w-[120px]" />
              <div className="h-[100px] bg-newTableHeader rounded-[10px]" />
              <div className="h-[200px] bg-newTableHeader rounded-[10px]" />
              <div className="h-[160px] bg-newTableHeader rounded-[10px]" />
            </div>
          )}

          {data?.topPosts && data.topPosts.length > 0 && (
            <div>
              <h4 className="text-[13px] font-medium text-newTableText mb-[8px]">
                {t('top_posts', 'Top Posts')}
              </h4>
              <div className="space-y-[6px]">
                {data.topPosts.slice(0, 5).map((post) => (
                  <div
                    key={post.postId}
                    className="px-[12px] py-[8px] bg-newTableHeader rounded-[8px]"
                  >
                    <div className="text-[13px] truncate">
                      {post.content}
                    </div>
                    <div className="text-[11px] text-newTableText mt-[4px]">
                      {post.integration.name}
                      {data.kpis[0] && (
                        <>
                          {' · '}
                          {new Intl.NumberFormat().format(
                            Math.round(
                              post.metrics[data.kpis[0].metric] || 0
                            )
                          )}{' '}
                          {data.kpis[0].label}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
    </Drawer>
  );
};
