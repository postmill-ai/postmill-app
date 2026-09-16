import { describe, it, expect, vi } from 'vitest';
import { ArgumentsHost } from '@nestjs/common';
import {
  ProviderVersionRetiredError,
  ProviderKernel,
  ContentPackDailyCapError,
  ProviderUpstreamError,
} from '@postmill-ai/provider-kernel';
import * as Sentry from '@sentry/nestjs';

vi.mock('@sentry/nestjs', () => ({ captureMessage: vi.fn() }));
import { ProviderExceptionFilter } from './provider-exception.filter';

/**
 * PROVIDER_VERSIONS.md §14.4 — "A retired-version simulation yields 410/banner,
 * never a silent fallthrough."
 *
 * This exercises the HTTP-status side of the retired path: a typed
 * ProviderVersionRetiredError must be mapped by the global exception filter to
 * HTTP 410 Gone with a body carrying { providerId, version, latestActive } —
 * never swallowed or silently resolved to another version.
 */
describe('ProviderExceptionFilter — retired version → 410', () => {
  const makeHost = () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const response = { status, json };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;
    return { host, status, json };
  };

  it('maps ProviderVersionRetiredError to HTTP 410 with providerId/version/latestActive', () => {
    const kernel = {
      latestActive: vi
        .fn()
        .mockReturnValue({ manifest: { version: 'v2' } }),
    } as unknown as ProviderKernel;

    const filter = new ProviderExceptionFilter(kernel);
    const { host, status, json } = makeHost();

    const error = new ProviderVersionRetiredError({
      domain: 'ai',
      providerId: 'openai',
      version: 'v1',
    });

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(410);
    expect(json).toHaveBeenCalledTimes(1);
    const body = json.mock.calls[0][0];
    expect(body).toMatchObject({
      providerId: 'openai',
      version: 'v1',
      latestActive: 'v2',
    });
  });

  it('returns 410 even when there is no active version to fall back to (no silent fallthrough)', () => {
    const kernel = {
      latestActive: vi.fn().mockReturnValue(undefined),
    } as unknown as ProviderKernel;

    const filter = new ProviderExceptionFilter(kernel);
    const { host, status, json } = makeHost();

    const error = new ProviderVersionRetiredError({
      domain: 'ai',
      providerId: 'openai',
      version: 'v1',
    });

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(410);
    const body = json.mock.calls[0][0];
    expect(body).toMatchObject({ providerId: 'openai', version: 'v1' });
    expect(body.latestActive).toBeUndefined();
  });

  it('1.7: maps ContentPackDailyCapError to HTTP 402 with the message', () => {
    const kernel = {
      latestActive: vi.fn(),
    } as unknown as ProviderKernel;

    const filter = new ProviderExceptionFilter(kernel);
    const { host, status, json } = makeHost();

    filter.catch(new ContentPackDailyCapError('Daily cap reached'), host);

    expect(status).toHaveBeenCalledWith(402);
    const body = json.mock.calls[0][0];
    expect(body.message).toBe('Daily cap reached');
  });

  // Upstream provider failures: 502 + an envelope the UI attributes to the
  // provider. Never the upstream status itself (401 → logout, 429 → Postmill
  // rate-limit toast, 402 → Postmill billing).
  describe('ProviderUpstreamError → 502 envelope', () => {
    const filter = () => new ProviderExceptionFilter({ latestActive: vi.fn() } as unknown as ProviderKernel);

    it('maps a media quota error to 502 with provider, kind and settings link; no Sentry event', () => {
      (Sentry.captureMessage as any).mockClear();
      const { host, status, json } = makeHost();
      const err = new ProviderUpstreamError(
        { domain: 'media', providerId: 'google', providerName: 'Google AI Studio', operation: 'image' },
        'quota',
        'You exceeded your current quota',
        429,
      );

      filter().catch(err, host);

      expect(status).toHaveBeenCalledWith(502);
      expect(json).toHaveBeenCalledWith({
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
      });
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it('maps an AI auth error to 502 (never 401) and links to AI settings', () => {
      const { host, status, json } = makeHost();
      filter().catch(
        new ProviderUpstreamError({ domain: 'ai', providerId: 'openai', providerName: 'OpenAI' }, 'auth', 'Incorrect API key', 401),
        host,
      );
      expect(status).toHaveBeenCalledWith(502);
      expect(json.mock.calls[0][0]).toMatchObject({ kind: 'auth', upstreamStatus: 401, settingsUrl: '/settings/ai' });
    });

    it('captures outages (unavailable/timeout/unknown) as Sentry warnings tagged by provider', () => {
      (Sentry.captureMessage as any).mockClear();
      const { host } = makeHost();
      filter().catch(
        new ProviderUpstreamError({ domain: 'media', providerId: 'runway', providerName: 'Runway' }, 'unavailable', 'overloaded', 503),
        host,
      );
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        'Runway is unavailable right now (HTTP 503): overloaded',
        expect.objectContaining({ level: 'warning', tags: { provider: 'runway', domain: 'media', kind: 'unavailable' } }),
      );
    });
  });
});
