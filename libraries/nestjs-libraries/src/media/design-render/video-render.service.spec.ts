import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as Sentry from '@sentry/nestjs';
import {
  VideoRenderService,
  withTimeout,
  NO_CREDIT,
  TEMPLATE_PREVIEW_DURATION_MS,
  TEMPLATE_PREVIEW_FPS,
  TEMPLATE_PREVIEW_SCALE,
} from './video-render.service';
import { ioRedis } from '@postmill-ai/nestjs-libraries/redis/redis.service';

vi.mock('@sentry/nestjs', () => ({
  captureException: vi.fn(),
}));

const inngestClient = vi.hoisted(() => ({ enabled: false, send: vi.fn() }));

vi.mock('@postmill-ai/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: { send: (...args: any[]) => inngestClient.send(...args) },
  isInngestEnabled: () => inngestClient.enabled,
}));

vi.mock('@postmill-ai/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn(),
    getdel: vi.fn(),
    del: vi.fn().mockResolvedValue(1),
  },
}));

describe('VideoRenderService', () => {
  let service: VideoRenderService;
  let lifecycle: MediaJobLifecycleService;
  let aiSettings: AiSettingsService;
  let encoder: FfmpegVideoEncoderService;
  let fileService: { getFileByPath: ReturnType<typeof vi.fn> };
  let designService: { getTemplate: ReturnType<typeof vi.fn>; updateTemplate: ReturnType<typeof vi.fn> };

  const orgId = 'org-1';

  beforeEach(() => {
    inngestClient.enabled = false;
    inngestClient.send.mockReset();
    lifecycle = {
      createPendingJob: vi.fn().mockResolvedValue({
        id: 'job-1',
        organizationId: orgId,
        provider: 'chromium-ffmpeg',
        operation: 'video',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      completeJobWithBuffer: vi.fn().mockResolvedValue(true),
    } as any;

    aiSettings = {
      getMediaJobById: vi.fn().mockResolvedValue({
        id: 'job-1',
        organizationId: orgId,
        provider: 'chromium-ffmpeg',
        operation: 'video',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      getMediaJobByIdUnscoped: vi.fn().mockResolvedValue({
        id: 'job-1',
        organizationId: orgId,
        provider: 'chromium-ffmpeg',
        operation: 'video',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      updateMediaJob: vi.fn().mockResolvedValue(undefined),
    } as any;

    encoder = {
      encode: vi.fn(),
      cleanup: vi.fn(),
    } as any;

    fileService = {
      getFileByPath: vi.fn().mockResolvedValue({ id: 'file-anim-1' }),
    };
    designService = {
      getTemplate: vi.fn().mockResolvedValue({ id: 'tpl-1', organizationId: orgId }),
      updateTemplate: vi.fn().mockResolvedValue({ id: 'tpl-1' }),
    };

    service = new VideoRenderService(
      lifecycle,
      aiSettings,
      encoder,
      undefined as any,
      fileService as any,
      designService as any,
    );

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const videoOutput = (durationMs = 5000) => ({
    id: 'vo-1',
    formatId: 'reel',
    name: 'Reel',
    width: 1080,
    height: 1920,
    fps: 30,
    durationMs,
    tracks: [
      {
        id: 't1',
        type: 'image' as const,
        clips: [
          {
            id: 'c1',
            startMs: 0,
            endMs: durationMs,
            x: 0,
            y: 0,
            width: 1080,
            height: 1920,
            src: 'https://example.com/image.png',
          },
        ],
      },
    ],
  });

  it('enqueues a render job and stores the payload in Redis', async () => {
    const composition = videoOutput(5000);
    const result = await service.enqueueRender(orgId, {
      composition,
      bitrateKbps: 4000,
    });

    expect(result.id).toBe('job-1');
    expect(result.status).toBe('pending');
    expect(lifecycle.createPendingJob).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: orgId,
        provider: 'chromium-ffmpeg',
        operation: 'video',
      }),
    );
    expect(vi.mocked(ioRedis.set)).toHaveBeenCalledWith(
      'video-render:payload:job-1',
      expect.stringContaining('"composition"'),
      'EX',
      24 * 60 * 60,
    );
  });

  it('rejects compositions longer than 180 seconds', async () => {
    await expect(
      service.enqueueRender(orgId, {
        composition: videoOutput(181000),
      }),
    ).rejects.toThrow('exceeds the 180 s hard cap');
  });

  it('accepts a composition at the 180 s cap', async () => {
    const result = await service.enqueueRender(orgId, {
      composition: videoOutput(180000),
    });
    expect(result.id).toBe('job-1');
  });

  it('processes a pending job and completes it with the rendered artifact', async () => {
    const composition = videoOutput(3000);
    vi.mocked(ioRedis.get).mockResolvedValueOnce(
      JSON.stringify({
        organizationId: orgId,
        composition,
        bitrateKbps: 4000,
      }),
    );

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postmill-test-'));
    const videoPath = path.join(tmpDir, 'output.mp4');
    const thumbPath = path.join(tmpDir, 'thumb.jpg');
    fs.writeFileSync(videoPath, Buffer.from('fake-video'));
    fs.writeFileSync(thumbPath, Buffer.from('fake-thumb'));

    vi.mocked(encoder.encode).mockImplementationOnce(async () => {
      // The payload key must still be in Redis while the encode runs: the
      // render-frame route serves it to headless Chromium during capture.
      expect(vi.mocked(ioRedis.del)).not.toHaveBeenCalled();
      return { videoPath, thumbnailPath: thumbPath };
    });

    await service.processVideoRender('job-1');

    // The payload is re-published for the render's duration (the token-gated
    // render-frame route serves it to the headless page) and removed afterwards.
    expect(vi.mocked(ioRedis.set)).toHaveBeenCalledWith(
      'video-render:payload:job-1',
      expect.stringContaining('"composition"'),
      'EX',
      24 * 60 * 60,
    );
    expect(vi.mocked(ioRedis.del)).toHaveBeenCalledWith(
      'video-render:payload:job-1',
      'video-render:claim:job-1',
      'video-render:progress:job-1',
    );

    expect(aiSettings.updateMediaJob).toHaveBeenCalledWith(orgId, 'job-1', {
      status: 'processing',
    });
    // Claim is a non-destructive GET + a SET NX marker — never GETDEL.
    expect(vi.mocked(ioRedis.get)).toHaveBeenCalledWith('video-render:payload:job-1');
    expect(vi.mocked(ioRedis.set)).toHaveBeenCalledWith(
      'video-render:claim:job-1',
      '1',
      'EX',
      24 * 60 * 60,
      'NX',
    );
    expect(vi.mocked(ioRedis.getdel)).not.toHaveBeenCalled();
    expect(encoder.encode).toHaveBeenCalledWith(
      composition,
      expect.objectContaining({ fps: 30, bitrateKbps: 4000, format: 'mp4' }),
    );
    expect(lifecycle.completeJobWithBuffer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'job-1' }),
      expect.any(Buffer),
      'video/mp4',
      expect.objectContaining({
        width: 1080,
        height: 1920,
        durationSeconds: 3,
        fps: 30,
        provider: 'chromium-ffmpeg',
      }),
      expect.any(Buffer),
      undefined,
    );
    expect(aiSettings.updateMediaJob).not.toHaveBeenCalledWith(
      orgId,
      'job-1',
      expect.objectContaining({ status: 'failed' }),
    );
    // Payload + claim + progress keys are released only after the render concludes.
    expect(vi.mocked(ioRedis.del)).toHaveBeenCalledWith(
      'video-render:payload:job-1',
      'video-render:claim:job-1',
      'video-render:progress:job-1',
    );

    encoder.cleanup(tmpDir);
  });

  it('fails the job when no payload is found in Redis (genuinely missing, still pending)', async () => {
    vi.mocked(ioRedis.get).mockResolvedValueOnce(null);
    // getMediaJobById keeps returning a 'pending' job → treated as a genuine missing payload.

    await service.processVideoRender('job-1');

    expect(aiSettings.updateMediaJob).toHaveBeenCalledWith(
      orgId,
      'job-1',
      expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('No pending composition'),
      }),
    );
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalled();
  });

  it('org-scopes getJob — returns null for another org, the job for the owner', async () => {
    vi.mocked(aiSettings.getMediaJobById).mockResolvedValue({
      id: 'job-1',
      organizationId: 'org-OWNER',
      status: 'completed',
      artifactUrl: 'https://cdn/x.mp4',
    } as any);

    await expect(service.getJob('org-ATTACKER', 'job-1')).resolves.toBeNull();
    await expect(service.getJob('org-OWNER', 'job-1')).resolves.toMatchObject({
      id: 'job-1',
    });
  });

  it('rejects an oversized composition (dims/fps bound-check) on enqueue', async () => {
    await expect(
      service.enqueueRender(orgId, {
        composition: { ...videoOutput(3000), width: 100000, height: 100000 },
      }),
    ).rejects.toThrow(/out of range/);

    await expect(
      service.enqueueRender(orgId, {
        composition: { ...videoOutput(3000), fps: 100000 },
      }),
    ).rejects.toThrow(/fps .* out of range/);
  });

  it('returns early without failing the job when the claim SET NX is already held', async () => {
    const composition = videoOutput(3000);
    vi.mocked(ioRedis.get).mockResolvedValueOnce(
      JSON.stringify({ organizationId: orgId, composition }),
    );
    // Another runner holds the claim.
    vi.mocked(ioRedis.set).mockResolvedValueOnce(null);
    // The winner already moved the job past 'pending'.
    vi.mocked(aiSettings.getMediaJobById).mockResolvedValueOnce({
      id: 'job-1',
      organizationId: orgId,
      provider: 'chromium-ffmpeg',
      status: 'processing',
    } as any);

    await service.processVideoRender('job-1');

    expect(encoder.encode).not.toHaveBeenCalled();
    expect(aiSettings.updateMediaJob).not.toHaveBeenCalledWith(
      orgId,
      'job-1',
      expect.objectContaining({ status: 'failed' }),
    );
    // The loser's finally must not release keys owned by the winning runner.
    expect(vi.mocked(ioRedis.del)).not.toHaveBeenCalled();
  });

  it('breaks a stale claim with no live runner and re-dispatches instead of failing the job', async () => {
    const composition = videoOutput(3000);
    vi.mocked(ioRedis.get)
      // Payload read — still present.
      .mockResolvedValueOnce(JSON.stringify({ organizationId: orgId, composition }))
      // Progress read — nothing reported, so no live runner holds the claim.
      .mockResolvedValueOnce(null);
    // The claim SET NX loses: a stale marker from a crashed runner is held.
    vi.mocked(ioRedis.set).mockResolvedValueOnce(null);
    // getMediaJobById keeps its default 'pending' mock.
    inngestClient.enabled = true;

    await service.processVideoRender('job-1');

    expect(encoder.encode).not.toHaveBeenCalled();
    // The stale claim + progress keys are broken — never the payload, which the
    // re-dispatched render still needs.
    expect(vi.mocked(ioRedis.del)).toHaveBeenCalledWith(
      'video-render:claim:job-1',
      'video-render:progress:job-1',
    );
    // The job is re-asserted pending and re-dispatched, NOT failed.
    expect(aiSettings.updateMediaJob).toHaveBeenCalledWith(orgId, 'job-1', {
      status: 'pending',
    });
    expect(inngestClient.send).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'media/render', data: { jobId: 'job-1', op: 'design' } }),
    );
    expect(aiSettings.updateMediaJob).not.toHaveBeenCalledWith(
      orgId,
      'job-1',
      expect.objectContaining({ status: 'failed' }),
    );
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
  });

  it('skips the duplicate when the claim holder is a live runner (fresh progress)', async () => {
    const composition = videoOutput(3000);
    vi.mocked(ioRedis.get)
      .mockResolvedValueOnce(JSON.stringify({ organizationId: orgId, composition }))
      .mockResolvedValueOnce(
        JSON.stringify({ frame: 5, total: 100, updatedAt: Date.now() }),
      );
    vi.mocked(ioRedis.set).mockResolvedValueOnce(null);
    inngestClient.enabled = true;

    await service.processVideoRender('job-1');

    expect(encoder.encode).not.toHaveBeenCalled();
    // A live runner owns the claim: no key release, no re-dispatch, no failure.
    expect(vi.mocked(ioRedis.del)).not.toHaveBeenCalled();
    expect(inngestClient.send).not.toHaveBeenCalled();
    expect(aiSettings.updateMediaJob).not.toHaveBeenCalledWith(
      orgId,
      'job-1',
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('files a plain export into the folderId carried by the payload', async () => {
    const composition = videoOutput(3000);
    vi.mocked(ioRedis.get).mockResolvedValueOnce(
      JSON.stringify({ organizationId: orgId, composition, folderId: 'folder-9' }),
    );

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postmill-test-'));
    const videoPath = path.join(tmpDir, 'output.mp4');
    fs.writeFileSync(videoPath, Buffer.from('fake-video'));
    vi.mocked(encoder.encode).mockResolvedValueOnce({
      videoPath,
      thumbnailPath: path.join(tmpDir, 'missing.jpg'),
    });

    await service.processVideoRender('job-1');

    expect(lifecycle.completeJobWithBuffer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'job-1' }),
      expect.any(Buffer),
      'video/mp4',
      expect.objectContaining({ provider: 'chromium-ffmpeg' }),
      undefined,
      'folder-9',
    );

    encoder.cleanup(tmpDir);
  });

  it('accepts a 2× scale on a 1080×1080 canvas @60fps and stores the overrides in the payload', async () => {
    const composition = { ...videoOutput(3000), height: 1080, fps: 30 };
    await service.enqueueRender(orgId, { composition, scale: 2, fps: 60 });

    const stored = JSON.parse(vi.mocked(ioRedis.set).mock.calls[0][1] as string);
    expect(stored.scale).toBe(2);
    expect(stored.fps).toBe(60);
    // The composition itself is stored unscaled — the render pipeline applies it.
    expect(stored.composition.width).toBe(1080);
  });

  it('rejects a scale that pushes the effective dimensions out of range', async () => {
    await expect(
      service.enqueueRender(orgId, {
        composition: { ...videoOutput(3000), width: 10000, height: 1080 },
        scale: 2,
      }),
    ).rejects.toThrow(/out of range/);
  });

  it('applies scale/fps overrides from the payload when processing', async () => {
    const composition = { ...videoOutput(3000), height: 1080, fps: 30 };
    vi.mocked(ioRedis.get).mockResolvedValueOnce(
      JSON.stringify({ organizationId: orgId, composition, scale: 2, fps: 60 }),
    );

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postmill-test-'));
    const videoPath = path.join(tmpDir, 'output.mp4');
    const thumbPath = path.join(tmpDir, 'thumb.jpg');
    fs.writeFileSync(videoPath, Buffer.from('fake-video'));
    fs.writeFileSync(thumbPath, Buffer.from('fake-thumb'));
    vi.mocked(encoder.encode).mockResolvedValueOnce({
      videoPath,
      thumbnailPath: thumbPath,
    });

    await service.processVideoRender('job-1');

    expect(encoder.encode).toHaveBeenCalledWith(
      composition,
      expect.objectContaining({ fps: 60, scale: 2 }),
    );
    expect(lifecycle.completeJobWithBuffer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'job-1' }),
      expect.any(Buffer),
      'video/mp4',
      // Metadata records the EFFECTIVE (scaled) dimensions and overridden fps.
      expect.objectContaining({ width: 2160, height: 2160, fps: 60 }),
      expect.any(Buffer),
      undefined,
    );

    encoder.cleanup(tmpDir);
  });

  it('does not double-render or spuriously fail a job when two runners race the claim', async () => {
    const composition = videoOutput(3000);
    // Both runners can read the payload (GET is non-destructive); exactly one wins
    // the SET NX claim — the loser gets null (atomic single-winner).
    vi.mocked(ioRedis.get).mockResolvedValue(
      JSON.stringify({ organizationId: orgId, composition, bitrateKbps: 4000 }),
    );
    vi.mocked(ioRedis.set)
      .mockResolvedValueOnce('OK')
      .mockResolvedValueOnce(null);

    // Stateful job: both runners read 'pending' at the top guard; the winner's
    // updateMediaJob(processing) flips it so the loser's re-read is no longer 'pending'.
    const state = { status: 'pending' };
    vi.mocked(aiSettings.getMediaJobByIdUnscoped).mockImplementation(
      async () =>
        ({
          id: 'job-1',
          organizationId: orgId,
          provider: 'chromium-ffmpeg',
          status: state.status,
        }) as any,
    );
    vi.mocked(aiSettings.getMediaJobById).mockImplementation(
      async () =>
        ({
          id: 'job-1',
          organizationId: orgId,
          provider: 'chromium-ffmpeg',
          status: state.status,
        }) as any,
    );
    vi.mocked(aiSettings.updateMediaJob).mockImplementation(async (_orgId, _id, data: any) => {
      if (data?.status) state.status = data.status;
      return undefined as any;
    });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postmill-race-'));
    const videoPath = path.join(tmpDir, 'output.mp4');
    fs.writeFileSync(videoPath, Buffer.from('v'));
    vi.mocked(encoder.encode).mockResolvedValue({
      videoPath,
      thumbnailPath: path.join(tmpDir, 'missing.jpg'),
    });

    await Promise.all([
      service.processVideoRender('job-1'),
      service.processVideoRender('job-1'),
    ]);

    // Exactly one render; the loser never marks the job failed.
    expect(encoder.encode).toHaveBeenCalledTimes(1);
    expect(aiSettings.updateMediaJob).not.toHaveBeenCalledWith(
      orgId,
      'job-1',
      expect.objectContaining({ status: 'failed' }),
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('withTimeout (in-process encoder wall-clock cap)', () => {
    it('rejects a promise that does not settle within the timeout', async () => {
      const neverSettles = new Promise<string>(() => {
        /* an encoder that hangs forever */
      });
      await expect(withTimeout(neverSettles, 10, 'encode')).rejects.toThrow(
        /encode exceeded the 10ms wall-clock timeout/,
      );
    });

    it('resolves with the value when the promise settles in time', async () => {
      await expect(
        withTimeout(Promise.resolve('done'), 1000, 'encode'),
      ).resolves.toBe('done');
    });
  });

  describe('computeRenderTimeoutMs', () => {
    it('scales with frames at 1× and with the pixel area at 2×', async () => {
      const { computeRenderTimeoutMs } = await import('./video-render.service');
      // 60s@30fps 1080×1080: 1800 frames × 250ms × 1.1664 MP = 524.88s — above
      // the 120s env floor.
      const base = computeRenderTimeoutMs(60000, 30, 1, 1080, 1080);
      // Same duration at 60fps and 2× scale: 2× frames × 4× pixels = 8×.
      const scaled = computeRenderTimeoutMs(60000, 60, 2, 1080, 1080);
      expect(base).toBe(Math.ceil(1800 * 250 * 1.1664));
      expect(scaled).toBe(8 * base);
    });

    it('budgets a 10s 1080×1920 @ 30fps Reel export past its ~145s measured capture', async () => {
      const { computeRenderTimeoutMs } = await import('./video-render.service');
      // 300 frames × 250ms × 2.0736 MP = 155.52s — the production failure this
      // fixes (120s env floor SIGKILLed the podman client mid-capture).
      expect(computeRenderTimeoutMs(10000, 30, 1, 1080, 1920)).toBe(155520);
    });

    it('never goes below the env floor for tiny compositions', async () => {
      const { computeRenderTimeoutMs } = await import('./video-render.service');
      expect(computeRenderTimeoutMs(1000, 24, 0.5, 540, 540)).toBeGreaterThanOrEqual(
        120_000,
      );
    });

    it('keeps a small 540×540 composition at the env floor', async () => {
      const { computeRenderTimeoutMs } = await import('./video-render.service');
      // 300 frames × 250ms × 0.2916 MP ≈ 21.9s → floor wins.
      expect(computeRenderTimeoutMs(10000, 30, 1, 540, 540)).toBe(120_000);
    });

    it('falls back to a 1 MP frame when dimensions are unknown', async () => {
      const { computeRenderTimeoutMs } = await import('./video-render.service');
      // 60s@30fps: 1800 frames × 250ms × 1 MP (fallback) = 450s.
      expect(computeRenderTimeoutMs(60000, 30, 1)).toBe(1800 * 250);
    });
  });

  describe('template animated previews', () => {
    it('enqueueTemplatePreview caps the composition and stores a no-credit webp payload', async () => {
      const composition = videoOutput(10000);
      const result = await service.enqueueTemplatePreview(orgId, 'tpl-1', composition);

      expect(result).toMatchObject({ id: 'job-1', status: 'pending' });
      // No video_export credit — the NO_CREDIT sentinel keeps the job out of
      // both the post-render charge and the VIDEO_EXPORTS in-flight gate.
      expect(lifecycle.createPendingJob).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: orgId,
          provider: 'chromium-ffmpeg',
          creditType: NO_CREDIT,
        }),
      );
      const stored = JSON.parse(vi.mocked(ioRedis.set).mock.calls[0][1] as string);
      expect(stored.templateId).toBe('tpl-1');
      expect(stored.format).toBe('webp-animated');
      expect(stored.fps).toBe(TEMPLATE_PREVIEW_FPS);
      expect(stored.scale).toBe(TEMPLATE_PREVIEW_SCALE);
      // Only the opening seconds: capped duration, clips truncated/dropped.
      expect(stored.composition.durationMs).toBe(TEMPLATE_PREVIEW_DURATION_MS);
      expect(stored.composition.tracks[0].clips[0].endMs).toBe(TEMPLATE_PREVIEW_DURATION_MS);
      // The caller's composition is not mutated.
      expect(composition.durationMs).toBe(10000);
    });

    it('enqueueTemplatePreview skips empty/zero-length compositions', async () => {
      await expect(
        service.enqueueTemplatePreview(orgId, 'tpl-1', { durationMs: 0, tracks: [] }),
      ).resolves.toBeNull();
      expect(lifecycle.createPendingJob).not.toHaveBeenCalled();
    });

    it('links the rendered artifact as the template thumbnail on completion', async () => {
      const composition = videoOutput(TEMPLATE_PREVIEW_DURATION_MS);
      vi.mocked(ioRedis.get).mockResolvedValueOnce(
        JSON.stringify({
          organizationId: orgId,
          composition,
          format: 'webp-animated',
          fps: TEMPLATE_PREVIEW_FPS,
          scale: TEMPLATE_PREVIEW_SCALE,
          templateId: 'tpl-1',
        }),
      );

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postmill-test-'));
      const videoPath = path.join(tmpDir, 'output.webp-animated');
      const thumbPath = path.join(tmpDir, 'thumb.jpg');
      fs.writeFileSync(videoPath, Buffer.from('fake-webp'));
      fs.writeFileSync(thumbPath, Buffer.from('fake-thumb'));
      vi.mocked(encoder.encode).mockResolvedValueOnce({
        videoPath,
        thumbnailPath: thumbPath,
      });
      // After completion, the artifact URL resolves to the stored File row.
      vi.mocked(aiSettings.getMediaJobById).mockResolvedValue({
        id: 'job-1',
        organizationId: orgId,
        status: 'completed',
        artifactUrl: '/uploads/org-1/video-job-1.webp',
      } as any);

      await service.processVideoRender('job-1');

      expect(lifecycle.completeJobWithBuffer).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'job-1' }),
        expect.any(Buffer),
        'image/webp',
        expect.objectContaining({ internal: 'design-preview' }),
        undefined,
        undefined,
        { notify: false },
      );
      expect(fileService.getFileByPath).toHaveBeenCalledWith(
        orgId,
        '/uploads/org-1/video-job-1.webp',
      );
      expect(designService.updateTemplate).toHaveBeenCalledWith(orgId, 'tpl-1', {
        thumbnailFileId: 'file-anim-1',
      });

      encoder.cleanup(tmpDir);
    });

    it('still completes the job when the thumbnail link fails', async () => {
      const composition = videoOutput(TEMPLATE_PREVIEW_DURATION_MS);
      vi.mocked(ioRedis.get).mockResolvedValueOnce(
        JSON.stringify({ organizationId: orgId, composition, templateId: 'tpl-1' }),
      );

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postmill-test-'));
      const videoPath = path.join(tmpDir, 'output.webp-animated');
      fs.writeFileSync(videoPath, Buffer.from('fake-webp'));
      vi.mocked(encoder.encode).mockResolvedValueOnce({
        videoPath,
        thumbnailPath: path.join(tmpDir, 'missing.jpg'),
      });
      designService.getTemplate.mockResolvedValueOnce(null);

      await service.processVideoRender('job-1');

      // The render itself succeeded; the missing template only skips the link.
      expect(aiSettings.updateMediaJob).not.toHaveBeenCalledWith(
        orgId,
        'job-1',
        expect.objectContaining({ status: 'failed' }),
      );
      expect(designService.updateTemplate).not.toHaveBeenCalled();

      encoder.cleanup(tmpDir);
    });
  });

  describe('render progress channel (in-process path)', () => {
    it('wires frame-capture progress into throttled Redis writes under video-render:progress:<jobId>', async () => {
      const composition = videoOutput(3000);
      vi.mocked(ioRedis.get).mockResolvedValueOnce(
        JSON.stringify({ organizationId: orgId, composition }),
      );

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postmill-test-'));
      const videoPath = path.join(tmpDir, 'output.mp4');
      fs.writeFileSync(videoPath, Buffer.from('fake-video'));

      let onProgress: ((p: { frame: number; total: number }) => void) | undefined;
      vi.mocked(encoder.encode).mockImplementationOnce(async (_c: any, opts: any) => {
        onProgress = opts.onProgress;
        // Simulate a 25-frame capture loop.
        for (let frame = 1; frame <= 25; frame++) onProgress!({ frame, total: 25 });
        return { videoPath, thumbnailPath: path.join(tmpDir, 'missing.jpg') };
      });

      await service.processVideoRender('job-1');

      expect(onProgress).toBeTypeOf('function');
      const progressWrites = vi
        .mocked(ioRedis.set)
        .mock.calls.filter((c) => c[0] === 'video-render:progress:job-1');
      // Throttled: first frame, every 10 frames, and the final frame.
      const reported = progressWrites.map((c) => JSON.parse(c[1] as string));
      expect(reported.map((r) => r.frame)).toEqual([1, 11, 21, 25]);
      expect(reported[0]).toMatchObject({ total: 25 });
      expect(reported[0].updatedAt).toBeTypeOf('number');
      for (const call of progressWrites) {
        expect(call.slice(2)).toEqual(['EX', 3600]);
      }

      encoder.cleanup(tmpDir);
    });

    it('getRenderProgress returns the stored {frame,total} and null when absent or unreadable', async () => {
      vi.mocked(ioRedis.get).mockResolvedValueOnce(
        JSON.stringify({ frame: 12, total: 40, updatedAt: 123 }),
      );
      await expect(service.getRenderProgress('job-1')).resolves.toEqual({
        frame: 12,
        total: 40,
        updatedAt: 123,
      });
      expect(vi.mocked(ioRedis.get)).toHaveBeenCalledWith('video-render:progress:job-1');

      vi.mocked(ioRedis.get).mockResolvedValueOnce(null);
      await expect(service.getRenderProgress('job-1')).resolves.toBeNull();

      vi.mocked(ioRedis.get).mockResolvedValueOnce('not-json');
      await expect(service.getRenderProgress('job-1')).resolves.toBeNull();

      vi.mocked(ioRedis.get).mockResolvedValueOnce(JSON.stringify({ frame: 1, total: 0 }));
      await expect(service.getRenderProgress('job-1')).resolves.toBeNull();
    });
  });
});
