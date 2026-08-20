'use client';

import React, { FC, useState } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { Slider, SegmentedControl } from './controls';
import type {
  FilterDescriptor,
  FilterParam,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/filter-descriptors';
import type { FilterParams } from '@postmill-ai/nestjs-libraries/media/designer-doc/filter-ops';

/**
 * One dialog for all 47 filters, generated from the descriptor.
 *
 * Hand-building a dialog per filter would be 47 chances for the range on a
 * slider to disagree with what the op actually accepts; here the two come from
 * the same table.
 */

interface FilterDialogProps {
  descriptor: FilterDescriptor;
  initial: FilterParams;
  busy?: boolean;
  onApply: (params: FilterParams) => void;
  onCancel: () => void;
}

const Control: FC<{
  param: FilterParam;
  value: number | string | boolean;
  onChange: (v: number | string | boolean) => void;
}> = ({ param, value, onChange }) => {
  const t = useT();
  const label = t(`designer_filter_param_${param.key}`, param.label);

  if (param.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-[12px] text-textColor">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          className="accent-designerAccent w-3.5 h-3.5"
        />
        {label}
      </label>
    );
  }

  if (param.type === 'select') {
    const options = param.options || [];
    // A short list reads better as segments; a long one needs a dropdown.
    if (options.length <= 3) {
      return (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-textColor/60">{label}</span>
          <SegmentedControl
            value={String(value)}
            options={options.map((o) => ({
              value: o.value,
              label: t(`designer_filter_option_${o.value}`, o.label),
            }))}
            onChange={(v) => onChange(v)}
          />
        </div>
      );
    }
    return (
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-textColor/60">{label}</span>
        <select
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="h-[30px] px-2 rounded-md bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-hidden"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {t(`designer_filter_option_${o.value}`, o.label)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <Slider
      label={label}
      min={param.min ?? 0}
      max={param.max ?? 100}
      step={param.step ?? 1}
      suffix={param.suffix}
      value={typeof value === 'number' ? value : 0}
      onChange={(n) => onChange(n)}
    />
  );
};

export const FilterDialog: FC<FilterDialogProps> = ({
  descriptor,
  initial,
  busy,
  onApply,
  onCancel,
}) => {
  const t = useT();
  const [params, setParams] = useState<FilterParams>(initial);

  return (
    <div className="flex flex-col gap-3 min-w-[300px]">
      {descriptor.params.map((param) => (
        <Control
          key={param.key}
          param={param}
          value={params[param.key] ?? param.default}
          onChange={(v) => setParams((prev) => ({ ...prev, [param.key]: v }))}
        />
      ))}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-md text-[12px] border border-studioBorder text-textColor hover:bg-boxHover"
        >
          {t('cancel', 'Cancel')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onApply(params)}
          className="px-4 py-1.5 rounded-md text-[12px] bg-designerAccent text-white hover:bg-designerAccent/80 disabled:opacity-50"
        >
          {busy ? t('designer_applying', 'Applying…') : t('ok', 'OK')}
        </button>
      </div>
    </div>
  );
};
