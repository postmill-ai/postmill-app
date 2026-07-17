'use client';

import React, { FC, useMemo, useRef, useState } from 'react';
import { mutate as swrMutate } from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  useCampaigns,
  useCampaignsForEntity,
} from '@gitroom/frontend/components/campaigns/hooks/campaign.hooks';
import { CampaignEntitySlug } from '@gitroom/frontend/components/campaigns/campaign-types';

// One reusable tagger, mounted in every entity edit UI. Tags/untags a campaign
// onto the given (entityType, entityId). When entityId is falsy (item not saved
// yet) it renders a hint instead.
export const CampaignSelector: FC<{
  entityType: CampaignEntitySlug;
  entityId?: string;
  label?: string;
  compact?: boolean;
  id?: string;
}> = ({ entityType, entityId, label, compact, id }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data: allCampaigns } = useCampaigns();
  const { data: tagged } = useCampaignsForEntity(entityType, entityId);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const taggedIds = useMemo(() => new Set((tagged || []).map((c) => c.id)), [tagged]);
  const forKey = `campaigns-for-${entityType}-${entityId}`;

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (allCampaigns || [])
      .filter((c) => !taggedIds.has(c.id))
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .slice(0, 50);
  }, [allCampaigns, taggedIds, query]);

  const add = async (campaignId: string) => {
    if (!entityId || busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/campaigns/${campaignId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType, entityId }),
      });
      if (!r.ok) throw new Error();
      await swrMutate(forKey);
      setQuery('');
      setOpen(false);
    } catch {
      toaster.show(t('campaign_tag_failed', 'Failed to add to campaign'), 'warning');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (campaignId: string) => {
    if (!entityId || busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/campaigns/${campaignId}/items/${entityType}/${entityId}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error();
      await swrMutate(forKey);
    } catch {
      toaster.show(t('campaign_untag_failed', 'Failed to remove from campaign'), 'warning');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-[6px]">
      {!compact && (
        <label htmlFor={id} className="text-[14px] font-[500]">{label || t('campaigns', 'Campaigns')}</label>
      )}
      {!entityId ? (
        <div className="text-[12px] text-newTableText">
          {t('save_to_tag_campaigns', 'Save this item first to tag it with campaigns.')}
        </div>
      ) : (
        <>
          {(tagged || []).length > 0 && (
            <div className="flex flex-wrap gap-[6px]">
              {(tagged || []).map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center gap-[6px] text-[12px] px-[8px] py-[3px] rounded-full bg-newBgColorInner border border-newTableBorder text-textColor"
                >
                  <span
                    className="w-[8px] h-[8px] rounded-full"
                    style={{ backgroundColor: c.color || '#2b5cd3' }}
                  />
                  {c.name}
                  <button
                    type="button"
                    onClick={() => remove(c.id)}
                    className="text-newTableText hover:text-textColor"
                    aria-label={t('remove', 'Remove')}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="relative">
            <input
              id={id}
              type="text"
              value={query}
              placeholder={t('add_to_campaign', 'Add to campaign…')}
              onFocus={() => setOpen(true)}
              onBlur={() => (blurTimer.current = setTimeout(() => setOpen(false), 120))}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full h-[38px] px-[12px] rounded-[8px] bg-newBgColorInner border border-newTableBorder text-[13px] text-textColor placeholder-newTableText outline-none"
            />
            {open && options.length > 0 && (
              <div className="absolute z-[20] mt-[4px] w-full max-h-[200px] overflow-y-auto rounded-[8px] border border-newTableBorder bg-newBgColorInner shadow-lg">
                {options.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      add(c.id);
                    }}
                    className="flex items-center gap-[8px] w-full text-left px-[12px] py-[7px] text-[13px] text-textColor hover:bg-boxHover transition-colors"
                  >
                    <span
                      className="w-[8px] h-[8px] rounded-full shrink-0"
                      style={{ backgroundColor: c.color || '#2b5cd3' }}
                    />
                    {c.name}
                    {c.archived && (
                      <span className="text-[10px] text-newTableText">({t('archived', 'archived')})</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
