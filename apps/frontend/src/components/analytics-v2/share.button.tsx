'use client';

import { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { AnalyticsShareModal } from './views/analytics-share.modal';

// Org-level public share button (7.6). Sits next to Export in the dashboard
// header; opens the bespoke share modal (mint/rotate/disable + copy link).
export const ShareButton: FC = () => {
  const t = useT();
  const modal = useModals();

  const open = () => {
    modal.openModal({
      title: t('analytics_share_title', 'Share analytics'),
      withCloseButton: true,
      children: <AnalyticsShareModal />,
    });
  };

  return (
    <button
      type="button"
      onClick={open}
      className="px-[12px] py-[6px] text-[13px] font-medium rounded-[8px] bg-newTableHeader border border-newTableBorder text-newTableText hover:text-btnText hover:border-newTableText transition-colors flex items-center gap-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
      </svg>
      {t('share', 'Share')}
    </button>
  );
};
