import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaJobsActivity } from './media-jobs.activity';
import { StorageProviderType } from '@prisma/client';
import { PermissionsService } from '@gitroom/backend/services/auth/permissions/permissions.service';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';

describe('MediaJobsActivity — video export metering', () => {
  const orgId = 'org-1';
  const jobId = 'job-1';
  const org = { id: orgId } as any;

  function makeCreditTracker() {
    // The render is charged via a plain `recordCredit` AFTER a confirmed-completed render
    // (not a $transaction-wrapped useCredit — that would time out on a multi-second render
    // and roll the charge back). A failed render never calls recordCredit at all.
    const credits: Array<{ type: string; orgId: string }> = [];
    return {
      credits,
      subscriptionService: {
        getSubscriptionByOrganizationId: vi.fn().mockResolvedValue({
          subscriptionTier: 'STARTER',
          createdAt: new Date(),
          extraVideoExports: 0,
        }),
        getCreditsFrom: vi.fn().mockResolvedValue(0),
        recordCredit: vi.fn(async (_orgArg: any, type: string) => {
          credits.push({ type, orgId: _orgArg.id });
        }),
      },
    };
  }

  function buildActivity(overrides: Record<string, unknown> = {}) {
    const creditTracker = makeCreditTracker();
    const aiSettings = {
      // Default: a job that is still `pending` at entry (the only state that renders
      // + charges). Individual tests override to model pending→completed etc.
      getMediaJobByIdUnscoped: vi
        .fn()
        .mockResolvedValue({
          id: jobId,
          organizationId: orgId,
          provider: 'chromium-ffmpeg',
          model: null,
          status: 'pending',
        }),
      getPendingMediaJobs: vi.fn().mockResolvedValue([]),
      ...((overrides.aiSettings as any) || {}),
    };
    const videoRenderService = {
      processVideoRender: vi.fn().mockResolvedValue(undefined),
      processMergeRender: vi.fn().mockResolvedValue(undefined),
      ...((overrides.videoRenderService as any) || {}),
    };
    const organizationService = {
      getOrgById: vi.fn().mockResolvedValue(org),
      ...((overrides.organizationService as any) || {}),
    };
    const lifecycle = {
      processJob: vi.fn().mockResolvedValue(undefined),
      reclaimStaleLandingJobs: vi.fn().mockResolvedValue(undefined),
      completeJobWithBuffer: vi.fn().mockResolvedValue(undefined),
      ...((overrides.lifecycle as any) || {}),
    };

    const activity = new MediaJobsActivity(
      lifecycle as any,
      aiSettings as any,
      videoRenderService as any,
      creditTracker.subscriptionService as any,
      organizationService as any
    );

    return {
      activity,
      aiSettings,
      videoRenderService,
      organizationService,
      lifecycle,
      ...creditTracker,
    };
  }

  beforeEach(() => {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    vi.clearAllMocks();
  });

  it('charges one video_export credit when the render succeeds', async () => {
    const { activity, subscriptionService, videoRenderService, credits, aiSettings } =
      buildActivity();
    // Realistic success: pending at entry, completed after the render.
    aiSettings.getMediaJobByIdUnscoped
      .mockResolvedValueOnce({
        id: jobId,
        organizationId: orgId,
        provider: 'chromium-ffmpeg',
        model: null,
        status: 'pending',
      })
      .mockResolvedValue({
        id: jobId,
        organizationId: orgId,
        provider: 'chromium-ffmpeg',
        model: null,
        status: 'completed',
      });

    await activity.processRenderJob(jobId);

    expect(subscriptionService.recordCredit).toHaveBeenCalledTimes(1);
    expect(subscriptionService.recordCredit).toHaveBeenCalledWith(org, 'video_export');
    expect(videoRenderService.processVideoRender).toHaveBeenCalledWith(jobId);
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({ type: 'video_export', orgId });
  });

  it('charges one credit for the local/ffmpeg-merge path', async () => {
    const { activity, subscriptionService, videoRenderService, credits, aiSettings } =
      buildActivity();
    aiSettings.getMediaJobByIdUnscoped
      .mockResolvedValueOnce({
        id: jobId,
        organizationId: orgId,
        provider: 'other',
        model: 'local/ffmpeg-merge',
        status: 'pending',
      })
      .mockResolvedValueOnce({
        id: jobId,
        organizationId: orgId,
        provider: 'other',
        model: 'local/ffmpeg-merge',
        status: 'completed',
      });

    await activity.processRenderJob(jobId);

    expect(videoRenderService.processMergeRender).toHaveBeenCalledWith(jobId);
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({ type: 'video_export', orgId });
  });

  it('does NOT charge when the job is already terminal — idempotent retry (B3.1)', async () => {
    // A retried / re-dispatched job that a prior invocation already completed.
    const { activity, subscriptionService, videoRenderService, credits, aiSettings } =
      buildActivity();
    aiSettings.getMediaJobByIdUnscoped.mockResolvedValue({
      id: jobId,
      organizationId: orgId,
      provider: 'chromium-ffmpeg',
      model: null,
      status: 'completed',
    });

    await activity.processRenderJob(jobId);

    // The pending-status guard must short-circuit: no render, no second credit.
    expect(subscriptionService.recordCredit).not.toHaveBeenCalled();
    expect(videoRenderService.processVideoRender).not.toHaveBeenCalled();
    expect(credits).toHaveLength(0);
  });

  it('does not charge when the render does not reach completed status', async () => {
    const { activity, subscriptionService, aiSettings, credits } = buildActivity();
    aiSettings.getMediaJobByIdUnscoped
      .mockResolvedValueOnce({
        id: jobId,
        organizationId: orgId,
        provider: 'chromium-ffmpeg',
        model: null,
        status: 'pending',
      })
      .mockResolvedValueOnce({
        id: jobId,
        organizationId: orgId,
        provider: 'chromium-ffmpeg',
        model: null,
        status: 'failed',
      });

    await expect(activity.processRenderJob(jobId)).rejects.toThrow(
      /did not complete/
    );

    // No charge for an incomplete render — nothing to roll back because we never insert.
    expect(subscriptionService.recordCredit).not.toHaveBeenCalled();
    expect(credits).toHaveLength(0);
  });

  it('does not charge when the render function throws', async () => {
    const { activity, subscriptionService, videoRenderService, credits } =
      buildActivity();
    videoRenderService.processVideoRender.mockRejectedValue(
      new Error('render crashed')
    );

    await expect(activity.processRenderJob(jobId)).rejects.toThrow(
      'render crashed'
    );

    expect(subscriptionService.recordCredit).not.toHaveBeenCalled();
    expect(credits).toHaveLength(0);
  });

  describe('render gate respects extraVideoExports', () => {
    beforeEach(() => {
      process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test';
    });

    function buildPermissionsService(extraVideoExports: number, used: number) {
      const subscriptionService = {
        getSubscriptionByOrganizationId: vi.fn().mockResolvedValue({
          subscriptionTier: 'STARTER',
          createdAt: new Date(),
          extraVideoExports,
        }),
        getCreditsFrom: vi.fn().mockResolvedValue(used),
      };
      const postsService = { countPostsFromDay: vi.fn() };
      const integrationService = { getIntegrationsList: vi.fn(), getIntegrationById: vi.fn() };
      const webhooksService = { getTotal: vi.fn() };
      const organizationService = { getTeam: vi.fn(), getOrgById: vi.fn() };
      const brandsRepository = { countBrands: vi.fn() };
      const watchlistRepository = { countByOrg: vi.fn() };
      const fileRepository = { getStorageBytes: vi.fn() };
      const storageService = { getMountedConfigs: vi.fn().mockResolvedValue([]) };
      const aiSettingsRepository = {
        countInFlightVideoExports: vi.fn().mockResolvedValue(0),
      };

      return {
        service: new PermissionsService(
          subscriptionService as any,
          postsService as any,
          integrationService as any,
          webhooksService as any,
          organizationService as any,
          brandsRepository as any,
          watchlistRepository as any,
          fileRepository as any,
          storageService as any,
          aiSettingsRepository as any
        ),
        subscriptionService,
      };
    }

    it('allows a render when usage is under the add-on-raised cap', async () => {
      const { service } = buildPermissionsService(10, 24);
      const ability = await service.check(orgId, new Date(), 'ADMIN', [
        [AuthorizationActions.Create, Sections.VIDEO_EXPORTS],
      ]);
      expect(ability.can(AuthorizationActions.Create, Sections.VIDEO_EXPORTS)).toBe(true);
    });

    it('blocks a render when usage reaches the add-on-raised cap', async () => {
      const { service } = buildPermissionsService(10, 25);
      const ability = await service.check(orgId, new Date(), 'ADMIN', [
        [AuthorizationActions.Create, Sections.VIDEO_EXPORTS],
      ]);
      expect(ability.can(AuthorizationActions.Create, Sections.VIDEO_EXPORTS)).toBe(false);
    });

    it('counts exports only from the current billing cycle, not since signup (monthly rollover)', async () => {
      // Subscription created several cycles ago; the export counter must roll over each
      // billing month rather than accumulating every export since account creation.
      const createdAt = new Date('2026-01-15T00:00:00Z');
      const { service, subscriptionService } = buildPermissionsService(0, 0);
      subscriptionService.getSubscriptionByOrganizationId.mockResolvedValue({
        subscriptionTier: 'STARTER',
        createdAt,
        extraVideoExports: 0,
      });

      await service.check(orgId, createdAt, 'ADMIN', [
        [AuthorizationActions.Create, Sections.VIDEO_EXPORTS],
      ]);

      expect(subscriptionService.getCreditsFrom).toHaveBeenCalledWith(
        orgId,
        expect.anything(),
        'video_export'
      );
      const fromArg: any = subscriptionService.getCreditsFrom.mock.calls[0][1];
      const fromDate: Date = fromArg?.toDate ? fromArg.toDate() : fromArg;
      // The window starts at the CURRENT cycle boundary (advanced whole months from
      // createdAt), strictly after signup — proving prior cycles don't count.
      expect(fromDate.getTime()).toBeGreaterThan(createdAt.getTime());
    });
  });
});
