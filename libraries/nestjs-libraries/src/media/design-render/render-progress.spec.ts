import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ioRedis } from '@postmill-ai/nestjs-libraries/redis/redis.service';
import { mediaJobWebhookToken } from '../media-job-token';
import {
  readRenderProgress,
  renderProgressKey,
  reportRenderProgress,
  writeRenderProgress,
} from './render-progress';

vi.mock('@postmill-ai/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn(),
    del: vi.fn().mockResolvedValue(1),
  },
}));

describe('render-progress channel', () => {
  const jobId = 'job-1';
  const orgId = 'org-1';
  let token: string;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
    token = mediaJobWebhookToken(jobId, orgId);
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
  });

  it('writeRenderProgress stores {frame,total,updatedAt} under the job key with a 1h TTL', async () => {
    await writeRenderProgress(jobId, 42, 100);
    expect(vi.mocked(ioRedis.set)).toHaveBeenCalledWith(
      renderProgressKey(jobId),
      expect.any(String),
      'EX',
      3600,
    );
    const stored = JSON.parse(vi.mocked(ioRedis.set).mock.calls[0][1] as string);
    expect(stored).toMatchObject({ frame: 42, total: 100 });
    expect(stored.updatedAt).toBeTypeOf('number');
  });

  it('readRenderProgress parses the stored value and rejects garbage', async () => {
    vi.mocked(ioRedis.get).mockResolvedValueOnce(JSON.stringify({ frame: 5, total: 10, updatedAt: 1 }));
    await expect(readRenderProgress(jobId)).resolves.toEqual({ frame: 5, total: 10, updatedAt: 1 });

    vi.mocked(ioRedis.get).mockResolvedValueOnce(null);
    await expect(readRenderProgress(jobId)).resolves.toBeNull();

    vi.mocked(ioRedis.get).mockResolvedValueOnce('{nope');
    await expect(readRenderProgress(jobId)).resolves.toBeNull();

    vi.mocked(ioRedis.get).mockResolvedValueOnce(JSON.stringify({ frame: 5, total: -1 }));
    await expect(readRenderProgress(jobId)).resolves.toBeNull();
  });

  describe('reportRenderProgress (container worker POST route guard)', () => {
    it('writes progress for a valid token', async () => {
      vi.mocked(ioRedis.get).mockResolvedValueOnce(
        JSON.stringify({ organizationId: orgId, composition: {} }),
      );
      await expect(reportRenderProgress(jobId, token, 30, 90)).resolves.toBe('ok');
      expect(vi.mocked(ioRedis.get)).toHaveBeenCalledWith(`video-render:payload:${jobId}`);
      expect(vi.mocked(ioRedis.set)).toHaveBeenCalledWith(
        renderProgressKey(jobId),
        expect.any(String),
        'EX',
        3600,
      );
      const stored = JSON.parse(vi.mocked(ioRedis.set).mock.calls[0][1] as string);
      expect(stored).toMatchObject({ frame: 30, total: 90 });
    });

    it('rejects a bad or missing token without writing', async () => {
      vi.mocked(ioRedis.get).mockResolvedValue(
        JSON.stringify({ organizationId: orgId, composition: {} }),
      );
      await expect(reportRenderProgress(jobId, 'wrong-token', 1, 10)).resolves.toBe('forbidden');
      await expect(reportRenderProgress(jobId, '', 1, 10)).resolves.toBe('forbidden');
      expect(vi.mocked(ioRedis.set)).not.toHaveBeenCalled();
    });

    it('rejects a token minted for a different job', async () => {
      vi.mocked(ioRedis.get).mockResolvedValueOnce(
        JSON.stringify({ organizationId: orgId, composition: {} }),
      );
      const otherToken = mediaJobWebhookToken('job-2', orgId);
      await expect(reportRenderProgress(jobId, otherToken, 1, 10)).resolves.toBe('forbidden');
      expect(vi.mocked(ioRedis.set)).not.toHaveBeenCalled();
    });

    it('returns not-found when the render payload is gone', async () => {
      vi.mocked(ioRedis.get).mockResolvedValueOnce(null);
      await expect(reportRenderProgress(jobId, token, 1, 10)).resolves.toBe('not-found');
      expect(vi.mocked(ioRedis.set)).not.toHaveBeenCalled();
    });

    it('clamps out-of-range frame values instead of poisoning the percent', async () => {
      vi.mocked(ioRedis.get).mockResolvedValue(
        JSON.stringify({ organizationId: orgId, composition: {} }),
      );
      await expect(reportRenderProgress(jobId, token, 999, 90)).resolves.toBe('ok');
      let stored = JSON.parse(vi.mocked(ioRedis.set).mock.calls[0][1] as string);
      expect(stored).toMatchObject({ frame: 90, total: 90 });

      await expect(reportRenderProgress(jobId, token, Number.NaN, 90)).resolves.toBe('ok');
      stored = JSON.parse(vi.mocked(ioRedis.set).mock.calls[1][1] as string);
      expect(stored).toMatchObject({ frame: 0, total: 90 });
    });
  });
});
