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

  it('selects metadata when resolving one file by path', async () => {
    const { repo, model } = makeRepo();

    await repo.getFileByPath('org-1', '/uploads/clip.mp4');

    expect(model.file.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ metadata: true }),
    }));
  });
});

describe('FileRepository — deleteFolder', () => {
  it('deletes the row — the FKs unfile its contents', async () => {
    // Both FKs (files.folderId, folders.parentId) are ON DELETE SET NULL:
    // deleting the row unfiles files and re-parents children to root. The
    // emptiness guard lives in the service.
    const { repo, model } = makeRepo();
    model.fileFolder.findUnique.mockResolvedValue({ id: 'f1' });
    model.fileFolder.delete.mockResolvedValue({ id: 'f1' });

    const result = await repo.deleteFolder('org-1', 'f1');

    expect(result).toEqual({ id: 'f1' });
    expect(model.fileFolder.delete).toHaveBeenCalledWith({
      where: { id: 'f1', organizationId: 'org-1' },
    });
  });

  it('returns null for a missing folder', async () => {
    const { repo, model } = makeRepo();
    model.fileFolder.findUnique.mockResolvedValue(null);

    expect(await repo.deleteFolder('org-1', 'nope')).toBeNull();
    expect(model.fileFolder.delete).not.toHaveBeenCalled();
  });

  it('countFolderActiveContents counts live files and child folders', async () => {
    const { repo, model } = makeRepo();
    model.file.count.mockResolvedValue(2);
    model.fileFolder.count.mockResolvedValue(1);

    const result = await repo.countFolderActiveContents('org-1', 'f1');

    expect(result).toEqual({ files: 2, children: 1 });
    // Soft-deleted files are excluded: a folder holding only trashed files
    // counts as empty.
    expect(model.file.count).toHaveBeenCalledWith({
      where: { folderId: 'f1', organizationId: 'org-1', deletedAt: null },
    });
    expect(model.fileFolder.count).toHaveBeenCalledWith({
      where: { parentId: 'f1', organizationId: 'org-1' },
    });
  });
});

describe('FileRepository — type filter', () => {
  const findManyArgs = (model: ReturnType<typeof makeModel>) =>
    model.file.findMany.mock.calls[0][0] as any;

  // The AI Designer intermediate exclusion rides the same AND array, first —
  // and the design-preview (internal) exclusion always follows it.
  const AI_DESIGNER_EXCLUSION = {
    NOT: { metadata: { path: ['aiDesigner'], not: expect.anything() } },
  };
  const INTERNAL_EXCLUSION = {
    NOT: { metadata: { path: ['internal'], not: expect.anything() } },
  };

  it('matches both the bare category and the MIME form', async () => {
    // AI Designer output is stored as 'image/png'; an exact match on 'image'
    // hid every one of those files from the library's Images filter.
    const { repo, model } = makeRepo();
    model.file.count.mockResolvedValue(0);
    model.file.findMany.mockResolvedValue([]);

    await repo.getFiles('org-1', 1, undefined, undefined, 'image');

    expect(findManyArgs(model).where.AND).toEqual([
      AI_DESIGNER_EXCLUSION,
      INTERNAL_EXCLUSION,
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
      AI_DESIGNER_EXCLUSION,
      INTERNAL_EXCLUSION,
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
      AI_DESIGNER_EXCLUSION,
      INTERNAL_EXCLUSION,
      { OR: [{ type: 'video' }, { type: { startsWith: 'video/' } }] },
    ]);
  });

  it('matches an unknown type exactly', async () => {
    const { repo, model } = makeRepo();
    model.file.count.mockResolvedValue(0);
    model.file.findMany.mockResolvedValue([]);

    await repo.getFiles('org-1', 1, undefined, undefined, 'other');

    expect(findManyArgs(model).where.AND).toEqual([
      AI_DESIGNER_EXCLUSION,
      INTERNAL_EXCLUSION,
      { type: 'other' },
    ]);
  });
});

