import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DefaultsSeedService } from './defaults-seed.service';

const makeRepository = () => ({
  get: vi.fn().mockResolvedValue(null),
  getAll: vi.fn().mockResolvedValue([]),
  upsert: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn(),
});

const makeResolution = (overrides: {
  resolve?: ReturnType<typeof vi.fn>;
  candidates?: ReturnType<typeof vi.fn>;
} = {}) => ({
  resolve:
    overrides.resolve ??
    vi.fn().mockResolvedValue({
      providerId: 'openai',
      version: 'v1',
      model: 'gpt-image-1',
      source: 'auto',
    }),
  candidates:
    overrides.candidates ??
    vi.fn().mockResolvedValue([
      {
        providerId: 'openai',
        version: 'v1',
        metadata: { id: 'openai', kind: 'hub', domains: ['ai', 'media'] },
      },
    ]),
});

const makeOrganizationService = () => ({
  getAllIds: vi.fn().mockResolvedValue([]),
});

describe('DefaultsSeedService', () => {
  let repository: ReturnType<typeof makeRepository>;
  let resolution: ReturnType<typeof makeResolution>;
  let service: DefaultsSeedService;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = makeRepository();
    resolution = makeResolution();
    service = new DefaultsSeedService(
      repository as any,
      resolution as any,
      makeOrganizationService() as any,
    );
  });

  it('seeds the auto-picked default when it names a model', async () => {
    await (service as any)._seedCategory('media', 'text-to-image', 'org-1');

    expect(repository.upsert).toHaveBeenCalledWith(
      'org-1',
      'media',
      'text-to-image',
      expect.objectContaining({ providerId: 'openai', model: 'gpt-image-1' }),
    );
  });

  it('leaves an existing stored row untouched', async () => {
    repository.get.mockResolvedValue({ providerId: 'openai', model: 'gpt-image-1' });

    await (service as any)._seedCategory('media', 'text-to-image', 'org-1');

    expect(resolution.resolve).not.toHaveBeenCalled();
    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it('does not re-seed a stored-source resolution', async () => {
    resolution.resolve.mockResolvedValue({
      providerId: 'openai',
      version: 'v1',
      model: 'gpt-image-1',
      source: 'stored',
    });

    await (service as any)._seedCategory('media', 'text-to-image', 'org-1');

    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it('skips the upsert when a model-bearing provider auto-picks no model', async () => {
    // e.g. openai image-focal-point: no listModels on the media adapter and no
    // static catalog — a stored NULL-model row could never resolve and would
    // warn on every read.
    resolution.resolve.mockResolvedValue({
      providerId: 'openai',
      version: 'v1',
      model: undefined,
      source: 'auto',
    });

    await (service as any)._seedCategory('media', 'image-focal-point', 'org-1');

    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it('still seeds a model-less default for action providers (model-less by design)', async () => {
    resolution.resolve.mockResolvedValue({
      providerId: 'deepgram',
      version: 'v1',
      model: undefined,
      source: 'auto',
    });
    resolution.candidates.mockResolvedValue([
      {
        providerId: 'deepgram',
        version: 'v1',
        metadata: { id: 'deepgram', kind: 'action', domains: ['media'] },
      },
    ]);

    await (service as any)._seedCategory('media', 'video-caption', 'org-1');

    expect(repository.upsert).toHaveBeenCalledWith(
      'org-1',
      'media',
      'video-caption',
      expect.objectContaining({ providerId: 'deepgram', model: undefined }),
    );
  });
});
