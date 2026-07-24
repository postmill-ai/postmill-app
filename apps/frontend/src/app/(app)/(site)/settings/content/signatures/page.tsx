'use client';

import { useUser } from '@postmill-ai/frontend/components/layout/user.context';
import { SettingsGate } from '@postmill-ai/frontend/components/settings/settings-gate';
import { SignaturesComponent } from '@postmill-ai/frontend/components/settings/signatures.component';

export default function Page() {
  const user = useUser();
  return (
    <SettingsGate allow={user ? user.tier?.current !== 'STARTER' : undefined}>
      <SignaturesComponent />
    </SettingsGate>
  );
}
