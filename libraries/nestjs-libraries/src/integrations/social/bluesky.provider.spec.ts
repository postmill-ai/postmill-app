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

const mockAgent = vi.hoisted(() => ({
  login: vi.fn().mockResolvedValue({ data: { accessJwt: 'tok', refreshJwt: 'rtok', handle: 'testuser', did: 'did:plc:123' } }),
  getProfile: vi.fn().mockResolvedValue({ data: { displayName: 'Test User', avatar: 'https://ex.com/avatar.jpg', handle: 'testuser' } }),
  getPostThread: vi.fn().mockResolvedValue({
    data: {
      thread: {
        post: {
          uri: 'at://did:plc:123/app.bsky.feed.post/post-1',
          cid: 'cid-1',
          record: { reply: { root: { uri: 'at://did:plc:123/app.bsky.feed.post/root', cid: 'root-cid' } } },
          likeCount: 10,
          replyCount: 3,
          viewer: { like: 'at://did:plc:123/app.bsky.feed.like/like-1' },
          author: { did: 'did:plc:author', displayName: 'Author', handle: 'author', avatar: 'https://ex.com/author.jpg' },
        },
        replies: [
          {
            post: {
              uri: 'at://did:plc:123/app.bsky.feed.post/reply-1',
              cid: 'cid-reply-1',
              record: { text: 'Great post!', reply: { parent: { uri: 'at://did:plc:123/app.bsky.feed.post/post-1' } }, createdAt: '2024-01-01T00:00:00.000Z' },
              likeCount: 3,
              replyCount: 0,
              viewer: { like: undefined },
              author: { did: 'did:plc:reply-author', displayName: 'Reply Author', handle: 'replyauthor', avatar: 'https://ex.com/reply.jpg' },
              indexedAt: '2024-01-01T00:00:00.000Z',
            },
          },
        ],
      },
    },
  }),
  post: vi.fn().mockResolvedValue({ uri: 'at://did:plc:123/app.bsky.feed.post/reply-sent', cid: 'cid-sent' }),
  like: vi.fn().mockResolvedValue({}),
  deleteLike: vi.fn().mockResolvedValue({}),
  uploadBlob: vi.fn().mockResolvedValue({ data: { blob: { ref: { $link: 'ref-123' }, mimeType: 'image/jpeg', size: 12345 } } }),
  searchActors: vi.fn().mockResolvedValue({ data: { actors: [{ displayName: 'Test Actor', handle: 'testactor', avatar: 'https://ex.com/avatar.jpg' }] } }),
  repost: vi.fn().mockResolvedValue({}),
  app: {
    bsky: {
      feed: {
        getLikes: vi.fn().mockResolvedValue({ data: { likes: [{ actor: { did: 'did:plc:my-did' }, uri: 'at://like/uri' }] } }),
      },
      video: { getJobStatus: vi.fn().mockResolvedValue({ data: { jobStatus: { state: 'JOB_STATE_COMPLETED', blob: { ref: { $link: 'vid-ref' } } } } }) },
    },
  },
  com: { atproto: { server: { getServiceAuth: vi.fn().mockResolvedValue({ data: { token: 'service-token' } }) } } },
  session: { did: 'did:plc:my-did', handle: 'testuser' },
  dispatchUrl: new URL('https://bsky.social'),
}));

const mockRichText = vi.hoisted(() => vi.fn(function() {
  return {
    detectFacets: vi.fn().mockResolvedValue(undefined),
    text: 'Hello!',
    facets: [],
  };
}));

vi.mock('@atproto/api', () => ({
  BskyAgent: vi.fn(function() { return mockAgent; }),
  AtpAgent: vi.fn(function() { return mockAgent; }),
  RichText: mockRichText,
  AppBskyEmbedVideo: {},
  AppBskyVideoDefs: {},
  BlobRef: class {},
}));

vi.mock('mime', () => ({ default: { getType: vi.fn(() => 'image/jpeg') } }));

process.env.FRONTEND_URL = 'http://localhost:5000';

import { BlueskyProvider } from './bluesky.provider';

