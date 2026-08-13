'use client';

import { FC } from 'react';
import { useUsage } from '../hooks/useUsage';
import { useAiUsage } from '../hooks/useAiUsage';
import { EmptyState, TabSkeleton } from '@postmill-ai/frontend/components/analytics-v2/kit/states';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import {
  AiSpendByProvider,
  AiSpendTotals,
  PlanUsageSection,
  hasPlanUsage,
} from './usage.sections';

// The card summary. The full picture — including spend by scope — is the Usage
// tab in /analytics, which this card's "View all" opens.
export const UsageWidget: FC = () => {
  const t = useT();
  const { data: usage, isLoading: usageLoading } = useUsage();
  const { data: aiUsage, error: aiError, isLoading: aiLoading } = useAiUsage();

  if (usageLoading) return <TabSkeleton variant="list" />;

  const hasPlan = hasPlanUsage(usage);
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
          <PlanUsageSection usage={usage!} />
        </div>
      )}

      {hasAi && (
        <div className="flex flex-col gap-[10px]">
          <h4 className="text-[12px] font-medium text-newTableText uppercase tracking-wide">
            {t('ai_spend_label', 'AI spend')}
          </h4>
          <AiSpendTotals usage={aiUsage} />
          {!!aiUsage.byProvider?.length && (
            <div className="flex flex-col gap-[8px] mt-[4px]">
              <h5 className="text-[11px] font-medium text-newTableText uppercase tracking-wide">
                {t('spend_by_provider', 'Spend by Provider')}
              </h5>
              <AiSpendByProvider usage={aiUsage} />
            </div>
          )}
          {aiLoading && (
            <div className="h-[40px] bg-newTableHeader rounded-[8px] animate-pulse" />
          )}
        </div>
      )}
    </div>
  );
};
