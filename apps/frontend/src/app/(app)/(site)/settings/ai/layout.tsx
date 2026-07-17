'use client';

import React from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { SettingsSubnav } from '@gitroom/frontend/components/settings/settings-subnav';

export default function AiSettingsLayout({ children }: { children: React.ReactNode }) {
  const t = useT();
  const user = useUser();
  const items = [
    { href: '/settings/ai/llm-providers', label: t('llm_providers', 'LLM Providers') },
    { href: '/settings/ai/model-defaults', label: t('model_defaults', 'Model Defaults') },
    ...(user?.tier?.brand_kits
      ? [{ href: '/settings/ai/brands', label: t('brands', 'Brands') }]
      : []),
    { href: '/settings/ai/prompt-templates', label: t('prompt_templates', 'Prompt Templates') },
    { href: '/settings/ai/prompt-library', label: t('prompt_library', 'Prompt Library') },
  ];
  return (
    <div className="flex flex-col gap-[16px]">
      <SettingsSubnav items={items} />
      {children}
    </div>
  );
}
