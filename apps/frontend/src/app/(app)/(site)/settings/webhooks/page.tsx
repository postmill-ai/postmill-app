'use client';

import { useUser } from '@postmill-ai/frontend/components/layout/user.context';
import { SettingsGate } from '@postmill-ai/frontend/components/settings/settings-gate';
import { Webhooks } from '@postmill-ai/frontend/components/webhooks/webhooks';

export default function Page() {
  const user = useUser();
  return (
    <SettingsGate allow={user ? !!user.tier?.webhooks : undefined}>
      <Webhooks />
    </SettingsGate>
  );
}
