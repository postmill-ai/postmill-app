'use client';

import React from 'react';
import { ProviderSettingsPanel } from '@gitroom/frontend/components/settings/shared/kit/provider-settings-panel';
import { vpnDescriptor } from '@gitroom/frontend/components/settings/shared/kit/descriptors/vpn.descriptor';

export const VpnTab = () => (
  <ProviderSettingsPanel descriptor={vpnDescriptor} hideHeader />
);
