'use client';

import React, { FC } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { PlatformIcon } from '@postmill-ai/frontend/components/shared/platform-icon';

/**
 * Uniform configure/edit modal header for provider surfaces (channels, comms,
 * AI/media/shortlink/VPN/storage):
 * `<provider-icon> <Provider name> Setup|Edit` — "Setup" when adding a new
 * config, "Edit" when modifying an existing one. The action word renders
 * lighter so the provider name stays the focus.
 */
export const ProviderModalTitle: FC<{
  identifier: string;
  name: string;
  action: 'setup' | 'edit';
  /** Circular icon crop (channel/comms rows use rounded marks). */
  rounded?: boolean;
  /**
   * Icon renderer — defaults to PlatformIcon (channel/comms platforms).
   * Kit/storage surfaces pass ProviderIcon, which draws its own tile
   * (its identifiers live in a different registry than PlatformIcon's).
   */
  IconComponent?: FC<{ identifier: string; name: string; size?: number; rounded?: boolean }>;
}> = ({ identifier, name, action, rounded = true, IconComponent = PlatformIcon }) => {
  const t = useT();
  return (
    <span className="flex items-center gap-[10px]">
      <IconComponent identifier={identifier} name={name} size={28} rounded={rounded} />
      <span>{name}</span>
      <span className="text-textColor/50 font-[400]">
        {action === 'edit' ? t('edit', 'Edit') : t('setup', 'Setup')}
      </span>
    </span>
  );
};

export default ProviderModalTitle;
