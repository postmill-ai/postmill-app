import { ProviderErrorContext } from './errors';
import { redactError } from './domains/media-guards';

// Upstream provider failures (the org's Google / OpenAI / Runway … account said
// no) are NOT Postmill failures, and the plumbing has to keep them apart:
//
// - A plain `Error("X failed: " + body)` reaches Nest's default handler as a
//   500 "Internal server error" — the user reads it as a Postmill outage, and
//   Sentry files it as one.
// - The AI SDK's `APICallError` carries `statusCode` + `message`, and
//   BaseExceptionFilter.handleUnknownError duck-types that as an HTTP error and
//   replays the PROVIDER's status as OUR response: a provider 401 logs the user
//   out (frontend treats 401 as session expiry), a provider 429 shows
//   Postmill's "too many requests" toast, 402 opens Postmill billing.
//
// So every adapter converts a non-OK upstream response / SDK error into a
// ProviderUpstreamError. It deliberately has NO `statusCode` property (the
// upstream status lives in `upstreamStatus`); ProviderExceptionFilter maps it
// to 502 with an envelope the frontend can attribute to the provider.

export type UpstreamErrorKind =
  | 'auth'
  | 'quota'
  | 'rate_limit'
  | 'invalid_request'
  | 'timeout'
  | 'unavailable'
  | 'unknown';

export interface UpstreamErrorContext extends ProviderErrorContext {
  // Display name shown to the user ("Google AI Studio", "OpenAI").
  providerName: string;
  operation?: string;
}

const RETRYABLE_KINDS: ReadonlySet<UpstreamErrorKind> = new Set([
  'rate_limit',
  'timeout',
  'unavailable',
]);

const DETAIL_MAX = 300;

export class ProviderUpstreamError extends Error {
  readonly retryable: boolean;

  constructor(
    public readonly ctx: UpstreamErrorContext,
    public readonly kind: UpstreamErrorKind,
    public readonly detail: string,
    public readonly upstreamStatus?: number,
    retryable?: boolean,
  ) {
    super(upstreamErrorMessage(ctx, kind, detail, upstreamStatus));
    this.name = 'ProviderUpstreamError';
    this.retryable = retryable ?? RETRYABLE_KINDS.has(kind);
  }

  // For text that is ALREADY attributed (a poll result's `error` produced by
  // upstreamFailureText) — rethrow it without prefixing the provider twice.
  static fromAttributedText(
    ctx: UpstreamErrorContext,
    text: string,
    kind: UpstreamErrorKind = 'unknown',
  ): ProviderUpstreamError {
    const err = new ProviderUpstreamError(ctx, kind, '');
    err.message = text;
    return err;
  }
}

// "Google AI Studio reports the account's quota or billing limit was reached (HTTP 429): …"
export function upstreamErrorMessage(
  ctx: Pick<UpstreamErrorContext, 'providerName'>,
  kind: UpstreamErrorKind,
  detail: string,
  upstreamStatus?: number,
): string {
  const status = upstreamStatus ? ` (HTTP ${upstreamStatus})` : '';
  const phrase = {
    auth: 'rejected the API key',
    quota: "reports the account's quota or billing limit was reached",
    rate_limit: 'is rate-limiting requests',
    invalid_request: 'rejected the request',
    timeout: 'did not answer in time',
    unavailable: 'is unavailable right now',
    unknown: 'returned an error',
  }[kind];
  const tail = detail ? `: ${detail}` : '';
  return `${ctx.providerName} ${phrase}${status}${tail}`;
}

const QUOTA_HINT = /quota|billing|credit|balance|insufficient|exceeded your|plan/i;
// Some providers answer a bad key with 400 (Google: API_KEY_INVALID) or 403.
const AUTH_HINT = /api[ _-]?key|invalid[ _-]?key|unauthenticated|unauthori[sz]ed|API_KEY_INVALID|PERMISSION_DENIED|incorrect.*key/i;

