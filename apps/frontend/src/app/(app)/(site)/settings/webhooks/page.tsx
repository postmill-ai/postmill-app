'use client';

import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { SettingsGate } from '@gitroom/frontend/components/settings/settings-gate';
import { Webhooks } from '@gitroom/frontend/components/webhooks/webhooks';

export default function Page() {
  const user = useUser();
  return (
    <SettingsGate allow={user ? !!user.tier?.webhooks : undefined}>
      <Webhooks />
    </SettingsGate>
  );
}
