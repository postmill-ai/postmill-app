'use client';

import React from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { CapabilityMeta } from './provider-surface.types';

/**
 * Centralized capability badge rendering (plan §0.3.5 / Step 1.3). Replaces the
 * per-surface `CAPABILITY_COLORS` maps — each surface passes its `capabilityMeta`
 * from the descriptor and the label/color is resolved here.
 */

const FALLBACK_COLOR = 'bg-newTableHeader text-newTableText';

export const titleCase = (s: string) =>
  s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;

export interface CapabilityBadgesProps {
  keys: string[];
  meta: Record<string, CapabilityMeta>;
  /** Optional leading badge(s), e.g. the AI "Hub" pill. */
  leading?: React.ReactNode;
}

export const CapabilityBadges: React.FC<CapabilityBadgesProps> = ({
  keys,
  meta,
  leading,
}) => {
  const t = useT();
  if (!leading && (!keys || keys.length === 0)) return null;
  return (
    <div className="flex gap-[4px] mt-[4px] flex-wrap items-center">
      {leading}
      {keys.map((key) => {
        const m = meta[key];
        return (
          <span
            key={key}
            className={`text-[10px] rounded-[4px] px-[6px] py-[2px] ${
              m?.color || FALLBACK_COLOR
            }`}
          >
            {m?.label
              ? t('provider_capability_' + key, m.label)
              : titleCase(key)}
          </span>
        );
      })}
    </div>
  );
};
