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

const mockCommentThreadsList = vi.hoisted(() => vi.fn());
const mockCommentsInsert = vi.hoisted(() => vi.fn());

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn(function() {
        return { setCredentials: vi.fn() };
      }),
    },
    youtube: vi.fn(() => ({
      commentThreads: { list: mockCommentThreadsList },
      comments: { insert: mockCommentsInsert },
      channels: { list: vi.fn() },
      videos: { list: vi.fn() },
      thumbnails: { set: vi.fn() },
    })),
    oauth2: vi.fn(() => ({ userinfo: { get: vi.fn() } })),
    youtubeAnalytics: vi.fn(() => ({ reports: { query: vi.fn() } })),
  },
  youtube_v3: {},
}));

process.env.FRONTEND_URL = 'http://localhost:5000';

import { YoutubeProvider } from './youtube.provider';

const mockIntegration = {
  internalId: 'int-1',
  name: 'Test User',
  profile: 'testuser',
  picture: 'https://ex.com/pic.jpg',
} as any;

describe('YouTube - comment capabilities', () => {
  let provider: YoutubeProvider;

  beforeEach(() => {
    provider = new YoutubeProvider();
    vi.clearAllMocks();
  });

  describe('commentsCapabilities', () => {
    it('returns read and reply as true, like as false', () => {
      expect(provider.commentsCapabilities).toEqual({ read: true, reply: true, like: false });
    });
  });

  describe('fetchComments', () => {
    it('returns comments when API responds successfully', async () => {
      mockCommentThreadsList.mockResolvedValueOnce({
        data: {
          items: [
            {
              id: 'comment-1',
              snippet: {
                topLevelComment: {
                  snippet: {
                    authorChannelId: { value: 'channel-1' },
                    authorDisplayName: 'John',
                    authorChannelUrl: 'https://youtube.com/@john',
                    authorProfileImageUrl: 'https://yt.com/pic.jpg',
                    textOriginal: 'Great video!',
                    publishedAt: '2024-01-01T00:00:00.000Z',
                    likeCount: 10,
                  },
                },
                totalReplyCount: 2,
              },
            },
          ],
          nextPageToken: 'next-token',
        },
      });
      const result = await provider.fetchComments('channel-1', 'tok', 'video-1', undefined, mockIntegration);
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].platformCommentId).toBe('comment-1');
      expect(result.comments[0].author.name).toBe('John');
      expect(result.comments[0].content).toBe('Great video!');
      expect(result.comments[0].likeCount).toBe(10);
      expect(result.nextCursor).toBe('next-token');
    });

    it('returns empty comments when API returns no items', async () => {
      mockCommentThreadsList.mockResolvedValueOnce({ data: {} });
      const result = await provider.fetchComments('channel-1', 'tok', 'video-1', undefined, mockIntegration);
      expect(result.comments).toEqual([]);
    });

    it('passes pageToken as cursor', async () => {
      mockCommentThreadsList.mockResolvedValueOnce({ data: {} });
      await provider.fetchComments('channel-1', 'tok', 'video-1', 'prev-token', mockIntegration);
      expect(mockCommentThreadsList).toHaveBeenCalledWith(
        expect.objectContaining({ pageToken: 'prev-token' })
      );
    });

    it('handles API error gracefully', async () => {
      mockCommentThreadsList.mockRejectedValueOnce(new Error('API error'));
      const result = await provider.fetchComments('channel-1', 'tok', 'video-1', undefined, mockIntegration);
      expect(result.comments).toEqual([]);
    });
  });

  describe('replyToComment', () => {
    it('returns a SocialCommentDTO with correct fields', async () => {
      mockCommentsInsert.mockResolvedValueOnce({
        data: {
          id: 'reply-123',
          snippet: {
            authorChannelId: { value: 'my-channel' },
            authorDisplayName: 'Test User',
            authorChannelUrl: 'https://youtube.com/@testuser',
            authorProfileImageUrl: 'https://yt.com/avatar.jpg',
            textOriginal: 'Thanks!',
            publishedAt: '2024-01-01T00:00:00.000Z',
          },
        },
      });
      const result = await provider.replyToComment('channel-1', 'tok', 'video-1', 'parent-1', 'Thanks!', mockIntegration);
      expect(result.platformCommentId).toBe('reply-123');
      expect(result.parentPlatformCommentId).toBe('parent-1');
      expect(result.content).toBe('Thanks!');
      expect(result.author.name).toBe('Test User');
    });

    it('throws on API error', async () => {
      mockCommentsInsert.mockRejectedValueOnce(new Error('API error'));
      await expect(provider.replyToComment('channel-1', 'tok', 'video-1', 'parent-1', 'Thanks!', mockIntegration)).rejects.toThrow('API error');
    });

    it('calls comments.insert with correct args', async () => {
      mockCommentsInsert.mockResolvedValueOnce({ data: { id: 'reply-456' } });
      await provider.replyToComment('channel-1', 'tok', 'video-1', 'parent-1', 'Nice!', mockIntegration);
      expect(mockCommentsInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          part: ['snippet'],
          requestBody: {
            snippet: {
              parentId: 'parent-1',
              textOriginal: 'Nice!',
            },
          },
        })
      );
    });
  });
});
