import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Organization } from '@prisma/client';

const storageMock = {
  uploadFile: vi.fn(),
  removeFile: vi.fn(),
};

const storageSvcMock = {
  resolveAdapterForFolderWithConfigId: vi.fn().mockResolvedValue({ adapter: storageMock, configId: null }),
  assertWithinProviderQuota: vi.fn(),
};

const fileSvcMock = {
  saveFile: vi.fn(),
};

vi.mock('@gitroom/nestjs-libraries/database/prisma/storage/storage.service', () => ({
  StorageService: class {
    resolveAdapterForFolderWithConfigId = storageSvcMock.resolveAdapterForFolderWithConfigId;
    assertWithinProviderQuota = storageSvcMock.assertWithinProviderQuota;
  },
}));

import { FilesController } from './files.controller';

const org: Organization = { id: 'org-1' } as any;

function makeController() {
  return new FilesController(
    fileSvcMock as any,
    storageSvcMock as any,
    {} as any,
    {} as any,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  storageSvcMock.resolveAdapterForFolderWithConfigId.mockResolvedValue({ adapter: storageMock, configId: null });
  storageSvcMock.assertWithinProviderQuota.mockResolvedValue(undefined);
  storageMock.removeFile.mockResolvedValue(undefined);
});

describe('FilesController — orphan storage-object cleanup on post-write failure (M4)', () => {
  describe('uploadServer', () => {
    it('deletes the stored object when saveFile fails after a successful write', async () => {
      storageMock.uploadFile.mockResolvedValue({
        originalname: 'abc123.png',
        path: 'http://localhost/uploads/abc123.png',
      });
      fileSvcMock.saveFile.mockRejectedValue(new Error('DB down'));
      const controller = makeController();
      const file = {
        originalname: 'test.png',
        size: 100,
        path: '/tmp/postmill-uploads/test123.png',
      } as any;

      const fs = await import('fs');
      const unlinkSpy = vi.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);

      await expect(controller.uploadServer(org, file, {})).rejects.toThrow('DB down');
      expect(storageMock.removeFile).toHaveBeenCalledWith('http://localhost/uploads/abc123.png');
      // multer temp unlink in `finally` is unchanged.
      expect(unlinkSpy).toHaveBeenCalledWith('/tmp/postmill-uploads/test123.png');

      unlinkSpy.mockRestore();
    });

    it('rethrows the original error even when the cleanup delete fails', async () => {
      storageMock.uploadFile.mockResolvedValue({
        originalname: 'abc123.png',
        path: 'http://localhost/uploads/abc123.png',
      });
      fileSvcMock.saveFile.mockRejectedValue(new Error('DB down'));
      storageMock.removeFile.mockRejectedValue(new Error('S3 unreachable'));
      const controller = makeController();
      const file = { originalname: 'test.png', size: 100 } as any;

      await expect(controller.uploadServer(org, file, {})).rejects.toThrow('DB down');
      expect(storageMock.removeFile).toHaveBeenCalledWith('http://localhost/uploads/abc123.png');
    });

    it('does not delete anything when the storage write itself fails', async () => {
      storageMock.uploadFile.mockRejectedValue(new Error('Upload failed'));
      const controller = makeController();
      const file = { originalname: 'test.png', size: 100 } as any;

      await expect(controller.uploadServer(org, file, {})).rejects.toThrow('Upload failed');
      expect(storageMock.removeFile).not.toHaveBeenCalled();
    });

    it('does not delete anything on the happy path', async () => {
      storageMock.uploadFile.mockResolvedValue({
        originalname: 'abc123.png',
        path: 'http://localhost/uploads/abc123.png',
      });
      fileSvcMock.saveFile.mockResolvedValue({ id: 'file-1' });
      const controller = makeController();
      const file = { originalname: 'test.png', size: 100 } as any;

      await controller.uploadServer(org, file, {});

      expect(storageMock.removeFile).not.toHaveBeenCalled();
    });
  });

  describe('uploadSimple', () => {
    it('deletes the stored object when saveFile fails after a successful write', async () => {
      storageMock.uploadFile.mockResolvedValue({
        originalname: 'abc123.png',
        path: 'http://localhost/uploads/abc123.png',
      });
      fileSvcMock.saveFile.mockRejectedValue(new Error('DB down'));
      const controller = makeController();
      const file = { originalname: 'test.png', size: 100 } as any;

      await expect(controller.uploadSimple(org, file, {})).rejects.toThrow('DB down');
      expect(storageMock.removeFile).toHaveBeenCalledWith('http://localhost/uploads/abc123.png');
    });

    it('rethrows the original error even when the cleanup delete fails', async () => {
      storageMock.uploadFile.mockResolvedValue({
        originalname: 'abc123.png',
        path: 'http://localhost/uploads/abc123.png',
      });
      fileSvcMock.saveFile.mockRejectedValue(new Error('folder not found'));
      storageMock.removeFile.mockRejectedValue(new Error('S3 unreachable'));
      const controller = makeController();
      const file = { originalname: 'test.png', size: 100 } as any;

      await expect(controller.uploadSimple(org, file, {})).rejects.toThrow('folder not found');
      expect(storageMock.removeFile).toHaveBeenCalledWith('http://localhost/uploads/abc123.png');
    });

    it('keeps the stored object when preventSave is set (caller owns it)', async () => {
      storageMock.uploadFile.mockResolvedValue({
        originalname: 'abc123.png',
        path: 'http://localhost/uploads/abc123.png',
      });
      const controller = makeController();
      const file = { originalname: 'test.png', size: 100 } as any;

      const result = await controller.uploadSimple(org, file, { preventSave: true });

      expect(result).toEqual({ path: 'http://localhost/uploads/abc123.png' });
      expect(fileSvcMock.saveFile).not.toHaveBeenCalled();
      expect(storageMock.removeFile).not.toHaveBeenCalled();
    });

    it('does not delete anything on the happy path', async () => {
      storageMock.uploadFile.mockResolvedValue({
        originalname: 'abc123.png',
        path: 'http://localhost/uploads/abc123.png',
      });
      fileSvcMock.saveFile.mockResolvedValue({ id: 'file-1' });
      const controller = makeController();
      const file = { originalname: 'test.png', size: 100 } as any;

      await controller.uploadSimple(org, file, {});

      expect(storageMock.removeFile).not.toHaveBeenCalled();
    });
  });
});
