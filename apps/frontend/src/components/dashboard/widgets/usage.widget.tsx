'use client';

import { FC } from 'react';
import { useUsage } from '../hooks/useUsage';
import { useAiUsage } from '../hooks/useAiUsage';
import { EmptyState, TabSkeleton } from '@gitroom/frontend/components/analytics-v2/kit/states';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface UsageBarProps {
  label: string;
  used: number;
  limit: number | boolean;
}

const UsageBar: FC<UsageBarProps> = ({ label, used, limit }) => {
  const numericLimit = typeof limit === 'number' ? limit : 0;
  const pct = numericLimit > 0 ? Math.min(100, (used / numericLimit) * 100) : 0;
  const color =
    pct >= 100 ? 'bg-[var(--negative,#f97066)]' : pct >= 80 ? 'bg-amber-500' : 'bg-btnPrimary';

  return (
    <div className="flex flex-col gap-[4px]">
      <div className="flex justify-between text-[12px]">
        <span className="text-textColor">{label}</span>
        <span className="text-newTableText">
          {used.toLocaleString()}
          {numericLimit > 0 ? ` / ${numericLimit.toLocaleString()}` : ''}
        </span>
      </div>
      {numericLimit > 0 && (
        <div className="h-[6px] w-full rounded-full bg-newTableBorder overflow-hidden">
          <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
};

export const UsageWidget: FC = () => {
  const t = useT();
  const { data: usage, isLoading: usageLoading } = useUsage();
  const { data: aiUsage, error: aiError, isLoading: aiLoading } = useAiUsage();

  if (usageLoading) return <TabSkeleton variant="list" />;

  const hasPlan = usage?.billingEnabled && usage.limits && usage.usage;
  const planLimits = hasPlan ? usage.limits : null;
  const planUsageData = hasPlan ? usage.usage : null;
  const hasAi = !aiError && aiUsage;

  if (!hasPlan && !hasAi) {
    return (
      <EmptyState
        title={t('usage_data_unavailable_title', 'Usage data unavailable')}
        description={t(
          'usage_data_unavailable_description',
          'Plan usage and AI budget will appear here.'
        )}
      />
    );
  }

  return (
    <div className="flex flex-col gap-[16px]">
      {hasPlan && (
        <div className="flex flex-col gap-[10px]">
          <h4 className="text-[12px] font-medium text-newTableText uppercase tracking-wide">
            {t('plan_label', 'Plan')}
          </h4>
          <UsageBar
            label={t('posts', 'Posts')}
            used={planUsageData!.postsThisCycle}
            limit={planLimits!.postsPerMonth}
          />
          <UsageBar
            label={t('channels', 'Channels')}
            used={planUsageData!.channels}
            limit={planLimits!.channels}
          />
          <UsageBar
            label={t('team', 'Team')}
            used={planUsageData!.teamMembers}
            limit={planLimits!.teamMembers}
          />
        </div>
      )}

      {hasAi && (
        <div className="flex flex-col gap-[10px]">
          <h4 className="text-[12px] font-medium text-newTableText uppercase tracking-wide">
            {t('ai_spend_label', 'AI spend')}
          </h4>
          <div className="grid grid-cols-2 gap-[12px]">
            <div className="p-[10px] rounded-[8px] bg-newTableHeader">
              <div className="text-[11px] text-newTableText">
                {t('monthly_label', 'Monthly')}
              </div>
              <div className="text-[16px] font-semibold text-textColor">
                ${aiUsage.monthlySpendUsd.toFixed(2)}
              </div>
              {aiUsage.budget?.monthlyCap != null && (
                <div className="text-[11px] text-newTableText">
                  ${aiUsage.budget.remainingMonthly?.toFixed(2)} {t('left_suffix', 'left')}
                </div>
              )}
            </div>
            <div className="p-[10px] rounded-[8px] bg-newTableHeader">
              <div className="text-[11px] text-newTableText">{t('daily', 'Daily')}</div>
              <div className="text-[16px] font-semibold text-textColor">
                ${aiUsage.dailySpendUsd.toFixed(2)}
              </div>
              {aiUsage.budget?.dailyCap != null && (
                <div className="text-[11px] text-newTableText">
                  ${aiUsage.budget.remainingDaily?.toFixed(2)} {t('left_suffix', 'left')}
                </div>
              )}
            </div>
          </div>
          {aiLoading && (
            <div className="h-[40px] bg-newTableHeader rounded-[8px] animate-pulse" />
          )}
        </div>
      )}
    </div>
  );
};
