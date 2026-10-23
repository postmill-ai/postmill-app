import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ enabled: true, send: vi.fn() }));

vi.mock('@postmill-ai/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: { send: (...args: any[]) => h.send(...args) },
  isInngestEnabled: () => h.enabled,
}));

const redisMock = vi.hoisted(() => ({ get: vi.fn().mockResolvedValue(null) }));

vi.mock('@postmill-ai/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: redisMock.get,
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  },
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
    updateMediaJob: vi.fn(async () => undefined),
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
  const designExport = {
    processExport: vi.fn(async (id: string) => {
      if (opts.jobsById?.[id]) opts.jobsById[id].status = 'completed';
    }),
  };
  const activity = new MediaJobsActivity(
    lifecycle as any,
    aiSettings as any,
    videoRender as any,
    subscriptionService as any,
    organizationService as any,
    designExport as any,
  );
  return { activity, lifecycle, aiSettings, videoRender, subscriptionService, organizationService, designExport };
}

describe('MediaJobsActivity', () => {
  beforeEach(() => {
    h.enabled = true;
    h.send.mockReset();
    redisMock.get.mockReset().mockResolvedValue(null);
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

  it('fans out stale pending design-export jobs via media/design-export, never media/poll-job', async () => {
    const { activity, lifecycle } = makeActivity({
      pending: [
        { id: 'x1', provider: 'design-export', model: null, updatedAt: new Date(Date.now() - 300_000) },
        { id: 'p1', provider: 'replicate', model: 'video' },
      ],
    });

    await activity.processPendingMediaJobs();

    const bucket = Math.floor(Date.now() / 60000);
    expect(h.send).toHaveBeenCalledWith({
      name: 'media/design-export',
      id: `design-export-x1-${bucket}`,
      data: { jobId: 'x1' },
    });
    // The export job must NOT enter the provider-poll path.
    expect(h.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'media/poll-job', data: { jobId: 'x1' } })
    );
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ name: 'media/poll-job', data: { jobId: 'p1' } }));
    expect(lifecycle.processJob).not.toHaveBeenCalled();
  });

  it('runs export jobs inline when Inngest is disabled', async () => {
    h.enabled = false;
    const { activity, designExport } = makeActivity({
      pending: [{ id: 'x1', provider: 'design-export', model: null, updatedAt: new Date(Date.now() - 300_000) }],
      jobsById: { x1: { id: 'x1', provider: 'design-export', model: null, status: 'pending' } },
    });

    const result = await activity.processPendingMediaJobs();

    expect(h.send).not.toHaveBeenCalled();
    expect(designExport.processExport).toHaveBeenCalledWith('x1');
    expect(result.processed).toBe(1);
  });

  it('fails a design-export job stuck in processing past the export budget', async () => {
    const { activity, aiSettings } = makeActivity({
      pending: [
        {
          id: 'x1',
          provider: 'design-export',
          model: null,
          status: 'processing',
          organizationId: 'org-1',
          updatedAt: new Date(Date.now() - 20 * 60 * 1000),
        },
      ],
    });

    const result = await activity.processPendingMediaJobs();

    expect(aiSettings.updateMediaJob).toHaveBeenCalledWith('org-1', 'x1', {
      status: 'failed',
      error: 'Export exceeded its wall-clock budget with no live runner',
    });
    expect(result.failed).toBe(1);
  });

  it('processPollJob delegates to lifecycle.processJob', async () => {    const { activity, lifecycle } = makeActivity({});

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

  it('processRenderJob returns cleanly (no throw, no charge) when the job is already terminal failed', async () => {
    const jobsById = {
      d1: { id: 'd1', provider: 'chromium-ffmpeg', model: null, organizationId: 'org-1', status: 'pending' },
    };
    const { activity, videoRender, subscriptionService } = makeActivity({ jobsById });
    // The render itself records the failure (its own catch sets status failed).
    videoRender.processVideoRender.mockImplementation(async () => {
      jobsById.d1.status = 'failed';
    });

    // A throw here would burn every Inngest retry on a job that can never
    // complete — the retry no-ops at the pending guard and lands back here.
    await expect(activity.processRenderJob('d1')).resolves.toBeUndefined();

    expect(videoRender.processVideoRender).toHaveBeenCalledWith('d1');
    expect(subscriptionService.recordCredit).not.toHaveBeenCalled();
  });

  it('fails a local render stuck in processing beyond its budget + grace, leaving fresh ones alone', async () => {
    const now = Date.now();
    const { activity, aiSettings, videoRender } = makeActivity({
      pending: [
        { id: 'stuck', provider: 'chromium-ffmpeg', model: null, organizationId: 'org-1', status: 'processing', updatedAt: new Date(now - 10 * 60_000) },
        { id: 'fresh', provider: 'chromium-ffmpeg', model: null, organizationId: 'org-1', status: 'processing', updatedAt: new Date(now - 5_000) },
      ],
    });

    const result = await activity.processPendingMediaJobs();

    // No payload in Redis (redisMock.get → null) → the 120s env floor + 60s grace.
    expect(aiSettings.updateMediaJob).toHaveBeenCalledWith(
      'org-1',
      'stuck',
      expect.objectContaining({ status: 'failed' }),
    );
    expect(aiSettings.updateMediaJob).not.toHaveBeenCalledWith(
      'org-1',
      'fresh',
      expect.anything(),
    );
    // A stuck job is failed, never re-dispatched or re-rendered.
    expect(h.send).not.toHaveBeenCalled();
    expect(videoRender.processVideoRender).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
  });

  it('keeps a stuck processing job alive while it is still within the payload-derived budget', async () => {
    const now = Date.now();
    // 60s @ 30fps, no dims in the payload (1 MP fallback) → 450s budget (+ 60s
    // grace): a 200s-old job is still inside it, even though it is past the bare
    // 120s env floor.
    redisMock.get.mockResolvedValueOnce(
      JSON.stringify({ organizationId: 'org-1', composition: { durationMs: 60_000, fps: 30 } }),
    );
    const { activity, aiSettings } = makeActivity({
      pending: [
        { id: 'long', provider: 'chromium-ffmpeg', model: null, organizationId: 'org-1', status: 'processing', updatedAt: new Date(now - 200_000) },
      ],
    });

    const result = await activity.processPendingMediaJobs();

    expect(aiSettings.updateMediaJob).not.toHaveBeenCalled();
    expect(result.failed).toBe(0);
  });
});
