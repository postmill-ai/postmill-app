import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileService } from './file.service';
import { FileRepository } from './file.repository';

function makeModel() {
  return {
    file: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    fileFolder: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  };
}

function makeRepo(model = makeModel()) {
  const fileRepo = new FileRepository(
    { model } as any,
    { model } as any,
  );
  return { fileRepo, model };
}

function makeService(fileRepo: FileRepository) {
  const storageService = {
    assertWithinQuota: vi.fn().mockResolvedValue(undefined),
    resolveAdapterForFolder: vi.fn().mockResolvedValue({
      getFileUrl: vi.fn().mockReturnValue('https://example.com/file.png'),
      readFile: vi.fn().mockResolvedValue(Buffer.from('file')),
      writeBuffer: vi.fn().mockResolvedValue('path'),
      removeFile: vi.fn().mockResolvedValue(undefined),
    }),
    resolveAdapterForFolderWithConfigId: vi.fn().mockResolvedValue({
      adapter: {
        getFileUrl: vi.fn().mockReturnValue('https://example.com/file.png'),
        readFile: vi.fn().mockResolvedValue(Buffer.from('file')),
        writeBuffer: vi.fn().mockResolvedValue('path'),
        removeFile: vi.fn().mockResolvedValue(undefined),
      },
      configId: null,
    }),
    getOrgStoragePublicPrefixes: vi.fn().mockResolvedValue([]),
    assertWithinProviderQuota: vi.fn().mockResolvedValue(undefined),
  };
  return new FileService(fileRepo, storageService as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FileService — cloud fileSize persistence', () => {
  it('persists the supplied fileSize for a cloud URL path', async () => {
    const { fileRepo, model } = makeRepo();
    model.file.create.mockResolvedValue({
      id: 'file-1',
      name: 'cloud.png',
      originalName: 'cloud.png',
      path: 'https://cdn.example.com/uploads/cloud.png',
      thumbnail: null,
      alt: null,
      folderId: null,
    });

    const service = makeService(fileRepo);
    const result = await service.saveFile(
      'org-1',
      'cloud.png',
      'https://cdn.example.com/uploads/cloud.png',
      'cloud.png',
      undefined,
      12345,
    );

    expect(model.file.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          path: 'https://cdn.example.com/uploads/cloud.png',
          fileSize: 12345,
          metadata: expect.objectContaining({ fileSize: 12345 }),
        }),
      }),
    );
    expect(result).toEqual(expect.objectContaining({ id: 'file-1' }));
  });

  it('does not call stat for a cloud URL even when fileSize is absent', async () => {
    const { fileRepo, model } = makeRepo();
    model.file.create.mockResolvedValue({ id: 'file-2' });

    const service = makeService(fileRepo);
    await service.saveFile(
      'org-1',
      'cloud.png',
      'https://cdn.example.com/uploads/cloud.png',
      'cloud.png',
      undefined,
      undefined,
    );

    const created = model.file.create.mock.calls[0][0].data;
    expect(created.fileSize).toBe(0);
    expect(created.metadata.fileSize).toBe(0);
  });
});

describe('FileService — purgeAiDesignerSessionFiles', () => {
  it('soft-deletes session assets + stamped references, keeping delivered-referenced files', async () => {
    const { fileRepo, model } = makeRepo();
    model.file.findMany.mockImplementation((args: any) => {
      // Asset query (AND on aiDesigner/sessionId) vs reference query (id in).
      if (args.where.AND) return Promise.resolve([{ id: 'asset-1' }, { id: 'asset-2' }]);
      return Promise.resolve([{ id: 'ref-1' }]);
    });
    model.file.updateMany.mockResolvedValue({ count: 2 });

    const service = makeService(fileRepo);
    const purged = await service.purgeAiDesignerSessionFiles('org-1', 'sess-1', {
      referenceFileIds: ['ref-1', 'library-file'],
      keepFileIds: new Set(['asset-2']),
    });

    expect(purged).toBe(2);
    const update = model.file.updateMany.mock.calls[0][0];
    expect(update.where.id.in.sort()).toEqual(['asset-1', 'ref-1']);
  });

  it('skips the delete when every candidate is still referenced', async () => {
    const { fileRepo, model } = makeRepo();
    model.file.findMany.mockResolvedValue([{ id: 'asset-1' }]);

    const service = makeService(fileRepo);
    const purged = await service.purgeAiDesignerSessionFiles('org-1', 'sess-1', {
      keepFileIds: new Set(['asset-1']),
    });

    expect(purged).toBe(0);
    expect(model.file.updateMany).not.toHaveBeenCalled();
  });
});
