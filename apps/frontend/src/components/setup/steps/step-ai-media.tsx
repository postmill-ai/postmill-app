'use client';

import React from 'react';
import { StepFrame } from '@gitroom/frontend/components/setup/step-frame';
import { MediaProvidersTab } from '@gitroom/frontend/components/settings/media-providers/media-providers.tab';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export function StepAiMedia() {
  const t = useT();
  return (
    <StepFrame
      title={t('setup_ai_media_title', 'AI media providers')}
      subtitle={t(
        'setup_ai_media_subtitle',
        'Add providers that generate images, videos, and audio for your posts. Optional — you can configure this later in Settings.'
      )}
    >
      <MediaProvidersTab />
    </StepFrame>
  );
}
