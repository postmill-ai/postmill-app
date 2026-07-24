'use client';

import { ProviderSettingsPanel } from '@postmill-ai/frontend/components/settings/shared/kit/provider-settings-panel';
import { aiDescriptor } from '@postmill-ai/frontend/components/settings/shared/kit/descriptors/ai.descriptor';

export default function Page() {
  return <ProviderSettingsPanel descriptor={aiDescriptor} />;
}
