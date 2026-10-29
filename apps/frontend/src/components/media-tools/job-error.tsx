'use client';

import React, { FC } from 'react';
import Link from 'next/link';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { presentJobError } from '@postmill-ai/frontend/components/ai/provider-error';

export const JobErrorText: FC<{ error: string; className?: string }> = ({ error, className }) => {
  const t = useT();
  const envelope = presentJobError(t, error);
  const message = envelope.message;
  return (
    <div className={className} title={message}>
      {message}
      {envelope?.settingsUrl && (
        <>
          {' '}
          <Link href={envelope.settingsUrl} className="underline">
            {t('provider_error_open_settings', 'Open settings')}
          </Link>
        </>
      )}
    </div>
  );
};
