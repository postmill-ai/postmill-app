'use client';

import { FC, useMemo } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { OverviewResponse } from '../utils';
import { useChannelDetail } from '../hooks/useChannelDetail';
import { ChannelDetailPanel } from '../drill/channel.detail.panel';
import { TabSkeleton, EmptyState, ErrorState } from '../kit/states';
import { ChannelAvatar } from '../kit/channel-avatar';
import { DerivedMetricInline } from '../kit/derived-metrics';
import { RefreshButton } from '../kit/refresh-button';

interface ChannelsTabProps {
  data?: OverviewResponse;
  loading: boolean;
  error?: Error;
  focusIntegration?: string;
  from: string;
  to: string;
  compare: boolean;
  integrations: string[];
  channels: { integrationId: string; name: string; identifier: string; picture: string }[];
  onSelectChannel: (integrationId: string) => void;
}

export const ChannelsTab: FC<ChannelsTabProps> = ({
  data,
  loading,
  error,
  focusIntegration,
  from,
  to,
  compare,
  integrations,
  channels,
  onSelectChannel,
}) => {
  const t = useT();
  const { data: channelDetail } = useChannelDetail({
    integrationId: focusIntegration || '',
    from,
    to,
    compare,
  });

  const focusedChannel = useMemo(() => {
    if (!focusIntegration) return undefined;
    return channels.find(
      (c) => c.integrationId === focusIntegration
    );
  }, [focusIntegration, channels]);
  if (loading) {
    return <TabSkeleton variant="list" />;
  }

  if (error) {
    return <ErrorState title={t('channels_load_failed', 'Failed to load channel data')} />;
  }

  if (!data?.byChannel?.length) {
    return <EmptyState title={t('channels_no_data', 'No channel data available')} />;
  }

  return (
    <div className="space-y-[8px]">
      {data.byChannel.map((ch) => {
        const mainKpi = ch.kpis?.[0];
        return (
          <div
            key={ch.integrationId}
            className="w-full flex items-center gap-[12px] px-[16px] py-[12px] bg-newTableHeader border border-newTableBorder rounded-[10px] hover:border-newTableText transition-colors"
          >
            <button
              type="button"
              onClick={() => onSelectChannel(ch.integrationId)}
              aria-label={t('view_channel', 'View {{name}}', { name: ch.name })}
              className="flex-1 min-w-0 text-left flex items-center gap-[12px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60 rounded-[8px]"
            >
              <ChannelAvatar
                src={ch.picture}
                name={ch.name}
                identifier={ch.identifier}
                size={36}
              />
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-medium truncate">{ch.name}</div>
                <div className="text-[12px] text-newTableText">
                  {ch.identifier}
                </div>
              </div>
            </button>
            {mainKpi && (
              <div className="text-right">
                <div className="text-[16px] font-semibold tabular-nums">
                  {new Intl.NumberFormat().format(Math.round(mainKpi.total ?? 0))}
                </div>
                {mainKpi.percentageChange != null && mainKpi.percentageChange !== 0 && (
                  <div
                    className={`text-[12px] tabular-nums ${
                      mainKpi.percentageChange >= 0
                        ? 'text-[var(--positive,#32d583)]'
                        : 'text-[var(--negative,#f97066)]'
                    }`}
                  >
                    {mainKpi.percentageChange >= 0 ? '+' : ''}
                    {mainKpi.percentageChange.toFixed(1)}%
                  </div>
                )}
              </div>
            )}
            {/* 6.2 — derived secondary metrics for this channel (hidden when none). */}
            <DerivedMetricInline derived={ch.derived} />
            {/* 6.7 — on-demand refresh. */}
            <RefreshButton integrationId={ch.integrationId} />
          </div>
        );
      })}

      <ChannelDetailPanel
        channel={focusedChannel || { integrationId: '', name: '', identifier: '', picture: '' }}
        data={channelDetail}
        open={!!focusIntegration && !!focusedChannel}
        onClose={() => onSelectChannel('')}
        from={from}
        to={to}
        compare={compare}
      />
    </div>
  );
};
