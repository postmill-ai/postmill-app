'use client';

import React from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { SettingsSubnav } from '@gitroom/frontend/components/settings/settings-subnav';

export default function StorageSettingsLayout({ children }: { children: React.ReactNode }) {
  const t = useT();
  const items = [
    { href: '/settings/storage/providers', label: t('providers', 'Providers') },
    { href: '/settings/storage/audit', label: t('audit_log', 'Audit Log') },
    { href: '/settings/storage/usage', label: t('usage_breakdown', 'Usage Breakdown') },
  ];
  return (
    <div className="flex flex-col gap-[16px]">
      <SettingsSubnav items={items} />
      {children}
    </div>
  );
}
