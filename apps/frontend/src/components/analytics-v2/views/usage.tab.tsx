'use client';

import { FC } from 'react';
import Link from 'next/link';
import { useUsage } from '@postmill-ai/frontend/components/dashboard/hooks/useUsage';
import { useAiUsage } from '@postmill-ai/frontend/components/dashboard/hooks/useAiUsage';
import {
  AiSpendByProvider,
  AiSpendByScope,
  AiSpendTotals,
  PlanUsageSection,
  hasPlanUsage,
} from '@postmill-ai/frontend/components/dashboard/widgets/usage.sections';
import { EmptyState, TabSkeleton } from '../kit/states';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

/**
 * The Usage tab — plan allowance and AI spend in one place.
 *
 * It is the only surface with both: `/billing` shows the plan you bought but no
 * usage, and AI spend previously existed nowhere outside a dashboard card. The
 * bars come from the shared usage sections so this tab and that card can't
 * disagree.
 *
 * Deliberately unaffected by the date filter above: a plan cycle and a billing
 * month are fixed periods, so re-scoping them to an arbitrary range would be a
 * different (and misleading) number.
 */
const Panel: FC<{
  title: string;
  action?: { href: string; label: string };
  children: React.ReactNode;
}> = ({ title, action, children }) => (
  <section className="flex flex-col gap-[14px] rounded-[12px] border border-newTableBorder bg-newBgColorInner p-[20px]">
    <div className="flex items-center justify-between gap-[10px]">
      <h3 className="text-[13px] font-[600] text-textColor">{title}</h3>
      {action && (
        <Link href={action.href} className="text-[12px] text-btnPrimary hover:underline">
          {action.label}
        </Link>
      )}
    </div>
    {children}
  </section>
);

export const UsageTab: FC = () => {
  const t = useT();
  const { data: usage, isLoading: usageLoading, error: usageError } = useUsage();
  const { data: aiUsage, error: aiError, isLoading: aiLoading } = useAiUsage();

  // `||`, not `&&`: when billing is off (or forbidden) the plan half settles
  // immediately, and `&&` would flash the "unavailable"/"billing access" empty
  // state while the AI half is still loading, then swap.
  if (usageLoading || aiLoading) return <TabSkeleton variant="list" />;

  const hasPlan = hasPlanUsage(usage);
  const hasAi = !aiError && !!aiUsage;

  if (!hasPlan && !hasAi) {
    return (
      <EmptyState
        title={t('usage_data_unavailable_title', 'Usage data unavailable')}
        description={
          usageError || aiError
            ? t(
                'usage_tab_forbidden_description',
                'Plan usage and AI spend need billing access. Ask an admin for it.'
              )
            : t(
                'usage_data_unavailable_description',
                'Plan usage and AI budget will appear here.'
              )
        }
      />
    );
  }

  return (
    // Both halves side by side; with only one (billing off, or no AI provider)
    // a two-column grid would leave half the page empty.
    <div
      className={
        hasPlan && hasAi
          ? 'grid grid-cols-1 lg:grid-cols-2 gap-[16px] items-start'
          : 'flex flex-col gap-[16px] max-w-[620px]'
      }
    >
      {hasPlan && (
        <Panel
          title={t('usage_tab_plan_title', 'Plan usage this cycle')}
          action={{ href: '/billing', label: t('usage_tab_manage_plan', 'Manage plan') }}
        >
          <PlanUsageSection usage={usage!} />
        </Panel>
      )}

      {hasAi && (
        <div className="flex flex-col gap-[16px]">
          <Panel
            title={t('usage_tab_ai_spend_title', 'AI spend')}
            action={{
              href: '/settings/ai/llm-providers',
              label: t('usage_tab_set_budget', 'Set budgets'),
            }}
          >
            <AiSpendTotals usage={aiUsage!} />
            <AiSpendByScope usage={aiUsage!} />
          </Panel>

          {!!aiUsage!.byProvider?.length && (
            <Panel title={t('spend_by_provider', 'Spend by Provider')}>
              <AiSpendByProvider usage={aiUsage!} />
            </Panel>
          )}
        </div>
      )}
    </div>
  );
};
