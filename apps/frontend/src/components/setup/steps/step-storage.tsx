'use client';

import React from 'react';
import { StepFrame } from '@gitroom/frontend/components/setup/step-frame';
import { StorageTab } from '@gitroom/frontend/components/settings/storage/storage.tab';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export function StepStorage() {
  const t = useT();
  return (
    <StepFrame
      title={t('setup_storage_title', 'Storage providers')}
      subtitle={t(
        'setup_storage_subtitle',
        'Local storage is enabled by default. You can mount cloud storage now or skip and configure it later in Settings.'
      )}
    >
      <StorageTab activeSubTab="providers" />
    </StepFrame>
  );
}
