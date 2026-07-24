'use client';

import React from 'react';
import { StepFrame } from '@postmill-ai/frontend/components/setup/step-frame';
import { ShortlinksTab } from '@postmill-ai/frontend/components/settings/shortlinks/shortlinks.tab';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

export function StepShortlinks() {
  const t = useT();
  return (
    <StepFrame
      title={t('setup_shortlinks_title', 'Short-link providers')}
      subtitle={t(
        'setup_shortlinks_subtitle',
        'Configure a provider to shorten links in your posts. Optional — you can set this up later in Settings.'
      )}
    >
      <div className="mb-[16px] text-[12px] text-amber-600 bg-amber-600/10 border border-amber-600/20 rounded-[8px] px-[12px] py-[8px]">
        {t(
          'setup_shortlinks_oauth_caveat',
          'API-key providers configure inline. OAuth providers (e.g. Dub) currently finish in Settings → Shortlinks after authorization.'
        )}
      </div>
      <ShortlinksTab />
    </StepFrame>
  );
}
