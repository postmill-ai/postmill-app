'use client';

import { usePermissions } from '@postmill-ai/frontend/components/layout/use-permissions';
import { BroadcastTab } from '@postmill-ai/frontend/components/settings/broadcast/broadcast.tab';
import { SettingsGate } from '@postmill-ai/frontend/components/settings/settings-gate';

export default function Page() {
  const permissions = usePermissions();
  return (
    <SettingsGate
      allow={permissions.isResolved ? permissions.hasPermission('notifications', 'manage') : undefined}
    >
      <BroadcastTab />
    </SettingsGate>
  );
}
