'use client';

import { RouteError } from '@postmill-ai/frontend/components/errors/route-error';

export default function SetupError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} />;
}
