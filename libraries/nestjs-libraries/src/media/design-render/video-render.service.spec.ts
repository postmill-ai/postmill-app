import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { VideoRenderService, withTimeout } from './video-render.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
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

  const orgId = 'org-1';

  beforeEach(() => {
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

    service = new VideoRenderService(lifecycle, aiSettings, encoder);

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

  it('rejects compositions longer than 60 seconds', async () => {
    await expect(
      service.enqueueRender(orgId, {
        composition: videoOutput(61000),
      }),
    ).rejects.toThrow('exceeds the 60 s hard cap');
  });

  it('processes a pending job and completes it with the rendered artifact', async () => {
    const composition = videoOutput(3000);
    vi.mocked(ioRedis.getdel).mockResolvedValueOnce(
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

    vi.mocked(encoder.encode).mockResolvedValueOnce({
      videoPath,
      thumbnailPath: thumbPath,
    });

    await service.processVideoRender('job-1');

    expect(aiSettings.updateMediaJob).toHaveBeenCalledWith(orgId, 'job-1', {
      status: 'processing',
    });
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
    );
    expect(aiSettings.updateMediaJob).not.toHaveBeenCalledWith(
      orgId,
      'job-1',
      expect.objectContaining({ status: 'failed' }),
    );

    encoder.cleanup(tmpDir);
  });

  it('fails the job when no payload is found in Redis (genuinely missing, still pending)', async () => {
    vi.mocked(ioRedis.getdel).mockResolvedValueOnce(null);
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

  it('does not double-render or spuriously fail a job when two runners race the claim', async () => {
    const composition = videoOutput(3000);
    // Only the first GETDEL returns the payload; the loser gets null (atomic single-winner).
    vi.mocked(ioRedis.getdel)
      .mockResolvedValueOnce(
        JSON.stringify({ organizationId: orgId, composition, bitrateKbps: 4000 }),
      )
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
});
