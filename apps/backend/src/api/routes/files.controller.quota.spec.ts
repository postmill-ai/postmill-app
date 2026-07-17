import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Organization, User } from '@prisma/client';
import { HttpException } from '@nestjs/common';

const storageMock = {
  uploadFile: vi.fn(),
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
  const ctrl = new FilesController(
    fileSvcMock as any,
    storageSvcMock as any,
    {} as any,
    {} as any,
  );
  return ctrl;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FilesController — quota enforcement', () => {
  describe('uploadServer', () => {
    it('enforces quota before uploading', async () => {
      storageSvcMock.assertWithinProviderQuota.mockRejectedValue(
        new HttpException('Storage quota exceeded', 413)
      );
      const controller = makeController();

      const file = {
        originalname: 'test.png',
        size: 1000,
        buffer: Buffer.from('data'),
      } as any;

      await expect(
        controller.uploadServer(org, file, {})
      ).rejects.toThrow('Storage quota exceeded');

      expect(storageSvcMock.resolveAdapterForFolderWithConfigId).toHaveBeenCalledWith(undefined, 'org-1');
      expect(storageSvcMock.assertWithinProviderQuota).toHaveBeenCalledWith(storageMock, 'org-1', 1000, null);
    });

    it('allows upload when within quota', async () => {
      storageSvcMock.assertWithinProviderQuota.mockResolvedValue(undefined);
      storageMock.uploadFile.mockResolvedValue({
        originalname: 'test.png',
        path: 'http://localhost/uploads/test.png',
      });
      fileSvcMock.saveFile.mockResolvedValue({
        id: 'file-1',
        path: 'http://localhost/uploads/test.png',
      });
      const controller = makeController();

      const file = {
        originalname: 'test.png',
        size: 100,
        buffer: Buffer.from('data'),
      } as any;

      const result = await controller.uploadServer(org, file, {});

      expect(storageSvcMock.assertWithinProviderQuota).toHaveBeenCalledWith(storageMock, 'org-1', 100, null);
      expect(storageMock.uploadFile).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe('uploadSimple', () => {
    it('enforces quota before uploading', async () => {
      storageSvcMock.assertWithinProviderQuota.mockRejectedValue(
        new HttpException('Over quota', 413)
      );
      const controller = makeController();

      const file = {
        originalname: 'image.png',
        size: 2000,
        buffer: Buffer.from('data'),
      } as any;

      await expect(
        controller.uploadSimple(org, file, {})
      ).rejects.toThrow('Over quota');

      expect(storageSvcMock.resolveAdapterForFolderWithConfigId).toHaveBeenCalledWith(undefined, 'org-1');
      expect(storageSvcMock.assertWithinProviderQuota).toHaveBeenCalledWith(storageMock, 'org-1', 2000, null);
    });

    it('skips saving when preventSave is true', async () => {
      storageSvcMock.assertWithinProviderQuota.mockResolvedValue(undefined);
      storageMock.uploadFile.mockResolvedValue({
        originalname: 'test.png',
        path: 'http://localhost/uploads/test.png',
      });
      const controller = makeController();

      const file = {
        originalname: 'test.png',
        size: 100,
        buffer: Buffer.from('data'),
      } as any;

      const result = await controller.uploadSimple(org, file, { preventSave: true });

      expect(result).toHaveProperty('path');
      expect(fileSvcMock.saveFile).not.toHaveBeenCalled();
    });
  });
});
