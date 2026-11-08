import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';

const { mockRedisSet, mockRedisDel } = vi.hoisted(() => ({
  mockRedisSet: vi.fn(),
  mockRedisDel: vi.fn(),
}));

vi.mock('@postmill-ai/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { set: mockRedisSet, del: mockRedisDel },
}));

import { SocialCommentsService } from './social.comments.service';
import { GuardrailViolation } from '@postmill-ai/nestjs-libraries/ai/governance/errors';
import { RefreshToken } from '@postmill-ai/nestjs-libraries/integrations/social.abstract';

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

  describe('classifyPostComments', () => {
    let classifyRepo: any;
    let classifyService: SocialCommentsService;
    let defaultsResolution: any;
    let aiModelProvider: any;

    beforeEach(() => {
      classifyRepo = {
        getUnclassifiedComments: vi.fn().mockResolvedValue([]),
        updateSentimentForIds: vi.fn().mockResolvedValue(undefined),
      };
      defaultsResolution = { resolve: vi.fn().mockResolvedValue(null) };
      aiModelProvider = {
        generateObjectWithModel: vi.fn().mockResolvedValue({ comments: [] }),
      };
      classifyService = new SocialCommentsService(
        classifyRepo,
        {},
        {},
        {},
        {},
        {},
        {},
        guardrails as any,
        defaultsResolution,
        aiModelProvider,
      );
    });

    const makePost = () =>
      ({ id: 'post-1', releaseId: 'rel-1', content: 'Post content' } as any);

    it('skips when no active AI provider / low-reasoning default is resolved', async () => {
      await classifyService.classifyPostComments('org-1', makePost());

      expect(defaultsResolution.resolve).toHaveBeenCalledWith(
        'ai',
        'low_reasoning',
        'org-1',
      );
      expect(classifyRepo.getUnclassifiedComments).not.toHaveBeenCalled();
      expect(aiModelProvider.generateObjectWithModel).not.toHaveBeenCalled();
    });

    it('persists sentiment, priority, and confidence returned by the AI', async () => {
      defaultsResolution.resolve.mockResolvedValue({
        providerId: 'openai',
        version: 'v1',
        model: 'gpt-4.1',
      });
      classifyRepo.getUnclassifiedComments.mockResolvedValue([
        { id: 'c1', platformCommentId: 'pc1', content: 'Love this!' },
      ]);
      aiModelProvider.generateObjectWithModel.mockResolvedValue({
        comments: [
          {
            platformCommentId: 'pc1',
            sentiment: 'positive',
            priority: 'low',
            confidence: 0.95,
          },
        ],
      });

      await classifyService.classifyPostComments('org-1', makePost());

      expect(aiModelProvider.generateObjectWithModel).toHaveBeenCalledWith(
        'org-1',
        'openai',
        'v1',
        'gpt-4.1',
        expect.objectContaining({
          system: expect.stringContaining('comment triage assistant'),
          schema: expect.anything(),
        }),
      );
      expect(classifyRepo.updateSentimentForIds).toHaveBeenCalledWith('org-1', [
        {
          id: 'c1',
          sentiment: 'positive',
          priority: 'low',
          sentimentConfidence: 0.95,
        },
      ]);
    });

    it('continues without failing when classification throws', async () => {
      defaultsResolution.resolve.mockResolvedValue({
        providerId: 'openai',
        version: 'v1',
        model: 'gpt-4.1',
      });
      classifyRepo.getUnclassifiedComments.mockRejectedValue(
        new Error('db down'),
      );

      await expect(
        classifyService.classifyPostComments('org-1', makePost()),
      ).resolves.toBeUndefined();

      expect(classifyRepo.updateSentimentForIds).not.toHaveBeenCalled();
    });

    it('does not re-classify already-classified comments (idempotent via NULL filter)', async () => {
      defaultsResolution.resolve.mockResolvedValue({
        providerId: 'openai',
        version: 'v1',
        model: 'gpt-4.1',
      });
      classifyRepo.getUnclassifiedComments.mockResolvedValue([]);

      await classifyService.classifyPostComments('org-1', makePost());

      expect(aiModelProvider.generateObjectWithModel).not.toHaveBeenCalled();
      expect(classifyRepo.updateSentimentForIds).not.toHaveBeenCalled();
    });
  });

  describe('syncComments reconciliation', () => {
    let provider: any;
    let syncRepository: any;
    let syncPostsService: any;
    let integrationService: any;
    let syncService: SocialCommentsService;
    const post = {
      id: 'post-1',
      organizationId: 'org-1',
      integrationId: 'integration-1',
      releaseId: 'release-1',
      integration: {
        id: 'integration-1',
        organizationId: 'org-1',
        providerIdentifier: 'linkedin',
        providerVersion: 'v1',
        providerConfigId: null,
        internalId: 'internal-1',
        token: 'token',
        tokenExpiration: null,
        refreshNeeded: false,
      },
    } as any;

    beforeEach(() => {
      provider = {
        commentsCapabilities: { read: true, reply: true, like: true },
        fetchComments: vi.fn(),
      };
      syncRepository = {
        getActiveCommentIds: vi.fn().mockResolvedValue([
          { id: 'stored-comment', platformCommentId: 'platform-old' },
        ]),
        softDeleteCommentsByIds: vi.fn().mockResolvedValue({ count: 1 }),
        countComments: vi.fn().mockResolvedValue(0),
        upsertComment: vi.fn(),
      };
      syncPostsService = { updateCommentCount: vi.fn().mockResolvedValue(undefined) };
      integrationService = {
        refreshNeeded: vi.fn().mockResolvedValue(undefined),
        disconnectChannel: vi.fn().mockResolvedValue(undefined),
      };
      const integrationManager = {
        getSocialIntegrationUnchecked: vi.fn().mockReturnValue(provider),
        requireClientInformation: vi.fn().mockResolvedValue(undefined),
      };
      syncService = new SocialCommentsService(
        syncRepository,
        syncPostsService,
        integrationManager,
        { refresh: vi.fn() },
        integrationService,
        { dispatchEvent: vi.fn().mockResolvedValue(undefined) },
        {},
        guardrails as any,
      );
    });

    it('does not reconcile deletions after a transient fetch failure', async () => {
      provider.fetchComments.mockRejectedValue(new Error('provider unavailable'));

      await syncService.syncComments('org-1', post);

      expect(syncRepository.getActiveCommentIds).not.toHaveBeenCalled();
      expect(syncRepository.softDeleteCommentsByIds).not.toHaveBeenCalled();
      expect(integrationService.refreshNeeded).not.toHaveBeenCalled();
    });

    it('does not reconcile deletions after a malformed provider response', async () => {
      provider.fetchComments.mockRejectedValue(new SyntaxError('malformed response'));

      await syncService.syncComments('org-1', post);

      expect(syncRepository.softDeleteCommentsByIds).not.toHaveBeenCalled();
    });

    it('pauses the affected channel without reconciling after a refresh-token failure', async () => {
      provider.fetchComments.mockRejectedValue(
        new RefreshToken('integration-1', '{}', '{}', 'refresh required'),
      );

      await syncService.syncComments('org-1', post);

      expect(integrationService.refreshNeeded).toHaveBeenCalledWith('org-1', 'integration-1');
      expect(syncRepository.softDeleteCommentsByIds).not.toHaveBeenCalled();
    });

    it('reconciles deletions after a successful authoritative empty response', async () => {
      provider.fetchComments.mockResolvedValue({ comments: [] });

      await syncService.syncComments('org-1', post);

      expect(syncRepository.softDeleteCommentsByIds).toHaveBeenCalledWith(
        ['stored-comment'],
        'org-1',
      );
    });

    it('skips providers without comment read support', async () => {
      provider.commentsCapabilities.read = false;

      await syncService.syncComments('org-1', post);

      expect(provider.fetchComments).not.toHaveBeenCalled();
      expect(syncRepository.softDeleteCommentsByIds).not.toHaveBeenCalled();
    });
  });
});
