import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getDispatcher: vi.fn(),
  isSafeUrl: vi.fn(),
}));

vi.mock('undici', () => ({ fetch: mocks.fetch }));
vi.mock('./webhook.url.validator', () => ({
  isSafePublicHttpsUrl: mocks.isSafeUrl,
}));
vi.mock('./ssrf.safe.dispatcher', () => ({
  getSsrfSafeDispatcher: mocks.getDispatcher,
}));

import { safeFetch } from './safe.fetch';

describe('safeFetch IP family selection', () => {
  beforeEach(() => {
    mocks.fetch.mockReset().mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Map(),
    });
    mocks.getDispatcher.mockReset().mockImplementation((ipFamily) => ({ ipFamily }));
    mocks.isSafeUrl.mockReset().mockResolvedValue(true);
  });

  it('uses the family dispatcher and strips custom options before undici', async () => {
    await safeFetch('https://api.provider.example/generate', {
      method: 'POST',
      ipFamily: 4,
      timeoutMs: 1_000,
    });

    expect(mocks.getDispatcher).toHaveBeenCalledWith(4);
    const init = mocks.fetch.mock.calls[0][1];
    expect(init.dispatcher).toEqual({ ipFamily: 4 });
    expect(init.method).toBe('POST');
    expect(init).not.toHaveProperty('ipFamily');
    expect(init).not.toHaveProperty('timeoutMs');
  });

  it('keeps the default dispatcher when no family is requested', async () => {
    await safeFetch('https://api.provider.example/generate');

    expect(mocks.getDispatcher).toHaveBeenCalledWith(undefined);
    expect(mocks.fetch.mock.calls[0][1].dispatcher).toEqual({
      ipFamily: undefined,
    });
  });

  it('still blocks unsafe URLs before dispatching a family-selected request', async () => {
    mocks.isSafeUrl.mockResolvedValue(false);

    await expect(
      safeFetch('https://api.provider.example/generate', { ipFamily: 4 }),
    ).rejects.toThrow('Blocked URL');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
