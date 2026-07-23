'use client';

import { RouteError } from '@postmill-ai/frontend/components/errors/route-error';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

export default function MediaError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  return (
    <RouteError
      {...props}
      title={t('media_tool_error_title', 'This media tool hit a snag')}
    />
  );
}
