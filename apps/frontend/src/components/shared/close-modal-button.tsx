'use client';

import { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// Floating close (✕) for full-screen `removeLayout` modals that have no built-in
// chrome (e.g. the composer opened from the campaign dashboard).
export const CloseModalButton: FC<{ onClick: () => void; label?: string }> = ({
  onClick,
  label,
}) => {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label ?? t('close', 'Close')}
      className="absolute top-[10px] right-[10px] z-[60] w-[34px] h-[34px] rounded-full bg-newBgColorInner border border-newTableBorder flex items-center justify-center text-textColor hover:bg-boxHover transition-colors"
    >
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M4 4l7 7M11 4l-7 7" />
      </svg>
    </button>
  );
};

export default CloseModalButton;
