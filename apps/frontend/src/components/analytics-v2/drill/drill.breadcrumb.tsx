'use client';

import { FC } from 'react';
import { DrillState } from '../utils';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface BreadcrumbItem {
  id: string;
  label: string;
  onClick?: () => void;
}

interface DrillBreadcrumbProps {
  drill: DrillState;
  onReset: () => void;
  onNavigate: (drill: Partial<DrillState>) => void;
  channelName?: string;
  postContent?: string;
}

export const DrillBreadcrumb: FC<DrillBreadcrumbProps> = ({
  drill,
  onReset,
  onNavigate,
  channelName,
  postContent,
}) => {
  const t = useT();
  const items: BreadcrumbItem[] = [];

  if (drill.tab && drill.tab !== 'overview') {
    items.push({
      id: 'tab',
      label: drill.tab.charAt(0).toUpperCase() + drill.tab.slice(1),
      onClick: () => onNavigate({ tab: drill.tab }),
    });
  } else {
    items.push({ id: 'overview', label: t('overview', 'Overview'), onClick: onReset });
  }

  if (drill.metric) {
    items.push({
      id: 'metric',
      label: drill.metric,
      onClick: () => onNavigate({ metric: undefined, focusDate: undefined, focusPost: undefined }),
    });
  }

  if (drill.focusIntegration && channelName) {
    items.push({
      id: 'channel',
      label: channelName,
      onClick: () => onNavigate({ focusIntegration: undefined, focusDate: undefined, focusPost: undefined }),
    });
  }

  if (drill.focusDate) {
    items.push({
      id: 'date',
      label: drill.focusDate,
      onClick: () => onNavigate({ focusDate: undefined, focusPost: undefined }),
    });
  }

  if (drill.focusPost && postContent) {
    items.push({
      id: 'post',
      label: postContent.length > 30 ? postContent.slice(0, 30) + '...' : postContent,
      onClick: () => onNavigate({ focusPost: undefined }),
    });
  }

  const hasDrill = drill.metric || drill.focusIntegration || drill.focusDate || drill.focusPost;

  if (!hasDrill) return null;

  return (
    <div className="flex items-center gap-[6px] text-[13px] text-newTableText mb-[16px] flex-wrap">
      {items.map((item, i) => (
        <span key={item.id} className="flex items-center gap-[6px]">
          {i > 0 && (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M4.5 2.5L7.5 6L4.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {item.onClick ? (
            <button
              onClick={item.onClick}
              className="hover:text-btnText transition-colors"
            >
              {item.label}
            </button>
          ) : (
            <span>{item.label}</span>
          )}
        </span>
      ))}
      <button
        onClick={onReset}
        className="ml-[8px] text-[11px] px-[8px] py-[3px] bg-newTableHeader border border-newTableBorder rounded-[4px] hover:text-btnText transition-colors"
      >
        {t('reset', 'Reset')}
      </button>
    </div>
  );
};
