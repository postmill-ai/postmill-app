'use client';

/**
 * Shared loading / error UX primitives for the Designer side panels (C6).
 *
 * Leaf, presentational components — no data fetching, no global state. They are
 * reused by templates / photos / uploads / ai panels so every panel gets a
 * consistent skeleton placeholder and a retriable error state.
 */

import React, { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface PanelSkeletonGridProps {
  /** Number of skeleton tiles to render. */
  count?: number;
  /** Tailwind grid columns class — defaults to a 2-column grid. */
  columnsClassName?: string;
  /** Aspect ratio of each tile. */
  aspectClassName?: string;
}

/** A grid of pulsing placeholder tiles shown while a panel's data loads. */
export const PanelSkeletonGrid: FC<PanelSkeletonGridProps> = ({
  count = 6,
  columnsClassName = 'grid-cols-2',
  aspectClassName = 'aspect-[4/3]',
}) => {
  const t = useT();
  return (
    <div
      className={`grid ${columnsClassName} gap-2`}
      role="status"
      aria-label={t('loading', 'Loading')}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`${aspectClassName} rounded-lg border border-studioBorder bg-newBgColorInner overflow-hidden`}
        >
          <div className="w-full h-full motion-safe:animate-pulse bg-studioBorder/10" />
        </div>
      ))}
    </div>
  );
};

interface PanelErrorProps {
  message: string;
  /** Called when the user clicks "Try again" — wire this to SWR `mutate`. */
  onRetry: () => void;
}

/** A retriable error state: a message plus a "Try again" button. */
export const PanelError: FC<PanelErrorProps> = ({ message, onRetry }) => {
  const t = useT();
  return (
    <div
      className="flex flex-col items-center gap-3 py-6 text-center"
      role="alert"
    >
      <div className="text-[20px] text-newTextColor/30" aria-hidden="true">
        ⚠
      </div>
      <div className="text-[12px] text-newTextColor/60">{message}</div>
      <button
        type="button"
        onClick={onRetry}
        className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-studioBorder text-textColor hover:border-designerAccent hover:bg-boxHover transition-colors"
      >
        {t('try_again', 'Try again')}
      </button>
    </div>
  );
};
