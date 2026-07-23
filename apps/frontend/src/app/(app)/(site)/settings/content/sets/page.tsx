'use client';

import { useUser } from '@postmill-ai/frontend/components/layout/user.context';
import { SettingsGate } from '@postmill-ai/frontend/components/settings/settings-gate';
import { Sets } from '@postmill-ai/frontend/components/sets/sets';

export default function Page() {
  const user = useUser();
  return (
    <SettingsGate allow={user ? !!user.tier : undefined}>
      <Sets />
    </SettingsGate>
  );
}
