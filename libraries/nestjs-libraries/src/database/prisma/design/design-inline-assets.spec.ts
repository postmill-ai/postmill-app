import { beforeEach, describe, expect, it, vi } from 'vitest';
import { materializeDesignerInlineAssets } from './design-inline-assets';

const png = (size: number, fill = 1) =>
  `data:image/png;base64,${Buffer.alloc(size, fill).toString('base64')}`;

const makeMocks = () => {
  const fileService = {
    findInlineAssetByHash: vi.fn(),
    saveGeneratedMedia: vi.fn(),
    deleteFile: vi.fn().mockResolvedValue(undefined),
  };
  const adapter = {
    writeBuffer: vi.fn().mockResolvedValue('/uploads/org-1/inline.png'),
    removeFile: vi.fn().mockResolvedValue(undefined),
  };
  const storageService = {
    getLocalAdapterForOrg: vi.fn().mockResolvedValue(adapter),
  };
  fileService.findInlineAssetByHash.mockResolvedValue(null);
  fileService.saveGeneratedMedia.mockResolvedValue({
    id: 'file-1',
    path: '/uploads/org-1/inline.png',
  });
  return { fileService, storageService, adapter };
};

describe('materializeDesignerInlineAssets', () => {
  beforeEach(() => vi.clearAllMocks());

  it('replaces large raster sources and reuses one File for repeated payloads', async () => {
    const { fileService, storageService, adapter } = makeMocks();
    const source = png(300_000);
    const doc = {
      outputs: [{
        children: [{ id: 'one', src: source }],
        pages: [{ children: [{ id: 'two', src: source }] }],
      }],
    };

    const result = await materializeDesignerInlineAssets(
      'org-1', doc, fileService as never, storageService as never
    );

    expect(result.createdFileIds).toEqual(['file-1']);
    expect(adapter.writeBuffer).toHaveBeenCalledTimes(1);
    expect(fileService.saveGeneratedMedia).toHaveBeenCalledTimes(1);
    expect(result.doc).toMatchObject({
      outputs: [{
        children: [{ id: 'one', src: '/uploads/org-1/inline.png', fileId: 'file-1' }],
        pages: [{ children: [{ id: 'two', src: '/uploads/org-1/inline.png', fileId: 'file-1' }] }],
      }],
    });
    expect(doc.outputs[0].children[0].src).toBe(source);

    fileService.findInlineAssetByHash.mockResolvedValue({
      id: 'file-1', path: '/uploads/org-1/inline.png',
    });
    const second = await materializeDesignerInlineAssets(
      'org-1', doc, fileService as never, storageService as never
    );
    expect(second.createdFileIds).toEqual([]);
    expect(adapter.writeBuffer).toHaveBeenCalledTimes(1);
  });

  it('reuses an existing content hash without writing or creating a File', async () => {
    const { fileService, storageService, adapter } = makeMocks();
    fileService.findInlineAssetByHash.mockResolvedValue({
      id: 'existing', path: '/uploads/org-1/existing.webp',
    });
    const source = `data:image/webp;base64,${Buffer.alloc(300_000).toString('base64')}`;
    const result = await materializeDesignerInlineAssets(
      'org-1',
      { outputs: [{ tracks: [{ clips: [{ src: source }] }] }] },
      fileService as never,
      storageService as never
    );

    expect(result.createdFileIds).toEqual([]);
    expect(adapter.writeBuffer).not.toHaveBeenCalled();
    expect(result.doc).toMatchObject({
      outputs: [{ tracks: [{ clips: [{ src: '/uploads/org-1/existing.webp', fileId: 'existing' }] }] }],
    });
  });

  it('leaves small raster and SVG sources unchanged', async () => {
    const { fileService, storageService } = makeMocks();
    const raster = png(100);
    const svg = `data:image/svg+xml,${encodeURIComponent('<svg>'.repeat(100_000))}`;
    const doc = { outputs: [{ children: [{ src: raster }, { src: svg }] }] };
    const result = await materializeDesignerInlineAssets(
      'org-1', doc, fileService as never, storageService as never
    );
    expect(result.doc).toEqual(doc);
    expect(result.createdFileIds).toEqual([]);
    expect(fileService.findInlineAssetByHash).not.toHaveBeenCalled();
  });

  it('removes a stored object when creating its File row fails', async () => {
    const { fileService, storageService, adapter } = makeMocks();
    fileService.saveGeneratedMedia.mockRejectedValue(new Error('database unavailable'));
    await expect(materializeDesignerInlineAssets(
      'org-1',
      { outputs: [{ children: [{ src: png(300_000) }] }] },
      fileService as never,
      storageService as never
    )).rejects.toThrow('database unavailable');
    expect(adapter.removeFile).toHaveBeenCalledWith('/uploads/org-1/inline.png');
  });

  it('cleans Files created earlier in the walk when a later asset fails', async () => {
    const { fileService, storageService } = makeMocks();
    fileService.saveGeneratedMedia
      .mockResolvedValueOnce({ id: 'file-1', path: '/uploads/org-1/inline.png' })
      .mockRejectedValueOnce(new Error('second insert failed'));
    await expect(materializeDesignerInlineAssets(
      'org-1',
      { outputs: [{ children: [{ src: png(300_000, 1) }, { src: png(300_000, 2) }] }] },
      fileService as never,
      storageService as never
    )).rejects.toThrow('second insert failed');
    expect(fileService.deleteFile).toHaveBeenCalledWith('org-1', 'file-1');
  });
});
