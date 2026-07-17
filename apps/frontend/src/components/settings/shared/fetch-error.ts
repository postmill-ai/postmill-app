/**
 * Pattern C helper for settings fetcher errors (dev/I18N_UPDATE.md §3.6).
 * Attaches a stable translation key to a thrown Error so the render site can
 * show a localized message while `error.message` keeps the exact English
 * fallback (byte-identical when no translation applies).
 */

export interface FetchError extends Error {
  messageKey?: string;
}

export function createFetchError(messageKey: string, fallback: string): FetchError {
  const err = new Error(fallback) as FetchError;
  err.messageKey = messageKey;
  return err;
}
