/**
 * Read the real failure reason out of a non-OK API response.
 *
 * The media endpoints answer 409 with `{ error, category }` (the
 * DefaultNotConfiguredError envelope) and Nest's validation/billing layers
 * answer 400/402 with `message` — a plain string, or a string[] from the
 * global validation pipe. Falls back to the caller's generic text when the
 * body carries nothing usable (or isn't JSON).
 */
export async function readErrorMessage(
  res: Response,
  fallback: string
): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.error === 'string' && body.error) {
      return body.error;
    }
    const message = body?.message;
    if (typeof message === 'string' && message) {
      return message;
    }
    if (Array.isArray(message)) {
      const joined = message
        .filter((m): m is string => typeof m === 'string')
        .join(' ');
      if (joined) return joined;
    }
    return fallback;
  } catch {
    return fallback;
  }
}
