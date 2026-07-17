'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  LEGACY_TAB_TO_PATH,
  SETTINGS_DEFAULT_PATH,
} from '@gitroom/frontend/components/settings/settings-paths';

// /settings has no content of its own — it redirects to the default section, mapping any
// legacy `?tab=` deep-link (OAuth return URIs, old bookmarks, dashboard onboarding cards) to
// its new nested path. Done client-side via router.replace so it navigates reliably in both
// the dev proxy and production (a server redirect() to a nested route is collapsed to 200 by
// the dev proxy — the "verify with Playwright not HTTP 307" gotcha).
export default function SettingsIndex(): null {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const tab = searchParams.get('tab');
    router.replace((tab && LEGACY_TAB_TO_PATH[tab]) || SETTINGS_DEFAULT_PATH);
  }, [router, searchParams]);
  return null;
}
