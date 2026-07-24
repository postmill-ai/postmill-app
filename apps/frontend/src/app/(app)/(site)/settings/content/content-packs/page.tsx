'use client';

import { usePermissions } from '@postmill-ai/frontend/components/layout/use-permissions';
import { ContentPacksTab } from '@postmill-ai/frontend/components/settings/content-packs/content-packs.tab';
import { SettingsGate } from '@postmill-ai/frontend/components/settings/settings-gate';

export default function Page() {
  const permissions = usePermissions();
  return (
    <SettingsGate
      allow={permissions.isResolved ? permissions.hasPermission('media-config', 'manage') : undefined}
    >
      <ContentPacksTab />
    </SettingsGate>
  );
}
