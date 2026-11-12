'use client';

import React from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { SettingsSubnav } from '@postmill-ai/frontend/components/settings/settings-subnav';

export default function AiSettingsLayout({ children }: { children: React.ReactNode }) {
  const t = useT();
  const items = [
    { href: '/settings/ai/llm-providers', label: t('llm_providers', 'LLM Providers') },
    { href: '/settings/ai/model-defaults', label: t('model_defaults', 'Model Defaults') },
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
