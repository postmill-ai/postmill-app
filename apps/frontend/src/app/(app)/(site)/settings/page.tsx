'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LEGACY_TAB_TO_PATH } from '@postmill-ai/frontend/components/settings/settings-paths';
import { SettingsIndexComponent } from '@postmill-ai/frontend/components/settings/settings-index';

// /settings is the settings landing page. It still honours `?tab=` deep-links —
// those are NOT legacy: the backend generates them today (dashboard summary
// cards, the short-link and integration exception filters) and `/dashboard/summary`
// is Redis-cached, so old links outlive any backend change.
//
// The redirect stays client-side (a server redirect() to a nested route is
// collapsed to 200 by the dev proxy — the "verify with Playwright not HTTP 307"
// gotcha). The target is computed during render, not only in the effect, so a
// `?tab=` link never paints the landing before bouncing.
//
// An unrecognised `?tab=` now falls through to the landing rather than being
// forced to one arbitrary section.
export default function SettingsIndex() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab');
  const target = tab ? LEGACY_TAB_TO_PATH[tab] : undefined;

  useEffect(() => {
    if (target) router.replace(target);
  }, [router, target]);

  if (target) return null;
  return <SettingsIndexComponent />;
}
