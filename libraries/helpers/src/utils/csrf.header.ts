/**
 * CopilotKit's runtime client POSTs directly to the backend (bypassing the
 * `useFetch` wrapper), so it never picks up the CSRF header that csrf.middleware
 * requires on cookie-authenticated mutating routes. Without it every CopilotKit
 * handshake 403s on mount (#9). The `csrf_token` cookie is JS-readable
 * (httpOnly:false) — forward it as the `x-csrf-token` header.
 *
 * Returns `undefined` when the cookie is absent (SSR / header-auth clients) so
 * callers can spread it without sending an empty header.
 */
export const csrfHeader = (): { 'x-csrf-token': string } | undefined => {
  if (typeof document === 'undefined') {
    return undefined;
  }
  const raw =
    (document.cookie.split('; ').find((c) => c.startsWith('csrf_token=')) || '').split('=')[1] || '';
  const token = decodeURIComponent(raw);
  return token ? { 'x-csrf-token': token } : undefined;
};
