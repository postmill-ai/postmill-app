import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
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

describe('FileService — deleteFolder', () => {
  it('404s on a missing folder', async () => {
    const { fileRepo, model } = makeRepo();
    model.fileFolder.findFirst.mockResolvedValue(null);

    const service = makeService(fileRepo);
    await expect(service.deleteFolder('org-1', 'nope')).rejects.toMatchObject({
      status: 404,
    });
    expect(model.fileFolder.delete).not.toHaveBeenCalled();
  });

  it('deletes an empty folder', async () => {
    const { fileRepo, model } = makeRepo();
    model.fileFolder.findFirst.mockResolvedValue({ id: 'f1' });
    model.file.count.mockResolvedValue(0);
    model.fileFolder.count.mockResolvedValue(0);
    model.fileFolder.findUnique.mockResolvedValue({ id: 'f1' });
    model.fileFolder.delete.mockResolvedValue({ id: 'f1' });

    const service = makeService(fileRepo);
    expect(await service.deleteFolder('org-1', 'f1')).toEqual({ id: 'f1' });
    expect(model.fileFolder.delete).toHaveBeenCalledWith({
      where: { id: 'f1', organizationId: 'org-1' },
    });
  });

  it('rejects a non-empty folder with a readable 400', async () => {
    const { fileRepo, model } = makeRepo();
    model.fileFolder.findFirst.mockResolvedValue({ id: 'f1' });
    model.file.count.mockResolvedValue(2);
    model.fileFolder.count.mockResolvedValue(0);

    const service = makeService(fileRepo);
    await expect(service.deleteFolder('org-1', 'f1')).rejects.toThrow(
      BadRequestException
    );
    expect(model.fileFolder.delete).not.toHaveBeenCalled();
  });

  it('treats a folder holding only trashed files as empty', async () => {
    const { fileRepo, model } = makeRepo();
    model.fileFolder.findFirst.mockResolvedValue({ id: 'f1' });
    // The count query filters deletedAt: null — only live files keep the
    // folder non-empty.
    model.file.count.mockResolvedValue(0);
    model.fileFolder.count.mockResolvedValue(0);
    model.fileFolder.findUnique.mockResolvedValue({ id: 'f1' });
    model.fileFolder.delete.mockResolvedValue({ id: 'f1' });

    const service = makeService(fileRepo);
    await service.deleteFolder('org-1', 'f1');

    expect(model.file.count).toHaveBeenCalledWith({
      where: { folderId: 'f1', organizationId: 'org-1', deletedAt: null },
    });
    expect(model.fileFolder.delete).toHaveBeenCalled();
  });

  it('with force skips the emptiness check — the FKs unfile files and re-parent children', async () => {
    const { fileRepo, model } = makeRepo();
    model.fileFolder.findFirst.mockResolvedValue({ id: 'f1' });
    model.fileFolder.findUnique.mockResolvedValue({ id: 'f1' });
    model.fileFolder.delete.mockResolvedValue({ id: 'f1' });

    const service = makeService(fileRepo);
    expect(await service.deleteFolder('org-1', 'f1', true)).toEqual({ id: 'f1' });
    // The emptiness check is skipped entirely in force mode.
    expect(model.file.count).not.toHaveBeenCalled();
    expect(model.fileFolder.count).not.toHaveBeenCalled();
    expect(model.fileFolder.delete).toHaveBeenCalledWith({
      where: { id: 'f1', organizationId: 'org-1' },
    });
  });
});

