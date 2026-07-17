import { createHmac } from 'crypto';
import { isSafePublicHttpsUrl } from './webhook.url.validator';
import { ssrfSafeDispatcher } from './ssrf.safe.dispatcher';
import {
  fetch as undiciFetch,
  type RequestInit as UndiciRequestInit,
} from 'undici';

const MAX_REDIRECTS = 5;

// D1: default outbound HTTP timeout (ms). Bounded but generous so a slow
// provider can't starve the publish concurrency pool indefinitely.
export const DEFAULT_OUTBOUND_TIMEOUT_MS = 30_000;
// D1: tighter budget for webhook dispatch specifically.
export const DEFAULT_WEBHOOK_TIMEOUT_MS = 10_000;

export function outboundTimeoutMs(): number {
  const v = Number(process.env.OUTBOUND_HTTP_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_OUTBOUND_TIMEOUT_MS;
}

export function webhookTimeoutMs(): number {
  const v = Number(process.env.WEBHOOK_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_WEBHOOK_TIMEOUT_MS;
}

// Merge a caller-supplied AbortSignal (if any) with a fresh timeout signal so
// whichever fires first aborts the request.
function withTimeoutSignal(
  caller: AbortSignal | undefined,
  ms: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return caller ? AbortSignal.any([caller, timeout]) : timeout;
}

// 1.4: credential-class headers that must NOT survive a cross-origin redirect.
// A provider endpoint that 302s to a CDN/third-party host would otherwise
// receive the org's API key (HeyGen artifact/status URLs legitimately redirect).
// Mirrors browser/undici auto-redirect behaviour (auth stripped off-origin).
const CREDENTIAL_HEADER_NAMES = [
  'authorization',
  'cookie',
  'x-api-key',
  'api-key',
  'apikey',
  'x-goog-api-key',
  'x-amz-security-token',
];

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// Return a shallow-cloned init with the credential-class headers removed.
// Handles Headers, array-of-pairs, and plain-object header shapes.
function stripCredentialHeaders(init: RequestInit | undefined): RequestInit {
  const next: RequestInit = { ...(init as RequestInit) };
  const src = next.headers;
  if (!src) {
    return next;
  }
  const out: Record<string, string> = {};
  const entries: Iterable<[string, string]> =
    src instanceof Headers
      ? (src as any).entries()
      : Array.isArray(src)
        ? (src as [string, string][])
        : Object.entries(src as Record<string, string>);
  for (const [k, v] of entries) {
    if (!CREDENTIAL_HEADER_NAMES.includes(k.toLowerCase())) {
      out[k] = v as string;
    }
  }
  next.headers = out;
  return next;
}

// D4: HMAC-SHA256 signature for an outbound webhook body. Secret is the
// deployment-wide WEBHOOK_SIGNING_SECRET; when unset it falls back to
// JWT_SECRET (mirroring EncryptionService's key-derivation) so signing is
// always on. Returns the `sha256=<hex>` value for the X-Postmill-Signature header.
export function webhookSignature(rawBody: string): string {
  const secret =
    process.env.WEBHOOK_SIGNING_SECRET || process.env.JWT_SECRET || '';
  return 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
}

// Use undici's own fetch (not the global one). The global fetch is backed by Node's
// BUILT-IN undici (v6 on Node 22), but `ssrfSafeDispatcher` is an Agent from the npm
// `undici` (v8). Dispatching a built-in-undici request handler through a v8 Agent throws
// `invalid onRequestStart method` (the handler API changed in undici 7/8) and every
// outbound provider/webhook publish fails. undici.fetch + undici.Agent are the same
// version, so the dispatcher is honoured (SSRF DNS-pinning preserved).
export async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  let currentUrl = url;
  let response: Response | undefined;

  // D1: bound the whole operation (across redirect hops) by a timeout, merged
  // with any caller-supplied signal. Webhook dispatch passes a tighter
  // WEBHOOK_TIMEOUT_MS signal via `init.signal`, which wins via AbortSignal.any.
  const timeoutMs = outboundTimeoutMs();
  const signal = withTimeoutSignal(
    (init as { signal?: AbortSignal } | undefined)?.signal,
    timeoutMs,
  );

  // 1.4: track the origin the credential headers were issued for; once a
  // redirect leaves it, strip them for all subsequent hops.
  const originalOrigin = originOf(url);
  let currentInit: RequestInit | undefined = init;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isSafePublicHttpsUrl(currentUrl))) {
      throw new Error('Blocked URL');
    }

    try {
      response = (await undiciFetch(currentUrl, {
        ...(currentInit as unknown as UndiciRequestInit),
        signal,
        redirect: 'manual',
        dispatcher: ssrfSafeDispatcher,
      })) as unknown as Response;
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new Error(`safeFetch request timed out after ${timeoutMs}ms`);
      }
      throw err;
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error('Redirect without Location');
      }
      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch {
        throw new Error('Invalid redirect target');
      }
      // 1.4: strip credential headers when the hop leaves the original origin.
      if (originalOrigin && originOf(currentUrl) !== originalOrigin) {
        currentInit = stripCredentialHeaders(currentInit);
      }
      continue;
    }

    return response;
  }

  if (!response) {
    throw new Error('No upstream response');
  }

  throw new Error('Too many redirects');
}
