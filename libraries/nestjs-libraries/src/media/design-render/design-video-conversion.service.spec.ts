import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { DesignerDocService } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.service';
import type { DesignerDoc, DesignerOutput } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { DesignVideoConversionService } from './design-video-conversion.service';
import { ioRedis } from '@postmill-ai/nestjs-libraries/redis/redis.service';

vi.mock('@postmill-ai/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { set: vi.fn(), get: vi.fn(), del: vi.fn() },
}));

const baseLayer = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  x: 10,
  y: 20,
  width: 100,
  height: 80,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  ...extra,
});

const sourceDoc = (): DesignerDoc => ({
  version: 14,
  mode: 'image',
  outputs: [{
    id: 'output-1',
    formatId: 'custom-400x400',
    name: 'Square',
    width: 400,
    height: 400,
    background: '#ffffff',
    children: [
      baseLayer('title', 'text', { text: 'Burger night', fontFamily: 'Arial', fontSize: 32 }),
      baseLayer('plate', 'shape', { shape: 'rect', fill: '#ff0000' }),
      baseLayer('photo', 'image', { src: 'https://cdn.example.com/burger.png' }),
    ] as DesignerOutput['children'],
    pages: [{
      id: 'page-2',
      children: [baseLayer('second', 'text', { text: 'Second page' })] as DesignerOutput['children'],
    }],
  }],
});

