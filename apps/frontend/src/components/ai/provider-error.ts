// Upstream provider failures arrive as HTTP 502 with this envelope (see
// ProviderExceptionFilter). The point of the shape is attribution: the user's
// own Google / OpenAI / Runway account said no, and the UI must say so — a
// bare "Internal server error" reads as Postmill being broken.

export type ProviderErrorKind =
  | 'auth'
  | 'quota'
  | 'rate_limit'
  | 'invalid_request'
  | 'timeout'
  | 'unavailable'
  | 'unknown';

export interface ProviderError {
  provider: string;
  providerName: string;
  domain?: string;
  operation?: string;
  kind: ProviderErrorKind;
  upstreamStatus?: number;
  retryable?: boolean;
  message: string;
  settingsUrl?: string;
}

export interface ApiError {
  status: number;
  // Best human-readable message for a toast / inline line.
  message: string;
  // Present when the failure came from the org's provider, not Postmill.
  providerError?: ProviderError;
  // Raw parsed body (when JSON).
  body?: any;
}

export function providerErrorFromBody(body: any): ProviderError | undefined {
  if (!body || typeof body !== 'object') return undefined;
  if (body.error !== 'ProviderUpstreamError' || typeof body.message !== 'string') return undefined;
  return {
    provider: String(body.provider || ''),
    providerName: String(body.providerName || body.provider || 'The provider'),
    domain: body.domain,
    operation: body.operation,
    kind: (body.kind as ProviderErrorKind) || 'unknown',
    upstreamStatus: typeof body.upstreamStatus === 'number' ? body.upstreamStatus : undefined,
    retryable: !!body.retryable,
    message: body.message,
    settingsUrl: typeof body.settingsUrl === 'string' ? body.settingsUrl : undefined,
  };
}

function messageFromBody(body: any, text: string): string {
  if (body && typeof body === 'object') {
    const m = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    if (typeof m === 'string' && m) return m;
    if (typeof body.error === 'string' && body.error) return body.error;
  }
  return text;
}

// Read a failed Response once: JSON envelope → message + provider attribution;
// plain text → as-is. Never returns the raw JSON string as the message.
export async function readApiError(response: Response, fallback = 'Request failed'): Promise<ApiError> {
  let text = '';
  let body: any;
  if (typeof response.text === 'function') {
    text = (await response.text().catch(() => '')) || '';
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
  } else if (typeof response.json === 'function') {
    body = await response.json().catch(() => undefined);
  }
  const providerError = providerErrorFromBody(body);
  const message =
    (providerError && providerError.message) ||
    messageFromBody(body, body ? '' : text) ||
    `${fallback} (${response.status})`;
  return { status: response.status, message, providerError, body };
}

type Translate = (key: string, fallback: string, params?: Record<string, unknown>) => string;

// "Google AI Studio returned an error — this comes from your Google AI Studio
// account, not Postmill." + what the kind means for the user.
export function providerErrorHeadline(t: Translate, pe: ProviderError): string {
  return t(
    'provider_error_headline',
    '{{provider}} returned an error — this comes from your {{provider}} account, not Postmill.',
    { provider: pe.providerName }
  );
}

export function providerErrorAdvice(t: Translate, pe: ProviderError): string {
  switch (pe.kind) {
    case 'auth':
      return t('provider_error_auth', 'The API key was rejected. Check the key in Settings.');
    case 'quota':
      return t(
        'provider_error_quota',
        "The account's quota or billing limit was reached. Check the plan and billing on the provider's side."
      );
    case 'rate_limit':
      return t('provider_error_rate_limit', 'The provider is rate-limiting requests. Try again shortly.');
    case 'invalid_request':
      return t('provider_error_invalid_request', 'The provider rejected the request. Check the model and inputs.');
    case 'timeout':
    case 'unavailable':
      return t('provider_error_unavailable', 'The provider is unavailable right now. Try again later.');
    default:
      return t('provider_error_unknown', 'The provider reported a failure.');
  }
}

// One line for toasts: the attributed message plus the advice.
export function providerErrorToastText(t: Translate, pe: ProviderError): string {
  return `${pe.message} — ${providerErrorAdvice(t, pe)}`;
}
