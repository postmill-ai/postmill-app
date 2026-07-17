'use client';

import React from 'react';
import { StepFrame } from '@gitroom/frontend/components/setup/step-frame';
import { ContentPacksTab } from '@gitroom/frontend/components/settings/content-packs/content-packs.tab';
import { usePermissions } from '@gitroom/frontend/components/layout/use-permissions';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export function StepContentPacks() {
  const t = useT();
  const permissions = usePermissions();
  const allowed = permissions.hasPermission('media-config', 'manage');

  return (
    <StepFrame
      title={t('setup_content_packs_title', 'Content packs')}
      subtitle={t(
        'setup_content_packs_subtitle',
        'Choose a premium stock-media provider or stay on the free default. Optional — you can change this later in Settings.'
      )}
    >
      {allowed ? (
        <ContentPacksTab />
      ) : (
        <div className="flex flex-col items-center justify-center gap-[12px] py-[40px] text-center">
          <div className="text-[16px] font-[500] text-textColor">
            {t('content_packs_permission_title', 'Permission required')}
          </div>
          <p className="text-[13px] text-newTableText max-w-[440px]">
            {t(
              'content_packs_permission_body',
              'You do not have permission to manage content packs. Ask an organization admin to configure this, or skip this step.'
            )}
          </p>
        </div>
      )}
    </StepFrame>
  );
}