describe('DesignVideoConversionService', () => {
  let designService: { getDesign: ReturnType<typeof vi.fn>; createDesign: ReturnType<typeof vi.fn> };
  let renderService: { renderPage: ReturnType<typeof vi.fn> };
  let fileService: { saveFile: ReturnType<typeof vi.fn>; deleteFile: ReturnType<typeof vi.fn> };
  let adapter: { writeBuffer: ReturnType<typeof vi.fn>; removeFile: ReturnType<typeof vi.fn> };
  let storageService: { getLocalAdapterForOrg: ReturnType<typeof vi.fn> };
  let service: DesignVideoConversionService;
  let source: { id: string; name: string; previewFileId: string; doc: DesignerDoc };

  beforeEach(() => {
    vi.clearAllMocks();
    source = { id: 'source-1', name: 'Burger', previewFileId: 'source-preview', doc: sourceDoc() };
    designService = {
      getDesign: vi.fn(async () => source),
      createDesign: vi.fn(async (_org, _user, data) => ({ id: 'video-1', ...data })),
    };
    renderService = { renderPage: vi.fn(async () => Buffer.from('png')) };
    fileService = {
      saveFile: vi.fn(async (_org, _name, path) => ({ id: `asset-${path}`, path })),
      deleteFile: vi.fn(async () => undefined),
    };
    adapter = {
      writeBuffer: vi.fn(async () => '/uploads/org/fallback.png'),
      removeFile: vi.fn(async () => undefined),
    };
    storageService = { getLocalAdapterForOrg: vi.fn(async () => adapter) };
    service = new DesignVideoConversionService(
      designService as any,
      new DesignerDocService(),
      renderService as any,
      fileService as any,
      storageService as any,
    );
  });

  it('creates a separate video design without modifying the source or its preview', async () => {
    const before = structuredClone(source);
    const result = await service.convertDesignToVideo('org-1', 'user-1', 'source-1', 5000);

    expect(result.design.id).toBe('video-1');
    expect(result.design.name).toBe('Burger — Video');
    expect(result.design.doc.mode).toBe('video');
    expect(result.design.doc.outputs[0].durationMs).toBe(10000);
    expect(result.summary.totalPages).toBe(2);
    expect(result.summary.totalFallbacks).toBe(0);
    expect(source).toEqual(before);
    expect(designService.createDesign).toHaveBeenCalledOnce();
    expect(designService.createDesign.mock.calls[0][2]).not.toHaveProperty('previewFileId');
    expect(renderService.renderPage).not.toHaveBeenCalled();
  });

  it('rasterizes an unsupported icon into an internal asset and discloses it', async () => {
    source.doc.outputs[0].children = [baseLayer('icon-1', 'icon', {
      src: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    })] as DesignerOutput['children'];
    const result = await service.convertDesignToVideo('org-1', 'user-1', 'source-1', 5000);

    expect(adapter.writeBuffer).toHaveBeenCalledWith(Buffer.from('png'), 'image/png');
    expect(fileService.saveFile).toHaveBeenCalledWith(
      'org-1', expect.any(String), '/uploads/org/fallback.png', expect.any(String),
      undefined, 3, { internal: 'design-asset', source: 'design-video-conversion' },
    );
    const output = result.design.doc.outputs[0];
    expect(output.tracks[0].type).toBe('raster');
    expect(output.tracks[0].clips[0].fileId).toBe('asset-/uploads/org/fallback.png');
    expect(result.summary.totalFallbacks).toBe(1);
    expect(result.summary.outputs[0].fallbacks[0]).toMatchObject({
      sourceIds: ['icon-1'], sourceTypes: ['icon'], pageNumber: 0,
    });
  });

  it('retains hidden fallback content on a hidden track', async () => {
    source.doc.outputs[0].children = [baseLayer('hidden-icon', 'icon', {
      hidden: true,
      src: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    })] as DesignerOutput['children'];
    const result = await service.convertDesignToVideo('org-1', 'user-1', 'source-1', 5000);
    expect(result.design.doc.outputs[0].tracks[0].hidden).toBe(true);
    expect(result.summary.outputs[0].hiddenLayerCount).toBe(1);
  });

  it('bakes a backdrop-dependent prefix while leaving higher layers editable', async () => {
    source.doc.outputs[0].children = [
      baseLayer('below', 'text', { text: 'Below' }),
      baseLayer('adjust', 'adjustment', { adjustment: { type: 'invert' } }),
      baseLayer('above', 'text', { text: 'Above' }),
    ] as DesignerOutput['children'];
    const result = await service.convertDesignToVideo('org-1', 'user-1', 'source-1', 5000);
    const output = result.design.doc.outputs[0];
    expect(output.tracks.slice(0, 2).map((track) => track.type)).toEqual(['raster', 'text']);
    expect(output.tracks[1].clips[0].text).toBe('Above');
    expect(result.summary.outputs[0].fallbacks[0].sourceIds).toEqual(['below', 'adjust']);
  });

  it('cleans up newly created fallback assets when design creation fails', async () => {
    source.doc.outputs[0].children = [baseLayer('icon-1', 'icon', {
      src: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    })] as DesignerOutput['children'];
    designService.createDesign.mockRejectedValue(new Error('database unavailable'));
    await expect(service.convertDesignToVideo('org-1', 'user-1', 'source-1', 5000))
      .rejects.toThrow('database unavailable');
    expect(fileService.deleteFile).toHaveBeenCalledWith(
      'org-1', 'asset-/uploads/org/fallback.png',
    );
  });

  it('rejects missing sources, video sources and excessive total duration', async () => {
    designService.getDesign.mockResolvedValueOnce(null);
    await expect(service.convertDesignToVideo('org-1', 'user-1', 'missing', 5000))
      .rejects.toThrow('Source design not found');

    source.doc = {
      version: 14,
      mode: 'video',
      outputs: [{
        id: 'video-output', formatId: 'custom', name: 'Video', width: 400, height: 400,
        fps: 30, durationMs: 5000, tracks: [],
      }],
    };
    await expect(service.convertDesignToVideo('org-1', 'user-1', 'source-1', 5000))
      .rejects.toThrow('Only a static image design');

    source.doc = sourceDoc();
    source.doc.outputs[0].pages = Array.from({ length: 19 }, (_, index) => ({
      id: `page-${index}`, children: [],
    }));
    await expect(service.convertDesignToVideo('org-1', 'user-1', 'source-1', 10000))
      .rejects.toThrow(/exceed the 180000ms video limit/);
    expect(designService.createDesign).not.toHaveBeenCalled();
  });

  it('replays the completed result for the same idempotency key', async () => {
    let stored: string | null = null;
    vi.mocked(ioRedis.set).mockImplementation(async (_key, value, ...args) => {
      if (args.includes('NX')) {
        if (stored) return null;
        stored = String(value);
        return 'OK';
      }
      stored = String(value);
      return 'OK';
    });
    vi.mocked(ioRedis.get).mockImplementation(async () => stored);

    const first = await service.convertDesignToVideo('org-1', 'user-1', 'source-1', 5000, 'attempt-1');
    const second = await service.convertDesignToVideo('org-1', 'user-1', 'source-1', 5000, 'attempt-1');
    expect(second).toEqual(first);
    expect(designService.createDesign).toHaveBeenCalledOnce();

    await expect(service.convertDesignToVideo('org-1', 'user-1', 'source-1', 3000, 'attempt-1'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(designService.createDesign).toHaveBeenCalledOnce();
  });

  it('rejects an in-flight duplicate and releases a failed claim', async () => {
    vi.mocked(ioRedis.set).mockResolvedValueOnce(null);
    vi.mocked(ioRedis.get).mockResolvedValue(JSON.stringify({ status: 'pending', pageDurationMs: 5000 }));
    await expect(service.convertDesignToVideo('org-1', 'user-1', 'source-1', 5000, 'attempt-2'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(designService.getDesign).not.toHaveBeenCalled();

    vi.mocked(ioRedis.set).mockResolvedValue('OK');
    designService.getDesign.mockRejectedValueOnce(new Error('read failed'));
    await expect(service.convertDesignToVideo('org-1', 'user-1', 'source-1', 5000, 'attempt-3'))
      .rejects.toThrow('read failed');
    expect(ioRedis.del).toHaveBeenCalledWith('design-video-convert:org-1:source-1:attempt-3');
  });
});
