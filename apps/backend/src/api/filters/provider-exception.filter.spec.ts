import { describe, it, expect, vi } from 'vitest';
import { ArgumentsHost } from '@nestjs/common';
import {
  ProviderVersionRetiredError,
  ProviderKernel,
  ContentPackDailyCapError,
} from '@gitroom/provider-kernel';
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
});
