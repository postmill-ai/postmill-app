/**
 * Read the real failure reason out of a non-OK API response.
 *
 * The media endpoints answer 409 with `{ error, category }` (the
 * DefaultNotConfiguredError envelope) and Nest's validation/billing layers
 * answer 400/402 with `message` — a plain string, or a string[] from the
 * global validation pipe. Nest's standard error body ALSO carries
 * `error: 'Bad Request'` (the generic HTTP reason phrase) next to the
 * specific `message`, so when both exist the specific one wins regardless of
 * which field holds it. Falls back to the caller's generic text when the
 * body carries nothing usable (or isn't JSON).
 */

// HTTP reason phrases Nest puts in `error` (or `message`) — never informative.
const GENERIC_REASONS = new Set([
  'Bad Request',
  'Unauthorized',
  'Forbidden',
  'Not Found',
  'Method Not Allowed',
  'Not Acceptable',
  'Request Timeout',
  'Conflict',
  'Gone',
  'Payload Too Large',
  'Unsupported Media Type',
  'Unprocessable Entity',
  'Too Many Requests',
  'Internal Server Error',
  'Bad Gateway',
  'Service Unavailable',
  'Gateway Timeout',
]);

export async function readErrorMessage(
  res: Response,
  fallback: string
): Promise<string> {
  try {
    const body = await res.json();
    const message = (() => {
      const m = body?.message;
      if (typeof m === 'string' && m) return m;
      if (Array.isArray(m)) {
        const joined = m
          .filter((x): x is string => typeof x === 'string')
          .join(' ');
        if (joined) return joined;
      }
      return null;
    })();
    const error =
      typeof body?.error === 'string' && body.error ? body.error : null;
    if (message && error) {
      return GENERIC_REASONS.has(message) && !GENERIC_REASONS.has(error)
        ? error
        : message;
    }
    return message || error || fallback;
  } catch {
    return fallback;
  }
}
