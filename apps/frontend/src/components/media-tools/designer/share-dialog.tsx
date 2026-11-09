'use client';

import React, { FC, useState } from 'react';
import { Button } from '@postmill-ai/react/form/button';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

export const designShareUrl = (designId: string, origin: string): string => {
  const url = new URL('/media/designer', origin);
  url.searchParams.set('designId', designId);
  return url.toString();
};

export const ShareDialog: FC<{
  designId: string;
  initialCollabEnabled: boolean;
  connectedCount: number;
  onToggleCollaboration: (enabled: boolean) => void;
}> = ({ designId, initialCollabEnabled, connectedCount, onToggleCollaboration }) => {
  const t = useT();
  const [collabEnabled, setCollabEnabled] = useState(initialCollabEnabled);
  const [copied, setCopied] = useState(false);
  const url = designShareUrl(designId, window.location.origin);

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
  };
  const toggle = () => {
    const next = !collabEnabled;
    setCollabEnabled(next);
    onToggleCollaboration(next);
  };

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-[12px] text-textColor/70">
        {t('designer_share_link', 'Design link')}
        <div className="flex gap-2">
          <input
            aria-label={t('designer_share_link', 'Design link')}
            readOnly
            value={url}
            onFocus={(event) => event.currentTarget.select()}
            className="min-w-0 flex-1 rounded-md border border-studioBorder bg-newBgColor px-3 py-2 text-[12px] text-textColor"
          />
          <Button onClick={copy}>{copied ? t('copied', 'Copied') : t('copy_link', 'Copy link')}</Button>
        </div>
      </label>
      <p className="text-[11px] text-newTextColor/60">
        {t('designer_share_link_hint', 'Anyone in this organization can use this link to open the saved design directly.')}
      </p>
      <div className="flex items-center justify-between gap-3 border-t border-studioBorder pt-3">
        <div>
          <div className="text-[12px] font-medium text-textColor">
            {t('designer_realtime_collaboration', 'Real-time collaboration')}
          </div>
          <div className="text-[11px] text-newTextColor/60">
            {collabEnabled
              ? t('peers_connected_count', '{{count}} connected', { count: connectedCount })
              : t('designer_collaboration_off', 'Collaboration is off')}
          </div>
        </div>
        <Button secondary onClick={toggle}>
          {collabEnabled ? t('designer_stop_sharing', 'Stop Sharing') : t('designer_enable_sharing', 'Enable collaboration')}
        </Button>
      </div>
    </div>
  );
};
