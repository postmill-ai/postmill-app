'use client';

import { useT } from '@gitroom/react/translation/get.transation.service.client';

export function RefreshButton() {
  const t = useT();
  return (
    <button
      onClick={() => window.location.reload()}
      className="bg-btnPrimary text-white rounded-[8px] h-[40px] px-[20px] text-[14px] font-[500] hover:opacity-90 transition-opacity"
    >
      {t('refresh', 'Refresh')}
    </button>
  );
}
