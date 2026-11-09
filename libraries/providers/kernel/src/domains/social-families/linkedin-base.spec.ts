import { describe, expect, it, vi } from 'vitest';
import { LinkedinProvider } from './linkedin-base';

describe('LinkedinProvider.fetchComments', () => {
  it('propagates fetch failures instead of returning an authoritative empty result', async () => {
    const provider = new LinkedinProvider();
    const failure = new Error('refresh required');
    vi.spyOn(provider, 'fetch').mockRejectedValue(failure);

    await expect(
      provider.fetchComments('id', 'token', 'post-id', undefined, {} as any),
    ).rejects.toBe(failure);
  });

  it('returns an empty result for a successful response with no comments', async () => {
    const provider = new LinkedinProvider();
    vi.spyOn(provider, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ elements: [] }), { status: 200 }),
    );

    await expect(
      provider.fetchComments('id', 'token', 'post-id', undefined, {} as any),
    ).resolves.toEqual({ comments: [], nextCursor: undefined });
  });
});
