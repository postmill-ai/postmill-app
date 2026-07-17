'use client';

import { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  MetricFilters,
  MetricKey,
  MetricOp,
} from '@gitroom/frontend/components/launches/calendar.context';

// Per-metric operator + value filter for views / likes / comments. A metric is
// only applied once it has a numeric value; the operator alone does nothing.
export const MetricFilter: FC<{
  value: MetricFilters;
  onChange: (next: MetricFilters) => void;
}> = ({ value, onChange }) => {
  const t = useT();

  const rows: { key: MetricKey; label: string }[] = [
    { key: 'views', label: t('views', 'Views') },
    { key: 'likes', label: t('likes', 'Likes') },
    { key: 'comments', label: t('replies', 'Replies') },
  ];

  const ops: { value: MetricOp; label: string }[] = [
    { value: 'gte', label: '≥' },
    { value: 'gt', label: '>' },
    { value: 'lte', label: '≤' },
    { value: 'lt', label: '<' },
    { value: 'eq', label: '=' },
  ];

  const update = (key: MetricKey, patch: Partial<MetricFilters[MetricKey]>) => {
    onChange({ ...value, [key]: { ...value[key], ...patch } });
  };

  return (
    <div className="flex flex-col gap-[8px]">
      {rows.map(({ key, label }) => (
        <div key={key} className="flex items-center gap-[8px]">
          <div className="w-[80px] text-[13px] text-textColor">{label}</div>
          <select
            value={value[key].op}
            onChange={(e) => update(key, { op: e.target.value as MetricOp })}
            className="h-[38px] w-[64px] px-[8px] rounded-[8px] bg-newBgColorInner border border-newColColor text-[14px] text-textColor outline-none focus:border-[#2B5CD3]"
          >
            {ops.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={value[key].value ?? ''}
            onChange={(e) => {
              const raw = e.target.value;
              update(key, { value: raw === '' ? null : Number(raw) });
            }}
            placeholder={t('any', 'Any')}
            className="flex-1 h-[38px] px-[10px] rounded-[8px] bg-newBgColorInner border border-newColColor text-[14px] text-textColor outline-none focus:border-[#2B5CD3]"
          />
        </div>
      ))}
    </div>
  );
};
