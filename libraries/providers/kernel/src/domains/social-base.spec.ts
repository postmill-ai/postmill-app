import { describe, it, expect, vi } from 'vitest';
import { SocialAbstract, setSocialFetchPorts } from './social-base';

class TestProvider extends SocialAbstract {
  identifier = 'test';
}

class TestBadBodyError extends Error {
  constructor(
    public identifier: string,
    public json: string,
    public body: any,
    message: string
  ) {
    super(message);
  }
}

function setPorts(undiciFetch: any) {
  setSocialFetchPorts({
    getVpnDispatcher: () => undefined,
    ssrfSafeDispatcher: undefined,
    isSafePublicHttpsUrl: async () => true,
    undiciFetch,
    RefreshTokenError: class RefreshTokenError extends Error {} as any,
    BadBodyError: TestBadBodyError as any,
    timer: async () => undefined,
    sharp: undefined,
    readOrFetch: async () => Buffer.from(''),
    safeFetch: vi.fn() as any,
  });
}

describe('SocialAbstract.fetch', () => {
  it.each([200, 201, 202, 204])('treats HTTP %i as success', async (status) => {
    setPorts(
      vi.fn(async () => new Response(status === 204 ? null : '{}', { status }))
    );
    const result = await new TestProvider().fetch('https://api.example.com/x');
    expect(result.status).toBe(status);
  });

  it('still rejects non-2xx with BadBodyError', async () => {
    setPorts(
      vi.fn(
        async () => new Response('{"error":"nope"}', { status: 400 })
      )
    );
    await expect(
      new TestProvider().fetch('https://api.example.com/x')
    ).rejects.toBeInstanceOf(TestBadBodyError);
  });
});
