import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  return {
    repo: new FileRepository({ model } as any, { model } as any),
    model,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FileRepository — metadata storage', () => {
  it('stores metadata as a JSON object, not a string', async () => {
    const { repo, model } = makeRepo();
    model.file.create.mockResolvedValue({ id: 'file-1' });

    await repo.saveFile(
      'org-1',
      'file.png',
      'https://cdn.example.com/file.png',
      'file.png',
      undefined,
      1000,
    );

    const data = model.file.create.mock.calls[0][0].data;
    expect(typeof data.metadata).toBe('object');
    expect(data.metadata).toEqual(expect.objectContaining({ fileSize: 1000 }));
    expect(typeof data.metadata).not.toBe('string');
  });

  it('stores generated-media metadata as a JSON object', async () => {
    const { repo, model } = makeRepo();
    model.file.create.mockResolvedValue({ id: 'file-2' });

    await repo.saveGeneratedMedia('org-1', {
      name: 'generated.png',
      path: 'https://cdn.example.com/generated.png',
      type: 'image',
      fileSize: 2000,
      metadata: { source: 'test', attribution: { author: 'me' } },
    });

    const data = model.file.create.mock.calls[0][0].data;
    expect(typeof data.metadata).toBe('object');
    expect(data.metadata).toEqual({ source: 'test', attribution: { author: 'me' } });
  });
});

describe('FileRepository — deleteFolder soft-delete handling', () => {
  it('succeeds when the folder contains only trashed files', async () => {
    const { repo, model } = makeRepo();
    model.fileFolder.findUnique.mockResolvedValue({
      id: 'folder-1',
      name: 'Trashable',
      _count: { children: 0 },
    });
    model.file.count.mockResolvedValue(0);
    model.fileFolder.delete.mockResolvedValue({ id: 'folder-1' });

    const result = await repo.deleteFolder('org-1', 'folder-1');

    expect(result).toEqual({ id: 'folder-1' });
    expect(model.file.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          folderId: 'folder-1',
          organizationId: 'org-1',
          deletedAt: null,
        }),
      }),
    );
    expect(model.fileFolder.delete).toHaveBeenCalledWith({
      where: { id: 'folder-1', organizationId: 'org-1' },
    });
  });

  it('still throws when active (non-trashed) files remain', async () => {
    const { repo, model } = makeRepo();
    model.fileFolder.findUnique.mockResolvedValue({
      id: 'folder-2',
      name: 'Busy',
      _count: { children: 0 },
    });
    model.file.count.mockResolvedValue(3);

    await expect(repo.deleteFolder('org-1', 'folder-2')).rejects.toThrow('Folder is not empty');
    expect(model.fileFolder.delete).not.toHaveBeenCalled();
  });
});

describe('FileRepository — type filter', () => {
  const findManyArgs = (model: ReturnType<typeof makeModel>) =>
    model.file.findMany.mock.calls[0][0] as any;

  it('matches both the bare category and the MIME form', async () => {
    // AI Designer output is stored as 'image/png'; an exact match on 'image'
    // hid every one of those files from the library's Images filter.
    const { repo, model } = makeRepo();
    model.file.count.mockResolvedValue(0);
    model.file.findMany.mockResolvedValue([]);

    await repo.getFiles('org-1', 1, undefined, undefined, 'image');

    expect(findManyArgs(model).where.AND).toEqual([
      { OR: [{ type: 'image' }, { type: { startsWith: 'image/' } }] },
    ]);
    expect(findManyArgs(model).where.type).toBeUndefined();
  });

  it('treats documents as application/* and text/* too', async () => {
    const { repo, model } = makeRepo();
    model.file.count.mockResolvedValue(0);
    model.file.findMany.mockResolvedValue([]);

    await repo.getFiles('org-1', 1, undefined, undefined, 'document');

    expect(findManyArgs(model).where.AND).toEqual([
      {
        OR: [
          { type: 'document' },
          { type: { startsWith: 'application/' } },
          { type: { startsWith: 'text/' } },
        ],
      },
    ]);
  });

  it('leaves the search OR intact when both are used', async () => {
    // `where.OR` carries the search clause — the type filter must not take it.
    const { repo, model } = makeRepo();
    model.file.count.mockResolvedValue(0);
    model.file.findMany.mockResolvedValue([]);

    await repo.getFiles('org-1', 1, 'alpha', undefined, 'video');

    const { where } = findManyArgs(model);
    expect(where.OR).toEqual([
      { originalName: { contains: 'alpha', mode: 'insensitive' } },
      { name: { contains: 'alpha', mode: 'insensitive' } },
    ]);
    expect(where.AND).toEqual([
      { OR: [{ type: 'video' }, { type: { startsWith: 'video/' } }] },
    ]);
  });

  it('matches an unknown type exactly', async () => {
    const { repo, model } = makeRepo();
    model.file.count.mockResolvedValue(0);
    model.file.findMany.mockResolvedValue([]);

    await repo.getFiles('org-1', 1, undefined, undefined, 'other');

    expect(findManyArgs(model).where.AND).toEqual([{ type: 'other' }]);
  });
});

describe('FileRepository — generated media type', () => {
  it('stores the bare category when a caller passes a MIME type', async () => {
    const { repo, model } = makeRepo();
    model.file.create.mockResolvedValue({ id: 'file-1' });

    await repo.saveGeneratedMedia('org-1', {
      name: 'poster.png',
      path: '/uploads/poster.png',
      type: 'image/png',
    });

    expect(model.file.create.mock.calls[0][0].data.type).toBe('image');
  });

  it('leaves an already-bare category alone', async () => {
    const { repo, model } = makeRepo();
    model.file.create.mockResolvedValue({ id: 'file-2' });

    await repo.saveGeneratedMedia('org-1', {
      name: 'clip.mp4',
      path: '/uploads/clip.mp4',
      type: 'video',
    });

    expect(model.file.create.mock.calls[0][0].data.type).toBe('video');
  });
});
