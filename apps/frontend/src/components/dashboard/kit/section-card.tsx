'use client';

import { FC, ReactNode } from 'react';
import Link from 'next/link';
import { useDashboardPrefs } from '../hooks/useDashboardPrefs';
import { ErrorBoundary } from '@gitroom/frontend/components/analytics-v2/error.boundary';
import { ErrorState } from '@gitroom/frontend/components/analytics-v2/kit/states';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

import { usePermissions } from '@gitroom/frontend/components/layout/use-permissions';

export interface SectionCardProps {
  id: string;
  title: string;
  icon?: ReactNode;
  badge?: number;
  viewAllHref?: string;
  permission?: [string, string];
  children: ReactNode;
}

export const SectionCard: FC<SectionCardProps> = ({
  id,
  title,
  icon,
  badge,
  viewAllHref,
  permission,
  children,
}) => {
  const { hidden } = useDashboardPrefs();
  const permissions = usePermissions();
  const t = useT();

  if (hidden.includes(id)) {
    return null;
  }

  // Optimistic: render while permissions are loading. Once resolved, hide if
  // the user lacks the required permission.
  if (permission && permissions.isResolved && !permissions.hasPermission(...permission)) {
    return null;
  }

  return (
    <div
      data-section-id={id}
      className="bg-newBgColorInner border border-newTableBorder rounded-[12px] min-w-0 overflow-hidden flex flex-col"
    >
      <div className="flex items-center justify-between gap-[12px] px-[16px] py-[12px] border-b border-newTableBorder">
        <div className="flex items-center gap-[8px] min-w-0">
          {icon && (
            <span className="text-newTableText shrink-0 w-[18px] h-[18px] flex items-center justify-center">
              {icon}
            </span>
          )}
          <h2 className="text-[13px] font-medium text-newTableText uppercase tracking-wide truncate">
            {title}
          </h2>
          {badge !== undefined && badge > 0 && (
            <span className="shrink-0 min-w-[18px] h-[18px] px-[5px] flex items-center justify-center rounded-full bg-btnPrimary text-[10px] font-semibold text-white">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </div>
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="shrink-0 text-[12px] font-medium text-newTableText hover:text-textColor transition-colors"
          >
            {t('view_all', 'View all')}
          </Link>
        )}
      </div>
      <div className="p-[16px] min-w-0 flex-1">
        <ErrorBoundary
          fallback={
            <ErrorState
              title={t('section_failed_title', 'This section failed to load')}
              message={t(
                'section_failed_message',
                'Something went wrong inside this dashboard card.'
              )}
            />
          }
        >
          {children}
        </ErrorBoundary>
      </div>
    </div>
  );
};
