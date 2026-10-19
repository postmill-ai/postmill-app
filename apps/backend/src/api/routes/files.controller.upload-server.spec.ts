import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Organization } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { UploadValidationError } from '@postmill-ai/provider-kernel';

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

vi.mock('@postmill-ai/nestjs-libraries/database/prisma/storage/storage.service', () => ({
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

describe('FilesController — uploadServer temp file cleanup', () => {
  it('unlinks temp file after successful upload', async () => {
    storageSvcMock.assertWithinProviderQuota.mockResolvedValue(undefined);
    storageMock.uploadFile.mockResolvedValue({
      originalname: 'abc123.png',
      path: 'http://localhost/uploads/abc123.png',
    });
    fileSvcMock.saveFile.mockResolvedValue({ id: 'file-1' });

    const controller = makeController();
    const file = {
      originalname: 'test.png',
      size: 100,
      path: '/tmp/postmill-uploads/test123.png',
    } as any;

    const fs = await import('fs');
    const unlinkSpy = vi.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);

    await controller.uploadServer(org, file, {});

    expect(unlinkSpy).toHaveBeenCalledWith('/tmp/postmill-uploads/test123.png');

    unlinkSpy.mockRestore();
  });

  it('unlinks temp file when uploadFile throws', async () => {
    storageSvcMock.assertWithinProviderQuota.mockResolvedValue(undefined);
    storageMock.uploadFile.mockRejectedValue(new Error('Upload failed'));

    const controller = makeController();
    const file = {
      originalname: 'test.png',
      size: 100,
      path: '/tmp/postmill-uploads/test123.png',
    } as any;

    const fs = await import('fs');
    const unlinkSpy = vi.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);

    await expect(controller.uploadServer(org, file, {})).rejects.toThrow('Upload failed');
    expect(unlinkSpy).toHaveBeenCalledWith('/tmp/postmill-uploads/test123.png');

    unlinkSpy.mockRestore();
  });

  it('unlinks temp file when saveFile throws', async () => {
    storageSvcMock.assertWithinProviderQuota.mockResolvedValue(undefined);
    storageMock.uploadFile.mockResolvedValue({
      originalname: 'abc123.png',
      path: 'http://localhost/uploads/abc123.png',
    });
    fileSvcMock.saveFile.mockRejectedValue(new Error('Save failed'));

    const controller = makeController();
    const file = {
      originalname: 'test.png',
      size: 100,
      path: '/tmp/postmill-uploads/test123.png',
    } as any;

    const fs = await import('fs');
    const unlinkSpy = vi.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);

    await expect(controller.uploadServer(org, file, {})).rejects.toThrow('Save failed');
    expect(unlinkSpy).toHaveBeenCalledWith('/tmp/postmill-uploads/test123.png');
    // M4: the stored object is best-effort deleted so failed uploads don't leak orphans.
    expect(storageMock.removeFile).toHaveBeenCalledWith('http://localhost/uploads/abc123.png');

    unlinkSpy.mockRestore();
  });

  it('does not call unlink when file has no path', async () => {
    storageSvcMock.assertWithinProviderQuota.mockResolvedValue(undefined);
    storageMock.uploadFile.mockResolvedValue({
      originalname: 'abc123.png',
      path: 'http://localhost/uploads/abc123.png',
    });
    fileSvcMock.saveFile.mockResolvedValue({ id: 'file-1' });

    const controller = makeController();
    const file = {
      originalname: 'test.png',
      size: 100,
    } as any;

    const fs = await import('fs');
    const unlinkSpy = vi.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);

    await controller.uploadServer(org, file, {});

    expect(unlinkSpy).not.toHaveBeenCalled();

    unlinkSpy.mockRestore();
  });
});

describe('FilesController — upload validation errors map to 400', () => {
  it('uploadServer maps UploadValidationError to BadRequestException and still unlinks the temp file', async () => {
    storageSvcMock.assertWithinProviderQuota.mockResolvedValue(undefined);
    storageMock.uploadFile.mockRejectedValue(new UploadValidationError('Unsupported file type.'));

    const controller = makeController();
    const file = {
      originalname: 'notes.exe',
      size: 100,
      path: '/tmp/postmill-uploads/test123.png',
    } as any;

    const fs = await import('fs');
    const unlinkSpy = vi.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);

    await expect(controller.uploadServer(org, file, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(unlinkSpy).toHaveBeenCalledWith('/tmp/postmill-uploads/test123.png');

    unlinkSpy.mockRestore();
  });

  it('uploadServer passes non-validation upload errors through untouched', async () => {
    storageSvcMock.assertWithinProviderQuota.mockResolvedValue(undefined);
    storageMock.uploadFile.mockRejectedValue(new Error('disk full'));

    const controller = makeController();
    const file = { originalname: 'test.png', size: 100 } as any;

    await expect(controller.uploadServer(org, file, {})).rejects.toThrow('disk full');
    await expect(controller.uploadServer(org, file, {})).rejects.not.toBeInstanceOf(BadRequestException);
  });

  it('uploadSimple maps UploadValidationError to BadRequestException', async () => {
    storageSvcMock.assertWithinProviderQuota.mockResolvedValue(undefined);
    storageMock.uploadFile.mockRejectedValue(new UploadValidationError('Unsupported file type.'));

    const controller = makeController();
    const file = { originalname: 'notes.txt', size: 100 } as any;

    await expect(controller.uploadSimple(org, file, {} as any)).rejects.toBeInstanceOf(BadRequestException);
  });
});
