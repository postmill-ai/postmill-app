import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/media/studio/media-studio.service', () => ({
  MediaStudioService: class MockMediaStudioService {
    generate = vi.fn();
    status = vi.fn();
    listJobs = vi.fn();
    listModels = vi.fn();
  },
}));

// Control the Redis SET NX / DEL for the idempotency claim; no real connection opens.
const { mockRedisSet, mockRedisDel } = vi.hoisted(() => ({
  mockRedisSet: vi.fn(),
  mockRedisDel: vi.fn(),
}));
vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { set: mockRedisSet, del: mockRedisDel },
}));

import { MediaStudioController } from './media-studio.controller';
import { MediaStudioService } from '@gitroom/nestjs-libraries/media/studio/media-studio.service';

const mockOrg = { id: 'org-1' } as any;
const mockUser = { id: 'user-1' } as any;
const body = {
  operation: 'image',
  model: 'gpt-image-1',
  input: { prompt: 'a cat' },
  mediaInputs: {},
  folderId: undefined,
} as any;

describe('MediaStudioController — generate idempotency (3.2)', () => {
  let controller: MediaStudioController;
  let studio: MediaStudioService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisSet.mockResolvedValue('OK');
    mockRedisDel.mockResolvedValue(1);
    studio = new (MediaStudioService as any)();
    (studio.generate as any).mockResolvedValue({ jobId: 'job-1', status: 'pending' });
    controller = new MediaStudioController(studio as unknown as MediaStudioService);
  });

  it('dispatches once, then short-circuits a duplicate key with {duplicate:true}', async () => {
    mockRedisSet.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

    const first = await controller.generate('openai', body, 'key-1', mockOrg, mockUser);
    const second = await controller.generate('openai', body, 'key-1', mockOrg, mockUser);

    expect(studio.generate).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ jobId: 'job-1', status: 'pending' });
    expect(second).toEqual({ duplicate: true });
    expect(mockRedisSet).toHaveBeenCalledWith('idem:org-1:key-1', '1', 'EX', 86400, 'NX');
  });

  it('different keys each dispatch', async () => {
    mockRedisSet.mockResolvedValue('OK');

    await controller.generate('openai', body, 'key-a', mockOrg, mockUser);
    await controller.generate('openai', body, 'key-b', mockOrg, mockUser);

    expect(studio.generate).toHaveBeenCalledTimes(2);
  });

  it('no header → unchanged (Redis not touched, always dispatches)', async () => {
    await controller.generate('openai', body, undefined, mockOrg, mockUser);

    expect(mockRedisSet).not.toHaveBeenCalled();
    expect(studio.generate).toHaveBeenCalledTimes(1);
  });

  // A definite generate failure releases the key so a retry can re-attempt (no
  // false "duplicate" success that would silently drop a paid render).
  it('releases the key when generate throws, so a retry re-attempts', async () => {
    mockRedisSet.mockResolvedValue('OK');
    (studio.generate as any)
      .mockRejectedValueOnce(new Error('provider 500'))
      .mockResolvedValueOnce({ jobId: 'job-2', status: 'pending' });

    await expect(
      controller.generate('openai', body, 'key-r', mockOrg, mockUser)
    ).rejects.toThrow('provider 500');
    expect(mockRedisDel).toHaveBeenCalledWith('idem:org-1:key-r');

    const retry = await controller.generate('openai', body, 'key-r', mockOrg, mockUser);
    expect(retry).toEqual({ jobId: 'job-2', status: 'pending' });
    expect(studio.generate).toHaveBeenCalledTimes(2);
  });

  // A Redis outage must NOT fail the generate — fail open (proceed, no dedup).
  it('fails open when Redis is unavailable', async () => {
    mockRedisSet.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await controller.generate('openai', body, 'key-x', mockOrg, mockUser);

    expect(result).toEqual({ jobId: 'job-1', status: 'pending' });
    expect(studio.generate).toHaveBeenCalledTimes(1);
  });
});
