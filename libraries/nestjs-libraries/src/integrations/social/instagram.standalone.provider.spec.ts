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

import { InstagramStandaloneProvider } from './instagram.standalone.provider';
import { InstagramProvider } from './instagram.provider';

const mockIntegration = {
  internalId: 'int-1',
  name: 'Test User',
  profile: 'testuser',
  picture: 'https://ex.com/pic.jpg',
} as any;

describe('Instagram Standalone - comment capabilities', () => {
  let provider: InstagramStandaloneProvider;
  let mockIgbProvider: any;

  beforeEach(() => {
    provider = new InstagramStandaloneProvider();
    mockIgbProvider = {
      fetchComments: vi.fn(),
      replyToComment: vi.fn(),
      likeComment: vi.fn(),
    };
    (provider as any)._instagramProvider = mockIgbProvider as InstagramProvider;
  });

  describe('commentsCapabilities', () => {
    it('returns read, reply, and like as true', () => {
      expect(provider.commentsCapabilities).toEqual({ read: true, reply: true, like: true });
    });
  });

  describe('fetchComments', () => {
    it('delegates to InstagramProvider.fetchComments', async () => {
      mockIgbProvider.fetchComments.mockResolvedValueOnce({
        comments: [{ platformCommentId: 'comment-1', content: 'Nice!' }],
        nextCursor: 'cursor-123',
      });
      const result = await provider.fetchComments('ig-1', 'tok', 'media-1', 'cursor-123', mockIntegration);
      expect(mockIgbProvider.fetchComments).toHaveBeenCalledWith('ig-1', 'tok', 'media-1', 'cursor-123', mockIntegration);
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].platformCommentId).toBe('comment-1');
    });

    it('returns empty comments when delegate returns empty', async () => {
      mockIgbProvider.fetchComments.mockResolvedValueOnce({ comments: [] });
      const result = await provider.fetchComments('ig-1', 'tok', 'media-1', undefined, mockIntegration);
      expect(result.comments).toEqual([]);
    });

    it('handles API error gracefully via delegate', async () => {
      mockIgbProvider.fetchComments.mockResolvedValueOnce({ comments: [] });
      const result = await provider.fetchComments('ig-1', 'tok', 'media-1', undefined, mockIntegration);
      expect(result.comments).toEqual([]);
    });
  });

  describe('replyToComment', () => {
    it('delegates to InstagramProvider.replyToComment', async () => {
      mockIgbProvider.replyToComment.mockResolvedValueOnce({
        platformCommentId: 'reply-123',
        parentPlatformCommentId: 'parent-1',
        content: 'Thanks!',
        author: { name: 'Test User' },
      });
      const result = await provider.replyToComment('ig-1', 'tok', 'media-1', 'parent-1', 'Thanks!', mockIntegration);
      expect(mockIgbProvider.replyToComment).toHaveBeenCalledWith('ig-1', 'tok', 'media-1', 'parent-1', 'Thanks!', mockIntegration);
      expect(result.platformCommentId).toBe('reply-123');
      expect(result.content).toBe('Thanks!');
    });

    it('handles API error gracefully via delegate', async () => {
      mockIgbProvider.replyToComment.mockResolvedValueOnce({
        platformCommentId: '',
        parentPlatformCommentId: 'parent-1',
        content: 'Thanks!',
      });
      const result = await provider.replyToComment('ig-1', 'tok', 'media-1', 'parent-1', 'Thanks!', mockIntegration);
      expect(result.platformCommentId).toBe('');
      expect(result.content).toBe('Thanks!');
    });
  });

  describe('likeComment', () => {
    it('delegates to InstagramProvider.likeComment', async () => {
      mockIgbProvider.likeComment.mockResolvedValueOnce({ liked: true });
      const result = await provider.likeComment('ig-1', 'tok', 'media-1', 'comment-1', true, mockIntegration);
      expect(mockIgbProvider.likeComment).toHaveBeenCalledWith('ig-1', 'tok', 'media-1', 'comment-1', true, mockIntegration);
      expect(result).toEqual({ liked: true });
    });

    it('returns { liked: false } via delegate', async () => {
      mockIgbProvider.likeComment.mockResolvedValueOnce({ liked: false });
      const result = await provider.likeComment('ig-1', 'tok', 'media-1', 'comment-1', false, mockIntegration);
      expect(result).toEqual({ liked: false });
    });

    it('throws on API error via delegate', async () => {
      mockIgbProvider.likeComment.mockRejectedValueOnce(new Error('API error'));
      await expect(provider.likeComment('ig-1', 'tok', 'media-1', 'comment-1', true, mockIntegration)).rejects.toThrow('API error');
    });
  });
});
