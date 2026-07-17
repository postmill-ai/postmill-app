'use client';

import React from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { ExtraFieldProps } from './extra-field.types';

/**
 * VPN region checklist. Static-region providers (`!isDynamicRegions` with a
 * `proxyRegions` catalog) render a checkbox per region into `extra[spec.key]`
 * (an array of region ids). Dynamic-region providers (the generic `custom`
 * adapter) hide the checklist entirely. Mirrors `vpn-provider-form.tsx`.
 */
export const RegionChecklistField: React.FC<ExtraFieldProps> = ({
  spec,
  state,
  setExtra,
  meta,
}) => {
  const t = useT();
  const regions: { id: string; label: string }[] = meta?.proxyRegions || [];
  if (meta?.isDynamicRegions || regions.length === 0) return null;

  const selected: string[] = state.extra[spec.key] || [];
  const toggle = (id: string) =>
    setExtra(
      spec.key,
      selected.includes(id)
        ? selected.filter((r) => r !== id)
        : [...selected, id],
    );

  return (
    <div className="flex flex-col gap-[8px]">
      <label className="text-[13px] text-newTableText">
        {spec.label || t('regions', 'Regions')}
      </label>
      <div className="flex flex-col gap-[6px]">
        {regions.map((region) => (
          <label
            key={region.id}
            className="flex items-center gap-[8px] text-[13px] text-textColor cursor-pointer"
          >
            <input
              type="checkbox"
              className="accent-btnPrimary w-[14px] h-[14px]"
              checked={selected.includes(region.id)}
              onChange={() => toggle(region.id)}
            />
            {region.label}
          </label>
        ))}
      </div>
    </div>
  );
};