export function classifyUpstream(
  status: number | undefined,
  body = '',
): UpstreamErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 400 && AUTH_HINT.test(body)) return 'auth';
  if (status === 402) return 'quota';
  if (status === 429) return QUOTA_HINT.test(body) ? 'quota' : 'rate_limit';
  if (status === 408 || status === 504) return 'timeout';
  if (status !== undefined && status >= 500) return 'unavailable';
  if (
    status === 400 ||
    status === 404 ||
    status === 409 ||
    status === 413 ||
    status === 415 ||
    status === 422
  ) {
    return 'invalid_request';
  }
  return 'unknown';
}

// One human line out of the usual JSON error shapes:
//   {error:{message}} (Google, OpenAI), {error:"…"}, {message}, {detail} (X, FastAPI),
//   {errors:[{message|title}]}, {title}. Falls back to the raw body. Always
//   redacted (signed-URL params) and bounded.
export function extractUpstreamDetail(body: string): string {
  const raw = (body || '').trim();
  let candidate = raw;
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      const found = pickMessage(parsed);
      if (found) candidate = found;
    } catch {
      /* not JSON */
    }
  }
  const firstLine = candidate.split(/\r?\n/).find((l) => l.trim()) || '';
  return redactError(firstLine.trim(), DETAIL_MAX);
}

function pickMessage(parsed: any): string | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const str = (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : null;
  const err = parsed.error;
  if (err && typeof err === 'object') {
    const m = str(err.message) || str(err.detail) || str(err.msg);
    if (m) return m;
  }
  const errors = Array.isArray(parsed.errors) ? parsed.errors[0] : null;
  return (
    str(err) ||
    str(parsed.message) ||
    str(parsed.detail) ||
    str(parsed.msg) ||
    (errors && (str(errors.message) || str(errors.title) || str(errors.detail))) ||
    str(parsed.title) ||
    null
  );
}

// Build the error for a non-OK fetch Response. Reads the body once.
export async function upstreamErrorFromResponse(
  ctx: UpstreamErrorContext,
  res: Pick<Response, 'status' | 'text'>,
): Promise<ProviderUpstreamError> {
  let body = '';
  try {
    body = await res.text();
  } catch {
    /* unreadable body — status alone still classifies */
  }
  return upstreamErrorFromBody(ctx, res.status, body);
}

export function upstreamErrorFromBody(
  ctx: UpstreamErrorContext,
  status: number | undefined,
  body: string,
): ProviderUpstreamError {
  return new ProviderUpstreamError(
    ctx,
    classifyUpstream(status, body),
    extractUpstreamDetail(body),
    status,
  );
}

// The same wording for poll paths that report `{ status: 'failed', error }`
// instead of throwing.
export function upstreamFailureText(
  ctx: UpstreamErrorContext,
  status: number | undefined,
  body: string,
): string {
  return upstreamErrorFromBody(ctx, status, body).message;
}

// Vercel AI SDK errors are identified by symbol, not class: the tree carries
// several @ai-sdk/provider copies, so `instanceof` misses most of them.
const AI_API_CALL_ERROR_MARKER = Symbol.for('vercel.ai.error.AI_APICallError');

function isAiSdkApiCallError(err: any): err is {
  statusCode?: number;
  responseBody?: string;
  isRetryable?: boolean;
  message: string;
} {
  return !!err && typeof err === 'object' && err[AI_API_CALL_ERROR_MARKER] === true;
}

