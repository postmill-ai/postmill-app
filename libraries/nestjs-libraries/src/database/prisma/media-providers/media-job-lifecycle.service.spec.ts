import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSafeFetch = vi.fn();
vi.mock('@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetch: (url: string, init?: RequestInit) => mockSafeFetch(url, init),
}));

import { MediaJobLifecycleService } from './media-job-lifecycle.service';
import { AIMediaJob } from '@prisma/client';

function makeJob(overrides: Partial<AIMediaJob> = {}): AIMediaJob {
  return {
    id: 'job-1',
    organizationId: 'org-1',
    userId: 'user-1',
    provider: 'luma',
    operation: 'video',
    status: 'pending',
    artifactUrl: 'pending://luma-ext-1',
    provenance: null,
    costUsd: 0.5,
    creditType: 'ai_videos',
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AIMediaJob;
}

function makeService() {
  const jobs = new Map<string, AIMediaJob>();
  const aiSettings = {
    createMediaJob: vi.fn().mockImplementation(async (data: Record<string, unknown>) => {
      const job = makeJob({ ...(data as Partial<AIMediaJob>), id: 'created-1', artifactUrl: null });
      jobs.set(job.id, job);
      return job;
    }),
    updateMediaJob: vi.fn().mockImplementation(async (_orgId: string, id: string, data: Partial<AIMediaJob>) => {
      const job = { ...(jobs.get(id) || makeJob({ id })), ...data };
      jobs.set(id, job as AIMediaJob);
      return job;
    }),
    getMediaJobById: vi.fn().mockImplementation(async (_orgId: string, id: string) => jobs.get(id) || null),
    getMediaJobByIdUnscoped: vi.fn().mockImplementation(async (id: string) => jobs.get(id) || null),
    getPendingMediaJobs: vi.fn().mockResolvedValue([]),
    // §3.1: atomic CAS on status. Mutates the shared job object synchronously (no await
    // between read and write) so it faithfully models the DB's conditional updateMany —
    // exactly one of two concurrent claimants sees the row still in `from`.
    claimMediaJobStatus: vi.fn().mockImplementation(async (_orgId: string, id: string, from: string[], to: string) => {
      const job = jobs.get(id);
      if (!job || !from.includes(job.status)) return 0;
      job.status = to as AIMediaJob['status'];
      jobs.set(id, job);
      return 1;
    }),
    // §3.1 crash-recovery: default no-op (no stranded rows) for the sweep pre-pass.
    reclaimStaleLandingJobs: vi.fn().mockResolvedValue(0),
  };

  const pollJob = vi.fn();
  const adapter = { identifier: 'luma', pollJob };
  const resolution = { resolveMedia: vi.fn().mockReturnValue(adapter) };

  const orgSettings = {
    getConfigForProvider: vi.fn().mockResolvedValue({
      credentials: { apiKey: 'luma-key' },
      storageProviderId: null,
      storageRootFolderId: null,
      version: 'v1',
    }),
    getStandardFolderId: vi.fn().mockResolvedValue('folder-video-1'),
  };

  const storageAdapter = { writeBuffer: vi.fn().mockResolvedValue('/uploads/org-1/artifact.mp4') };
  const storageService = {
    getAdapter: vi.fn().mockResolvedValue(storageAdapter),
    getLocalAdapterForOrg: vi.fn().mockResolvedValue(storageAdapter),
  };

  const mediaRepository = {
    saveGeneratedMedia: vi.fn().mockResolvedValue({ id: 'media-1', path: '/uploads/org-1/artifact.mp4' }),
    // 1.3 (orchestrator): _writeToTenantStorage validates a client folderId's ownership;
    // null = not owned → fall through to standard folder resolution (default behaviour).
    resolveOwnedFolderId: vi.fn().mockResolvedValue(null),
  };

  const notificationService = { notify: vi.fn().mockResolvedValue(undefined) };

  const service = new MediaJobLifecycleService(
    aiSettings as never,
    orgSettings as never,
    resolution as never,
    storageService as never,
    mediaRepository as never,
    notificationService as never,
  );

  return {
    service,
    jobs,
    aiSettings,
    pollJob,
    resolution,
    orgSettings,
    storageAdapter,
    storageService,
    mediaRepository,
    notificationService,
  };
}

describe('MediaJobLifecycleService (§11.2 async job lifecycle)', () => {
  const originalBackendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  const originalJwt = process.env.JWT_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSafeFetch.mockReset();
    process.env.JWT_SECRET = 'test-secret';
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://api.example.com';
  });

  afterEach(() => {
    if (originalBackendUrl === undefined) delete process.env.NEXT_PUBLIC_BACKEND_URL;
    else process.env.NEXT_PUBLIC_BACKEND_URL = originalBackendUrl;
    if (originalJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwt;
  });

  describe('job creation + provider reference', () => {
    it('creates a pending AIMediaJob row', async () => {
      const { service, aiSettings } = makeService();
      const job = await service.createPendingJob({
        organizationId: 'org-1',
        userId: 'user-1',
        provider: 'luma',
        operation: 'video',
        costUsd: 0.5,
        creditType: 'ai_videos',
      });
      expect(job.id).toBe('created-1');
      expect(aiSettings.createMediaJob).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending', provider: 'luma', operation: 'video' }),
      );
    });

    it('stores the provider job reference under the pending:// scheme', async () => {
      const { service, aiSettings } = makeService();
      await service.attachProviderJob('job-1', 'ext-99', 'org-1');
      expect(aiSettings.updateMediaJob).toHaveBeenCalledWith('org-1', 'job-1', { artifactUrl: 'pending://ext-99' });
    });

    it('extracts the provider job ref only from pending:// values', () => {
      const { service } = makeService();
      expect(service.providerJobRef(makeJob({ artifactUrl: 'pending://abc' }))).toBe('abc');
      expect(service.providerJobRef(makeJob({ artifactUrl: 'https://real/url.mp4' }))).toBeNull();
      expect(service.providerJobRef(makeJob({ artifactUrl: null }))).toBeNull();
    });

    it('builds an org-bound webhook URL and omits it when no base URL is set', () => {
      const { service } = makeService();
      const url = service.webhookUrlFor('job-1', 'org-1');
      expect(url).toMatch(/^https:\/\/api\.example\.com\/media-jobs\/webhook\/job-1\/[0-9a-f]{64}$/);

      delete process.env.NEXT_PUBLIC_BACKEND_URL;
      expect(service.webhookUrlFor('job-1', 'org-1')).toBeUndefined();
    });

    it('omits the webhook for a non-HTTPS base (providers reject http/localhost)', () => {
      const { service } = makeService();
      const prev = process.env.NEXT_PUBLIC_BACKEND_URL;
      process.env.NEXT_PUBLIC_BACKEND_URL = 'http://localhost:3000';
      expect(service.webhookUrlFor('job-1', 'org-1')).toBeUndefined();
      process.env.NEXT_PUBLIC_BACKEND_URL = prev;
    });
  });

  describe('processJob', () => {
    it('skips unknown or already-finished jobs', async () => {
      const { service, jobs } = makeService();
      expect(await service.processJob('nope')).toBe('skipped');

      jobs.set('done-1', makeJob({ id: 'done-1', status: 'completed' }));
      expect(await service.processJob('done-1')).toBe('skipped');
    });

    it('fails jobs that exceeded the 24h timeout', async () => {
      const { service, jobs, aiSettings, notificationService } = makeService();
      jobs.set('old-1', makeJob({ id: 'old-1', createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }));

      expect(await service.processJob('old-1')).toBe('failed');
      expect(aiSettings.updateMediaJob).toHaveBeenCalledWith(
        'org-1',
        'old-1',
        expect.objectContaining({ status: 'failed' }),
      );
      expect(notificationService.notify).toHaveBeenCalled();
    });

    it('stays pending while the provider is still working (and marks processing)', async () => {
      const { service, jobs, pollJob, aiSettings } = makeService();
      jobs.set('job-1', makeJob());
      pollJob.mockResolvedValue({ status: 'pending' });

      expect(await service.processJob('job-1')).toBe('pending');
      expect(pollJob).toHaveBeenCalledWith('luma-ext-1', { credentials: { apiKey: 'luma-key' } });
      // §3.1: the pending→processing write is now a guarded conditional claim.
      expect(aiSettings.claimMediaJobStatus).toHaveBeenCalledWith('org-1', 'job-1', ['pending'], 'processing');
    });

    it('polls through the version pinned on the job, not the config current version (4.10)', async () => {
      const { service, jobs, pollJob, resolution, orgSettings } = makeService();
      // job was created under v1; the org config has since been upgraded to v2.
      jobs.set('job-1', makeJob({ version: 'v1' }));
      orgSettings.getConfigForProvider.mockResolvedValue({
        credentials: { apiKey: 'luma-key' },
        storageProviderId: null,
        storageRootFolderId: null,
        version: 'v2',
      });
      pollJob.mockResolvedValue({ status: 'pending' });

      await service.processJob('job-1');

      expect(resolution.resolveMedia).toHaveBeenCalledWith(
        'luma',
        expect.objectContaining({ version: 'v1' }),
      );
    });

    it('treats transient poll errors as pending (retried next sweep)', async () => {
      const { service, jobs, pollJob } = makeService();
      jobs.set('job-1', makeJob());
      pollJob.mockRejectedValue(new Error('network blip'));

      expect(await service.processJob('job-1')).toBe('pending');
    });

    it('fails the job when the provider reports failure', async () => {
      const { service, jobs, pollJob, notificationService } = makeService();
      jobs.set('job-1', makeJob());
      pollJob.mockResolvedValue({ status: 'failed', error: 'NSFW rejected' });

      expect(await service.processJob('job-1')).toBe('failed');
      expect(jobs.get('job-1')!.status).toBe('failed');
      expect(jobs.get('job-1')!.error).toContain('NSFW rejected');
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          category: 'media',
          title: expect.stringContaining('failed'),
          message: expect.stringContaining('failed'),
          channels: { email: false, push: false, inApp: true },
        })
      );
    });

    it('downloads, stores under the typed folder, completes, and notifies on success', async () => {
      const { service, jobs, pollJob, orgSettings, storageAdapter, mediaRepository, notificationService } =
        makeService();
      jobs.set('job-1', makeJob());
      orgSettings.getConfigForProvider.mockResolvedValue({
        credentials: { apiKey: 'luma-key' },
        storageProviderId: null,
        storageRootFolderId: 'root-1',
        version: 'v1',
      });
      pollJob.mockResolvedValue({
        status: 'completed',
        artifactUrl: 'https://provider.example.com/out.mp4',
        metadata: { durationSeconds: 5, model: 'dream-machine' },
      });
      mockSafeFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'video/mp4', 'content-length': '4' }),
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      });

      expect(await service.processJob('job-1')).toBe('completed');

      // artifact downloaded via safeFetch (provider URLs expire)
      expect(mockSafeFetch).toHaveBeenCalledWith('https://provider.example.com/out.mp4', undefined);
      // written into tenant storage
      expect(storageAdapter.writeBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'video/mp4');
      // typed folder under the provider root (video operation → video/)
      expect(orgSettings.getStandardFolderId).toHaveBeenCalledWith('org-1', 'root-1', 'video');
      // Media row with extracted metadata
      expect(mediaRepository.saveGeneratedMedia).toHaveBeenCalledWith('org-1', expect.objectContaining({
        type: 'video',
        folderId: 'folder-video-1',
        fileSize: 4,
        metadata: expect.objectContaining({
          durationSeconds: 5,
          model: 'dream-machine',
          provider: 'luma',
          mime: 'video/mp4',
        }),
      }));
      // job completed with the stored (tenant) URL, not the provider URL
      expect(jobs.get('job-1')!.status).toBe('completed');
      expect(jobs.get('job-1')!.artifactUrl).toBe('/uploads/org-1/artifact.mp4');
      // user notified
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          category: 'media',
          title: expect.stringContaining('ready'),
          message: expect.stringContaining('ready'),
          channels: { email: false, push: false, inApp: true },
        })
      );
    });

    it('uses the bound storage provider adapter when configured', async () => {
      const { service, jobs, pollJob, orgSettings, storageService } = makeService();
      jobs.set('job-1', makeJob());
      orgSettings.getConfigForProvider.mockResolvedValue({
        credentials: { apiKey: 'k' },
        storageProviderId: 'sp-1',
        storageRootFolderId: null,
        version: 'v1',
      });
      pollJob.mockResolvedValue({ status: 'completed', artifactUrl: 'data:video/mp4;base64,AAAA' });

      await service.processJob('job-1');
      expect(storageService.getAdapter).toHaveBeenCalledWith('sp-1', 'org-1');
      expect(storageService.getLocalAdapterForOrg).not.toHaveBeenCalled();
    });

    it('decodes data: URI artifacts without fetching', async () => {
      const { service, jobs, pollJob, storageAdapter } = makeService();
      jobs.set('job-1', makeJob());
      pollJob.mockResolvedValue({
        status: 'completed',
        artifactUrl: `data:video/mp4;base64,${Buffer.from('vid').toString('base64')}`,
      });

      expect(await service.processJob('job-1')).toBe('completed');
      expect(mockSafeFetch).not.toHaveBeenCalled();
      expect(storageAdapter.writeBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'video/mp4');
    });

    it('fails the job when the artifact download fails', async () => {
      const { service, jobs, pollJob } = makeService();
      jobs.set('job-1', makeJob());
      pollJob.mockResolvedValue({ status: 'completed', artifactUrl: 'https://provider.example.com/gone.mp4' });
      mockSafeFetch.mockResolvedValue({ ok: false, status: 404, headers: new Headers() });

      expect(await service.processJob('job-1')).toBe('failed');
      expect(jobs.get('job-1')!.error).toContain('Failed to store generated artifact');
    });

    it('fails jobs whose adapter cannot poll', async () => {
      const { service, jobs, resolution } = makeService();
      jobs.set('job-1', makeJob());
      resolution.resolveMedia.mockReturnValue({ identifier: 'x' }); // no pollJob

      expect(await service.processJob('job-1')).toBe('failed');
    });

    it('fails jobs whose provider config is gone', async () => {
      const { service, jobs, orgSettings } = makeService();
      jobs.set('job-1', makeJob());
      orgSettings.getConfigForProvider.mockResolvedValue(null);

      expect(await service.processJob('job-1')).toBe('failed');
    });
  });

  describe('processJob multi-artifact (extraArtifactUrls)', () => {
    function audioCompleteWithExtras() {
      const ctx = makeService();
      ctx.jobs.set('job-1', makeJob({ provider: 'suno', operation: 'audio' }));
      ctx.orgSettings.getConfigForProvider.mockResolvedValue({
        credentials: { apiKey: 'suno-key' },
        storageProviderId: null,
        storageRootFolderId: 'root-1',
        version: 'v1',
      });
      ctx.pollJob.mockResolvedValue({
        status: 'completed',
        artifactUrl: 'https://cdn.suno/a.mp3',
        extraArtifactUrls: ['https://cdn.suno/b.mp3'],
        metadata: { mime: 'audio/mpeg' },
      });
      mockSafeFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'audio/mpeg', 'content-length': '3' }),
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      });
      return ctx;
    }

    it('lands the primary artifact AND a sibling completed job per extra URL', async () => {
      const { service, aiSettings, mediaRepository } = audioCompleteWithExtras();

      expect(await service.processJob('job-1')).toBe('completed');

      // one sibling job created for the single extra clip, same provider/operation as the primary
      expect(aiSettings.createMediaJob).toHaveBeenCalledTimes(1);
      expect(aiSettings.createMediaJob).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'suno', operation: 'audio', status: 'pending' }),
      );
      // both clips stored (primary + sibling)
      expect(mediaRepository.saveGeneratedMedia).toHaveBeenCalledTimes(2);
      // the sibling was completed with the stored tenant path
      expect(aiSettings.updateMediaJob).toHaveBeenCalledWith(
        'org-1',
        'created-1',
        expect.objectContaining({ status: 'completed' }),
      );
    });

    it('is idempotent: a second sweep on the now-completed primary creates no more siblings', async () => {
      const { service, aiSettings } = audioCompleteWithExtras();

      expect(await service.processJob('job-1')).toBe('completed');
      expect(aiSettings.createMediaJob).toHaveBeenCalledTimes(1);

      // primary is now `completed` → processJob short-circuits to 'skipped', no new siblings
      expect(await service.processJob('job-1')).toBe('skipped');
      expect(aiSettings.createMediaJob).toHaveBeenCalledTimes(1);
    });

    it('caps the extra-artifact fan-out at 8 siblings (§6.2)', async () => {
      const { service, jobs, orgSettings, pollJob, aiSettings } = makeService();
      jobs.set('job-1', makeJob({ provider: 'suno', operation: 'audio' }));
      orgSettings.getConfigForProvider.mockResolvedValue({
        credentials: { apiKey: 'suno-key' },
        storageProviderId: null,
        storageRootFolderId: 'root-1',
        version: 'v1',
      });
      pollJob.mockResolvedValue({
        status: 'completed',
        artifactUrl: 'https://cdn.suno/primary.mp3',
        extraArtifactUrls: Array.from({ length: 12 }, (_, i) => `https://cdn.suno/extra-${i}.mp3`),
        metadata: { mime: 'audio/mpeg' },
      });
      mockSafeFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'audio/mpeg', 'content-length': '3' }),
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      });

      expect(await service.processJob('job-1')).toBe('completed');
      // 12 extras offered, only 8 siblings created (one createMediaJob per sibling).
      expect(aiSettings.createMediaJob).toHaveBeenCalledTimes(8);
    });

    it('does not notify per sibling — only the primary "ready" fires (§6.2)', async () => {
      const { service, notificationService } = audioCompleteWithExtras();

      expect(await service.processJob('job-1')).toBe('completed');
      // primary success notification only; the single sibling completes with notify:false
      expect(notificationService.notify).toHaveBeenCalledTimes(1);
    });
  });

  describe('processJob atomic completion claim (§3.1)', () => {
    function completedJob() {
      const ctx = makeService();
      ctx.jobs.set('job-1', makeJob());
      ctx.orgSettings.getConfigForProvider.mockResolvedValue({
        credentials: { apiKey: 'luma-key' },
        storageProviderId: null,
        storageRootFolderId: 'root-1',
        version: 'v1',
      });
      ctx.pollJob.mockResolvedValue({
        status: 'completed',
        artifactUrl: 'https://provider.example.com/out.mp4',
        metadata: { model: 'dream-machine' },
      });
      mockSafeFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'video/mp4', 'content-length': '4' }),
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      });
      return ctx;
    }

    it('two concurrent processJob on one completed job → exactly one download/File/notification', async () => {
      const { service, mediaRepository, notificationService, jobs } = completedJob();

      const [a, b] = await Promise.all([service.processJob('job-1'), service.processJob('job-1')]);

      // exactly one winner; the loser short-circuits to 'skipped'
      expect([a, b].filter((r) => r === 'completed')).toHaveLength(1);
      expect([a, b].filter((r) => r === 'skipped')).toHaveLength(1);
      // single download, single File row, single notification
      expect(mockSafeFetch).toHaveBeenCalledTimes(1);
      expect(mediaRepository.saveGeneratedMedia).toHaveBeenCalledTimes(1);
      expect(notificationService.notify).toHaveBeenCalledTimes(1);
      expect(jobs.get('job-1')!.status).toBe('completed');
    });

    it('a lost claim on the failure path does not double-notify', async () => {
      const { service, jobs, pollJob, notificationService } = makeService();
      jobs.set('job-1', makeJob());
      pollJob.mockResolvedValue({ status: 'failed', error: 'NSFW rejected' });

      const results = await Promise.all([service.processJob('job-1'), service.processJob('job-1')]);
      expect(results.filter((r) => r === 'failed')).toHaveLength(1);
      expect(results.filter((r) => r === 'skipped')).toHaveLength(1);
      expect(notificationService.notify).toHaveBeenCalledTimes(1);
    });
  });

  describe('failJob notify option', () => {
    it('suppresses the notification when notify=false', async () => {
      const { service, jobs, notificationService } = makeService();
      jobs.set('job-1', makeJob());
      await service.failJob(makeJob(), 'provider down', { notify: false });
      expect(notificationService.notify).not.toHaveBeenCalled();
    });
  });

  describe('storeTranscript (§11.1)', () => {
    it('stores the transcript as a text document under documents/ with stt metadata', async () => {
      const { service, orgSettings, storageAdapter, mediaRepository } = makeService();
      orgSettings.getConfigForProvider.mockResolvedValue({
        credentials: { apiKey: 'k' },
        storageProviderId: null,
        storageRootFolderId: 'root-1',
        version: 'v1',
      });

      const result = await service.storeTranscript({
        organizationId: 'org-1',
        provider: 'deepgram',
        text: 'hello world',
        segments: [{ start: 0, end: 1.5, text: 'hello world' }],
      });

      expect(storageAdapter.writeBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'text/plain');
      expect(orgSettings.getStandardFolderId).toHaveBeenCalledWith('org-1', 'root-1', 'documents');
      expect(mediaRepository.saveGeneratedMedia).toHaveBeenCalledWith('org-1', expect.objectContaining({
        type: 'document',
        name: expect.stringMatching(/^transcript-\d+\.txt$/),
        metadata: expect.objectContaining({
          source: 'stt',
          provider: 'deepgram',
          segments: [{ start: 0, end: 1.5, text: 'hello world' }],
        }),
      }));
      expect(result.mediaId).toBe('media-1');
    });
  });

  describe('processPendingJobs (polling sweep)', () => {
    it('processes each pending job and never throws on individual failures', async () => {
      const { service, jobs, aiSettings, pollJob } = makeService();
      jobs.set('a', makeJob({ id: 'a' }));
      jobs.set('b', makeJob({ id: 'b' }));
      aiSettings.getPendingMediaJobs.mockResolvedValue([jobs.get('a'), jobs.get('b')]);
      pollJob
        .mockResolvedValueOnce({ status: 'failed', error: 'x' })
        .mockResolvedValueOnce({ status: 'pending' });

      const result = await service.processPendingJobs();
      expect(result).toEqual({ processed: 2, completed: 0, failed: 1 });
    });

    it('reclaims stranded `landing` jobs before fetching the pending set (§3.1 crash-recovery)', async () => {
      const { service, aiSettings } = makeService();
      aiSettings.getPendingMediaJobs.mockResolvedValue([]);

      await service.processPendingJobs();

      expect(aiSettings.reclaimStaleLandingJobs).toHaveBeenCalledTimes(1);
      // Reclaim cutoff is in the past (only rows stuck since before it are reset).
      const cutoff = aiSettings.reclaimStaleLandingJobs.mock.calls[0][0] as Date;
      expect(cutoff.getTime()).toBeLessThan(Date.now());
    });
  });

  describe('completeJobWithBuffer (M-06)', () => {
    function bufferCtx(jobOverrides: Partial<AIMediaJob> = {}) {
      const ctx = makeService();
      const job = makeJob({
        status: 'processing',
        artifactUrl: null,
        operation: 'video',
        ...jobOverrides,
      });
      ctx.jobs.set(job.id, job);
      ctx.orgSettings.getConfigForProvider.mockResolvedValue({
        credentials: { apiKey: 'k' },
        storageProviderId: null,
        storageRootFolderId: 'root-1',
        version: 'v1',
      });
      return { ...ctx, job };
    }

    it('claims the job, stores the buffer, completes, and notifies', async () => {
      const { service, job, jobs, mediaRepository, notificationService } = bufferCtx();

      const ok = await service.completeJobWithBuffer(
        job,
        Buffer.from('vid'),
        'video/mp4',
        { model: 'test' },
      );

      expect(ok).toBe(true);
      expect(jobs.get('job-1')!.status).toBe('completed');
      expect(jobs.get('job-1')!.artifactUrl).toBe('/uploads/org-1/artifact.mp4');
      expect(mediaRepository.saveGeneratedMedia).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ type: 'video', metadata: expect.objectContaining({ model: 'test' }) }),
      );
      expect(notificationService.notify).toHaveBeenCalled();
    });

    it('is idempotent: returns true without re-writing when the job is already completed', async () => {
      const { service, job, jobs, mediaRepository, notificationService } = bufferCtx();
      jobs.set('job-1', { ...job, status: 'completed', artifactUrl: '/uploads/org-1/done.mp4' });

      const ok = await service.completeJobWithBuffer(job, Buffer.from('vid'), 'video/mp4');

      expect(ok).toBe(true);
      expect(mediaRepository.saveGeneratedMedia).not.toHaveBeenCalled();
      expect(notificationService.notify).not.toHaveBeenCalled();
    });

    it('fails the job and returns false when storage throws', async () => {
      const { service, job, jobs, mediaRepository } = bufferCtx();
      mediaRepository.saveGeneratedMedia.mockRejectedValue(new Error('disk full'));

      const ok = await service.completeJobWithBuffer(job, Buffer.from('vid'), 'video/mp4');

      expect(ok).toBe(false);
      expect(jobs.get('job-1')!.status).toBe('failed');
      expect(jobs.get('job-1')!.error).toContain('disk full');
    });

    it('two concurrent completions produce exactly one file row and one notification', async () => {
      const { service, job, mediaRepository, notificationService } = bufferCtx();

      const [a, b] = await Promise.all([
        service.completeJobWithBuffer(job, Buffer.from('vid'), 'video/mp4'),
        service.completeJobWithBuffer(job, Buffer.from('vid'), 'video/mp4'),
      ]);

      // Exactly one worker wins the atomic claim and completes; the loser observes
      // the job in `landing` mid-completion and returns false. A later retry sees
      // `completed` and returns true idempotently.
      expect([a, b].filter(Boolean)).toHaveLength(1);
      expect(mediaRepository.saveGeneratedMedia).toHaveBeenCalledTimes(1);
      expect(notificationService.notify).toHaveBeenCalledTimes(1);
    });
  });
});
