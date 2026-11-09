import { describe, expect, it, vi } from 'vitest';
import { SlackProvider } from './social.adapter';

describe('SlackProvider.fetchComments', () => {
  it('throws for an HTTP-200 API error payload', async () => {
    const provider = new SlackProvider();
    vi.spyOn(provider, 'fetch').mockResolvedValue({
      json: async () => ({ ok: false, error: 'invalid_auth' }),
    } as Response);

    await expect(
      provider.fetchComments('channel', 'token', 'post-id', undefined, {} as any),
    ).rejects.toThrow('Slack comment fetch failed');
  });

  it('returns an empty result for a successful response with no replies', async () => {
    const provider = new SlackProvider();
    vi.spyOn(provider, 'fetch').mockResolvedValue({
      json: async () => ({ ok: true, messages: [] }),
    } as Response);

    await expect(
      provider.fetchComments('channel', 'token', 'post-id', undefined, {} as any),
    ).resolves.toEqual({ comments: [], nextCursor: undefined });
  });
});
