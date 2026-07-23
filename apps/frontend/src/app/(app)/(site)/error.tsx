'use client';

import { RouteError } from '@postmill-ai/frontend/components/errors/route-error';

export default function SiteError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} />;
}
