import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import EventEmitter from 'events';

vi.mock('sharp', () => ({ default: vi.fn() }));
vi.mock('@gitroom/helpers/utils/timer', () => ({ timer: vi.fn() }));
vi.mock('@gitroom/helpers/utils/read.or.fetch', () => ({ readOrFetch: vi.fn().mockResolvedValue(Buffer.from('data')) }));
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(), ProviderConfiguration: class {}, Integration: class {} }));
vi.mock('@gitroom/helpers/auth/auth.service', () => ({ AuthService: { fixedEncryption: vi.fn((s: string) => s), fixedDecryption: vi.fn((s: string) => s) } }));
vi.mock('@gitroom/nestjs-libraries/database/prisma/provider-configs/provider-config.service', () => ({
  ProviderConfigService: vi.fn(() => ({ getAll: vi.fn().mockResolvedValue([]), getByIdentifier: vi.fn(), decryptConfig: vi.fn(function() { return {}; }), upsert: vi.fn(), delete: vi.fn() })),
}));
vi.mock('@gitroom/nestjs-libraries/database/prisma/provider-configs/provider-config.repository', () => ({
  ProviderConfigRepository: vi.fn(() => ({ getAll: vi.fn(), getByIdentifier: vi.fn(), upsert: vi.fn(), delete: vi.fn(), setEnabled: vi.fn() })),
}));
vi.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({
  PrismaRepository: vi.fn(() => ({ model: {} })),
  PrismaService: class {},
}));
vi.mock('@gitroom/nestjs-libraries/integrations/credentials', () => ({
  getOrgCredential: () => 'mock-value',
  setCredentials: vi.fn(),
  getCredential: vi.fn(function() { return undefined; }),
  clearCredentials: vi.fn(),
  replaceCredentialsMap: vi.fn(),
}));
vi.mock('ws', () => {
  return { default: class MockWebSocket extends EventEmitter { close = vi.fn(); } };
});
vi.mock('axios', () => ({ default: vi.fn() }));
vi.mock('mime-types', () => ({ lookup: vi.fn() }));

import { RedditProvider } from './reddit.provider';

function resp(data: any) {
  return {
    status: 200, ok: true,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
    headers: new Map(),
  };
}

const mockIntegration = {
  internalId: 'int-1',
  name: 'Test User',
  profile: 'testuser',
  picture: 'https://ex.com/pic.jpg',
} as any;

describe('Reddit - comment capabilities', () => {
  let provider: RedditProvider;

  beforeEach(() => {
    provider = new RedditProvider();
    globalThis.fetch = vi.fn();
  });

  describe('commentsCapabilities', () => {
    it('returns read and reply as true, like as false', () => {
      expect(provider.commentsCapabilities).toEqual({ read: true, reply: true, like: false });
    });
  });

  describe('fetchComments', () => {
    it('returns comments when API responds successfully', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(resp({ data: { children: [{ data: { subreddit: 'testsub' } }] } }))
        .mockResolvedValueOnce(resp([
          {},
          {
            data: {
              children: [
                {
                  kind: 't1',
                  data: {
                    id: 'comment-1',
                    parent_id: 't3_post-1',
                    author: 'reddituser',
                    body: 'Nice post!',
                    created_utc: 1704067200,
                    score: 5,
                    replies: '',
                    likes: true,
                  },
                },
              ],
              after: undefined,
            },
          },
        ]));
      const result = await provider.fetchComments('user-123', 'tok', 'post-1', undefined, mockIntegration);
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].platformCommentId).toBe('comment-1');
      expect(result.comments[0].author.name).toBe('reddituser');
      expect(result.comments[0].content).toBe('Nice post!');
    });

    it('returns empty comments when subreddit not found', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: { children: [] } }));
      const result = await provider.fetchComments('user-123', 'tok', 'post-1', undefined, mockIntegration);
      expect(result.comments).toEqual([]);
    });

    it('returns empty comments when no comment listing', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(resp({ data: { children: [{ data: { subreddit: 'testsub' } }] } }))
        .mockResolvedValueOnce(resp([{}, {}]));
      const result = await provider.fetchComments('user-123', 'tok', 'post-1', undefined, mockIntegration);
      expect(result.comments).toEqual([]);
    });

    it('handles API error gracefully', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      const result = await provider.fetchComments('user-123', 'tok', 'post-1', undefined, mockIntegration);
      expect(result.comments).toEqual([]);
    });

    it('strips t3_ prefix from postId for API calls', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(resp({ data: { children: [{ data: { subreddit: 'testsub' } }] } }))
        .mockResolvedValueOnce(resp([{}, { data: { children: [] } }]));
      await provider.fetchComments('user-123', 'tok', 't3_post-1', undefined, mockIntegration);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('id=t3_post-1'),
        expect.any(Object)
      );
    });
  });

  describe('replyToComment', () => {
    it('returns a SocialCommentDTO with correct fields', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(resp({
        json: {
          data: {
            things: [{
              data: {
                id: 'reply-123',
                author: 'testuser',
                created_utc: 1704067200,
              },
            }],
          },
        },
      }));
      const result = await provider.replyToComment('user-123', 'tok', 'post-1', 't1_parent-1', 'Thanks!', mockIntegration);
      expect(result.platformCommentId).toBe('reply-123');
      expect(result.parentPlatformCommentId).toBe('t1_parent-1');
      expect(result.content).toBe('Thanks!');
      expect(result.author.name).toBe('testuser');
    });

    it('prepends t1_ to parentCommentId if not already prefixed', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(resp({
        json: {
          data: {
            things: [{
              data: { id: 'reply-456', author: 'testuser', created_utc: 1704067200 },
            }],
          },
        },
      }));
      await provider.replyToComment('user-123', 'tok', 'post-1', 'parent-1', 'Thanks!', mockIntegration);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://oauth.reddit.com/api/comment',
        expect.objectContaining({
          body: expect.any(URLSearchParams),
        })
      );
      const callBody = (globalThis.fetch as any).mock.calls[0][1].body;
      expect(callBody.get('thing_id')).toBe('t1_parent-1');
    });

    it('handles API error gracefully', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('API error'));
      const result = await provider.replyToComment('user-123', 'tok', 'post-1', 'parent-1', 'Thanks!', mockIntegration);
      expect(result.platformCommentId).toBe('');
      expect(result.content).toBe('Thanks!');
    });

    it('uses correct endpoint and auth headers', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(resp({
        json: { data: { things: [{ data: { id: 'reply-789', author: 'u' } }] } },
      }));
      await provider.replyToComment('user-123', 'tok', 'post-1', 't1_parent-1', 'Nice!', mockIntegration);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://oauth.reddit.com/api/comment',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer tok',
          }),
        })
      );
    });
  });
});
