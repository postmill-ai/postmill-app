'use client';

import React from 'react';

const inputClass =
  'bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px] disabled:opacity-60';

export interface BudgetLimitsValue {
  enabled: boolean;
  /** Raw input strings so the user can type freely; parse on save. */
  monthlyCap: string;
  dailyCap: string;
  /** 0–100 percentage string (the slider's unit); convert to 0–1 on save. */
  thresholdPct: string;
}

export interface BudgetLimitsLabels {
  enabled: string;
  monthlyCap: string;
  dailyCap: string;
  threshold: string;
  thresholdHelp: string;
  monthlyPlaceholder: string;
  dailyPlaceholder: string;
}

/** Parses an optional non-negative number from a form string; '' / invalid → undefined. */
export const parseOptionalNumber = (value: unknown): number | undefined => {
  if (value === '' || value === null || value === undefined) return undefined;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/**
 * Presentational budget-limits block: an opt-in switch gating monthly/daily cap
 * inputs and a 0–100 alert-threshold slider. Shared by the per-provider form
 * (via BudgetBlockField) and the org-wide budget card so both read identically.
 */
export const BudgetLimitsFields: React.FC<{
  value: BudgetLimitsValue;
  labels: BudgetLimitsLabels;
  disabled?: boolean;
  onChange: (patch: Partial<BudgetLimitsValue>) => void;
}> = ({ value, labels, disabled, onChange }) => {
  const threshold = value.thresholdPct || '80';

  return (
    <div className="flex flex-col gap-[12px]">
      <label className="inline-flex items-center gap-[8px] cursor-pointer">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={value.enabled}
          disabled={disabled}
          onChange={(e) => {
            // Commit the slider's displayed default so what you see is what saves.
            onChange({
              enabled: e.target.checked,
              ...(e.target.checked && !value.thresholdPct ? { thresholdPct: '80' } : {}),
            });
          }}
        />
        <div className="relative w-[44px] h-[24px] bg-newTableBorder peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:inset-s-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-[20px] after:w-[20px] after:transition-all peer-checked:bg-btnPrimary peer-disabled:opacity-60" />
        <span className="text-[13px] text-textColor">{labels.enabled}</span>
      </label>

      {value.enabled && (
        <>
          <div className="flex flex-col gap-[4px]">
            <label className="text-[13px] text-newTableText">{labels.monthlyCap}</label>
            <input
              className={inputClass}
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              disabled={disabled}
              placeholder={labels.monthlyPlaceholder}
              value={value.monthlyCap}
              onChange={(e) => onChange({ monthlyCap: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-[4px]">
            <label className="text-[13px] text-newTableText">{labels.dailyCap}</label>
            <input
              className={inputClass}
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              disabled={disabled}
              placeholder={labels.dailyPlaceholder}
              value={value.dailyCap}
              onChange={(e) => onChange({ dailyCap: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-[4px]">
            <label className="text-[13px] text-newTableText">{labels.threshold}</label>
            <div className="flex items-center gap-[12px]">
              <input
                className="flex-1 accent-btnPrimary"
                type="range"
                min="0"
                max="100"
                step="1"
                disabled={disabled}
                value={threshold}
                onChange={(e) => onChange({ thresholdPct: e.target.value })}
              />
              <span className="text-[13px] text-textColor min-w-[40px] text-end">{threshold}%</span>
            </div>
            <div className="text-[11px] text-newTableText">{labels.thresholdHelp}</div>
          </div>
        </>
      )}
    </div>
  );
};
