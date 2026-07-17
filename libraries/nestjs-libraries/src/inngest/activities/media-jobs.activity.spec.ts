import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ enabled: true, send: vi.fn() }));

vi.mock('@gitroom/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: { send: (...args: any[]) => h.send(...args) },
  isInngestEnabled: () => h.enabled,
}));

import { MediaJobsActivity } from './media-jobs.activity';

function makeActivity(opts: {
  pending?: any[];
  jobsById?: Record<string, any>;
}) {
  const lifecycle = {
    reclaimStaleLandingJobs: vi.fn().mockResolvedValue(0),
    processJob: vi.fn().mockResolvedValue('pending'),
  };
  const aiSettings = {
    getPendingMediaJobs: vi.fn().mockResolvedValue(opts.pending ?? []),
    getMediaJobById: vi.fn(async (_orgId: string, id: string) => opts.jobsById?.[id]),
    getMediaJobByIdUnscoped: vi.fn(async (id: string) => opts.jobsById?.[id]),
  };
  const videoRender = {
    // A successful render transitions the job pending→completed (so the after-read passes).
    // Failure tests override these to resolve without flipping the status.
    processVideoRender: vi.fn(async (id: string) => {
      if (opts.jobsById?.[id]) opts.jobsById[id].status = 'completed';
    }),
    processMergeRender: vi.fn(async (id: string) => {
      if (opts.jobsById?.[id]) opts.jobsById[id].status = 'completed';
    }),
  };
  const subscriptionService = {
    recordCredit: vi.fn(async (_org: unknown, _type: string) => undefined),
  };
  const organizationService = {
    getOrgById: vi.fn(async (_orgId: string) => ({ id: _orgId, name: 'Test Org' })),
  };
  const activity = new MediaJobsActivity(
    lifecycle as any,
    aiSettings as any,
    videoRender as any,
    subscriptionService as any,
    organizationService as any,
  );
  return { activity, lifecycle, aiSettings, videoRender, subscriptionService, organizationService };
}

