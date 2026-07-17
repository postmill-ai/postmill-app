'use client';

import { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useHealth, HealthItem } from '../hooks/useHealth';
import { TabSkeleton, EmptyState, ErrorState } from '../kit/states';
import { ChannelAvatar } from '../kit/channel-avatar';
import { FetchError } from '../utils';

// Data-health panel (6.6, trust surface). Lists every integration with whether
// its provider exposes analytics, its last snapshot date, window coverage, and
// a stale flag. Channels on providers without analytics() are labeled "not
// supported by <provider>" — never shown as zeros — so "why is my number wrong"
// becomes self-service.

// Human-readable provider name for the unsupported label (capitalize the
// identifier; good enough for "not supported by <provider>").
function providerLabel(identifier: string): string {
  if (!identifier) return 'this provider';
  return identifier.charAt(0).toUpperCase() + identifier.slice(1);
}

const HealthRow: FC<{ item: HealthItem }> = ({ item }) => {
  const t = useT();
  const coveragePct = Math.round(item.coverage * 100);

  return (
    <div className="flex items-center gap-[12px] p-[16px] bg-newBgColorInner border border-newTableBorder rounded-[12px]">
      <ChannelAvatar
        src={item.picture || undefined}
        name={item.name}
        identifier={item.identifier}
        size={32}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-[8px]">
          <span className="text-[14px] font-medium text-textColor truncate">
            {item.name}
          </span>
          {item.supportsAnalytics && item.stale && (
            <span className="inline-flex items-center gap-[4px] text-[11px] font-semibold uppercase tracking-wide text-amber-600 border border-amber-600/40 rounded-full px-[6px] py-[1px]">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              </svg>
              {t('analytics_health_stale', 'Stale')}
            </span>
          )}
        </div>
        <div className="text-[12px] text-newTableText mt-[2px]">
          {!item.supportsAnalytics ? (
            <span>
              {t('analytics_health_unsupported', 'Analytics not supported by {{provider}}', {
                provider: providerLabel(item.identifier),
              })}
            </span>
          ) : item.lastSnapshotDate ? (
            <span
              className={item.stale ? 'text-amber-600' : undefined}
            >
              {t('analytics_health_last_snapshot', 'Last snapshot {{date}}', {
                date: item.lastSnapshotDate,
              })}
            </span>
          ) : (
            <span className="text-amber-600">
              {t('analytics_health_no_snapshot', 'No snapshot collected yet')}
            </span>
          )}
        </div>
      </div>

      {item.supportsAnalytics && (
        <div className="shrink-0 text-right">
          <div className="text-[16px] font-semibold tabular-nums text-textColor">
            {coveragePct}%
          </div>
          <div className="text-[11px] text-newTableText uppercase tracking-wide">
            {t('analytics_health_coverage', 'Coverage')}
          </div>
        </div>
      )}
    </div>
  );
};

export const HealthSection: FC = () => {
  const t = useT();
  const { data, isLoading, error, mutate } = useHealth();

  if (isLoading) {
    return <TabSkeleton variant="list" />;
  }

  if (error) {
    const fe = error as FetchError;
    return (
      <ErrorState
        title={t('analytics_health_error', 'Failed to load channel health')}
        message={fe.messageKey ? t(fe.messageKey, fe.message) : fe.message}
        onRetry={() => mutate()}
      />
    );
  }

  if (!data || data.length === 0) {
    return (
      <EmptyState
        title={t('analytics_health_empty_title', 'No channels connected')}
        description={t(
          'analytics_health_empty_desc',
          'Connect a channel to start collecting analytics snapshots.'
        )}
      />
    );
  }

  return (
    <div className="flex flex-col gap-[12px]">
      <p className="text-[12px] text-newTableText">
        {t(
          'analytics_health_intro',
          'Snapshot freshness and coverage per channel over the last 7 days. Channels on providers without analytics are labeled, not shown as zeros.'
        )}
      </p>
      <div className="flex flex-col gap-[10px]">
        {data.map((item) => (
          <HealthRow key={item.integrationId} item={item} />
        ))}
      </div>
    </div>
  );
};
