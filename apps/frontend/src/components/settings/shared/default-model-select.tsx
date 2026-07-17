'use client';

import React, { FC } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { createFetchError } from './fetch-error';
import type { StudioField } from '@gitroom/frontend/components/media-tools/studio-kit/types';

export interface DefaultCatalogOption {
  providerId: string;
  version: string;
  model?: string;
  label: string;
  fields?: StudioField[];
}

interface DefaultCatalogResponse {
  category: string;
  options: DefaultCatalogOption[];
}

function encodeValue(option: { providerId: string; version: string; model?: string }): string {
  return option.model
    ? `${option.providerId}::${option.version}::${option.model}`
    : `${option.providerId}::${option.version}`;
}

export function decodeValue(value: string): {
  providerId: string;
  version: string;
  model?: string;
} | null {
  const parts = value.split('::');
  if (parts.length < 2) return null;
  const [providerId, version, model] = parts;
  if (!providerId || !version) return null;
  return { providerId, version, model };
}

export const useDefaultCatalog = (domain: 'ai' | 'media', category: string) => {
  const fetch = useFetch();
  const path =
    domain === 'ai'
      ? `/settings/ai/defaults/catalog?category=${encodeURIComponent(category)}`
      : `/settings/content/media-defaults/catalog?category=${encodeURIComponent(category)}`;

  const load = React.useCallback(async () => {
    const res = await fetch(path);
    if (!res.ok) throw createFetchError('failed_to_load_default_catalog', 'Failed to load catalog');
    return (await res.json()) as DefaultCatalogResponse;
  }, [fetch, path]);

  return useSWR(path, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};

const selectClass =
  'w-full px-[12px] py-[9px] rounded-[8px] bg-newBgColorInner border border-newTableBorder text-[13px] text-textColor outline-none focus:border-[#2B5CD3] transition-colors appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

// A real native <select> dropdown. Options come from the parent row (which owns the catalog
// SWR hook), so the same data drives both the dropdown and the row's enabled/disabled state.
// When there is nothing to pick (empty catalog), the select is disabled with a clear label.
export const DefaultModelSelect: FC<{
  options: DefaultCatalogOption[];
  isLoading?: boolean;
  disabled?: boolean;
  label?: string;
  value?: { providerId: string; version: string; model?: string } | null;
  onChange: (value: { providerId: string; version: string; model?: string } | null) => void;
}> = ({ options, isLoading, disabled, label, value, onChange }) => {
  const selectedValue = value ? encodeValue(value) : '';
  // A stored value whose option is no longer in the live catalog still needs to render as
  // the selected entry, so append it as an extra option when it's missing.
  const hasSelectedInOptions = options.some((o) => encodeValue(o) === selectedValue);
  const placeholder = disabled
    ? 'No models available'
    : isLoading
    ? 'Loading…'
    : 'Select a model…';

  return (
    <div className="relative">
      <select
        aria-label={label ?? 'Default model'}
        disabled={disabled || isLoading}
        value={selectedValue}
        onChange={(e) => {
          const decoded = decodeValue(e.target.value);
          if (decoded) onChange(decoded);
        }}
        className={selectClass}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {!hasSelectedInOptions && value && (
          <option value={selectedValue}>
            {value.model ? `${value.providerId}: ${value.model}` : value.providerId}
          </option>
        )}
        {options.map((o) => (
          <option key={encodeValue(o)} value={encodeValue(o)}>
            {o.label}
          </option>
        ))}
      </select>
      {/* native dropdown chevron */}
      <div className="pointer-events-none absolute right-[12px] top-1/2 -translate-y-1/2 text-newTextColor/65">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M3 4.5L6 7.5L9 4.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
};
