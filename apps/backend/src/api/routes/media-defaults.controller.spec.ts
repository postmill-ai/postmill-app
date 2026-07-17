import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaDefaultsController } from './media-defaults.controller';
import { MediaDefaultsService } from '@gitroom/nestjs-libraries/ai/defaults/media-defaults.service';

const mockGetMediaDefaults = vi.fn();
const mockSetMediaDefault = vi.fn();
const mockClearMediaDefault = vi.fn();
const mockGetMediaDefaultsCatalog = vi.fn();

vi.mock('@gitroom/nestjs-libraries/ai/defaults/media-defaults.service', () => ({
  MediaDefaultsService: class {
    getMediaDefaults = mockGetMediaDefaults;
    setMediaDefault = mockSetMediaDefault;
    clearMediaDefault = mockClearMediaDefault;
    getMediaDefaultsCatalog = mockGetMediaDefaultsCatalog;
  },
}));

function makeController() {
  return new MediaDefaultsController(new (MediaDefaultsService as any)());
}

const org = { id: 'org-1' } as any;

describe('MediaDefaultsController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET / delegates to MediaDefaultsService', async () => {
    mockGetMediaDefaults.mockResolvedValue({
      categories: [{ category: 'text-to-image', providerId: 'openai' }],
    });

    const controller = makeController();
    const result = await controller.getMediaDefaults(org);

    expect(mockGetMediaDefaults).toHaveBeenCalledWith('org-1');
    expect(result).toEqual({
      categories: [{ category: 'text-to-image', providerId: 'openai' }],
    });
  });

  it('PUT /:category delegates to MediaDefaultsService', async () => {
    mockSetMediaDefault.mockResolvedValue({ category: 'text-to-image', success: true });
    const controller = makeController();

    const body = { providerId: 'openai', version: 'v1', model: 'dall-e-3' } as any;
    const result = await controller.setMediaDefault(org, 'text-to-image', body);

    expect(result).toEqual({ category: 'text-to-image', success: true });
    expect(mockSetMediaDefault).toHaveBeenCalledWith('org-1', 'text-to-image', body);
  });

  it('DELETE /:category delegates to MediaDefaultsService', async () => {
    mockClearMediaDefault.mockResolvedValue({ category: 'text-to-image', success: true });
    const controller = makeController();

    const result = await controller.clearMediaDefault(org, 'text-to-image');

    expect(result).toEqual({ category: 'text-to-image', success: true });
    expect(mockClearMediaDefault).toHaveBeenCalledWith('org-1', 'text-to-image');
  });

  it('GET /catalog delegates to MediaDefaultsService', async () => {
    mockGetMediaDefaultsCatalog.mockResolvedValue({
      category: 'text-to-image',
      options: [{ providerId: 'openai', version: 'v1', label: 'openai' }],
    });

    const controller = makeController();
    const result = await controller.getMediaDefaultsCatalog(org, 'text-to-image');

    expect(mockGetMediaDefaultsCatalog).toHaveBeenCalledWith('org-1', 'text-to-image');
    expect(result).toEqual({
      category: 'text-to-image',
      options: [{ providerId: 'openai', version: 'v1', label: 'openai' }],
    });
  });
});
