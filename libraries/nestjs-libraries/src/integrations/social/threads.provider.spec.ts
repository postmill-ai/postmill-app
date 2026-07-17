import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
vi.mock('form-data', () => ({ default: class FormData { append = vi.fn(); } }));

import { ThreadsProvider } from './threads.provider';

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

describe('Threads - comment capabilities', () => {
  let provider: ThreadsProvider;

  beforeEach(() => {
    provider = new ThreadsProvider();
    globalThis.fetch = vi.fn();
  });

  describe('commentsCapabilities', () => {
    it('returns read and reply as true, like as false', () => {
      expect(provider.commentsCapabilities).toEqual({ read: true, reply: true, like: false });
    });
  });

  describe('fetchComments', () => {
    it('returns comments when API responds successfully', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(resp({
        data: [
          {
            id: 'reply-1',
            text: 'Great post!',
            username: 'follower',
            permalink: 'https://threads.net/@follower/post/1',
            timestamp: '2024-01-01T00:00:00.000Z',
            like_count: 3,
            replies: { data: [{ id: 'subreply-1' }] },
          },
        ],
        paging: { cursors: { after: 'next-cursor' } },
      }));
      const result = await provider.fetchComments('user-1', 'tok', 'thread-1', undefined, mockIntegration);
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].platformCommentId).toBe('reply-1');
      expect(result.comments[0].author.name).toBe('follower');
      expect(result.comments[0].content).toBe('Great post!');
      expect(result.comments[0].likeCount).toBe(3);
      expect(result.comments[0].replyCount).toBe(1);
    });

    it('includes cursor in URL when provided', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: [], paging: {} }));
      await provider.fetchComments('user-1', 'tok', 'thread-1', 'cursor-123', mockIntegration);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('after=cursor-123'),
        expect.any(Object)
      );
    });

    it('returns empty comments when API returns empty data', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: [] }));
      const result = await provider.fetchComments('user-1', 'tok', 'thread-1', undefined, mockIntegration);
      expect(result.comments).toEqual([]);
    });

    it('handles API error gracefully', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('API error'));
      const result = await provider.fetchComments('user-1', 'tok', 'thread-1', undefined, mockIntegration);
      expect(result.comments).toEqual([]);
    });
  });

  describe('replyToComment', () => {
    it('returns a SocialCommentDTO with correct fields', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(resp({ id: 'reply-123' }));
      const result = await provider.replyToComment('user-1', 'tok', 'thread-1', 'parent-1', 'Thanks!', mockIntegration);
      expect(result.platformCommentId).toBe('reply-123');
      expect(result.parentPlatformCommentId).toBe('parent-1');
      expect(result.content).toBe('Thanks!');
    });

    it('throws on API error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('API error'));
      await expect(provider.replyToComment('user-1', 'tok', 'thread-1', 'parent-1', 'Thanks!', mockIntegration)).rejects.toThrow('API error');
    });

    it('sends POST to replies endpoint with reply_to_id', async () => {
      const fetchMock = vi.fn().mockResolvedValue(resp({ id: 'reply-456' }));
      globalThis.fetch = fetchMock;
      await provider.replyToComment('user-1', 'tok', 'thread-1', 'parent-1', 'Nice!', mockIntegration);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://graph.threads.net/v1.0/thread-1/replies?access_token=tok',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Nice!'),
        })
      );
    });
  });
});
