import { useEffect, useRef } from 'react';
import i18next from 'i18next';
import { normalizeSupportedLanguage } from '@postmill-ai/helpers/translation/languages';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import {
  applyPreferredLanguage,
  savePreferredLanguage,
} from './preferred-language.client';

export const usePreferredLanguageSync = (
  user:
    | {
        id: string;
        profile?: { preferredLanguage?: string | null } | null;
      }
    | undefined,
  fetch: (path: string, options: RequestInit) => Promise<Response>
) => {
  const syncedUser = useRef<string | null>(null);
  const t = useT();
  const toaster = useToaster();

  useEffect(() => {
    if (!user?.id || syncedUser.current === user.id) return;
    syncedUser.current = user.id;

    const saved = normalizeSupportedLanguage(user.profile?.preferredLanguage);
    if (saved) {
      void applyPreferredLanguage(saved);
      return;
    }

    const current = normalizeSupportedLanguage(i18next.resolvedLanguage) || 'en';
    void savePreferredLanguage(fetch, current).then((response) => {
      if (!response.ok) throw new Error('Language save failed');
    }).catch(() => {
      toaster.show(
        t(
          'preferred_language_save_failed',
          'Your language preference could not be saved. Please try again.'
        ),
        'warning'
      );
    });
  }, [fetch, t, toaster, user]);
};
