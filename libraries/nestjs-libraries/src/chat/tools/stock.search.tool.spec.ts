import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { StockSearchTool } from './stock.search.tool';
import { executeTool, makeOrganization, makeUser } from './__tests__/tool-test.harness';

describe('StockSearchTool', () => {
  const org = makeOrganization();
  const user = makeUser();
  const access = { mode: 'user' };

  const makePhoto = (id: string) => ({
    id,
    url: `https://cdn.example.com/photo-${id}.jpg`,
    thumbUrl: `https://cdn.example.com/photo-${id}-thumb.jpg`,
    source: 'unsplash',
    attribution: { provider: 'Unsplash', userId: `user-${id}` },
  });

  const makeVideo = (id: string) => ({
    id,
    url: `https://cdn.example.com/video-${id}.mp4`,
    thumbUrl: `https://cdn.example.com/video-${id}-thumb.jpg`,
    source: 'pexels',
    attribution: { provider: 'Pexels' },
    duration: 30,
  });

  it('searches photos and caps results', async () => {
    const stockMediaService = {
      searchPhotos: vi.fn().mockResolvedValue({
        results: Array.from({ length: 20 }, (_, i) => makePhoto(`p-${i}`)),
        page: 1,
        totalPages: 5,
        configured: true,
        source: 'unsplash',
      }),
      searchVideos: vi.fn(),
    };
    const tool = new StockSearchTool(stockMediaService as any);

    const result = await executeTool(tool, {
      inputData: { query: 'mountain', kind: 'photos', page: 1 },
      organization: org,
      user,
      access,
    });

    expect(stockMediaService.searchPhotos).toHaveBeenCalledWith(org.id, 'mountain', 1);
    expect(stockMediaService.searchVideos).not.toHaveBeenCalled();
    expect(result.output).toHaveLength(12);
    expect(result.output[0]).toEqual({
      url: 'https://cdn.example.com/photo-p-0.jpg',
      thumb: 'https://cdn.example.com/photo-p-0-thumb.jpg',
      source: 'unsplash',
      attribution: { provider: 'Unsplash', userId: 'user-p-0' },
    });
  });

  it('searches videos', async () => {
    const stockMediaService = {
      searchPhotos: vi.fn(),
      searchVideos: vi.fn().mockResolvedValue({
        results: [makeVideo('v-1')],
        page: 2,
        totalPages: 3,
        configured: true,
        source: 'pexels',
      }),
    };
    const tool = new StockSearchTool(stockMediaService as any);

    const result = await executeTool(tool, {
      inputData: { query: 'ocean', kind: 'videos', page: 2 },
      organization: org,
      user,
      access,
    });

    expect(stockMediaService.searchVideos).toHaveBeenCalledWith(org.id, 'ocean', 2);
    expect(result.output).toHaveLength(1);
    expect(result.output[0]).toMatchObject({
      url: expect.stringContaining('video-v-1.mp4'),
      thumb: expect.stringContaining('video-v-1-thumb.jpg'),
      source: 'pexels',
    });
  });

  it('denies read without access context', async () => {
    const tool = new StockSearchTool({} as any);

    await expect(
      executeTool(tool, {
        inputData: { query: 'x', kind: 'photos' },
        organization: org,
        user,
      })
    ).rejects.toThrow('Read access denied');
  });

  it('denies mcp read without mcp:read scope', async () => {
    const tool = new StockSearchTool({} as any);

    await expect(
      executeTool(tool, {
        inputData: { query: 'x', kind: 'photos' },
        organization: org,
        user,
        access: { mode: 'mcp', scopes: ['mcp:posts:write'] },
      })
    ).rejects.toThrow('Read access denied: mcp:read scope required');
  });
});
