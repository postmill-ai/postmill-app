import { describe, it, expect } from 'vitest';
import { setSocialFetchPorts } from '@gitroom/provider-kernel';
import { XProvider } from './social.adapter';

// F3 — Social-adapter posting contract test (X / Twitter).
//
// No live creds, no network. X's text post goes through SocialAbstract.fetch, whose
// outbound port (`undiciFetch`) we replace with a recorder. We assert the request
// shape: URL/host, method, OAuth auth header presence, and that the body carries the
// post content.

interface Rec {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

function recorder(handler: (url: string, init: any, n: number) => any): Rec[] {
  const recs: Rec[] = [];
  const undiciFetch = (async (input: any, init: any = {}) => {
    recs.push({
      url: String(input),
      method: init.method || 'GET',
      headers: init.headers || {},
      body: init.body,
    });
    return handler(String(input), init, recs.length);
  }) as any;
  setSocialFetchPorts({
    getVpnDispatcher: () => undefined,
    ssrfSafeDispatcher: undefined,
    isSafePublicHttpsUrl: async () => true,
    undiciFetch,
    RefreshTokenError: class extends Error {},
    BadBodyError: class extends Error {},
    timer: (async () => undefined) as any,
    sharp: (() => ({ metadata: async () => ({ width: 100, height: 100 }) })) as any,
    readOrFetch: (async () => Buffer.from('x')) as any,
    safeFetch: undiciFetch,
  } as any);
  return recs;
}

function res(body: any, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    headers: { get: () => null },
  } as any;
}

describe('x provider post() contract', () => {
  it('POSTs the tweet to api.x.com/2/tweets with OAuth1 auth and the message in the body', async () => {
    const recs = recorder(() => res({ data: { id: 'tweet-123' } }));
    const provider = new XProvider();

    const out = await provider.post(
      'me',
      'access-token:access-secret',
      [{ id: 'p1', message: 'hello from a contract test', media: [], settings: {} } as any],
      { profile: 'myhandle' } as any,
      { client_id: 'app-key', client_secret: 'app-secret' } as any
    );

    const r = recs[0];
    expect(r.url).toBe('https://api.x.com/2/tweets');
    expect(new URL(r.url).host).toBe('api.x.com');
    expect(r.method).toBe('POST');
    expect(String((r.headers as any).Authorization)).toMatch(/^OAuth /);
    const body = JSON.parse(r.body);
    expect(body.text).toBe('hello from a contract test');
    expect(out[0].postId).toBe('tweet-123');
  });
});
