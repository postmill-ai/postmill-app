import { describe, it, expect } from 'vitest';
import {
  ProviderUpstreamError,
  classifyUpstream,
  extractUpstreamDetail,
  upstreamErrorFromResponse,
  upstreamErrorFromUnknown,
  upstreamFailureText,
} from './upstream-error';

const ctx = { domain: 'media', providerId: 'google', providerName: 'Google AI Studio', operation: 'image' };

// The exact body behind Sentry POSTMILL-APP-P.
const GOOGLE_429 = JSON.stringify({
  error: {
    code: 429,
    message:
      'You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_input_token_count, limit: 0, model: gemini-2.5-flash-preview-image',
    status: 'RESOURCE_EXHAUSTED',
  },
});

describe('classifyUpstream', () => {
  it.each([
    [401, '', 'auth'],
    [403, '', 'auth'],
    [402, '', 'quota'],
    [429, GOOGLE_429, 'quota'],
    [429, '{"error":"Rate limit reached for requests"}', 'rate_limit'],
    [408, '', 'timeout'],
    [504, '', 'timeout'],
    [400, '', 'invalid_request'],
    [400, '{"error":{"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}', 'auth'],
    [404, '', 'invalid_request'],
    [422, '', 'invalid_request'],
    [500, '', 'unavailable'],
    [503, '', 'unavailable'],
    [418, '', 'unknown'],
    [undefined, '', 'unknown'],
  ])('%s → %s', (status, body, kind) => {
    expect(classifyUpstream(status as number | undefined, body as string)).toBe(kind);
  });
});

describe('extractUpstreamDetail', () => {
  it('reads Google / OpenAI {error:{message}} and keeps only the first line', () => {
    expect(extractUpstreamDetail(GOOGLE_429)).toBe(
      'You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.',
    );
  });
  it.each([
    ['{"error":"Invalid API key"}', 'Invalid API key'],
    ['{"message":"Bad prompt"}', 'Bad prompt'],
    ['{"detail":"Not enough credits"}', 'Not enough credits'],
    ['{"errors":[{"message":"Unknown user"}]}', 'Unknown user'],
    ['{"title":"Forbidden","status":403}', 'Forbidden'],
    ['plain text failure', 'plain text failure'],
    ['', ''],
  ])('%s → %s', (body, detail) => {
    expect(extractUpstreamDetail(body)).toBe(detail);
  });
  it('redacts signed-URL params and bounds the length', () => {
    const long = 'x'.repeat(1000);
    expect(extractUpstreamDetail(long)).toHaveLength(300);
    expect(extractUpstreamDetail('see https://h/f?X-Amz-Signature=abc&x=1')).toContain('X-Amz-Signature=[REDACTED]');
  });
});

describe('ProviderUpstreamError', () => {
  it('names the provider and the kind in the message, and never exposes statusCode', () => {
    const err = new ProviderUpstreamError(ctx, 'quota', 'You exceeded your current quota', 429);
    expect(err.message).toBe(
      "Google AI Studio reports the account's quota or billing limit was reached (HTTP 429): You exceeded your current quota",
    );
    expect(err.name).toBe('ProviderUpstreamError');
    expect(err.upstreamStatus).toBe(429);
    // Nest's BaseExceptionFilter duck-types {statusCode, message} as an HTTP
    // error and would replay the provider's status as ours.
    expect('statusCode' in err).toBe(false);
    expect(err.retryable).toBe(false);
  });

  it.each([
    ['auth', 401, 'OpenAI rejected the API key (HTTP 401): bad key', false],
    ['rate_limit', 429, 'OpenAI is rate-limiting requests (HTTP 429): bad key', true],
    ['unavailable', 503, 'OpenAI is unavailable right now (HTTP 503): bad key', true],
    ['timeout', undefined, 'OpenAI did not answer in time: bad key', true],
    ['invalid_request', 400, 'OpenAI rejected the request (HTTP 400): bad key', false],
    ['unknown', undefined, 'OpenAI returned an error: bad key', false],
  ])('%s phrasing', (kind, status, message, retryable) => {
    const err = new ProviderUpstreamError(
      { domain: 'ai', providerId: 'openai', providerName: 'OpenAI' },
      kind as any,
      'bad key',
      status as number | undefined,
    );
    expect(err.message).toBe(message);
    expect(err.retryable).toBe(retryable);
  });
});

describe('upstreamErrorFromResponse / upstreamFailureText', () => {
  it('reads the body once and classifies from status + body', async () => {
    const res = { status: 429, text: async () => GOOGLE_429 };
    const err = await upstreamErrorFromResponse(ctx, res);
    expect(err).toBeInstanceOf(ProviderUpstreamError);
    expect(err.kind).toBe('quota');
    expect(err.message).toContain('Google AI Studio reports the account');
    expect(err.message).toContain('You exceeded your current quota');
  });
  it('survives an unreadable body', async () => {
    const res = { status: 502, text: async () => { throw new Error('stream closed'); } };
    const err = await upstreamErrorFromResponse(ctx, res);
    expect(err.kind).toBe('unavailable');
    expect(err.message).toBe('Google AI Studio is unavailable right now (HTTP 502)');
  });
  it('gives poll paths the same wording', () => {
    expect(upstreamFailureText(ctx, 401, '{"error":{"message":"API key not valid"}}')).toBe(
      'Google AI Studio rejected the API key (HTTP 401): API key not valid',
    );
  });
});

describe('upstreamErrorFromUnknown', () => {
  const aiCtx = { domain: 'ai', providerId: 'openai', providerName: 'OpenAI' };

  it('recognises the AI SDK APICallError by its symbol marker (not instanceof)', () => {
    const err: any = new Error('Incorrect API key provided: sk-abc***');
    err[Symbol.for('vercel.ai.error.AI_APICallError')] = true;
    err.statusCode = 401;
    err.responseBody = '{"error":{"message":"Incorrect API key provided: sk-abc***","type":"invalid_request_error"}}';
    err.isRetryable = false;
    const out = upstreamErrorFromUnknown(aiCtx, err)!;
    expect(out.kind).toBe('auth');
    expect(out.upstreamStatus).toBe(401);
    expect(out.message).toBe('OpenAI rejected the API key (HTTP 401): Incorrect API key provided: sk-abc***');
    expect('statusCode' in out).toBe(false);
  });

  it('classifies a gateway-style {statusCode, message} object', () => {
    const out = upstreamErrorFromUnknown(aiCtx, Object.assign(new Error('Rate limit'), { statusCode: 429 }))!;
    expect(out.kind).toBe('rate_limit');
  });

  it('maps aborts to timeout and fetch network failures to unavailable', () => {
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    expect(upstreamErrorFromUnknown(aiCtx, abort)!.kind).toBe('timeout');
    const net = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    expect(upstreamErrorFromUnknown(aiCtx, net)!.kind).toBe('unavailable');
  });

  it('passes a ProviderUpstreamError through and returns null for anything else', () => {
    const own = new ProviderUpstreamError(aiCtx, 'auth', 'x', 401);
    expect(upstreamErrorFromUnknown(aiCtx, own)).toBe(own);
    expect(upstreamErrorFromUnknown(aiCtx, new Error('AI budget exceeded'))).toBeNull();
    expect(upstreamErrorFromUnknown(aiCtx, 'string')).toBeNull();
  });
});
