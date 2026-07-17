'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Client-side redirect (like settings/page.tsx). A server redirect() to /agents/new collapses to
// an empty 200 in prod, so /agents rendered only the layout shell (thread list + "Start a new
// chat") with the CopilotChat page never mounting — the agent chat appeared blank/unusable.
export default function Page(): null {
  const router = useRouter();
  useEffect(() => {
    router.replace('/agents/new');
  }, [router]);
  return null;
}
