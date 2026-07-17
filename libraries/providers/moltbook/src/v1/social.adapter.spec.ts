import { describe, it, expect, vi } from 'vitest';
import { MoltbookProvider } from './social.adapter';

const mockResponse = (body: any) =>
  ({
    json: async () => body,
  } as any);

describe('MoltbookProvider (S-01)', () => {
  it('routes registerAgent through this.fetch()', async () => {
    const provider = new MoltbookProvider();
    const fetchSpy = vi.spyOn(provider as any, 'fetch').mockResolvedValue(
      mockResponse({
        success: true,
        agent: { id: 'agent-1', name: 'Agent One' },
      })
    );

    const result = await provider.registerAgent('Agent One', 'Description');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://www.moltbook.com/api/v1/agents/register',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Agent One', description: 'Description' }),
      }),
      'moltbook-register-agent'
    );
    expect(result).toEqual({ id: 'agent-1', name: 'Agent One' });
  });

  it('routes getAgentProfile through this.fetch()', async () => {
    const provider = new MoltbookProvider();
    const fetchSpy = vi.spyOn(provider as any, 'fetch').mockResolvedValue(
      mockResponse({
        success: true,
        agent: { id: 'a1', name: 'profile-name', display_name: 'Display Name' },
      })
    );

    const result = await provider.getAgentProfile('api-key-1');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://www.moltbook.com/api/v1/agents/me',
      expect.objectContaining({
        headers: { Authorization: 'Bearer api-key-1' },
      }),
      'moltbook-agent-profile'
    );
    expect(result).toEqual({
      id: 'a1',
      name: 'profile-name',
      display_name: 'Display Name',
    });
  });

  it('routes post through this.fetch()', async () => {
    const provider = new MoltbookProvider();
    const fetchSpy = vi.spyOn(provider as any, 'fetch').mockResolvedValue(
      mockResponse({
        success: true,
        post: { id: 123 },
      })
    );

    const result = await provider.post(
      'id',
      'access-token',
      [
        {
          id: 'post-1',
          message: 'Hello Moltbook',
          settings: { submolt: 'general' },
        } as any,
      ],
      { id: 'int-1', organizationId: 'org-1' } as any
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://www.moltbook.com/api/v1/posts',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          submolt: 'general',
          title: 'Hello Moltbook'.slice(0, 100),
          content: 'Hello Moltbook',
        }),
      }),
      'moltbook-post'
    );
    expect(result).toEqual([
      {
        id: 'post-1',
        postId: '123',
        releaseURL: 'https://www.moltbook.com/post/123',
        status: 'completed',
      },
    ]);
  });

  it('routes comment through this.fetch()', async () => {
    const provider = new MoltbookProvider();
    const fetchSpy = vi.spyOn(provider as any, 'fetch').mockResolvedValue(
      mockResponse({
        success: true,
        comment: { id: 456 },
      })
    );

    const result = await provider.comment(
      'id',
      'post-123',
      'parent-789',
      'access-token',
      [
        {
          id: 'comment-1',
          message: 'Nice post',
        } as any,
      ],
      { id: 'int-1', organizationId: 'org-1' } as any
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://www.moltbook.com/api/v1/posts/post-123/comments',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'Nice post', parent_id: 'parent-789' }),
      }),
      'moltbook-comment'
    );
    expect(result).toEqual([
      {
        id: 'comment-1',
        postId: '456',
        releaseURL: 'https://www.moltbook.com/post/post-123',
        status: 'completed',
      },
    ]);
  });
});
