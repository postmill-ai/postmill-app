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
vi.mock('mime-types', () => ({ lookup: vi.fn() }));

import { FacebookProvider } from './facebook.provider';

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

describe('Facebook - comment capabilities', () => {
  let provider: FacebookProvider;

  beforeEach(() => {
    provider = new FacebookProvider();
    globalThis.fetch = vi.fn();
  });

  describe('commentsCapabilities', () => {
    it('returns read, reply, and like as true', () => {
      expect(provider.commentsCapabilities).toEqual({ read: true, reply: true, like: true });
    });
  });

  describe('fetchComments', () => {
    it('returns comments when API responds successfully', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(resp({
        data: [
          {
            id: 'comment-1',
            message: 'Great post!',
            from: { id: 'user-1', name: 'John', picture: { data: { url: 'https://ex.com/pic.jpg' } } },
            created_time: '2024-01-01T00:00:00.000Z',
            like_count: 5,
            comment_count: 1,
            user_likes: true,
          },
        ],
        paging: { cursors: { after: 'next-cursor' } },
      }));
      const result = await provider.fetchComments('page-1', 'tok', 'post-1', undefined, mockIntegration);
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].platformCommentId).toBe('comment-1');
      expect(result.comments[0].author.name).toBe('John');
      expect(result.comments[0].content).toBe('Great post!');
      expect(result.comments[0].likeCount).toBe(5);
      expect(result.comments[0].likedByMe).toBe(true);
    });

    it('includes cursor in URL when provided', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: [], paging: {} }));
      await provider.fetchComments('page-1', 'tok', 'post-1', 'cursor-123', mockIntegration);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('after=cursor-123'),
        expect.anything()
      );
    });

    it('returns empty comments when API returns empty data', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(resp({ data: [] }));
      const result = await provider.fetchComments('page-1', 'tok', 'post-1', undefined, mockIntegration);
      expect(result.comments).toEqual([]);
    });

    it('handles API error gracefully', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('API error'));
      const result = await provider.fetchComments('page-1', 'tok', 'post-1', undefined, mockIntegration);
      expect(result.comments).toEqual([]);
    });
  });

  describe('replyToComment', () => {
    it('returns a SocialCommentDTO with correct fields', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(resp({ id: 'reply-123' }));
      const result = await provider.replyToComment('page-1', 'tok', 'post-1', 'parent-1', 'Thanks!', mockIntegration);
      expect(result.platformCommentId).toBe('reply-123');
      expect(result.parentPlatformCommentId).toBe('parent-1');
      expect(result.content).toBe('Thanks!');
      expect(result.author.name).toBe('Test User');
    });

    it('handles API error gracefully', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('API error'));
      const result = await provider.replyToComment('page-1', 'tok', 'post-1', 'parent-1', 'Thanks!', mockIntegration);
      expect(result.platformCommentId).toBe('');
      expect(result.content).toBe('Thanks!');
    });

    it('sends POST to correct endpoint with message', async () => {
      const fetchMock = vi.fn().mockResolvedValue(resp({ id: 'reply-456' }));
      globalThis.fetch = fetchMock;
      await provider.replyToComment('page-1', 'tok', 'post-1', 'parent-1', 'Nice!', mockIntegration);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://graph.facebook.com/v20.0/parent-1/replies?access_token=tok',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Nice!'),
        })
      );
    });
  });

  describe('likeComment', () => {
    it('returns { liked: true } when liking', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(resp({}));
      const result = await provider.likeComment('page-1', 'tok', 'post-1', 'comment-1', true, mockIntegration);
      expect(result).toEqual({ liked: true });
    });

    it('returns { liked: false } when unliking', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(resp({}));
      const result = await provider.likeComment('page-1', 'tok', 'post-1', 'comment-1', false, mockIntegration);
      expect(result).toEqual({ liked: false });
    });

    it('throws on API error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('API error'));
      await expect(provider.likeComment('page-1', 'tok', 'post-1', 'comment-1', true, mockIntegration)).rejects.toThrow('API error');
    });

    it('uses POST for like and DELETE for unlike', async () => {
      const fetchMock = vi.fn().mockResolvedValue(resp({}));
      globalThis.fetch = fetchMock;

      await provider.likeComment('page-1', 'tok', 'post-1', 'comment-1', true, mockIntegration);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('comment-1/likes'),
        expect.objectContaining({ method: 'POST' })
      );

      fetchMock.mockClear();
      await provider.likeComment('page-1', 'tok', 'post-1', 'comment-1', false, mockIntegration);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('comment-1/likes'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });
});
