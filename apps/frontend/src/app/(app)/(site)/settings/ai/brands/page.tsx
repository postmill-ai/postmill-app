'use client';

import { useUser } from '@postmill-ai/frontend/components/layout/user.context';
import { SettingsGate } from '@postmill-ai/frontend/components/settings/settings-gate';
import { BrandList } from '@postmill-ai/frontend/components/settings/brand/brand-list';

export default function Page() {
  const user = useUser();
  return (
    <SettingsGate allow={user ? !!user.tier?.brand_kits : undefined}>
      <BrandList />
    </SettingsGate>
  );
}