describe('FileRepository — AI Designer intermediate visibility', () => {
  const findManyArgs = (model: ReturnType<typeof makeModel>) =>
    model.file.findMany.mock.calls[0][0] as any;

  it('hides metadata-stamped intermediates by default, even without a type filter', async () => {
    const { repo, model } = makeRepo();
    model.file.count.mockResolvedValue(0);
    model.file.findMany.mockResolvedValue([]);

    await repo.getFiles('org-1', 1);

    const { where } = findManyArgs(model);
    expect(where.AND).toEqual([
      {
        NOT: {
          metadata: { path: ['aiDesigner'], not: expect.anything() },
        },
      },
      {
        NOT: {
          metadata: { path: ['internal'], not: expect.anything() },
        },
      },
    ]);
  });

  it('returns stamped files when the caller explicitly opts in — but never internal previews', async () => {
    const { repo, model } = makeRepo();
    model.file.count.mockResolvedValue(0);
    model.file.findMany.mockResolvedValue([]);

    await repo.getFiles(
      'org-1', 1, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, true
    );

    // The aiDesigner exclusion lifts on opt-in; the design-preview (internal)
    // exclusion always applies.
    expect(findManyArgs(model).where.AND).toEqual([
      {
        NOT: {
          metadata: { path: ['internal'], not: expect.anything() },
        },
      },
    ]);
  });
});

describe('FileRepository — AI Designer session purge queries', () => {
  it('findAiDesignerSessionAssetFiles matches the asset stamp + session id', async () => {
    const { repo, model } = makeRepo();
    model.file.findMany.mockResolvedValue([{ id: 'file-1' }]);

    const rows = await repo.findAiDesignerSessionAssetFiles('org-1', 'sess-1');

    expect(rows).toEqual([{ id: 'file-1' }]);
    expect(model.file.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        deletedAt: null,
        AND: [
          { metadata: { path: ['aiDesigner'], equals: 'asset' } },
          { metadata: { path: ['sessionId'], equals: 'sess-1' } },
        ],
      },
      select: { id: true },
    });
  });

  it('findAiDesignerReferenceFiles only matches stamped reference rows among the ids', async () => {
    const { repo, model } = makeRepo();
    model.file.findMany.mockResolvedValue([]);

    await repo.findAiDesignerReferenceFiles('org-1', ['a', 'b']);

    expect(model.file.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        deletedAt: null,
        id: { in: ['a', 'b'] },
        metadata: { path: ['aiDesigner'], equals: 'reference' },
      },
      select: { id: true },
    });
  });

  it('findAiDesignerReferenceFiles short-circuits on an empty id list', async () => {
    const { repo, model } = makeRepo();

    const rows = await repo.findAiDesignerReferenceFiles('org-1', []);

    expect(rows).toEqual([]);
    expect(model.file.findMany).not.toHaveBeenCalled();
  });

  it('softDeleteMany updateMany-marks live rows and returns the count', async () => {
    const { repo, model } = makeRepo();
    model.file.updateMany.mockResolvedValue({ count: 2 });

    const count = await repo.softDeleteMany('org-1', ['a', 'b']);

    expect(count).toBe(2);
    expect(model.file.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] }, organizationId: 'org-1', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('softDeleteMany skips the query on an empty id list', async () => {
    const { repo, model } = makeRepo();

    const count = await repo.softDeleteMany('org-1', []);

    expect(count).toBe(0);
    expect(model.file.updateMany).not.toHaveBeenCalled();
  });
});

describe('FileRepository — design metadata backfill', () => {
  it('selects a bounded org-scoped batch of active design files missing metadata', async () => {
    const { repo, model } = makeRepo();
    model.file.findMany.mockResolvedValue([]);

    await repo.findDesignFilesForMetadataBackfill('org-1', 25, 'file-1');

    expect(model.file.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: 'org-1', deletedAt: null }),
      take: 25,
      cursor: { id: 'file-1' },
      skip: 1,
      orderBy: { id: 'asc' },
    }));
  });

  it('updates metadata only for an active row in the same org', async () => {
    const { repo, model } = makeRepo();
    model.file.updateMany.mockResolvedValue({ count: 1 });

    await repo.updateFileMetadata('org-1', 'file-1', { kind: 'design', mode: 'image' });

    expect(model.file.updateMany).toHaveBeenCalledWith({
      where: { id: 'file-1', organizationId: 'org-1', deletedAt: null },
      data: { metadata: { kind: 'design', mode: 'image' } },
    });
  });

  it('changes type and merged metadata in one org-scoped operation', async () => {
    const { repo, model } = makeRepo();
    model.file.updateMany.mockResolvedValue({ count: 1 });
    const metadata = { provider: 'reel-farm', mime: 'image/jpeg', mimeType: 'image/jpeg' };

    await repo.reclassifyFile('org-1', 'file-1', 'image', metadata);

    expect(model.file.updateMany).toHaveBeenCalledWith({
      where: { id: 'file-1', organizationId: 'org-1', deletedAt: null },
      data: { type: 'image', metadata },
    });
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
