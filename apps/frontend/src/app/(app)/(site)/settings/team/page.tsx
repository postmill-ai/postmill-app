'use client';

import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { TeamsComponent } from '@gitroom/frontend/components/settings/teams.component';
import { SettingsGate } from '@gitroom/frontend/components/settings/settings-gate';

export default function Page() {
  const user = useUser();
  const { isGeneral } = useVariables();
  return (
    <SettingsGate allow={user ? (user.tier?.team_members ?? 0) > 1 && isGeneral : undefined}>
      <TeamsComponent />
    </SettingsGate>
  );
}
