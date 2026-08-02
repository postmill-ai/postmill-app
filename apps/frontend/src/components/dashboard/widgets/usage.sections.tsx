'use client';

import { FC } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import type { UsageResponse } from '../hooks/useUsage';
import type { AiUsageResponse } from '../hooks/useAiUsage';

/**
 * The two halves of "usage": what the plan allows, and what AI has cost.
 *
 * Both the dashboard widget and the analytics Usage tab render these — the
 * widget stacked in a narrow card, the tab in two columns. Keeping the bars
 * here is what stops the two surfaces from drifting apart, which is how the
 * third (now-deleted) copy in settings came to disagree with both.
 */

interface UsageBarProps {
  label: string;
  used: number;
  limit: number | boolean;
  /** Spend is dollars; plan usage is whole units. */
  money?: boolean;
}

export const UsageBar: FC<UsageBarProps> = ({ label, used, limit, money }) => {
  // 1000000 is the pricing.ts "effectively unlimited" sentinel — show usage
  // without the literal " / 1,000,000" (same as a zero/false cap).
  const numericLimit = typeof limit === 'number' && limit < 1000000 ? limit : 0;
  const pct = numericLimit > 0 ? Math.min(100, (used / numericLimit) * 100) : 0;
  const color =
    pct >= 100 ? 'bg-[var(--negative,#f97066)]' : pct >= 80 ? 'bg-amber-500' : 'bg-btnPrimary';
  const fmt = (value: number) => (money ? `$${value.toFixed(2)}` : value.toLocaleString());

  return (
    <div className="flex flex-col gap-[4px]">
      <div className="flex justify-between text-[12px]">
        <span className="text-textColor">{label}</span>
        <span className="text-newTableText">
          {fmt(used)}
          {numericLimit > 0 ? ` / ${fmt(numericLimit)}` : ''}
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

/** True when `/dashboard/usage` came back with a plan to report on. */
export const hasPlanUsage = (usage: UsageResponse | undefined) =>
  !!(usage?.billingEnabled && usage.limits && usage.usage);

export const PlanUsageSection: FC<{ usage: UsageResponse }> = ({ usage }) => {
  const t = useT();
  const limits = usage.limits!;
  const used = usage.usage!;

  return (
    <div className="flex flex-col gap-[10px]">
      <UsageBar label={t('posts', 'Posts')} used={used.postsThisCycle} limit={limits.postsPerMonth} />
      <UsageBar label={t('channels', 'Channels')} used={used.channels} limit={limits.channels} />
      <UsageBar label={t('team', 'Team')} used={used.teamMembers} limit={limits.teamMembers} />
      <UsageBar
        label={t('competitors', 'Competitors')}
        used={used.competitors}
        limit={limits.competitors}
      />
      <UsageBar label={t('webhooks', 'Webhooks')} used={used.webhooks} limit={limits.webhooks} />
      <UsageBar
        label={t('brand_kits', 'Brand kits')}
        used={used.brandKits}
        limit={limits.brandKits}
      />
    </div>
  );
};

/** Monthly and daily spend against their caps. */
export const AiSpendTotals: FC<{ usage: AiUsageResponse }> = ({ usage }) => {
  const t = useT();

  return (
    <div className="grid grid-cols-2 gap-[12px]">
      <div className="p-[10px] rounded-[8px] bg-newTableHeader">
        <div className="text-[11px] text-newTableText">{t('monthly_label', 'Monthly')}</div>
        <div className="text-[16px] font-semibold text-textColor">
          ${usage.monthlySpendUsd.toFixed(2)}
        </div>
        {usage.budget?.monthlyCap != null && (
          <div className="text-[11px] text-newTableText">
            ${usage.budget.remainingMonthly?.toFixed(2)} {t('left_suffix', 'left')}
          </div>
        )}
      </div>
      <div className="p-[10px] rounded-[8px] bg-newTableHeader">
        <div className="text-[11px] text-newTableText">{t('daily', 'Daily')}</div>
        <div className="text-[16px] font-semibold text-textColor">
          ${usage.dailySpendUsd.toFixed(2)}
        </div>
        {usage.budget?.dailyCap != null && (
          <div className="text-[11px] text-newTableText">
            ${usage.budget.remainingDaily?.toFixed(2)} {t('left_suffix', 'left')}
          </div>
        )}
      </div>
    </div>
  );
};

/** Caller supplies the heading — the widget labels it, the tab's panel title does. */
export const AiSpendByProvider: FC<{ usage: AiUsageResponse }> = ({ usage }) => {
  const t = useT();
  if (!usage.byProvider?.length) return null;

  return (
    <div className="flex flex-col gap-[8px]">
      {usage.byProvider.map((provider) => (
        <div key={provider.provider} className="flex flex-col gap-[6px]">
          <div className="text-[12px] font-medium capitalize text-textColor">
            {provider.provider}
          </div>
          <UsageBar
            label={t('ai_budget_monthly_cap', 'Monthly cap')}
            used={provider.monthlySpendUsd}
            limit={provider.monthlyCap ?? false}
            money
          />
          <UsageBar
            label={t('ai_budget_daily_cap', 'Daily cap')}
            used={provider.dailySpendUsd}
            limit={provider.dailyCap ?? false}
            money
          />
        </div>
      ))}
    </div>
  );
};

/**
 * Which AI surface spent the money. Only the Usage tab shows this — it answers
 * "why is the bill this size", which is a question you ask when you've come
 * looking, not something to squeeze into a dashboard card.
 */
export const AiSpendByScope: FC<{ usage: AiUsageResponse }> = ({ usage }) => {
  const t = useT();
  const scopeLabels: Record<string, string> = {
    utility: t('utility', 'Utility'),
    generator: t('generator', 'Generator'),
    agent: t('agent', 'Agent'),
    mcp: t('mcp', 'MCP'),
    media: t('media', 'Media'),
  };
  const rows = usage.byScope ?? [];
  const max = rows.reduce((m, s) => Math.max(m, s._sum?.costUsd || 0), 0);

  return (
    <div className="flex flex-col gap-[10px]">
      <h5 className="text-[11px] font-medium text-newTableText uppercase tracking-wide">
        {t('spend_by_scope', 'Spend by Scope')}
      </h5>
      {rows.length === 0 ? (
        <div className="text-[12px] text-newTableText">
          {t('no_spend_data', 'No spend data yet')}
        </div>
      ) : (
        rows.map((scope) => {
          const cost = scope._sum?.costUsd || 0;
          return (
            <div key={scope.scope} className="flex items-center gap-[12px]">
              <div className="w-[80px] text-[12px] text-textColor shrink-0">
                {scopeLabels[scope.scope] || scope.scope}
              </div>
              <div className="flex-1 h-[8px] bg-newTableBorder rounded-full overflow-hidden">
                <div
                  className="h-full bg-btnPrimary rounded-full transition-all"
                  style={{ width: `${max > 0 ? (cost / max) * 100 : 0}%` }}
                />
              </div>
              <div className="w-[72px] text-[12px] text-newTableText text-end shrink-0">
                ${cost.toFixed(2)}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};
