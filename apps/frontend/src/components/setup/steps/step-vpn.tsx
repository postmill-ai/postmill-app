'use client';

import React from 'react';
import { StepFrame } from '@postmill-ai/frontend/components/setup/step-frame';
import { VpnTab } from '@postmill-ai/frontend/components/settings/vpn/vpn.tab';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

export function StepVpn() {
  const t = useT();
  return (
    <StepFrame
      title={t('setup_vpn_title', 'VPN / Proxy providers')}
      subtitle={t(
        'setup_vpn_subtitle',
        'Route outbound channel requests through a proxy. Optional — you can configure this later in Settings.'
      )}
    >
      <VpnTab />
    </StepFrame>
  );
}
