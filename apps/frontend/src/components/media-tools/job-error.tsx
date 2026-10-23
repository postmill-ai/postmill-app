'use client';

import React, { FC } from 'react';
import Link from 'next/link';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { parseJobError } from '@postmill-ai/frontend/components/ai/provider-error';

// Failed-job error line for the render queues. Unwraps the structured
// envelope the lifecycle stores for provider-attributed failures (kind +
// settingsUrl) so a quota/billing failure links straight to Settings;
// plain-string errors render verbatim, exactly as before.
export const JobErrorText: FC<{ error: string; className?: string }> = ({ error, className }) => {
  const t = useT();
  const envelope = parseJobError(error);
  const message = envelope?.message ?? error;
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
