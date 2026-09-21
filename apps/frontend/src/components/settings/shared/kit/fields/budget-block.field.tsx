'use client';

import React from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { ExtraFieldProps } from './extra-field.types';
import { BudgetLimitsFields } from './budget-limits.fields';

/**
 * Budget block (AI surface) — the per-provider "Budget limits" switch and caps.
 * Thin adapter over BudgetLimitsFields: maps the form's `extra` bag
 * (`budgetEnabled`, `budgetMonthlyCap`, `budgetDailyCap`, `budgetAlertThresholdPct`
 * as a 0–100 slider value) to the shared presentational block. The descriptor
 * converts to the stored 0–1 fraction on save and clears the columns when off.
 */
export const BudgetBlockField: React.FC<ExtraFieldProps> = ({ state, setExtra }) => {
  const t = useT();

  return (
    <BudgetLimitsFields
      value={{
        enabled: !!state.extra.budgetEnabled,
        monthlyCap: state.extra.budgetMonthlyCap || '',
        dailyCap: state.extra.budgetDailyCap || '',
        thresholdPct: state.extra.budgetAlertThresholdPct || '',
      }}
      labels={{
        enabled: t('provider_field_budgetEnabled', 'Budget limits'),
        monthlyCap: t('provider_field_budgetMonthlyCap', 'Monthly budget cap'),
        dailyCap: t('provider_field_budgetDailyCap', 'Daily budget cap'),
        threshold: t('provider_field_budgetAlertThresholdPct', 'Alert threshold'),
        thresholdHelp: t(
          'provider_field_help_budgetAlertThresholdPct',
          'Alert when spend reaches this percentage of the cap.',
        ),
        monthlyPlaceholder: t('provider_field_placeholder_budgetMonthlyCap', 'e.g. 100'),
        dailyPlaceholder: t('provider_field_placeholder_budgetDailyCap', 'e.g. 10'),
      }}
      onChange={(patch) => {
        if (patch.enabled !== undefined) setExtra('budgetEnabled', patch.enabled);
        if (patch.monthlyCap !== undefined) setExtra('budgetMonthlyCap', patch.monthlyCap);
        if (patch.dailyCap !== undefined) setExtra('budgetDailyCap', patch.dailyCap);
        if (patch.thresholdPct !== undefined) setExtra('budgetAlertThresholdPct', patch.thresholdPct);
      }}
    />
  );
};
