import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setSocialFetchPorts } from '@gitroom/provider-kernel';
import { WhopProvider } from './social.adapter';

// Avoid waiting 5 s between each of the 120 capped status-poll iterations.
vi.mock('@gitroom/helpers/utils/timer', () => ({
  timer: () => Promise.resolve(),
}));

// Records every call the port-bound `safeFetch` (imported from the kernel by the
// whop adapter) receives, so we can assert the provider-returned upload_url is
// routed through the SSRF-validated path (5.4) rather than a bare fetch.
const safeFetchCalls: Array<{ url: string; init: any }> = [];

beforeEach(() => {
  safeFetchCalls.length = 0;
  setSocialFetchPorts({
    safeFetch: async (url: string, init?: any) => {
      safeFetchCalls.push({ url, init });
      // download leg (item.path) needs bytes; the PUT leg just needs to resolve
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      } as any;
    },
    isSafePublicHttpsUrl: async () => true,
  } as any);
});

describe('WhopProvider.uploadMediaToWhop (5.4 — upload_url is SSRF-validated)', () => {
  it('PUTs file bytes to the provider-returned upload_url through safeFetch', async () => {
    const provider = new WhopProvider();

    // this.fetch handles the api.whop.com create-file + status calls.
    (provider as any).fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/api/v1/files')) {
        return {
          json: async () => ({
            id: 'file_1',
            upload_url: 'https://uploads.whopcdn.com/put/abc',
            upload_headers: { 'x-amz': '1' },
          }),
        } as any;
      }
      // status poll
      return { json: async () => ({ upload_status: 'ready' }) } as any;
    });

    const attachments = await (provider as any).uploadMediaToWhop(
      [{ path: 'https://cdn.example.com/pic.png' }],
      'access-token'
    );

    expect(attachments).toEqual([{ id: 'file_1' }]);

    // The upload PUT must go through safeFetch (validated), not a bare fetch.
    const putCall = safeFetchCalls.find((c) => c.init?.method === 'PUT');
    expect(putCall).toBeTruthy();
    expect(putCall!.url).toBe('https://uploads.whopcdn.com/put/abc');
    expect(putCall!.init.headers).toEqual({ 'x-amz': '1' });
  });
});

describe('WhopProvider.uploadMediaToWhop (POSTS-06 — status polling is capped)', () => {
  it('rejects after the configured max attempts when upload_status stays pending', async () => {
    const provider = new WhopProvider();
    let statusCalls = 0;

    (provider as any).fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/api/v1/files')) {
        return {
          json: async () => ({
            id: 'file_2',
            upload_url: 'https://uploads.whopcdn.com/put/xyz',
          }),
        } as any;
      }
      statusCalls += 1;
      return { json: async () => ({ upload_status: 'pending' }) } as any;
    });

    await expect(
      (provider as any).uploadMediaToWhop(
        [{ path: 'https://cdn.example.com/pic.png' }],
        'access-token'
      )
    ).rejects.toThrow('exceeded 120 attempts');

    expect(statusCalls).toBe(120);
  });
});
