'use client';

import React from 'react';
import { ProviderSettingsPanel } from '@postmill-ai/frontend/components/settings/shared/kit/provider-settings-panel';
import { vpnDescriptor } from '@postmill-ai/frontend/components/settings/shared/kit/descriptors/vpn.descriptor';

export const VpnTab = () => (
  <ProviderSettingsPanel descriptor={vpnDescriptor} hideHeader />
);