const mockIntegration = {
  id: 'int-1',
  internalId: 'int-1',
  name: 'Test User',
  profile: 'testuser',
  picture: 'https://ex.com/pic.jpg',
  customInstanceDetails: JSON.stringify({ service: 'https://bsky.social', identifier: 'testuser', password: 'pass' }),
} as any;

describe('Bluesky - comment capabilities', () => {
  let provider: BlueskyProvider;

  beforeEach(() => {
    provider = new BlueskyProvider();
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
      const result = await provider.fetchComments('did:plc:123', 'tok', 'at://post/1', undefined, mockIntegration);
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].platformCommentId).toBe('at://did:plc:123/app.bsky.feed.post/reply-1');
      expect(result.comments[0].author.name).toBe('Reply Author');
      expect(result.comments[0].content).toBeDefined();
    });

    it('returns empty comments when there are no replies', async () => {
      mockAgent.getPostThread.mockResolvedValueOnce({
        data: { thread: { replies: [] } },
      });
      const result = await provider.fetchComments('did:plc:123', 'tok', 'at://post/1', undefined, mockIntegration);
      expect(result.comments).toEqual([]);
    });

    it('handles API error gracefully', async () => {
      mockAgent.getPostThread.mockRejectedValueOnce(new Error('API error'));
      const result = await provider.fetchComments('did:plc:123', 'tok', 'at://post/1', undefined, mockIntegration);
      expect(result.comments).toEqual([]);
    });
  });

  describe('replyToComment', () => {
    it('returns a SocialCommentDTO with correct fields', async () => {
      const result = await provider.replyToComment('did:plc:123', 'tok', 'at://post/1', 'at://parent/1', 'Thanks!', mockIntegration);
      expect(result.platformCommentId).toBe('at://did:plc:123/app.bsky.feed.post/reply-sent');
      expect(result.parentPlatformCommentId).toBe('at://parent/1');
      expect(result.content).toBe('Thanks!');
      expect(result.author.name).toBe('Test User');
    });

    it('handles API error gracefully', async () => {
      mockAgent.post.mockRejectedValueOnce(new Error('API error'));
      const result = await provider.replyToComment('did:plc:123', 'tok', 'at://post/1', 'at://parent/1', 'Thanks!', mockIntegration);
      expect(result.platformCommentId).toBe('');
      expect(result.content).toBe('Thanks!');
    });
  });

  describe('likeComment', () => {
    it('returns { liked: true } when liking', async () => {
      const result = await provider.likeComment('did:plc:123', 'tok', 'at://post/1', 'at://comment/1', true, mockIntegration);
      expect(result).toEqual({ liked: true });
    });

    it('returns { liked: false } when like fails because no cid', async () => {
      mockAgent.getPostThread.mockResolvedValueOnce({
        data: { thread: { post: { cid: undefined } } },
      });
      const result = await provider.likeComment('did:plc:123', 'tok', 'at://post/1', 'at://comment/1', true, mockIntegration);
      expect(result).toEqual({ liked: false });
    });

    it('returns { liked: false } when unliking', async () => {
      const result = await provider.likeComment('did:plc:123', 'tok', 'at://post/1', 'at://comment/1', false, mockIntegration);
      expect(result).toEqual({ liked: false });
    });

    it('throws on API error', async () => {
      mockAgent.like.mockRejectedValueOnce(new Error('API error'));
      await expect(provider.likeComment('did:plc:123', 'tok', 'at://post/1', 'at://comment/1', true, mockIntegration)).rejects.toThrow('API error');
    });

    it('calls agent.like when liking', async () => {
      await provider.likeComment('did:plc:123', 'tok', 'at://post/1', 'at://comment/1', true, mockIntegration);
      expect(mockAgent.like).toHaveBeenCalled();
    });

    it('calls agent.deleteLike when unliking', async () => {
      await provider.likeComment('did:plc:123', 'tok', 'at://post/1', 'at://comment/1', false, mockIntegration);
      expect(mockAgent.deleteLike).toHaveBeenCalled();
    });
  });
});
