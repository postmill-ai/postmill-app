import { describe, it, expect } from 'vitest';
import {
  providerErrorFromBody,
  providerErrorToastText,
  readApiError,
} from './provider-error';

const t = (_key: string, fallback: string, params?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(params?.[k] ?? ''));

const res = (status: number, body: string) =>
  ({ status, text: async () => body }) as unknown as Response;

const ENVELOPE = {
  statusCode: 502,
  error: 'ProviderUpstreamError',
  provider: 'google',
  providerName: 'Google AI Studio',
  domain: 'media',
  operation: 'image',
  kind: 'quota',
  upstreamStatus: 429,
  retryable: false,
  message: "Google AI Studio reports the account's quota or billing limit was reached (HTTP 429): You exceeded your current quota",
  settingsUrl: '/settings/content/ai-media',
};

describe('readApiError', () => {
  it('reads the 502 provider envelope into an attributed error', async () => {
    const out = await readApiError(res(502, JSON.stringify(ENVELOPE)));
    expect(out.status).toBe(502);
    expect(out.message).toBe(ENVELOPE.message);
    expect(out.providerError).toMatchObject({ provider: 'google', providerName: 'Google AI Studio', kind: 'quota', upstreamStatus: 429 });
  });

  it('never surfaces raw JSON as the message (Nest {statusCode,message})', async () => {
    const out = await readApiError(res(500, '{"statusCode":500,"message":"Internal server error"}'));
    expect(out.message).toBe('Internal server error');
    expect(out.providerError).toBeUndefined();
  });

  it('falls back to plain text, then to the fallback + status', async () => {
    expect((await readApiError(res(400, 'bad input'))).message).toBe('bad input');
    expect((await readApiError(res(503, ''), 'Generation failed')).message).toBe('Generation failed (503)');
  });

  it('uses {error} when there is no message (pre-flight generator catch)', async () => {
    expect((await readApiError(res(429, '{"error":"AI budget exceeded"}'))).message).toBe('AI budget exceeded');
  });
});

describe('providerErrorToastText', () => {
  it('appends kind-specific advice to the attributed message', () => {
    const pe = providerErrorFromBody(ENVELOPE)!;
    expect(providerErrorToastText(t, pe)).toBe(
      `${ENVELOPE.message} — The account's quota or billing limit was reached. Check the plan and billing on the provider's side.`
    );
    expect(providerErrorToastText(t, { ...pe, kind: 'auth' })).toContain('The API key was rejected');
    expect(providerErrorToastText(t, { ...pe, kind: 'unavailable' })).toContain('unavailable right now');
  });

  it('ignores non-envelope bodies', () => {
    expect(providerErrorFromBody({ error: 'BudgetExceeded', message: 'x' })).toBeUndefined();
    expect(providerErrorFromBody('text')).toBeUndefined();
  });
});
