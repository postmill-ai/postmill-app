'use client';

import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { SettingsGate } from '@gitroom/frontend/components/settings/settings-gate';
import { SignaturesComponent } from '@gitroom/frontend/components/settings/signatures.component';

export default function Page() {
  const user = useUser();
  return (
    <SettingsGate allow={user ? user.tier?.current !== 'STARTER' : undefined}>
      <SignaturesComponent />
    </SettingsGate>
  );
}
