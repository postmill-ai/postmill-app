'use client';

import React from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { ExtraFieldProps } from './extra-field.types';

const inputClass =
  'bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]';

/**
 * Budget block (AI surface) — an opt-in "Budget limits" switch (off by default)
 * gating the per-provider budget fields. Manages four keys in the form's `extra`
 * bag: `budgetEnabled` (boolean), `budgetMonthlyCap` / `budgetDailyCap` (number
 * inputs) and `budgetAlertThresholdPct` (a 0–100 percentage slider; the descriptor
 * converts to the stored 0–1 fraction on save). When the switch is off the fields
 * are hidden and the descriptor clears the columns server-side.
 */
export const BudgetBlockField: React.FC<ExtraFieldProps> = ({
  state,
  setExtra,
}) => {
  const t = useT();
  const enabled = !!state.extra.budgetEnabled;
  const threshold = state.extra.budgetAlertThresholdPct || '80';

  return (
    <div className="flex flex-col gap-[12px]">
      <label className="inline-flex items-center gap-[8px] cursor-pointer">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={enabled}
          onChange={(e) => {
            setExtra('budgetEnabled', e.target.checked);
            // Commit the slider's displayed default so what you see is what saves.
            if (e.target.checked && !state.extra.budgetAlertThresholdPct) {
              setExtra('budgetAlertThresholdPct', '80');
            }
          }}
        />
        <div className="relative w-[44px] h-[24px] bg-newTableBorder peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-[20px] after:w-[20px] after:transition-all peer-checked:bg-btnPrimary" />
        <span className="text-[13px] text-textColor">
          {t('provider_field_budgetEnabled', 'Budget limits')}
        </span>
      </label>

      {enabled && (
        <>
          <div className="flex flex-col gap-[4px]">
            <label className="text-[13px] text-newTableText">
              {t('provider_field_budgetMonthlyCap', 'Monthly budget cap')}
            </label>
            <input
              className={inputClass}
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              placeholder={t('provider_field_placeholder_budgetMonthlyCap', 'e.g. 100')}
              value={state.extra.budgetMonthlyCap || ''}
              onChange={(e) => setExtra('budgetMonthlyCap', e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-[4px]">
            <label className="text-[13px] text-newTableText">
              {t('provider_field_budgetDailyCap', 'Daily budget cap')}
            </label>
            <input
              className={inputClass}
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              placeholder={t('provider_field_placeholder_budgetDailyCap', 'e.g. 10')}
              value={state.extra.budgetDailyCap || ''}
              onChange={(e) => setExtra('budgetDailyCap', e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-[4px]">
            <label className="text-[13px] text-newTableText">
              {t('provider_field_budgetAlertThresholdPct', 'Alert threshold')}
            </label>
            <div className="flex items-center gap-[12px]">
              <input
                className="flex-1 accent-btnPrimary"
                type="range"
                min="0"
                max="100"
                step="1"
                value={threshold}
                onChange={(e) => setExtra('budgetAlertThresholdPct', e.target.value)}
              />
              <span className="text-[13px] text-textColor min-w-[40px] text-end">
                {threshold}%
              </span>
            </div>
            <div className="text-[11px] text-newTableText">
              {t(
                'provider_field_help_budgetAlertThresholdPct',
                'Alert when spend reaches this percentage of the cap.',
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
