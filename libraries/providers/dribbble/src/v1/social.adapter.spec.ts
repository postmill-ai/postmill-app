import { describe, it, expect, vi } from 'vitest';
import { DribbbleProvider } from './social.adapter';

describe('DribbbleProvider.authenticate (5.2 — secret in body, not query)', () => {
  it('sends client_secret + code in the x-www-form-urlencoded POST body, never the URL query', async () => {
    const provider = new DribbbleProvider();
    const calls: Array<{ url: string; options: any }> = [];

    (provider as any).fetch = vi.fn(async (url: string, options: any = {}) => {
      calls.push({ url, options });
      // First call = token exchange, second = /v2/user
      if (url.includes('/oauth/token')) {
        return { json: async () => ({ access_token: 'tok', scope: 'public,upload' }) } as any;
      }
      return {
        json: async () => ({ id: '1', name: 'n', avatar_url: 'a', login: 'l' }),
      } as any;
    });

    await provider.authenticate(
      { code: 'THE_CODE', codeVerifier: 'v', refresh: '' },
      { client_id: 'CID', client_secret: 'SEKRET' } as any
    );

    const tokenCall = calls.find((c) => c.url.includes('/oauth/token'))!;
    expect(tokenCall).toBeTruthy();

    // The secret + code must not be in the URL (would land in access logs).
    expect(tokenCall.url).toBe('https://dribbble.com/oauth/token');
    expect(tokenCall.url).not.toContain('client_secret');
    expect(tokenCall.url).not.toContain('SEKRET');
    expect(tokenCall.url).not.toContain('THE_CODE');

    // They must ride in the urlencoded POST body instead.
    expect(tokenCall.options.method).toBe('POST');
    expect(tokenCall.options.headers['Content-Type']).toBe(
      'application/x-www-form-urlencoded'
    );
    const body = String(tokenCall.options.body);
    expect(body).toContain('client_secret=SEKRET');
    expect(body).toContain('code=THE_CODE');
    expect(body).toContain('client_id=CID');
  });
});
