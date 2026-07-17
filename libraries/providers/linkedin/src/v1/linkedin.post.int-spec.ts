import { describe, it, expect } from 'vitest';
import { setSocialFetchPorts } from '@gitroom/provider-kernel';
import { LinkedinProvider } from './social.adapter';

// F3 — Social-adapter posting contract test (LinkedIn).
//
// No live creds, no network. LinkedIn's text post goes through SocialAbstract.fetch;
// we replace the outbound port with a recorder and assert URL/host, method, the Bearer
// auth header, and that the post commentary carries the content.

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

function res(
  body: any,
  opts: { status?: number; headers?: Record<string, string> } = {}
) {
  const status = opts.status ?? 200;
  const headers = opts.headers ?? {};
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    headers: {
      get: (k: string) => headers[k] ?? headers[k.toLowerCase()] ?? null,
    },
  } as any;
}

describe('linkedin provider post() contract', () => {
  it('POSTs to api.linkedin.com/rest/posts with Bearer auth and the message as commentary', async () => {
    const recs = recorder(() =>
      res({}, { status: 201, headers: { 'x-restli-id': 'urn:li:share:999' } })
    );
    const provider = new LinkedinProvider();

    const out = await provider.post(
      'person-1',
      'li-access-token',
      [{ id: 'p1', message: 'hello linkedin world', media: [], settings: {} } as any],
      {} as any,
      undefined,
      'personal'
    );

    const r = recs[0];
    expect(r.url).toBe('https://api.linkedin.com/rest/posts');
    expect(new URL(r.url).host).toBe('api.linkedin.com');
    expect(r.method).toBe('POST');
    expect((r.headers as any).Authorization).toBe('Bearer li-access-token');
    const body = JSON.parse(r.body);
    expect(body.commentary).toBe('hello linkedin world');
    expect(body.author).toBe('urn:li:person:person-1');
    expect(out[0].postId).toBe('urn:li:share:999');
  });
});
