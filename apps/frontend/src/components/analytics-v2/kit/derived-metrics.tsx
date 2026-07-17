'use client';

import { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { DerivedMetrics } from '../utils';

// Shared rendering of the derived (computed) secondary metrics (6.2):
// engagement rate + reach-per-follower. A null field is HIDDEN (its
// denominator was zero/missing) — never shown as 0, which would read as "bad".

function formatEngagementRate(value: number): string {
  // Backend sends a ratio (engagement ÷ impressions); render as a percent.
  return (value * 100).toFixed(2) + '%';
}

function formatReachPerFollower(value: number): string {
  return value.toFixed(2) + '×';
}

interface DerivedProps {
  derived?: DerivedMetrics;
}

/** Org-wide (or panel) block of derived-metric tiles. Renders nothing when none present. */
export const DerivedMetricTiles: FC<DerivedProps> = ({ derived }) => {
  const t = useT();
  const rate = derived?.engagementRate;
  const rpf = derived?.reachPerFollower;
  if (rate == null && rpf == null) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-[12px] mobile:gap-[8px]">
      {rate != null && (
        <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] px-[16px] py-[14px] flex flex-col gap-[4px]">
          <span className="text-[13px] mobile:text-[11px] font-medium text-newTableText uppercase tracking-wide">
            {t('analytics_engagement_rate', 'Engagement rate')}
          </span>
          <span className="text-[24px] mobile:text-[18px] leading-[30px] font-semibold tabular-nums">
            {formatEngagementRate(rate)}
          </span>
        </div>
      )}
      {rpf != null && (
        <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] px-[16px] py-[14px] flex flex-col gap-[4px]">
          <span className="text-[13px] mobile:text-[11px] font-medium text-newTableText uppercase tracking-wide">
            {t('analytics_reach_per_follower', 'Reach / follower')}
          </span>
          <span className="text-[24px] mobile:text-[18px] leading-[30px] font-semibold tabular-nums">
            {formatReachPerFollower(rpf)}
          </span>
        </div>
      )}
    </div>
  );
};

/** Compact inline derived-metric labels for a channel row. Renders nothing when none present. */
export const DerivedMetricInline: FC<DerivedProps> = ({ derived }) => {
  const t = useT();
  const rate = derived?.engagementRate;
  const rpf = derived?.reachPerFollower;
  if (rate == null && rpf == null) return null;

  return (
    <div className="flex flex-col items-end gap-[2px] text-[11px] text-newTableText tabular-nums">
      {rate != null && (
        <span>
          {t('analytics_engagement_rate_short', 'ER')} {formatEngagementRate(rate)}
        </span>
      )}
      {rpf != null && (
        <span>
          {t('analytics_reach_per_follower_short', 'R/F')} {formatReachPerFollower(rpf)}
        </span>
      )}
    </div>
  );
};
