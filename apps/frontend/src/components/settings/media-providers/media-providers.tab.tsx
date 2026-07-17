'use client';

import React from 'react';
import { useSearchParams } from 'next/navigation';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { ProviderSettingsPanel } from '@gitroom/frontend/components/settings/shared/kit/provider-settings-panel';
import { mediaDescriptor } from '@gitroom/frontend/components/settings/shared/kit/descriptors/media.descriptor';

export const MediaProvidersTab = () => {
  const t = useT();
  // Seed the filter from ?search= so a studio's "Configure" CTA deep-links straight to its provider.
  const searchParams = useSearchParams();
  const searchFromQuery = searchParams.get('search') || '';

  return (
    <div className="flex flex-col">
      <h3 className="text-[18px] mb-[8px] font-semibold text-textColor">
        {t('ai_media', 'AI Media')}
      </h3>
      <p className="text-[13px] text-newTableText mb-[16px]">
        {t(
          'ai_media_settings_description',
          'Connect tools that generate images, videos, and audio for your posts.',
        )}
      </p>
      <ProviderSettingsPanel
        descriptor={mediaDescriptor}
        hideHeader
        initialSearch={searchFromQuery}
      />
    </div>
  );
};
