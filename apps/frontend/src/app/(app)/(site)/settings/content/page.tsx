'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Client-side redirect (mirrors settings/page.tsx). A server redirect() to a nested route is
// collapsed to an empty 200 by the prod server, leaving only the layout subnav with no child
// content on a full page load / refresh / bookmark. router.replace navigates reliably.
export default function Page(): null {
  const router = useRouter();
  useEffect(() => {
    router.replace('/settings/content/ai-media');
  }, [router]);
  return null;
}
