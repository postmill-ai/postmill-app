'use client';

import { usePermissions } from '@gitroom/frontend/components/layout/use-permissions';
import { BroadcastTab } from '@gitroom/frontend/components/settings/broadcast/broadcast.tab';
import { SettingsGate } from '@gitroom/frontend/components/settings/settings-gate';

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
