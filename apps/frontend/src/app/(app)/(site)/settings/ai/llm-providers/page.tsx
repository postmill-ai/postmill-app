'use client';

import { ProviderSettingsPanel } from '@gitroom/frontend/components/settings/shared/kit/provider-settings-panel';
import { aiDescriptor } from '@gitroom/frontend/components/settings/shared/kit/descriptors/ai.descriptor';

export default function Page() {
  return <ProviderSettingsPanel descriptor={aiDescriptor} />;
}
