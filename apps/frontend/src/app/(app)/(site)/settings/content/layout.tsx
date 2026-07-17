'use client';

import React from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { usePermissions } from '@gitroom/frontend/components/layout/use-permissions';
import { SettingsSubnav } from '@gitroom/frontend/components/settings/settings-subnav';

export default function ContentSettingsLayout({ children }: { children: React.ReactNode }) {
  const t = useT();
  const user = useUser();
  const permissions = usePermissions();
  const canManagePacks = permissions.hasPermission('media-config', 'manage');
  const canManageTemplates = !!user?.tier;
  const items = [
    { href: '/settings/content/ai-media', label: t('ai_media', 'AI Media') },
    { href: '/settings/content/media-defaults', label: t('media_defaults', 'Media Defaults') },
    ...(canManagePacks
      ? [{ href: '/settings/content/content-packs', label: t('content_packs', 'Content Packs') }]
      : []),
    ...(canManageTemplates
      ? [
          { href: '/settings/content/sets', label: t('post_templates', 'Post Templates') },
          { href: '/settings/content/signatures', label: t('signatures', 'Signatures') },
        ]
      : []),
  ];
  return (
    <div className="flex flex-col gap-[16px]">
      <SettingsSubnav items={items} />
      {children}
    </div>
  );
}