describe('FileService — cross-provider move', () => {
  // Storage mock whose folder resolution is driven by the test: folder ids map
  // to (adapter, configId) pairs so same- vs cross-provider moves are exercised.
  function makeMoveService(
    fileRepo: FileRepository,
    resolveImpl: (folderId: string | null) => { adapter: any; configId: string | null }
  ) {
    const storageService = {
      resolveAdapterForFolderWithConfigId: vi
        .fn()
        .mockImplementation((folderId: string | null) => Promise.resolve(resolveImpl(folderId))),
      assertWithinProviderQuota: vi.fn().mockResolvedValue(undefined),
    };
    return new FileService(fileRepo, storageService as any);
  }

  function makeMoveAdapters() {
    return {
      srcAdapter: {
        readFile: vi.fn().mockResolvedValue(Buffer.from('bytes')),
        writeBuffer: vi.fn(),
        removeFile: vi.fn().mockResolvedValue(undefined),
      },
      dstAdapter: {
        readFile: vi.fn(),
        writeBuffer: vi.fn().mockResolvedValue('new-path'),
        removeFile: vi.fn().mockResolvedValue(undefined),
      },
    };
  }

  it('same-provider move only updates the folder (no byte transfer)', async () => {
    const { fileRepo, model } = makeRepo();
    model.file.findUnique.mockResolvedValue({ id: 'f-1', folderId: 'src-folder', path: 'old-path' });
    model.fileFolder.findFirst.mockResolvedValue({ id: 'dst-folder' });
    model.file.update.mockResolvedValue({ id: 'f-1', folderId: 'dst-folder' });
    const { srcAdapter } = makeMoveAdapters();
    const service = makeMoveService(fileRepo, () => ({ adapter: srcAdapter, configId: 'cfg-1' }));

    await service.moveFile('org-1', 'f-1', 'dst-folder');

    expect(model.file.update).toHaveBeenCalledWith({
      where: { id: 'f-1', organizationId: 'org-1' },
      data: { folderId: 'dst-folder' },
    });
    expect(srcAdapter.readFile).not.toHaveBeenCalled();
    expect(srcAdapter.writeBuffer).not.toHaveBeenCalled();
    expect(srcAdapter.removeFile).not.toHaveBeenCalled();
  });

  it('cross-provider move reads, writes, repoints the row, then removes the source', async () => {
    const { fileRepo, model } = makeRepo();
    model.file.findUnique.mockResolvedValue({ id: 'f-1', folderId: 'src-folder', path: 'old-path' });
    model.fileFolder.findFirst.mockResolvedValue({ id: 'dst-folder' });
    model.file.update.mockResolvedValue({ id: 'f-1', folderId: 'dst-folder', path: 'new-path' });
    const { srcAdapter, dstAdapter } = makeMoveAdapters();
    const service = makeMoveService(fileRepo, (folderId) =>
      folderId === 'src-folder'
        ? { adapter: srcAdapter, configId: 'src-cfg' }
        : { adapter: dstAdapter, configId: 'dst-cfg' }
    );

    const result = await service.moveFile('org-1', 'f-1', 'dst-folder');

    expect(srcAdapter.readFile).toHaveBeenCalledWith('old-path');
    // writeBuffer sniffs the mime itself — no contentType argument is passed.
    expect(dstAdapter.writeBuffer).toHaveBeenCalledWith(Buffer.from('bytes'));
    expect(model.file.update).toHaveBeenCalledWith({
      where: { id: 'f-1', organizationId: 'org-1' },
      data: { folderId: 'dst-folder', path: 'new-path' },
    });
    expect(srcAdapter.removeFile).toHaveBeenCalledWith('old-path');
    expect(srcAdapter.readFile.mock.invocationCallOrder[0]).toBeLessThan(
      dstAdapter.writeBuffer.mock.invocationCallOrder[0]
    );
    expect(dstAdapter.writeBuffer.mock.invocationCallOrder[0]).toBeLessThan(
      model.file.update.mock.invocationCallOrder[0]
    );
    expect(model.file.update.mock.invocationCallOrder[0]).toBeLessThan(
      srcAdapter.removeFile.mock.invocationCallOrder[0]
    );
    expect(result).toEqual(expect.objectContaining({ path: 'new-path' }));
  });

  it('write failure throws 502 and leaves the row untouched', async () => {
    const { fileRepo, model } = makeRepo();
    model.file.findUnique.mockResolvedValue({ id: 'f-1', folderId: 'src-folder', path: 'old-path' });
    model.fileFolder.findFirst.mockResolvedValue({ id: 'dst-folder' });
    const { srcAdapter, dstAdapter } = makeMoveAdapters();
    dstAdapter.writeBuffer.mockRejectedValue(new Error('bucket exploded'));
    const service = makeMoveService(fileRepo, (folderId) =>
      folderId === 'src-folder'
        ? { adapter: srcAdapter, configId: 'src-cfg' }
        : { adapter: dstAdapter, configId: 'dst-cfg' }
    );

    await expect(service.moveFile('org-1', 'f-1', 'dst-folder')).rejects.toMatchObject({
      status: 502,
    });
    expect(model.file.update).not.toHaveBeenCalled();
    expect(srcAdapter.removeFile).not.toHaveBeenCalled();
  });

  it('read failure throws 502 before any write or DB change', async () => {
    const { fileRepo, model } = makeRepo();
    model.file.findUnique.mockResolvedValue({ id: 'f-1', folderId: 'src-folder', path: 'old-path' });
    model.fileFolder.findFirst.mockResolvedValue({ id: 'dst-folder' });
    const { srcAdapter, dstAdapter } = makeMoveAdapters();
    srcAdapter.readFile.mockRejectedValue(new Error('object gone'));
    const service = makeMoveService(fileRepo, (folderId) =>
      folderId === 'src-folder'
        ? { adapter: srcAdapter, configId: 'src-cfg' }
        : { adapter: dstAdapter, configId: 'dst-cfg' }
    );

    await expect(service.moveFile('org-1', 'f-1', 'dst-folder')).rejects.toMatchObject({
      status: 502,
    });
    expect(dstAdapter.writeBuffer).not.toHaveBeenCalled();
    expect(model.file.update).not.toHaveBeenCalled();
  });

  it('destination quota rejection aborts the move before any write or DB change', async () => {
    const { fileRepo, model } = makeRepo();
    model.file.findUnique.mockResolvedValue({ id: 'f-1', folderId: 'src-folder', path: 'old-path' });
    model.fileFolder.findFirst.mockResolvedValue({ id: 'dst-folder' });
    const { srcAdapter, dstAdapter } = makeMoveAdapters();
    const quotaError = Object.assign(new Error('quota exceeded'), { status: 413 });
    const storageService = {
      resolveAdapterForFolderWithConfigId: vi
        .fn()
        .mockImplementation((folderId: string | null) =>
          Promise.resolve(
            folderId === 'src-folder'
              ? { adapter: srcAdapter, configId: 'src-cfg' }
              : { adapter: dstAdapter, configId: 'dst-cfg' }
          )
        ),
      assertWithinProviderQuota: vi.fn().mockRejectedValue(quotaError),
    };
    const service = new FileService(fileRepo, storageService as any);

    await expect(service.moveFile('org-1', 'f-1', 'dst-folder')).rejects.toBe(quotaError);
    expect(storageService.assertWithinProviderQuota).toHaveBeenCalledWith(
      dstAdapter,
      'org-1',
      Buffer.from('bytes').length,
      'dst-cfg'
    );
    expect(dstAdapter.writeBuffer).not.toHaveBeenCalled();
    expect(model.file.update).not.toHaveBeenCalled();
    expect(srcAdapter.removeFile).not.toHaveBeenCalled();
  });

  it('a failed source cleanup is warn-only — the move still succeeds', async () => {
    const { fileRepo, model } = makeRepo();
    model.file.findUnique.mockResolvedValue({ id: 'f-1', folderId: 'src-folder', path: 'old-path' });
    model.fileFolder.findFirst.mockResolvedValue({ id: 'dst-folder' });
    model.file.update.mockResolvedValue({ id: 'f-1', folderId: 'dst-folder', path: 'new-path' });
    const { srcAdapter, dstAdapter } = makeMoveAdapters();
    srcAdapter.removeFile.mockRejectedValue(new Error('delete denied'));
    const service = makeMoveService(fileRepo, (folderId) =>
      folderId === 'src-folder'
        ? { adapter: srcAdapter, configId: 'src-cfg' }
        : { adapter: dstAdapter, configId: 'dst-cfg' }
    );

    const result = await service.moveFile('org-1', 'f-1', 'dst-folder');

    expect(model.file.update).toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ path: 'new-path' }));
  });

  it('bulkMove: same-provider files batch-move with no byte transfer', async () => {
    const { fileRepo, model } = makeRepo();
    model.file.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve({
        a: { id: 'a', folderId: 'same-folder', path: 'p-a' },
        b: { id: 'b', folderId: 'same-folder', path: 'p-b' },
      }[where.id as string] ?? null)
    );
    model.fileFolder.findFirst.mockResolvedValue({ id: 'dst-folder' });
    model.file.updateMany.mockResolvedValue({ count: 2 });
    const { srcAdapter } = makeMoveAdapters();
    const service = makeMoveService(fileRepo, () => ({ adapter: srcAdapter, configId: 'cfg-1' }));

    const result = await service.bulkMove('org-1', ['a', 'b'], 'dst-folder');

    expect(result).toEqual({ count: 2 });
    expect(model.file.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] }, organizationId: 'org-1' },
      data: { folderId: 'dst-folder' },
    });
    expect(srcAdapter.readFile).not.toHaveBeenCalled();
    expect(srcAdapter.writeBuffer).not.toHaveBeenCalled();
  });

  it('bulkMove: partial failure moves what succeeds and keeps the { count } shape', async () => {
    const { fileRepo, model } = makeRepo();
    model.file.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve({
        a: { id: 'a', folderId: 'same-folder', path: 'p-a' },
        b: { id: 'b', folderId: 'src-folder', path: 'p-b' },
        c: { id: 'c', folderId: 'src-folder', path: 'p-c' },
      }[where.id as string] ?? null)
    );
    model.fileFolder.findFirst.mockResolvedValue({ id: 'dst-folder' });
    model.file.updateMany.mockResolvedValue({ count: 1 });
    model.file.update.mockResolvedValue({ id: 'b', folderId: 'dst-folder', path: 'new-path-b' });
    const { srcAdapter, dstAdapter } = makeMoveAdapters();
    dstAdapter.writeBuffer
      .mockReset()
      .mockResolvedValueOnce('new-path-b')
      .mockRejectedValueOnce(new Error('bucket exploded'));
    const service = makeMoveService(fileRepo, (folderId) =>
      folderId === 'src-folder'
        ? { adapter: srcAdapter, configId: 'src-cfg' }
        : { adapter: dstAdapter, configId: 'dst-cfg' }
    );

    const result = await service.bulkMove('org-1', ['a', 'b', 'c'], 'dst-folder');

    // a took the batched cheap path, b migrated, c failed and was skipped.
    expect(result).toEqual({ count: 2 });
    expect(model.file.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a'] }, organizationId: 'org-1' },
      data: { folderId: 'dst-folder' },
    });
    expect(model.file.update).toHaveBeenCalledTimes(1);
    expect(model.file.update).toHaveBeenCalledWith({
      where: { id: 'b', organizationId: 'org-1' },
      data: { folderId: 'dst-folder', path: 'new-path-b' },
    });
    expect(srcAdapter.removeFile).toHaveBeenCalledTimes(1);
    expect(srcAdapter.removeFile).toHaveBeenCalledWith('p-b');
    expect(srcAdapter.readFile).toHaveBeenCalledWith('p-b');
    expect(srcAdapter.readFile).toHaveBeenCalledWith('p-c');
  });
});
