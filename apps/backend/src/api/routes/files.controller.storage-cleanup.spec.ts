import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Organization, StorageProviderType } from '@prisma/client';
import { FilesController } from './files.controller';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { FileRepository } from '@gitroom/nestjs-libraries/database/prisma/file/file.repository';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const org: Organization = { id: 'org-1' } as any;

function makePrismaModel(overrides: Record<string, any> = {}) {
  return {
    file: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      ...overrides,
    },
    fileFolder: {
      findUnique: vi.fn(),
      ...overrides.fileFolder,
    },
  };
}

function makeRepo(modelOverrides: Record<string, any> = {}) {
  const model = makePrismaModel(modelOverrides);
  const fileRepo = new FileRepository(
    { model } as any,
    { model } as any,
  );
  return { fileRepo, model };
}

function makeStorageService(adapter: any) {
  return {
    resolveAdapterForFolder: vi.fn().mockResolvedValue(adapter),
    resolveAdapterForFolderWithConfigId: vi.fn().mockResolvedValue({ adapter, configId: null }),
  };
}

function makeController(fileRepo: FileRepository, storageService: any) {
  const fileService = new FileService(fileRepo, storageService);
  return new FilesController(
    fileService,
    storageService as any,
    {} as any,
    {} as any,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FilesController — storage cleanup on permanent delete', () => {
  it('removes a local-disk object on DELETE /:id', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'postmill-cleanup-'));
    const filePath = path.join(tmpDir, 'local.png');
    await fs.writeFile(filePath, 'local bytes');

    const { fileRepo, model } = makeRepo();
    model.file.findUnique.mockResolvedValue({
      id: 'file-1',
      organizationId: 'org-1',
      folderId: null,
      path: filePath,
    });
    model.file.delete.mockResolvedValue({ id: 'file-1' });

    const localAdapter = {
      type: StorageProviderType.LOCAL,
      removeFile: vi.fn(async (p: string) => {
        await fs.unlink(p);
      }),
    };
    const storageService = makeStorageService(localAdapter);
    const ctrl = makeController(fileRepo, storageService);

    const result = await ctrl.deleteFile(org, 'file-1');

    expect(result).toEqual({ success: true });
    expect(localAdapter.removeFile).toHaveBeenCalledWith(filePath);
    await expect(fs.access(filePath)).rejects.toThrow();

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('removes an S3-family object on DELETE /:id', async () => {
    const { fileRepo, model } = makeRepo();
    model.file.findUnique.mockResolvedValue({
      id: 'file-2',
      organizationId: 'org-1',
      folderId: 'folder-s3',
      path: 'https://bucket.s3.us-east-1.amazonaws.com/key.png',
    });
    model.file.delete.mockResolvedValue({ id: 'file-2' });

    const s3Adapter = {
      type: StorageProviderType.S3,
      removeFile: vi.fn().mockResolvedValue(undefined),
    };
    const storageService = makeStorageService(s3Adapter);
    const ctrl = makeController(fileRepo, storageService);

    const result = await ctrl.deleteFile(org, 'file-2');

    expect(result).toEqual({ success: true });
    expect(storageService.resolveAdapterForFolder).toHaveBeenCalledWith('folder-s3', 'org-1');
    expect(s3Adapter.removeFile).toHaveBeenCalledWith(
      'https://bucket.s3.us-east-1.amazonaws.com/key.png',
    );
  });

  it('keeps the storage object on soft-delete and restore', async () => {
    const { fileRepo, model } = makeRepo();
    model.file.findUnique.mockResolvedValue({
      id: 'file-3',
      organizationId: 'org-1',
      folderId: null,
      path: 'https://app.example.com/uploads/kept.png',
    });
    model.file.update.mockResolvedValue({ id: 'file-3' });

    const adapter = {
      type: StorageProviderType.LOCAL,
      removeFile: vi.fn().mockResolvedValue(undefined),
    };
    const storageService = makeStorageService(adapter);
    const ctrl = makeController(fileRepo, storageService);

    await expect(ctrl.softDelete(org, 'file-3')).resolves.toEqual({ success: true });
    await expect(ctrl.restore(org, 'file-3')).resolves.toEqual({ success: true });

    expect(adapter.removeFile).not.toHaveBeenCalled();
    expect(model.file.update).toHaveBeenCalledTimes(2);
    expect(model.file.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'file-3', organizationId: 'org-1' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(model.file.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'file-3', organizationId: 'org-1' },
      data: { deletedAt: null },
    });
  });

  it('does not remove a file belonging to another org', async () => {
    const { fileRepo, model } = makeRepo();
    model.file.findUnique.mockImplementation(({ where }: any) =>
      where.organizationId === 'org-2'
        ? {
            id: 'file-4',
            organizationId: 'org-2',
            folderId: null,
            path: 'https://app.example.com/uploads/foreign.png',
          }
        : null
    );

    const adapter = {
      type: StorageProviderType.LOCAL,
      removeFile: vi.fn().mockResolvedValue(undefined),
    };
    const ctrl = makeController(fileRepo, makeStorageService(adapter));

    await expect(ctrl.deleteFile(org, 'file-4')).rejects.toMatchObject({
      status: 404,
      message: 'File not found',
    });

    expect(adapter.removeFile).not.toHaveBeenCalled();
    expect(model.file.delete).not.toHaveBeenCalled();
  });
});
