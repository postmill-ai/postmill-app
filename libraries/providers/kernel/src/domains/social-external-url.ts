/**
 * Shared normalization for the user-supplied instance URL consumed by the
 * `SocialProvider.externalUrl` hook (dynamic per-instance client registration,
 * e.g. Mastodon's `POST {instance}/api/v1/apps`).
 *
 * The URL is user-influenced, so the contract is deliberately strict: https
 * only, no credentials, no path/query/fragment — just the bare origin. A bare
 * hostname ("mastodon.social") is accepted and upgraded to https. The
 * normalized origin is what gets stashed as `instanceUrl` and later decrypted
 * from `Integration.customInstanceDetails`, so every variable-host provider
 * (Mastodon today, self-hosted WordPress tomorrow) shares one validation.
 *
 * NOTE: this is request-shape validation, not SSRF protection — the actual
 * outbound call must still go through the kernel `safeFetch` port.
 */
export function normalizeExternalInstanceUrl(raw: string): string {
  const input = (raw ?? '').trim();
  if (!input) {
    throw new Error('Instance URL is required');
  }
  if (/^http:\/\//i.test(input)) {
    throw new Error('Instance URL must use https');
  }

  let parsed: URL;
  try {
    parsed = new URL(input.startsWith('https://') ? input : `https://${input}`);
  } catch {
    throw new Error(`Invalid instance URL: ${input}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Instance URL must use https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Instance URL must not embed credentials');
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(
      'Instance URL must be a bare server host (no path, query, or fragment)'
    );
  }

  // `origin` lowercases/punycodes the host and carries no trailing slash.
  return parsed.origin;
}
