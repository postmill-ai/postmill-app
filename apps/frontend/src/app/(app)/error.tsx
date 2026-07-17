'use client';

import { RouteError } from '@gitroom/frontend/components/errors/route-error';

export default function AppError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} />;
}
