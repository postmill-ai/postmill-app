'use client';

import React, { useCallback } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import ProviderIcon from '@gitroom/frontend/components/shared/provider-icon';
import { ProviderSettingsPanel } from '@gitroom/frontend/components/settings/shared/kit/provider-settings-panel';
import { contentPacksDescriptor } from '@gitroom/frontend/components/settings/shared/kit/descriptors/content-packs.descriptor';

/**
 * Content Packs settings tab — migrated onto the Provider Settings Kit.
 *
 * The premium packs render through `<ProviderSettingsPanel>` (search, capability
 * badges, Configure/Make-Primary/Remove/Test all built-in). Making a premium
 * pack Primary uses the panel's built-in `set-active` action.
 *
 * The free "Postmill (Default)" pack does NOT fit the panel's per-row Make
 * Primary (reverting to it hits a different `/deactivate` endpoint, and there is
 * no provider row for it), so it is rendered as a banner via the panel's
 * `children` slot — highlighted when no premium pack is active.
 */
export const ContentPacksTab: React.FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  // Read the SAME key + shape (`{ rows }`) the panel uses (its `descriptor.load`),
  // so there is no SWR cache-shape collision and the panel's internal mutate()
  // keeps this banner in sync. The free default is active when no premium pack
  // is Primary (pointer === null ⟺ no row has isPrimary).
  const { data } = useSWR(contentPacksDescriptor.swrKey, () =>
    contentPacksDescriptor.load(fetch),
  );

  const isFreeActive = !(data?.rows ?? []).some((r) => r.isPrimary);

  const handleUseFreeDefault = useCallback(async () => {
    const res = await fetch('/settings/content-packs/deactivate', {
      method: 'POST',
    });
    if (!res.ok) {
      toaster.show(t('deactivate_failed', 'Failed to deactivate'), 'warning');
      return;
    }
    toaster.show(
      t('using_free_default', 'Using the free default content pack'),
      'success',
    );
    globalMutate(contentPacksDescriptor.swrKey);
  }, [fetch, toaster, t]);

  const freeDefaultCard = (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-col gap-[4px]">
        <h3 className="text-[18px] font-semibold text-textColor">
          {t('content_packs', 'Content Packs')}
        </h3>
        <p className="text-[13px] text-newTableText max-w-[640px]">
          {t(
            'content_packs_description',
            'A content pack is the stock media library that powers searches for photos, videos, vectors, stickers, icons and audio across the app. Postmill ships with a free default pack; connect a premium provider for higher-quality, licensed content. You can configure several, but only one pack is enabled at a time — anything it doesn’t cover falls back to the free default.',
          )}
        </p>
      </div>

      <div
        className={`rounded-[12px] border p-[16px] flex items-center justify-between gap-[12px] ${
          isFreeActive
            ? 'border-green-500/40 bg-green-900/10'
            : 'border-newTableBorder bg-newBgColorInner'
        }`}
      >
        <div className="flex items-center gap-[12px]">
          <ProviderIcon identifier="postmill" name="Postmill" size={32} />
          <div className="flex flex-col gap-[2px]">
            <div className="flex items-center gap-[8px]">
              <span className="text-[14px] font-medium text-textColor">
                {t('postmill_default', 'Postmill (Default)')}
              </span>
              {isFreeActive && (
                <span className="text-[10px] rounded-[4px] px-[6px] py-[2px] bg-green-900/20 text-green-900 dark:text-green-400">
                  {t('primary', 'Primary')}
                </span>
              )}
            </div>
            <span className="text-[12px] text-newTableText">
              {t(
                'content_pack_free_note',
                'Free stock media for every capability. Used whenever no premium pack is Primary.',
              )}
            </span>
          </div>
        </div>
        {!isFreeActive && (
          <button
            className="text-[12px] text-btnPrimaryAccent hover:underline"
            onClick={handleUseFreeDefault}
          >
            {t('use_free_default', 'Use free default')}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <ProviderSettingsPanel descriptor={contentPacksDescriptor} hideHeader>
      {freeDefaultCard}
    </ProviderSettingsPanel>
  );
};
