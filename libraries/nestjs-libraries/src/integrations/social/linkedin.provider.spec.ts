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
vi.mock('image-to-pdf', () => ({ default: vi.fn(() => ({ pipe: vi.fn(), on: vi.fn() })) }));
vi.mock('mime-types', () => ({ lookup: vi.fn() }));

import { LinkedinProvider } from './linkedin.provider';

function resp(data: any) {
  return {
    status: 200, ok: true,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
    headers: new Map([['x-restli-id', 'urn:li:post:abc'], ['get', (k: string) => k === 'x-restli-id' ? 'urn:li:post:abc' : undefined]]),
  };
}

const mockIntegration = {
  internalId: 'int-1',
  name: 'Test User',
  profile: 'testuser',
  picture: 'https://ex.com/pic.jpg',
} as any;

describe('LinkedIn - comment capabilities', () => {
  let provider: LinkedinProvider;

  beforeEach(() => {
    provider = new LinkedinProvider();
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
        elements: [{
          id: 'comment-1',
          'actor~': {
            localizedFirstName: 'John',
            localizedLastName: 'Doe',
            'profilePicture~': { elements: [{ identifiers: [{ identifier: 'https://ex.com/pic.jpg' }] }] },
          },
          actor: 'urn:li:person:abc123',
          message: { text: 'Great post!' },
          createdAt: '2024-01-01T00:00:00.000Z',
        }],
      }));
      const result = await provider.fetchComments('user-123', 'tok', 'post-123', undefined, mockIntegration);
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].platformCommentId).toBe('comment-1');
      expect(result.comments[0].author.name).toBe('John Doe');
      expect(result.comments[0].content).toBe('Great post!');
    });

    it('returns empty comments when API returns empty', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(resp({ elements: [] }));
      const result = await provider.fetchComments('user-123', 'tok', 'post-123', undefined, mockIntegration);
      expect(result.comments).toEqual([]);
    });

    it('handles API error gracefully', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      const result = await provider.fetchComments('user-123', 'tok', 'post-123', undefined, mockIntegration);
      expect(result.comments).toEqual([]);
    });

    it('uses correct auth headers and endpoint URL', async () => {
      const fetchMock = vi.fn().mockResolvedValue(resp({ elements: [] }));
      globalThis.fetch = fetchMock;
      await provider.fetchComments('user-123', 'tok', 'post-123', undefined, mockIntegration);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('api.linkedin.com/rest/socialActions/post-123/comments'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer tok',
            'X-Restli-Protocol-Version': '2.0.0',
          }),
        })
      );
    });
  });

  describe('replyToComment', () => {
    it('returns a SocialCommentDTO with correct fields', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(resp({ object: 'urn:li:comment:reply-123' }));
      const result = await provider.replyToComment('user-123', 'tok', 'post-123', 'parent-1', 'Thanks!', mockIntegration);
      expect(result.platformCommentId).toBe('urn:li:comment:reply-123');
      expect(result.parentPlatformCommentId).toBe('parent-1');
      expect(result.content).toBe('Thanks!');
      expect(result.author.name).toBe('Test User');
    });

    it('handles API error gracefully (returns fallback with empty platformCommentId)', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('API error'));
      const result = await provider.replyToComment('user-123', 'tok', 'post-123', 'parent-1', 'Thanks!', mockIntegration);
      expect(result.platformCommentId).toBe('');
      expect(result.content).toBe('Thanks!');
    });

    it('sends POST with correct payload', async () => {
      const fetchMock = vi.fn().mockResolvedValue(resp({ object: 'urn:li:comment:reply-456' }));
      globalThis.fetch = fetchMock;
      await provider.replyToComment('user-123', 'tok', 'post-123', 'parent-1', 'Nice!', mockIntegration);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('api.linkedin.com/rest/socialActions/post-123/comments'),
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
      const result = await provider.likeComment('user-123', 'tok', 'post-123', 'comment-1', true, mockIntegration);
      expect(result).toEqual({ liked: true });
    });

    it('returns { liked: false } when unliking', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(resp({}));
      const result = await provider.likeComment('user-123', 'tok', 'post-123', 'comment-1', false, mockIntegration);
      expect(result).toEqual({ liked: false });
    });

    it('throws on API error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('API error'));
      await expect(provider.likeComment('user-123', 'tok', 'post-123', 'comment-1', true, mockIntegration)).rejects.toThrow('API error');
    });

    it('uses correct endpoint for like', async () => {
      const fetchMock = vi.fn().mockResolvedValue(resp({}));
      globalThis.fetch = fetchMock;
      await provider.likeComment('user-123', 'tok', 'post-123', 'comment-1', true, mockIntegration);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('api.linkedin.com/rest/socialActions/comment-1/likes'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});
