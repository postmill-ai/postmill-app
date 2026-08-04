import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSafeFetch = vi.fn();
vi.mock('@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetch: (url: string, init?: RequestInit) => mockSafeFetch(url, init),
}));

import { resolveIconifyIcon } from './icon-resolver';

function svgResponse(body: string, attrs = 'viewBox="0 0 24 24"') {
  return {
    ok: true,
    headers: new Headers(),
    text: async () => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`,
  };
}

describe('resolveIconifyIcon', () => {
  beforeEach(() => mockSafeFetch.mockReset());

  it('resolves prefix:name to the inner SVG body and viewBox', async () => {
    mockSafeFetch.mockResolvedValue(svgResponse('<path d="M0 0h1v1z"/>'));
    const icon = await resolveIconifyIcon('mdi:rocket');
    expect(icon?.body).toBe('<path d="M0 0h1v1z"/>');
    expect(icon?.viewBox).toBe('0 0 24 24');
    expect(mockSafeFetch).toHaveBeenCalledWith(
      'https://api.iconify.design/mdi/rocket.svg',
      undefined
    );
  });

  it('rejects malformed names without fetching', async () => {
    expect(await resolveIconifyIcon('not-an-icon')).toBeNull();
    expect(await resolveIconifyIcon('MDI:rocket')).toBeNull();
    expect(await resolveIconifyIcon('mdi:../../etc/passwd')).toBeNull();
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it('returns null on a non-OK response', async () => {
    mockSafeFetch.mockResolvedValue({ ok: false, headers: new Headers() });
    expect(await resolveIconifyIcon('mdi:does-not-exist')).toBeNull();
  });

  it('refuses markup that can run script', async () => {
    mockSafeFetch.mockResolvedValue(
      svgResponse('<script>alert(1)</script><path d="M0 0h1v1z"/>')
    );
    expect(await resolveIconifyIcon('mdi:evil')).toBeNull();

    mockSafeFetch.mockResolvedValue(
      svgResponse('<rect onload="alert(1)" width="1" height="1"/>')
    );
    expect(await resolveIconifyIcon('mdi:evil2')).toBeNull();
  });

  it('caches resolutions and failures by name', async () => {
    mockSafeFetch.mockResolvedValue(svgResponse('<path d="M0 0h1v1z"/>'));
    await resolveIconifyIcon('mdi:cached');
    await resolveIconifyIcon('mdi:cached');
    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
  });
});
