'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

// Client-side redirect (mirrors settings/page.tsx) — a server redirect() to a nested route
// collapses to an empty 200 on full load / refresh, leaving only the layout subnav.
export default function Page(): null {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  useEffect(() => {
    if (params?.id) router.replace(`/settings/ai/brands/${params.id}/voice`);
  }, [router, params?.id]);
  return null;
}
