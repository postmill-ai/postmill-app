'use client';

import { FC } from 'react';
import Link from 'next/link';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useAnomalies, AnomalyRow } from '../hooks/useAnomalies';
import { TabSkeleton, EmptyState, ErrorState } from '../kit/states';
import { ChannelAvatar } from '../kit/channel-avatar';
import { CANONICAL_METRICS, formatCompactNumber, FetchError } from '../utils';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { AlertRulesModal } from './alert-rules.modal';

// Anomaly Alerts surface (4.8). Renders the org's undismissed spike/drop
// anomalies with a per-row dismiss and — when present — a root-cause post link
// (4.9). Mounted as the third Insights section (see insights.tab.tsx).

function metricLabel(
  metric: string,
  translate: (key: string, fallback: string) => string
): string {
  const found = CANONICAL_METRICS.find((m) => m.key === metric);
  return found ? translate(found.labelKey, found.label) : metric;
}

// Deep-link matching the notification bell's format (4.5): jump to Insights with
// the offending channel + metric pre-filtered.
function bellLink(a: AnomalyRow): string {
  return `/analytics?tab=insights&integrations=${a.integrationId}&metric=${a.metric}`;
}

const AlertCard: FC<{ anomaly: AnomalyRow; onDismiss: (id: string) => void }> = ({
  anomaly,
  onDismiss,
}) => {
  const t = useT();
  const isSpike = anomaly.direction === 'spike';
  // Token colours only — spike = positive token, drop = amber-600 (repo
  // light-mode warning rule); no raw tailwind palette classes.
  const dirColor = isSpike ? 'text-[var(--positive,#32d583)]' : 'text-amber-600';
  const dirLabel = isSpike
    ? t('analytics_alert_spike', 'Spike')
    : t('analytics_alert_drop', 'Drop');
  const deviationPct = `${anomaly.deviation >= 0 ? '+' : ''}${Math.round(
    anomaly.deviation * 100
  )}%`;

  return (
    <div className="bg-newBgColorInner rounded-[12px] border border-newTableBorder p-[16px] flex flex-col gap-[12px]">
      <div className="flex items-start justify-between gap-[12px]">
        <div className="flex items-center gap-[10px] min-w-0">
          <ChannelAvatar
            src={anomaly.integration.picture || undefined}
            name={anomaly.integration.name}
            identifier={anomaly.integration.providerIdentifier}
            size={32}
          />
          <div className="min-w-0">
            <span className="flex items-center gap-[6px]">
              <span
                className={`text-[11px] font-semibold uppercase tracking-wide ${dirColor}`}
              >
                {dirLabel}
              </span>
              {anomaly.ruleId && (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-btnPrimary border border-btnPrimary rounded-full px-[6px] py-[1px]">
                  {t('analytics_alert_rule_badge', 'Rule')}
                </span>
              )}
            </span>
            <div className="text-[14px] font-medium text-textColor truncate">
              {anomaly.integration.name}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onDismiss(anomaly.id)}
          aria-label={t('analytics_alert_dismiss', 'Dismiss alert')}
          className="shrink-0 text-newTableText hover:text-textColor transition-colors rounded-[6px] p-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-[16px] gap-y-[4px]">
        <div>
          <div className="text-[11px] text-newTableText uppercase tracking-wide">
            {metricLabel(anomaly.metric, t)}
          </div>
          <div className="text-[20px] font-semibold tabular-nums text-textColor">
            {formatCompactNumber(anomaly.value)}
          </div>
        </div>
        <div className="text-[12px] text-newTableText">
          {t('analytics_alert_vs_baseline', 'vs {{baseline}} avg', {
            baseline: formatCompactNumber(anomaly.baseline),
          })}
        </div>
        <div className={`text-[13px] font-semibold tabular-nums ${dirColor}`}>
          {deviationPct}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-[12px]">
        <Link
          href={bellLink(anomaly)}
          className="text-[13px] font-medium text-btnPrimary hover:opacity-80 transition-opacity"
        >
          {t('analytics_alert_view_metric', 'View metric')}
        </Link>
        {anomaly.topPostId && (
          <Link
            href={`/analytics?focusPost=${anomaly.topPostId}&metric=${anomaly.metric}`}
            className="text-[13px] font-medium text-newTableText hover:text-textColor transition-colors"
          >
            {t('analytics_alert_view_post', 'View top post')}
          </Link>
        )}
      </div>
    </div>
  );
};

export const AlertsSection: FC = () => {
  const t = useT();
  const modal = useModals();
  const { data, isLoading, error, dismiss, mutate } = useAnomalies();

  // 7.3 — the "Manage rules" modal (user-defined alert rules) is always
  // reachable, independent of whether any anomalies currently exist.
  const openRules = () => {
    modal.openModal({
      title: t('analytics_manage_rules', 'Manage alert rules'),
      withCloseButton: true,
      children: <AlertRulesModal />,
    });
  };

  const alerts = data || [];

  const body = (() => {
    if (isLoading) return <TabSkeleton variant="list" />;
    if (error) {
      const fe = error as FetchError;
      return (
        <ErrorState
          title={t('analytics_alerts_error', 'Failed to load alerts')}
          message={fe.messageKey ? t(fe.messageKey, fe.message) : fe.message}
          onRetry={() => mutate()}
        />
      );
    }
    if (alerts.length === 0) {
      return (
        <EmptyState
          title={t('analytics_alerts_empty_title', 'No alerts')}
          description={t(
            'analytics_alerts_empty_desc',
            'Anomaly alerts for spikes and drops will appear here.'
          )}
        />
      );
    }
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-[12px]">
        {alerts.map((a) => (
          <AlertCard key={a.id} anomaly={a} onDismiss={dismiss} />
        ))}
      </div>
    );
  })();

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={openRules}
          className="inline-flex items-center gap-[6px] px-[12px] py-[6px] text-[13px] font-medium rounded-[8px] bg-newTableHeader border border-newTableBorder text-newTableText hover:text-textColor hover:border-newTableText transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          {t('analytics_manage_rules', 'Manage alert rules')}
        </button>
      </div>
      {body}
    </div>
  );
};

// Compact, unobtrusive strip for the Overview tab (4.8): shows when undismissed
// anomalies exist and deep-links into Insights → Alerts. Hidden when none.
export const AnomalyOverviewStrip: FC = () => {
  const t = useT();
  const { data } = useAnomalies();
  const count = (data || []).filter((a) => !a.dismissedAt).length;

  if (!count) return null;

  return (
    <Link
      href="/analytics?tab=insights&section=alerts"
      className="flex items-center gap-[8px] px-[14px] py-[10px] rounded-[10px] bg-newTableHeader border border-newTableBorder text-[13px] text-textColor hover:border-amber-600/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-600 shrink-0">
        <path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="font-medium">
        {t('analytics_alert_strip', '{{count}} anomaly alert(s) detected', { count })}
      </span>
      <span className="text-newTableText ml-auto">
        {t('analytics_alert_strip_cta', 'Review')}
      </span>
    </Link>
  );
};
