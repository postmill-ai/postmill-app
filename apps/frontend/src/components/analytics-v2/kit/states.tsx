'use client';

import { FC, ReactNode } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// Shared loading / empty / error states (F5). Replaces the per-tab ad-hoc
// skeletons, bare "Loading..." strings, and diverging empty/error blocks.

interface TabSkeletonProps {
  variant?: 'cards' | 'list' | 'chart';
  className?: string;
}

/** Themed pulsing placeholder while a tab's data loads. */
export const TabSkeleton: FC<TabSkeletonProps> = ({ variant = 'cards', className }) => {
  if (variant === 'list') {
    return (
      <div className={`space-y-[12px] animate-pulse ${className ?? ''}`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-[72px] bg-newTableHeader rounded-[10px]" />
        ))}
      </div>
    );
  }
  if (variant === 'chart') {
    return (
      <div className={`space-y-[16px] animate-pulse ${className ?? ''}`}>
        <div className="h-[320px] bg-newTableHeader rounded-[12px]" />
      </div>
    );
  }
  return (
    <div className={`space-y-[16px] animate-pulse ${className ?? ''}`}>
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-[12px] mobile:gap-[8px]">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-[180px] mobile:h-[112px] bg-newTableHeader rounded-[12px]"
          />
        ))}
      </div>
      <div className="h-[320px] bg-newTableHeader rounded-[12px]" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[12px]">
        <div className="h-[280px] bg-newTableHeader rounded-[12px]" />
        <div className="h-[280px] bg-newTableHeader rounded-[12px]" />
      </div>
    </div>
  );
};

interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

/** Neutral "nothing here yet" panel. */
export const EmptyState: FC<EmptyStateProps> = ({ title, description, icon, action }) => {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center py-[48px] px-[24px] text-center">
      <div className="w-[48px] h-[48px] mb-[16px] rounded-full bg-newTableHeader flex items-center justify-center text-newTableText">
        {icon ?? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 3v18h18M7 16l4-8 4 4 4-6" />
          </svg>
        )}
      </div>
      <p className="text-textColor text-[14px] font-medium mb-[8px]">
        {title ?? t('analytics_empty_title', 'No data available yet')}
      </p>
      {description && (
        <p className="text-[12px] text-newTableText max-w-[420px]">{description}</p>
      )}
      {action && <div className="mt-[20px]">{action}</div>}
    </div>
  );
};

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

/** Failure panel with an optional retry. */
export const ErrorState: FC<ErrorStateProps> = ({ title, message, onRetry }) => {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center py-[48px] text-center">
      <div className="w-[48px] h-[48px] mb-[16px] rounded-full bg-[rgba(249,112,102,0.1)] flex items-center justify-center text-[var(--negative,#f97066)]">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4m0 4h.01" />
        </svg>
      </div>
      <p className="text-newTableText text-[14px] mb-[12px]">
        {title ?? t('analytics_error_title', 'Something went wrong')}
      </p>
      {message && <p className="text-[12px] text-newTableText opacity-60 mb-[12px]">{message}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-[4px] px-[14px] py-[6px] text-[13px] font-medium bg-btnPrimary text-white rounded-[8px] hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60"
        >
          {t('try_again', 'Try again')}
        </button>
      )}
    </div>
  );
};
