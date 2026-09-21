'use client';

import { ProviderSettingsPanel } from '@postmill-ai/frontend/components/settings/shared/kit/provider-settings-panel';
import { aiDescriptor } from '@postmill-ai/frontend/components/settings/shared/kit/descriptors/ai.descriptor';
import { OrgBudgetCard } from '@postmill-ai/frontend/components/settings/ai/org-budget.card';

export default function Page() {
  return (
    <ProviderSettingsPanel descriptor={aiDescriptor}>
      <OrgBudgetCard />
    </ProviderSettingsPanel>
  );
}
