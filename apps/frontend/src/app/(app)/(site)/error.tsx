'use client';

import { RouteError } from '@gitroom/frontend/components/errors/route-error';

export default function SiteError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} />;
}