describe('MediaJobsActivity', () => {
  beforeEach(() => {
    h.enabled = true;
    h.send.mockReset();
  });

  it('reclaims stale landing jobs at the start of the sweep', async () => {
    const { activity, lifecycle } = makeActivity({ pending: [] });

    await activity.processPendingMediaJobs();

    expect(lifecycle.reclaimStaleLandingJobs).toHaveBeenCalled();
  });

  it('fans out one media/poll-job event per non-local pending job', async () => {
    const { activity, lifecycle, videoRender } = makeActivity({
      pending: [
        { id: 'p1', provider: 'replicate', model: 'video' },
        { id: 'p2', provider: 'fal', model: 'image' },
        { id: 'd1', provider: 'chromium-ffmpeg', model: null, updatedAt: new Date(Date.now() - 5_000) },
      ],
    });

    await activity.processPendingMediaJobs();

    const bucket = Math.floor(Date.now() / 60000);
    expect(h.send).toHaveBeenCalledWith({
      name: 'media/poll-job',
      id: `media-poll-p1-${bucket}`,
      data: { jobId: 'p1' },
    });
    expect(h.send).toHaveBeenCalledWith({
      name: 'media/poll-job',
      id: `media-poll-p2-${bucket}`,
      data: { jobId: 'p2' },
    });
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(lifecycle.processJob).not.toHaveBeenCalled();
    expect(videoRender.processVideoRender).not.toHaveBeenCalled();
  });

  it('re-enqueues only STALE pending local renders, leaving freshly-queued ones alone', async () => {
    const now = Date.now();
    const { activity } = makeActivity({
      pending: [
        { id: 'fresh', provider: 'chromium-ffmpeg', model: null, updatedAt: new Date(now - 5_000) },
        { id: 'stale', provider: 'chromium-ffmpeg', model: null, updatedAt: new Date(now - 300_000) },
      ],
    });

    await activity.processPendingMediaJobs();

    const bucket = Math.floor(Date.now() / 60000);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledWith({
      name: 'media/render',
      id: `media-render-stale-${bucket}`,
      data: { jobId: 'stale', op: 'design' },
    });
  });

  it('re-enqueues stale merge jobs with the merge op', async () => {
    const { activity } = makeActivity({
      pending: [
        { id: 'm1', provider: 'replicate', model: 'local/ffmpeg-merge', updatedAt: new Date(Date.now() - 300_000) },
      ],
    });

    await activity.processPendingMediaJobs();

    const bucket = Math.floor(Date.now() / 60000);
    expect(h.send).toHaveBeenCalledWith({
      name: 'media/render',
      id: `media-render-m1-${bucket}`,
      data: { jobId: 'm1', op: 'merge' },
    });
  });

  it('does not send events when Inngest is disabled (inline fallback counted as processed)', async () => {
    h.enabled = false;
    const { activity, videoRender } = makeActivity({
      pending: [{ id: 'd1', provider: 'chromium-ffmpeg', model: null, updatedAt: new Date(Date.now() - 300_000) }],
      jobsById: { d1: { id: 'd1', provider: 'chromium-ffmpeg', model: null, status: 'pending' } },
    });

    const result = await activity.processPendingMediaJobs();

    expect(h.send).not.toHaveBeenCalled();
    expect(videoRender.processVideoRender).toHaveBeenCalledWith('d1');
    expect(result.processed).toBe(1);
    expect(result.completed).toBe(1);
  });

  it('bounds inline local renders with a per-job timeout', async () => {
    h.enabled = false;
    const { activity, videoRender } = makeActivity({
      pending: [{ id: 'd1', provider: 'chromium-ffmpeg', model: null, updatedAt: new Date(Date.now() - 300_000) }],
      jobsById: { d1: { id: 'd1', provider: 'chromium-ffmpeg', model: null, status: 'pending' } },
    });
    vi.mocked(videoRender.processVideoRender).mockImplementation(
      () => new Promise(() => {})
    );
    (activity as any)._inlineRenderTimeoutMs = 50;

    const result = await activity.processPendingMediaJobs();

    expect(result.processed).toBe(1);
    expect(result.completed).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('processPollJob delegates to lifecycle.processJob', async () => {
    const { activity, lifecycle } = makeActivity({});

    await activity.processPollJob('job-1');

    expect(lifecycle.processJob).toHaveBeenCalledWith('job-1');
  });

  it('processRenderJob dispatches design vs merge by job shape and charges one video_export credit', async () => {
    const { activity, videoRender, subscriptionService } = makeActivity({
      jobsById: {
        d1: { id: 'd1', provider: 'chromium-ffmpeg', model: null, organizationId: 'org-1', status: 'pending' },
        m1: { id: 'm1', provider: 'replicate', model: 'local/ffmpeg-merge', organizationId: 'org-1', status: 'pending' },
      },
    });

    await activity.processRenderJob('d1');
    await activity.processRenderJob('m1');

    expect(videoRender.processVideoRender).toHaveBeenCalledWith('d1');
    expect(videoRender.processMergeRender).toHaveBeenCalledWith('m1');
    expect(subscriptionService.recordCredit).toHaveBeenCalledTimes(2);
    expect(subscriptionService.recordCredit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'org-1' }),
      'video_export',
    );
  });

  it('processRenderJob does not charge when the render does not reach completed', async () => {
    const { activity, videoRender, subscriptionService } = makeActivity({
      jobsById: {
        d1: { id: 'd1', provider: 'chromium-ffmpeg', model: null, organizationId: 'org-1', status: 'pending' },
      },
    });
    // Render runs but does not transition the job to completed.
    videoRender.processVideoRender.mockResolvedValue(undefined);

    await expect(activity.processRenderJob('d1')).rejects.toThrow('did not complete');

    expect(videoRender.processVideoRender).toHaveBeenCalledWith('d1');
    expect(subscriptionService.recordCredit).not.toHaveBeenCalled();
  });
});
