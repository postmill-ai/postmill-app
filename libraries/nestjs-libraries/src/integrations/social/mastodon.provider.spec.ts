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
  getOrgCredential: () => 'https://mastodon.social',
  setCredentials: vi.fn(),
  getCredential: vi.fn(function() { return undefined; }),
  clearCredentials: vi.fn(),
  replaceCredentialsMap: vi.fn(),
}));
vi.mock('form-data', () => ({ default: class FormData { append = vi.fn(); } }));
vi.mock('@gitroom/helpers/utils/html.to.text', () => ({ htmlToText: vi.fn((s: string) => s.replace(/<[^>]*>/g, '')) }));

import { MastodonProvider } from './mastodon.provider';

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

describe('Mastodon - comment capabilities', () => {
  let provider: MastodonProvider;

  beforeEach(() => {
    provider = new MastodonProvider();
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
        ancestors: [],
        descendants: [
          {
            id: 'status-2',
            in_reply_to_id: 'status-1',
            account: { id: 'acct-2', display_name: 'Follower', acct: 'follower@masto', username: 'follower', avatar: 'https://ex.com/av.jpg', url: 'https://masto.social/@follower' },
            content: '<p>Great post!</p>',
            created_at: '2024-01-01T00:00:00.000Z',
            favourites_count: 3,
            replies_count: 1,
            favourited: true,
          },
        ],
      }));
      const result = await provider.fetchComments('user-123', 'tok', 'status-1', undefined, mockIntegration);
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].platformCommentId).toBe('status-2');
      expect(result.comments[0].author.name).toBe('Follower');
      expect(result.comments[0].content).toBe('Great post!');
      expect(result.comments[0].likeCount).toBe(3);
    });

    it('returns empty comments when API returns empty descendants', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(resp({ ancestors: [], descendants: [] }));
      const result = await provider.fetchComments('user-123', 'tok', 'status-1', undefined, mockIntegration);
      expect(result.comments).toEqual([]);
    });

    it('handles API error gracefully', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      const result = await provider.fetchComments('user-123', 'tok', 'status-1', undefined, mockIntegration);
      expect(result.comments).toEqual([]);
    });

    it('uses correct endpoint URL and auth headers', async () => {
      const fetchMock = vi.fn().mockResolvedValue(resp({ ancestors: [], descendants: [] }));
      globalThis.fetch = fetchMock;
      await provider.fetchComments('user-123', 'tok', 'status-1', undefined, mockIntegration);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://mastodon.social/api/v1/statuses/status-1/context',
        expect.objectContaining({
          headers: { Authorization: 'Bearer tok' },
        })
      );
    });
  });

  describe('replyToComment', () => {
    it('returns a SocialCommentDTO with correct fields', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(resp({
        id: 'reply-123',
        in_reply_to_id: 'parent-1',
        account: { id: 'my-acct', display_name: 'Test User', acct: 'testuser', username: 'testuser', avatar: 'https://ex.com/av.jpg', url: 'https://masto.social/@testuser' },
        content: '<p>Thanks!</p>',
        created_at: '2024-01-01T00:00:00.000Z',
      }));
      const result = await provider.replyToComment('user-123', 'tok', 'status-1', 'parent-1', 'Thanks!', mockIntegration);
      expect(result.platformCommentId).toBe('reply-123');
      expect(result.parentPlatformCommentId).toBe('parent-1');
      expect(result.content).toBe('Thanks!');
      expect(result.author.name).toBe('Test User');
    });

    it('handles API error gracefully', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('API error'));
      const result = await provider.replyToComment('user-123', 'tok', 'status-1', 'parent-1', 'Thanks!', mockIntegration);
      expect(result.platformCommentId).toBe('');
      expect(result.content).toBe('Thanks!');
    });

    it('sends POST to statuses endpoint with in_reply_to_id', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(resp({ id: 'reply-456' }));
      await provider.replyToComment('user-123', 'tok', 'status-1', 'parent-1', 'Nice!', mockIntegration);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://mastodon.social/api/v1/statuses',
        expect.objectContaining({
          method: 'POST',
          headers: { Authorization: 'Bearer tok' },
        })
      );
    });
  });

  describe('likeComment', () => {
    it('returns { liked: true, likeCount } when favouriting', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(resp({ favourites_count: 5 }));
      const result = await provider.likeComment('user-123', 'tok', 'status-1', 'comment-1', true, mockIntegration);
      expect(result).toEqual({ liked: true, likeCount: 5 });
    });

    it('returns { liked: false, likeCount } when un-favouriting', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(resp({ favourites_count: 4 }));
      const result = await provider.likeComment('user-123', 'tok', 'status-1', 'comment-1', false, mockIntegration);
      expect(result).toEqual({ liked: false, likeCount: 4 });
    });

    it('throws on API error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('API error'));
      await expect(provider.likeComment('user-123', 'tok', 'status-1', 'comment-1', true, mockIntegration)).rejects.toThrow('API error');
    });

    it('calls correct endpoint for favourite', async () => {
      const fetchMock = vi.fn().mockResolvedValue(resp({ favourites_count: 3 }));
      globalThis.fetch = fetchMock;
      await provider.likeComment('user-123', 'tok', 'status-1', 'comment-1', true, mockIntegration);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://mastodon.social/api/v1/statuses/comment-1/favourite',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('calls correct endpoint for unfavourite', async () => {
      const fetchMock = vi.fn().mockResolvedValue(resp({ favourites_count: 2 }));
      globalThis.fetch = fetchMock;
      await provider.likeComment('user-123', 'tok', 'status-1', 'comment-1', false, mockIntegration);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://mastodon.social/api/v1/statuses/comment-1/unfavourite',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});
