import { describe, it, expect } from 'vitest';
import { setSocialFetchPorts } from '@gitroom/provider-kernel';
import { FacebookProvider } from './social.adapter';

// F3 — Social-adapter posting contract test (Facebook Pages).
//
// No live creds, no network. The text post goes through SocialAbstract.fetch; we
// replace the outbound port with a recorder. Facebook authenticates via the
// `access_token` query param (Graph API) rather than an Authorization header, so we
// assert host + the token in the URL + that the body carries the message.

interface Rec {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

function recorder(handler: (url: string, init: any, n: number) => any): Rec[] {
  const recs: Rec[] = [];
  const undiciFetch = (async (input: any, init: any = {}): Promise<any> => {
    recs.push({
      url: String(input),
      method: init.method || 'GET',
      headers: init.headers || {},
      body: init.body,
    });
    return handler(String(input), init, recs.length);
  }) as any;
  setSocialFetchPorts({
    getVpnDispatcher: ((): undefined => undefined) as any,
    ssrfSafeDispatcher: undefined,
    isSafePublicHttpsUrl: (async () => true) as any,
    undiciFetch,
    RefreshTokenError: class extends Error {},
    BadBodyError: class extends Error {},
    timer: (async (): Promise<void> => undefined) as any,
    sharp: (() => ({ metadata: async () => ({ width: 100, height: 100 }) })) as any,
    readOrFetch: (async () => Buffer.from('x')) as any,
    safeFetch: undiciFetch,
  } as any);
  return recs;
}

function res(body: any, status = 200): any {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    headers: { get: ((): null => null) as any },
  } as any;
}

describe('facebook provider post() contract', () => {
  it('POSTs a text feed post to graph.facebook.com with the access_token and message in the body', async () => {
    const recs = recorder(() =>
      res({ id: 'fb-post-1', permalink_url: 'https://facebook.com/fb-post-1' })
    );
    const provider = new FacebookProvider();

    const out = await provider.post(
      'page-1',
      'fb-token',
      [{ id: 'p1', message: 'hello facebook world', media: [], settings: {} } as any]
    );

    const r = recs[0];
    expect(new URL(r.url).host).toBe('graph.facebook.com');
    expect(r.url).toContain('/page-1/feed');
    expect(r.url).toContain('access_token=fb-token');
    expect(r.method).toBe('POST');
    const body = JSON.parse(r.body);
    expect(body.message).toBe('hello facebook world');
    expect(body.published).toBe(true);
    expect(out[0].postId).toBe('fb-post-1');
  });
});