// Convert an SDK / network error into a ProviderUpstreamError, or return null
// when it is not an upstream failure (caller rethrows the original).
export function upstreamErrorFromUnknown(
  ctx: UpstreamErrorContext,
  err: unknown,
): ProviderUpstreamError | null {
  if (err instanceof ProviderUpstreamError) return err;
  if (!err || typeof err !== 'object') return null;
  const e = err as any;

  if (isAiSdkApiCallError(e)) {
    const body = typeof e.responseBody === 'string' ? e.responseBody : '';
    const status = typeof e.statusCode === 'number' ? e.statusCode : undefined;
    const kind = classifyUpstream(status, body || e.message);
    const detail = extractUpstreamDetail(body) || extractUpstreamDetail(e.message);
    return new ProviderUpstreamError(
      ctx,
      kind,
      detail,
      status,
      typeof e.isRetryable === 'boolean' ? e.isRetryable : undefined,
    );
  }

  // Gateway / OpenRouter style: a thrown object carrying the upstream status.
  if (typeof e.statusCode === 'number' && typeof e.message === 'string') {
    return new ProviderUpstreamError(
      ctx,
      classifyUpstream(e.statusCode, e.message),
      extractUpstreamDetail(e.message),
      e.statusCode,
    );
  }

  if (e.name === 'AbortError' || e.name === 'TimeoutError') {
    return new ProviderUpstreamError(ctx, 'timeout', extractUpstreamDetail(e.message || ''));
  }
  // undici / fetch network failure: TypeError("fetch failed") with a cause.
  if (e instanceof TypeError && /fetch failed|network|ECONN|ENOTFOUND|EAI_AGAIN/i.test(
    `${e.message} ${(e as any).cause?.code || ''}`,
  )) {
    return new ProviderUpstreamError(
      ctx,
      'unavailable',
      extractUpstreamDetail((e as any).cause?.message || e.message || 'network error'),
    );
  }
  return null;
}

// ── Media adapter conveniences ───────────────────────────────────────────
// Every media adapter exposes `identifier` + `name`, so the call sites stay
// one-liners:  if (!res.ok) throw await mediaUpstreamError(this, res, 'image');

export interface UpstreamAdapterLike {
  identifier: string;
  name: string;
}

export function mediaUpstreamCtx(
  adapter: UpstreamAdapterLike,
  operation?: string,
): UpstreamErrorContext {
  return {
    domain: 'media',
    providerId: adapter.identifier,
    providerName: adapter.name,
    ...(operation ? { operation } : {}),
  };
}

export function mediaUpstreamError(
  adapter: UpstreamAdapterLike,
  res: Pick<Response, 'status' | 'text'>,
  operation?: string,
): Promise<ProviderUpstreamError> {
  return upstreamErrorFromResponse(mediaUpstreamCtx(adapter, operation), res);
}

// Poll paths report `{ status: 'failed', error }` instead of throwing.
export function mediaUpstreamFailure(
  adapter: UpstreamAdapterLike,
  status: number | undefined,
  body: string,
  operation?: string,
): string {
  return upstreamFailureText(mediaUpstreamCtx(adapter, operation), status, body);
}

// SDK-backed adapters: rethrow as upstream when the SDK error says so.
export function mediaUpstreamFromUnknown(
  adapter: UpstreamAdapterLike,
  err: unknown,
  operation?: string,
): unknown {
  return upstreamErrorFromUnknown(mediaUpstreamCtx(adapter, operation), err) ?? err;
}

// Provider-reported failure inside an otherwise-OK response (a 200 whose body
// says "failed"), or a body that is not a fetch Response.
export function mediaUpstreamFromBody(
  adapter: UpstreamAdapterLike,
  status: number | undefined,
  body: string,
  operation?: string,
): ProviderUpstreamError {
  return upstreamErrorFromBody(mediaUpstreamCtx(adapter, operation), status, body);
}

// Rethrow a poll result's already-attributed `error` text as a typed error.
export function mediaUpstreamFromPoll(
  adapter: UpstreamAdapterLike,
  text: string,
  operation?: string,
): ProviderUpstreamError {
  const ctx = mediaUpstreamCtx(adapter, operation);
  return text.startsWith(`${adapter.name} `)
    ? ProviderUpstreamError.fromAttributedText(ctx, text)
    : upstreamErrorFromBody(ctx, undefined, text);
}
