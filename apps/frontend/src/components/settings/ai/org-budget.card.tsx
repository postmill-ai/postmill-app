'use client';

import React, { useCallback, useEffect, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { createFetchError } from '@postmill-ai/frontend/components/settings/shared/fetch-error';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { Button } from '@postmill-ai/react/form/button';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { usePermissions } from '@postmill-ai/frontend/components/layout/use-permissions';
import {
  BudgetLimitsFields,
  BudgetLimitsValue,
  parseOptionalNumber,
} from '@postmill-ai/frontend/components/settings/shared/kit/fields/budget-limits.fields';

export interface OrgAiBudget {
  monthlyCap: number | null;
  dailyCap: number | null;
  /** 0–1 fraction; null = default. */
  alertThresholdPct: number | null;
}

const useOrgAiBudget = () => {
  const fetch = useFetch();
  const load = useCallback(async (): Promise<OrgAiBudget> => {
    const res = await fetch('/settings/ai/budget');
    if (!res.ok) throw createFetchError('ai_org_budget_load_failed', 'Failed to load organization budget');
    return res.json();
  }, [fetch]);
  return useSWR<OrgAiBudget>('/settings/ai/budget', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};

const toFormValue = (budget: OrgAiBudget | undefined): BudgetLimitsValue => ({
  enabled:
    !!budget &&
    (budget.monthlyCap != null || budget.dailyCap != null || budget.alertThresholdPct != null),
  monthlyCap: budget?.monthlyCap != null ? String(budget.monthlyCap) : '',
  dailyCap: budget?.dailyCap != null ? String(budget.dailyCap) : '',
  thresholdPct:
    budget?.alertThresholdPct != null ? String(Math.round(budget.alertThresholdPct * 100)) : '',
});

/** Form → PUT body. Toggle off ⇒ every cap null; enabled-but-empty ⇒ null; slider % ⇒ 0–1. */
export const toBudgetBody = (value: BudgetLimitsValue) => {
  if (!value.enabled) return { monthlyCap: null, dailyCap: null, alertThresholdPct: null };
  const threshold = parseOptionalNumber(value.thresholdPct);
  return {
    monthlyCap: parseOptionalNumber(value.monthlyCap) ?? null,
    dailyCap: parseOptionalNumber(value.dailyCap) ?? null,
    alertThresholdPct: threshold != null ? threshold / 100 : null,
  };
};

/**
 * Org-wide AI budget: a hard ceiling on total spend across every provider,
 * enforced independently of the per-provider caps configured below it.
 */
export const OrgBudgetCard: React.FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const permissions = usePermissions();
  const { mutate: mutateGlobal } = useSWRConfig();
  const { data, isLoading, mutate } = useOrgAiBudget();
  const [value, setValue] = useState<BudgetLimitsValue>(() => toFormValue(undefined));
  const [saving, setSaving] = useState(false);

  // Seed the form once the resource arrives (and re-seed after a save/revalidate).
  useEffect(() => {
    if (data) setValue(toFormValue(data));
  }, [data]);

  // Render optimistically; only lock once permissions have resolved to "no".
  const readOnly = permissions.isResolved && !permissions.hasPermission('settings', 'update');

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch('/settings/ai/budget', {
        method: 'PUT',
        body: JSON.stringify(toBudgetBody(value)),
      });
      if (!res.ok) throw createFetchError('ai_org_budget_save_failed', 'Failed to save organization budget');
      await mutate();
      // The dashboard / analytics usage widgets show "$X left" from this cap.
      void mutateGlobal('/ai/usage');
      toaster.show(t('ai_org_budget_saved', 'Organization budget saved'), 'success');
    } catch (err) {
      toaster.show(
        (err as Error)?.message || t('ai_org_budget_save_failed', 'Failed to save organization budget'),
        'warning',
      );
    } finally {
      setSaving(false);
    }
  }, [fetch, value, mutate, mutateGlobal, toaster, t]);

  return (
    <div
      className="flex flex-col gap-[12px] p-[16px] rounded-[8px] border border-newTableBorder bg-newBgColorInner"
      data-testid="org-budget-card"
    >
      <div>
        <div className="text-[14px] font-[600] text-textColor">
          {t('ai_org_budget_title', 'Organization budget')}
        </div>
        <div className="text-[12px] text-newTextColor/60">
          {t(
            'ai_org_budget_help',
            'A hard ceiling on total AI spend across all providers. Calls are refused once it is reached, regardless of per-provider caps.',
          )}
        </div>
      </div>

      {isLoading && !data ? (
        <div className="text-newTextColor/60 text-[14px]">{t('loading', 'Loading')}</div>
      ) : (
        <>
          <BudgetLimitsFields
            value={value}
            disabled={readOnly}
            labels={{
              enabled: t('ai_org_budget_enabled', 'Organization budget limit'),
              monthlyCap: t('ai_org_budget_monthly_cap', 'Monthly cap (USD)'),
              dailyCap: t('ai_org_budget_daily_cap', 'Daily cap (USD)'),
              threshold: t('ai_org_budget_alert_threshold', 'Alert threshold'),
              thresholdHelp: t(
                'ai_org_budget_alert_help',
                'Notify when spend reaches this percentage of the cap.',
              ),
              monthlyPlaceholder: t('provider_field_placeholder_budgetMonthlyCap', 'e.g. 100'),
              dailyPlaceholder: t('provider_field_placeholder_budgetDailyCap', 'e.g. 10'),
            }}
            onChange={(patch) => setValue((prev) => ({ ...prev, ...patch }))}
          />
          <div className="flex justify-end">
            <Button type="button" onClick={handleSave} loading={saving} disabled={readOnly || saving}>
              {t('ai_org_budget_save', 'Save budget')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};
