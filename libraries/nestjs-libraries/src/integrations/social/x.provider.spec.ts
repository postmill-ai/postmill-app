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

const mockV2 = vi.hoisted(() => ({
  me: vi.fn().mockResolvedValue({ data: { id: 'user-123' } }),
  like: vi.fn().mockResolvedValue({}),
  unlike: vi.fn().mockResolvedValue({}),
  search: vi.fn().mockResolvedValue({
    data: {
      data: [
        { id: 'tweet-1', author_id: 'author-1', text: 'Nice post!', created_at: '2024-01-01T00:00:00.000Z', public_metrics: { like_count: 5, reply_count: 1 } },
      ],
    },
    includes: { users: [{ id: 'author-1', name: 'John', username: 'john', profile_image_url: 'https://ex.com/pic.jpg' }] },
    meta: { result_count: 1 },
  }),
}));

vi.mock('twitter-api-v2', () => {
  class MockTwitterApi {
    appKey: string; appSecret: string; accessToken: string; accessSecret: string;
    constructor(opts: any) { Object.assign(this, opts); }
    get v2() { return mockV2; }
  }
  return { TwitterApi: MockTwitterApi };
});

import { XProvider } from './x.provider';

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

describe('X - comment capabilities', () => {
  let provider: XProvider;

  beforeEach(() => {
    provider = new XProvider();
    globalThis.fetch = vi.fn();
    vi.clearAllMocks();
  });

  describe('commentsCapabilities', () => {
    it('returns read, reply, and like as true', () => {
      expect(provider.commentsCapabilities).toEqual({ read: true, reply: true, like: true });
    });
  });

  describe('fetchComments', () => {
    it('returns comments when API responds successfully', async () => {
      const result = await provider.fetchComments('user-123', 'at:as', 'post-123', undefined, mockIntegration);
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].platformCommentId).toBe('tweet-1');
      expect(result.comments[0].author.name).toBe('John');
      expect(result.comments[0].content).toBe('Nice post!');
    });

    it('returns empty comments when API returns empty', async () => {
      mockV2.search.mockResolvedValueOnce({ data: { data: [] }, includes: {}, meta: {} });
      const result = await provider.fetchComments('user-123', 'at:as', 'post-123', undefined, mockIntegration);
      expect(result.comments).toEqual([]);
    });

    it('handles API error gracefully', async () => {
      mockV2.search.mockRejectedValueOnce(new Error('API error'));
      const result = await provider.fetchComments('user-123', 'at:as', 'post-123', undefined, mockIntegration);
      expect(result.comments).toEqual([]);
    });

    it('passes cursor as next_token when provided', async () => {
      mockV2.search.mockResolvedValueOnce({ data: { data: [] }, includes: {}, meta: {} });
      await provider.fetchComments('user-123', 'at:as', 'post-123', 'next-cursor', mockIntegration);
      expect(mockV2.search).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ next_token: 'next-cursor' })
      );
    });
  });

  describe('replyToComment', () => {
    it('returns a SocialCommentDTO with correct fields', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: { id: 'reply-123' } }));
      const result = await provider.replyToComment('user-123', 'at:as', 'post-123', 'parent-1', 'Thanks!', mockIntegration);
      expect(result.platformCommentId).toBe('reply-123');
      expect(result.parentPlatformCommentId).toBe('parent-1');
      expect(result.content).toBe('Thanks!');
    });

    it('handles API error gracefully', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('API error'));
      const result = await provider.replyToComment('user-123', 'at:as', 'post-123', 'parent-1', 'Thanks!', mockIntegration);
      expect(result.platformCommentId).toBe('');
      expect(result.content).toBe('Thanks!');
    });

    it('sends POST to tweet endpoint with reply settings', async () => {
      const fetchMock = vi.fn().mockResolvedValue(resp({ data: { id: 'reply-456' } }));
      globalThis.fetch = fetchMock;
      await provider.replyToComment('user-123', 'at:as', 'post-123', 'parent-1', 'Nice!', mockIntegration);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.x.com/2/tweets',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"in_reply_to_tweet_id":"parent-1"'),
        })
      );
    });
  });

  describe('likeComment', () => {
    it('returns { liked: true } when liking', async () => {
      const result = await provider.likeComment('user-123', 'at:as', 'post-123', 'comment-1', true, mockIntegration);
      expect(result).toEqual({ liked: true });
    });

    it('returns { liked: false } when unliking', async () => {
      const result = await provider.likeComment('user-123', 'at:as', 'post-123', 'comment-1', false, mockIntegration);
      expect(result).toEqual({ liked: false });
    });

    it('throws on API error', async () => {
      mockV2.like.mockRejectedValueOnce(new Error('API error'));
      await expect(provider.likeComment('user-123', 'at:as', 'post-123', 'comment-1', true, mockIntegration)).rejects.toThrow('API error');
    });

    it('calls client.v2.like with correct args', async () => {
      await provider.likeComment('user-123', 'at:as', 'post-123', 'comment-1', true, mockIntegration);
      expect(mockV2.like).toHaveBeenCalledWith('user-123', 'comment-1');
    });

    it('calls client.v2.unlike with correct args', async () => {
      await provider.likeComment('user-123', 'at:as', 'post-123', 'comment-1', false, mockIntegration);
      expect(mockV2.unlike).toHaveBeenCalledWith('user-123', 'comment-1');
    });
  });
});
