'use client';

import { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Button } from '@gitroom/react/form/button';

export const CopyCampaignModal: FC<{ campaignId: string; name: string; onDone: () => void }> = ({
  campaignId,
  name,
  onDone,
}) => {
  const fetch = useFetch();
  const t = useT();
  const toast = useToaster();
  const router = useRouter();
  const modals = useModals();

  const [copyName, setCopyName] = useState(`${name} (Copy)`);
  const [shiftDates, setShiftDates] = useState(false);
  const [resetSchedule, setResetSchedule] = useState(false);
  const [loading, setLoading] = useState(false);
  const copyNameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    copyNameInputRef.current?.focus();
  }, []);

  const copy = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/campaigns/${campaignId}/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: copyName.trim() || undefined,
        shiftDates,
        resetSchedule,
      }),
    });
    setLoading(false);

    if (!res.ok) {
      toast.show(t('failed_to_copy_campaign', 'Failed to copy campaign'), 'warning');
      return;
    }

    const data = await res.json();
    toast.show(t('campaign_copied', 'Campaign copied'), 'success');
    onDone();
    modals.closeAll();
    router.push(`/campaigns/${data.id}`);
  }, [campaignId, copyName, fetch, modals, onDone, resetSchedule, router, shiftDates, t, toast]);

  return (
    <div className="flex flex-col gap-[16px] p-[16px] min-w-[400px]">
      <div className="flex flex-col gap-[4px]">
        <label className="text-[12px] text-newTableText">
          {t('copy_name', 'Copy name')}
        </label>
        <input
          ref={copyNameInputRef}
          type="text"
          value={copyName}
          onChange={(e) => setCopyName(e.target.value)}
          className="px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] outline-none"
          placeholder={t('campaign_name_placeholder', 'Campaign name')}
        />
      </div>

      <label className="flex items-center gap-[8px] text-[13px] text-textColor cursor-pointer">
        <input
          type="checkbox"
          checked={shiftDates}
          onChange={(e) => setShiftDates(e.target.checked)}
          className="w-[16px] h-[16px] rounded-[4px] accent-btnPrimary cursor-pointer"
        />
        {t('shift_dates', 'Shift dates by 1 month')}
      </label>

      <label className="flex items-center gap-[8px] text-[13px] text-textColor cursor-pointer">
        <input
          type="checkbox"
          checked={resetSchedule}
          onChange={(e) => setResetSchedule(e.target.checked)}
          className="w-[16px] h-[16px] rounded-[4px] accent-btnPrimary cursor-pointer"
        />
        {t('reset_schedule', 'Reset schedule to now')}
      </label>

      <div className="flex gap-[8px] justify-end mt-[8px]">
        <Button type="button" secondary onClick={onDone}>
          {t('cancel', 'Cancel')}
        </Button>
        <Button
          type="button"
          onClick={copy}
          loading={loading}
          disabled={!copyName.trim()}
        >
          {t('copy_campaign', 'Copy Campaign')}
        </Button>
      </div>
    </div>
  );
};
