import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HeyGenService } from './heygen.service';

const mockSubmitHeyGenTts = vi.fn();

vi.mock('@postmill-ai/provider-heygen/v1', () => ({
  submitHeyGenTts: (...args: any[]) => mockSubmitHeyGenTts(...args),
}));

vi.mock('@postmill-ai/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: vi.fn(), set: vi.fn() },
}));

function makeService() {
  const job = {
    id: 'job-1',
    organizationId: 'org-1',
    provider: 'heygen',
    operation: 'audio',
    folderId: 'folder-1',
  };
  const orgMediaProviderSettings = {
    getConfigForProvider: vi.fn().mockResolvedValue({ credentials: { apiKey: 'heygen-key' }, version: 'v1' }),
  };
  const lifecycle = {
    createPendingJob: vi.fn().mockResolvedValue(job),
    completeJob: vi.fn().mockResolvedValue(true),
    attachProviderJob: vi.fn(),
    failJob: vi.fn().mockResolvedValue(undefined),
  };
  const service = new HeyGenService(
    orgMediaProviderSettings as never,
    lifecycle as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, job, lifecycle };
}

describe('HeyGenService voiceover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubmitHeyGenTts.mockResolvedValue({
      artifactUrl: 'https://cdn.heygen/voice.mp3',
      durationSeconds: 2.5,
    });
  });

  it('completes the job directly from the speech API audio URL instead of attaching a poll id', async () => {
    const { service, job, lifecycle } = makeService();

    await expect(service.textToSpeech('org-1', 'user-1', {
      voiceId: 'voice-1',
      text: 'Fresh coffee, beautifully brewed.',
      folderId: 'folder-1',
    })).resolves.toEqual({ jobId: 'job-1' });

    expect(mockSubmitHeyGenTts).toHaveBeenCalledWith(expect.any(Function), {
      apiKey: 'heygen-key',
      voiceId: 'voice-1',
      text: 'Fresh coffee, beautifully brewed.',
    });
    expect(lifecycle.completeJob).toHaveBeenCalledWith(
      job,
      'https://cdn.heygen/voice.mp3',
      { provider: 'heygen', mime: 'audio/mpeg', durationSeconds: 2.5 },
      'folder-1',
    );
    expect(lifecycle.attachProviderJob).not.toHaveBeenCalled();
    expect(lifecycle.failJob).not.toHaveBeenCalled();
  });
});
