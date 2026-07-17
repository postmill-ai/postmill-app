'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Client-side redirect (mirrors settings/page.tsx) — a server redirect() to a nested route
// collapses to an empty 200 on full load / refresh, leaving only the layout subnav.
export default function Page(): null {
  const router = useRouter();
  useEffect(() => {
    router.replace('/settings/ai/llm-providers');
  }, [router]);
  return null;
}
