export const SUPPORTED_LANGUAGES = [
  'en',
  'ru',
  'zh',
  'fr',
  'es',
  'pt',
  'de',
  'it',
  'ja',
  'ko',
  'ar',
  'tr',
  'vi',
  'nl',
  'id',
  'pl',
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const normalizeSupportedLanguage = (
  value: unknown
): SupportedLanguage | null => {
  if (typeof value !== 'string') return null;
  const match = value.trim().toLowerCase().match(/^([a-z]{2})(?:-[a-z0-9]+)?$/);
  const base = match?.[1] || '';
  return SUPPORTED_LANGUAGES.includes(base as SupportedLanguage)
    ? (base as SupportedLanguage)
    : null;
};
