'use client';

import React, { FC, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useStudioModels } from './hooks';

// Searchable model combobox for hub studios. Populates from the live provider catalog
// (GET /media/studio/:provider/models?operation=) and falls back to the descriptor's
// static options when the catalog is empty/unavailable. Native — no UI library.
const inputClass =
  'w-full px-[12px] py-[9px] rounded-[8px] bg-newBgColorInner border border-studioBorder text-[13px] text-textColor outline-none focus:border-[#2B5CD3] transition-colors';

interface Option {
  value: string;
  label: string;
}

export const ModelSelect: FC<{
  provider: string;
  operation: string;
  value?: string;
  staticOptions?: Option[];
  onChange: (value: string) => void;
}> = ({ provider, operation, value, staticOptions = [], onChange }) => {
  const t = useT();
  const { data: fetched, isLoading } = useStudioModels(provider, operation, true);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Clear the pending blur-close timer if the combobox unmounts mid-blur.
  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

  // Merge live catalog with static fallbacks, de-duplicated by id (live wins).
  const options = useMemo<Option[]>(() => {
    const map = new Map<string, Option>();
    for (const o of staticOptions) map.set(o.value, o);
    for (const m of fetched ?? []) map.set(m.id, { value: m.id, label: m.label || m.id });
    return Array.from(map.values());
  }, [fetched, staticOptions]);

  const selectedLabel = options.find((o) => o.value === value)?.label || value || '';

  const trimmed = query.trim();
  const filtered = useMemo(() => {
    const q = trimmed.toLowerCase();
    if (!q) return options.slice(0, 100);
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)).slice(0, 100);
  }, [options, trimmed]);

  // Catalogs can be incomplete (some hubs don't tag every modality) — let the user submit a
  // raw model id they typed when it isn't in the list.
  const showRaw = trimmed.length > 0 && !options.some((o) => o.value === trimmed);

  const pick = (v: string) => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    onChange(v);
    setOpen(false);
  };

  return (
    <div className="relative">
      <input
        type="text"
        aria-label={t('model', 'Model')}
        value={open ? query : selectedLabel}
        placeholder={
          isLoading
            ? t('loading_models', 'Loading models…')
            : t('search_or_type_model_id', 'Search or type a model id…')
        }
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 120);
        }}
        onChange={(e) => setQuery(e.target.value)}
        className={inputClass}
      />
      {open && (filtered.length > 0 || showRaw) && (
        <div className="absolute z-[20] mt-[4px] w-full max-h-[260px] overflow-y-auto rounded-[8px] border border-studioBorder bg-newBgColorInner shadow-lg">
          {showRaw && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(trimmed);
              }}
              className="block w-full text-left px-[12px] py-[8px] text-[13px] text-textColor hover:bg-boxHover transition-colors"
            >
              {t('use_typed_model', 'Use “{{model}}”', { model: trimmed })}
            </button>
          )}
          {filtered.map((o) => (
            <button
              key={o.value}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o.value);
              }}
              className={`block w-full text-left px-[12px] py-[8px] text-[13px] hover:bg-boxHover transition-colors ${
                o.value === value ? 'text-textColor bg-[#2B5CD3]/15' : 'text-newTextColor/80'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
