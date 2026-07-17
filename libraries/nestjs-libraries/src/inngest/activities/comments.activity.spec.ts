import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';

vi.mock('@gitroom/nestjs-libraries/integrations/provider-config.manager', () => ({
  ProviderConfigManager: vi.fn(),
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({
  PrismaService: vi.fn(),
}));

vi.mock(
  '@gitroom/nestjs-libraries/database/prisma/social-comments/social.comments.service',
  () => ({ SocialCommentsService: vi.fn() })
);

vi.mock('@gitroom/nestjs-libraries/services/email.service', () => ({
  EmailService: vi.fn(),
}));

import { CommentsActivity } from '@gitroom/nestjs-libraries/inngest/activities/comments.activity';

const makePost = (overrides: any = {}) => ({
  id: 'post-1',
  releaseId: 'rel-1',
  integrationId: 'int-1',
  organizationId: 'org-1',
  integration: { id: 'int-1', providerIdentifier: 'mastodon' },
  ...overrides,
});

describe('CommentsActivity', () => {
  let activity: CommentsActivity;
  let organizationService: any;
  let providerConfigManager: any;
  let socialCommentsService: any;
  let webhooksService: any;
  let notificationService: any;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    organizationService = {
      getAllIds: vi
        .fn()
        .mockResolvedValue([{ id: 'org-1' }, { id: 'org-2' }]),
    };
    providerConfigManager = { ensureFresh: vi.fn().mockResolvedValue(undefined) };
    socialCommentsService = {
      syncComments: vi.fn().mockResolvedValue(undefined),
      getPublishedPostsForSync: vi.fn().mockResolvedValue([]),
      getPostsWithRecentComments: vi.fn().mockResolvedValue([]),
      findCommentsToPrune: vi.fn().mockResolvedValue([]),
      softDeleteCommentsByIds: vi.fn().mockResolvedValue(undefined),
      getPostsForCommentDigest: vi.fn().mockResolvedValue([]),
    };
    webhooksService = { dispatchEvent: vi.fn().mockResolvedValue(undefined) };
    notificationService = { notifyCommentDigest: vi.fn().mockResolvedValue(undefined) };

    activity = new CommentsActivity(
      organizationService as any,
      providerConfigManager,
      socialCommentsService,
      webhooksService as any,
      notificationService as any
    );
  });

  afterEach(() => {
    delete process.env.COMMENTS_SWEEP_INTERVAL_MINUTES;
    delete process.env.SOCIAL_COMMENT_RETENTION_DAYS;
  });

  describe('getSweepIntervalMinutes', () => {
    it('defaults to 30', async () => {
      expect(await activity.getSweepIntervalMinutes()).toBe(30);
    });
    it('honors a valid env override', async () => {
      process.env.COMMENTS_SWEEP_INTERVAL_MINUTES = '45';
      expect(await activity.getSweepIntervalMinutes()).toBe(45);
    });
    it('falls back to 30 on invalid env', async () => {
      process.env.COMMENTS_SWEEP_INTERVAL_MINUTES = 'nonsense';
      expect(await activity.getSweepIntervalMinutes()).toBe(30);
    });
  });

  describe('getAllOrganizationIds', () => {
    it('maps org rows to ids', async () => {
      expect(await activity.getAllOrganizationIds()).toEqual(['org-1', 'org-2']);
      expect(organizationService.getAllIds).toHaveBeenCalled();
    });
  });

  describe('pruneComments', () => {
    it('soft-deletes comments older than the retention window', async () => {
      socialCommentsService.findCommentsToPrune
        .mockResolvedValueOnce([{ id: 'c1' }, { id: 'c2' }])
        .mockResolvedValueOnce([]);

      await activity.pruneComments('org-1');
      expect(socialCommentsService.findCommentsToPrune).toHaveBeenCalled();
      expect(socialCommentsService.softDeleteCommentsByIds).toHaveBeenCalledWith(
        ['c1', 'c2'],
        'org-1'
      );
    });

    it('handles empty result without error', async () => {
      await activity.pruneComments('org-1');
      expect(socialCommentsService.softDeleteCommentsByIds).not.toHaveBeenCalled();
    });
  });

  describe('syncPostComments', () => {
    it('ensures provider config is fresh', async () => {
      await activity.syncPostComments('org-1', 30);
      expect(providerConfigManager.ensureFresh).toHaveBeenCalled();
    });

    it('skips posts with missing releaseId and delegates the rest to the service', async () => {
      socialCommentsService.getPublishedPostsForSync.mockResolvedValue([
        makePost({ id: 'p1' }),
        makePost({ id: 'p2', releaseId: 'missing' }),
        makePost({ id: 'p3', releaseId: null }),
      ]);

      await activity.syncPostComments('org-1', 30);

      expect(socialCommentsService.syncComments).toHaveBeenCalledTimes(1);
      expect(socialCommentsService.syncComments).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ id: 'p1' })
      );
    });

    it('isolates per-post failures so one channel cannot abort the org sweep', async () => {
      socialCommentsService.getPublishedPostsForSync.mockResolvedValue([
        makePost({ id: 'p1' }),
        makePost({ id: 'p2' }),
      ]);
      socialCommentsService.syncComments
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(undefined);

      await activity.syncPostComments('org-1', 30);

      expect(socialCommentsService.syncComments).toHaveBeenCalledTimes(2);
      expect(Logger.prototype.error).toHaveBeenCalled();
    });
  });

  describe('notifyNewComments', () => {
    it('uses the notification stack for comment backlog alerts before sending email digests', async () => {
      socialCommentsService.getPostsForCommentDigest.mockResolvedValue([
        {
          id: 'post-1',
          content: 'Published post',
          socialComments: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }, { id: 'c5' }, { id: 'c6' }],
          integration: { name: 'Mastodon' },
        },
      ]);

      await activity.notifyNewComments('org-1');

      expect(notificationService.notifyCommentDigest).toHaveBeenCalledWith(
        'org-1',
        6,
        expect.any(Array)
      );
    });
  });
});
