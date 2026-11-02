import i18next from 'i18next';
import { cookieName } from '@postmill-ai/react/translation/i18n.config';
import { SupportedLanguage } from '@postmill-ai/helpers/translation/languages';

let saveQueue: Promise<unknown> = Promise.resolve();

export const applyPreferredLanguage = (language: SupportedLanguage) => {
  document.cookie = `${cookieName}=${encodeURIComponent(language)};max-age=31536000;path=/`;
  document.documentElement.setAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
  return i18next.changeLanguage(language);
};

export const savePreferredLanguage = (
  fetch: (path: string, options: RequestInit) => Promise<Response>,
  preferredLanguage: SupportedLanguage
) => {
  const request = saveQueue.catch(() => undefined).then(() =>
    fetch('/user/preferred-language', {
      method: 'POST',
      body: JSON.stringify({ preferredLanguage }),
    })
  );
  saveQueue = request.catch(() => undefined);
  return request;
};
