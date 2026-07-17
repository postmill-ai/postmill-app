'use client';

import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { SettingsGate } from '@gitroom/frontend/components/settings/settings-gate';
import { Sets } from '@gitroom/frontend/components/sets/sets';

export default function Page() {
  const user = useUser();
  return (
    <SettingsGate allow={user ? !!user.tier : undefined}>
      <Sets />
    </SettingsGate>
  );
}
