import { describe, it, expect, vi, afterEach } from 'vitest';
import { directFetchForAbsoluteUrls } from './waveform-fetch';

const okResponse = () => ({ ok: true }) as Response;

describe('directFetchForAbsoluteUrls', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends absolute http(s) URLs to the global fetch, unprefixed', async () => {
    // Regression: useFetch prefixes the backend baseUrl onto any URL, turning
    // an absolute uploads src into `https://api.hosthttps://app.host/uploads/…`
    // — CSP-blocked, waveform never rendered.
    const globalFetch = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', globalFetch);
    const prefixed = vi.fn().mockResolvedValue(okResponse());

    const wrapped = directFetchForAbsoluteUrls(prefixed);
    const src = 'https://app.postmill.ai/uploads/org/2026/10/19/x.mp3';
    await wrapped(src);

    expect(globalFetch).toHaveBeenCalledWith(src, undefined);
    expect(prefixed).not.toHaveBeenCalled();
  });

  it('matches the scheme case-insensitively', async () => {
    const globalFetch = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', globalFetch);
    const prefixed = vi.fn().mockResolvedValue(okResponse());

    await directFetchForAbsoluteUrls(prefixed)('HTTPS://cdn.example.com/a.mp3');

    expect(globalFetch).toHaveBeenCalled();
    expect(prefixed).not.toHaveBeenCalled();
  });

  it('passes the RequestInit through to the global fetch', async () => {
    const globalFetch = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', globalFetch);
    const init = { credentials: 'same-origin' } as RequestInit;

    await directFetchForAbsoluteUrls(vi.fn())('https://app.postmill.ai/uploads/a.mp3', init);

    expect(globalFetch).toHaveBeenCalledWith('https://app.postmill.ai/uploads/a.mp3', init);
  });

  it('keeps relative API paths on the wrapped (backend-prefixed) fetch', async () => {
    const globalFetch = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', globalFetch);
    const prefixed = vi.fn().mockResolvedValue(okResponse());

    const wrapped = directFetchForAbsoluteUrls(prefixed);
    await wrapped('/media/replicate/categories');

    expect(prefixed).toHaveBeenCalledWith('/media/replicate/categories', undefined);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it('returns the underlying response untouched', async () => {
    const res = okResponse();
    const globalFetch = vi.fn().mockResolvedValue(res);
    vi.stubGlobal('fetch', globalFetch);

    await expect(directFetchForAbsoluteUrls(vi.fn())('https://x.test/a.mp3')).resolves.toBe(res);
  });
});
