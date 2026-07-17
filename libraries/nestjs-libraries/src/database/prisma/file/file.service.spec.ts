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
