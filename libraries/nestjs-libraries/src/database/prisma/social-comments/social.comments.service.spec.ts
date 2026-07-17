import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';

const { mockRedisSet, mockRedisDel } = vi.hoisted(() => ({
  mockRedisSet: vi.fn(),
  mockRedisDel: vi.fn(),
}));

vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { set: mockRedisSet, del: mockRedisDel },
}));

import { SocialCommentsService } from './social.comments.service';
import { GuardrailViolation } from '@gitroom/nestjs-libraries/ai/governance/errors';

describe('SocialCommentsService — controller-moved logic', () => {
  let service: SocialCommentsService;
  let guardrails: { checkOutput: ReturnType<typeof vi.fn> };
  let repository: any;
  let postsService: any;
  let integrationManager: any;

  const mockOrg = { id: 'org-1', name: 'Test Org' } as any;
  const mockUser = { id: 'user-1', name: 'Test User' } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisSet.mockResolvedValue('OK');
    mockRedisDel.mockResolvedValue(1);

    guardrails = {
      checkOutput: vi.fn().mockImplementation((m: string) => Promise.resolve(m)),
    };

    repository = {
      getInbox: vi.fn().mockResolvedValue({ comments: [], nextCursor: undefined }),
    };

    postsService = {};
    integrationManager = {};

    service = new SocialCommentsService(
      repository,
      postsService,
      integrationManager,
      {},
      {},
      {},
      {},
      guardrails as any
    );
  });

  describe('parseInboxFilters', () => {
    it('accepts a valid status', () => {
      const result = service.parseInboxFilters({ status: 'needs_reply' } as any);
      expect(result.status).toBe('needs_reply');
    });

    it('rejects an invalid status', () => {
      expect(() => service.parseInboxFilters({ status: 'invalid' } as any)).toThrow(
        BadRequestException
      );
    });

    it('validates assigneeId as cuid', () => {
      expect(() =>
        service.parseInboxFilters({ assigneeId: 'not-a-cuid' } as any)
      ).toThrow(BadRequestException);
    });

    it('splits and validates campaignId list as UUIDs', () => {
      const result = service.parseInboxFilters({
        campaignId: ' a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 , 550e8400-e29b-41d4-a716-446655440000 ',
      } as any);
      expect(result.campaignIds).toEqual([
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        '550e8400-e29b-41d4-a716-446655440000',
      ]);
    });

    it('rejects invalid campaignId values', () => {
      expect(() =>
        service.parseInboxFilters({ campaignId: 'not-a-uuid' } as any)
      ).toThrow(BadRequestException);
    });

    it('splits and validates integrationId list as cuids', () => {
      const result = service.parseInboxFilters({
        integrationId: 'clabcdefghijklmnopqrs123, clstuvwxyz1234567890',
      } as any);
      expect(result.integrationIds).toEqual([
        'clabcdefghijklmnopqrs123',
        'clstuvwxyz1234567890',
      ]);
    });

    it('rejects invalid integrationId values', () => {
      expect(() =>
        service.parseInboxFilters({ integrationId: 'not-a-cuid' } as any)
      ).toThrow(BadRequestException);
    });
  });

  describe('addComment', () => {
    it('guards the message and dispatches replyToPost', async () => {
      (service as any).replyToPost = vi
        .fn()
        .mockResolvedValue({ platformCommentId: 'c1' });

      const result = await service.addComment(
        'org-1',
        'user-1',
        'post-1',
        'hello',
        mockOrg,
        mockUser,
        'idem-key'
      );

      expect(guardrails.checkOutput).toHaveBeenCalledWith('hello', {
        orgId: 'org-1',
        userId: 'user-1',
      });
      expect(mockRedisSet).toHaveBeenCalledWith(
        'idem:org-1:idem-key',
        '1',
        'EX',
        86400,
        'NX'
      );
      expect((service as any).replyToPost).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        'post-1',
        'hello'
      );
      expect(result).toEqual({ platformCommentId: 'c1' });
    });

    it('maps GuardrailViolation to 422 and does not claim idempotency key', async () => {
      guardrails.checkOutput.mockRejectedValueOnce(
        new GuardrailViolation('Blocked', 'pii', 'block')
      );

      await expect(
        service.addComment('org-1', 'user-1', 'post-1', 'ssn', mockOrg, mockUser, 'idem-key')
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(mockRedisSet).not.toHaveBeenCalled();
    });

    it('returns duplicate when the idempotency key is already claimed', async () => {
      mockRedisSet.mockResolvedValueOnce(null);

      const result = await service.addComment(
        'org-1',
        'user-1',
        'post-1',
        'hi',
        mockOrg,
        mockUser,
        'idem-key'
      );

      expect(result).toEqual({ duplicate: true });
    });

    it('releases the key when dispatch throws', async () => {
      (service as any).replyToPost = vi
        .fn()
        .mockRejectedValueOnce(new Error('provider down'));

      await expect(
        service.addComment('org-1', 'user-1', 'post-1', 'hi', mockOrg, mockUser, 'idem-key')
      ).rejects.toThrow('provider down');
      expect(mockRedisDel).toHaveBeenCalledWith('idem:org-1:idem-key');
    });

    it('fails open when Redis is unavailable', async () => {
      mockRedisSet.mockRejectedValue(new Error('ECONNREFUSED'));
      (service as any).replyToPost = vi
        .fn()
        .mockResolvedValue({ platformCommentId: 'c2' });

      const result = await service.addComment(
        'org-1',
        'user-1',
        'post-1',
        'hi',
        mockOrg,
        mockUser,
        'idem-key'
      );

      expect(result).toEqual({ platformCommentId: 'c2' });
    });
  });

  describe('replyToCommentGuarded', () => {
    it('guards the message and dispatches replyToComment', async () => {
      (service as any).replyToComment = vi
        .fn()
        .mockResolvedValue({ platformCommentId: 'reply-1' });

      const result = await service.replyToCommentGuarded(
        'org-1',
        'user-1',
        'post-1',
        'comment-1',
        'reply text',
        mockOrg,
        mockUser
      );

      expect(guardrails.checkOutput).toHaveBeenCalledWith('reply text', {
        orgId: 'org-1',
        userId: 'user-1',
      });
      expect((service as any).replyToComment).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        'post-1',
        'comment-1',
        'reply text'
      );
      expect(result).toEqual({ platformCommentId: 'reply-1' });
    });
  });
});
