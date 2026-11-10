import { describe, it, expect, vi } from 'vitest';
import { BackfillDesignThumbnails } from './backfill-design-thumbnails';

const VALID_DOC = {
  mode: 'image',
  outputs: [{ id: 'out-1', width: 1080, height: 1080, children: [] as unknown[] }],
};
const VIDEO_DOC = {
  mode: 'video',
  outputs: [{ id: 'out-v', width: 1080, height: 1920, durationMs: 10000, tracks: [] }],
};

function createMocks() {
  const store: Record<string, any[]> = {
    design: [
      { id: 'd-skip-file', organizationId: 'org-1', doc: VALID_DOC, deletedAt: null, previewFileId: 'file-x', previewDataUrl: null },
      { id: 'd-skip-data', organizationId: 'org-1', doc: VALID_DOC, deletedAt: null, previewFileId: null, previewDataUrl: 'data:image/jpeg;base64,bbb' },
      { id: 'd-deleted', organizationId: 'org-1', doc: VALID_DOC, deletedAt: new Date(), previewFileId: null, previewDataUrl: null },
      { id: 'd-fill', organizationId: 'org-1', doc: VIDEO_DOC, deletedAt: null, previewFileId: null, previewDataUrl: null },
      { id: 'd-export-source', organizationId: 'org-1', doc: VIDEO_DOC, deletedAt: null, previewFileId: 'source-preview', previewDataUrl: null },
      { id: 'd-other', organizationId: 'org-2', doc: VALID_DOC, deletedAt: null, previewFileId: null, previewDataUrl: null },
    ],
    designTemplate: [
      { id: 't-system', organizationId: null, doc: VALID_DOC, deletedAt: null, isSystem: true, thumbnailFileId: null },
      { id: 't-skip', organizationId: 'org-1', doc: VALID_DOC, deletedAt: null, isSystem: false, thumbnailFileId: 'file-y' },
      { id: 't-fill', organizationId: 'org-1', doc: VALID_DOC, deletedAt: null, isSystem: false, thumbnailFileId: null },
      { id: 't-no-org', organizationId: null, doc: VALID_DOC, deletedAt: null, isSystem: false, thumbnailFileId: null },
    ],
    file: [
      { id: 'x-skip', organizationId: 'org-1', folderId: null, type: 'document', deletedAt: null, thumbnail: '/already.png', metadata: { source: 'design-export', kind: 'design', designId: 'd-fill' } },
      { id: 'x-design', organizationId: 'org-1', folderId: 'folder-cloud', type: 'document', deletedAt: null, thumbnail: null, metadata: { source: 'design-export', kind: 'design', designId: 'd-export-source' } },
      { id: 'x-template', organizationId: 'org-1', folderId: null, type: 'document', deletedAt: null, thumbnail: null, metadata: { source: 'design-export', kind: 'template', templateId: 't-fill' } },
      { id: 'x-missing', organizationId: 'org-1', folderId: null, type: 'document', deletedAt: null, thumbnail: null, metadata: { source: 'design-export', kind: 'design', designId: 'd-deleted' } },
      { id: 'x-other', organizationId: 'org-2', folderId: null, type: 'document', deletedAt: null, thumbnail: null, metadata: { source: 'design-export', kind: 'design', designId: 'd-other' } },
    ],
  };

  const matches = (row: any, where: any) =>
    Object.entries(where).every(([key, value]: [string, any]) => {
      if (value && typeof value === 'object' && 'not' in value) return row[key] !== value.not;
      if (value && typeof value === 'object' && 'path' in value) {
        const actual = value.path.reduce((acc: any, part: string) => acc?.[part], row[key]);
        return actual === value.equals;
      }
      return row[key] === value;
    });

  const selected = (row: any, select?: any) => {
    if (!row || !select) return row;
    return Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));
  };

  const modelProxy = (modelName: string) => ({
    findMany: vi.fn(({ where, select, take, cursor }: any) =>
      Promise.resolve(
        store[modelName]
          .filter((row) => matches(row, where))
          .sort((a, b) => a.id.localeCompare(b.id))
          .filter((row) => !cursor || row.id > cursor.id)
          .slice(0, take)
          .map((row) => selected(row, select))
      )
    ),
    findFirst: vi.fn(({ where, select }: any) =>
      Promise.resolve(selected(store[modelName].find((row) => matches(row, where)) ?? null, select))
    ),
    update: vi.fn(({ where, data }: any) => {
      const row = store[modelName].find((candidate) => candidate.id === where.id);
      if (row) Object.assign(row, data);
      return Promise.resolve(row);
    }),
  });

  const prisma = {
    design: modelProxy('design'),
    designTemplate: modelProxy('designTemplate'),
    file: modelProxy('file'),
  };
  const designPreviewService = {
    renderPreviewBuffer: vi.fn().mockResolvedValue(Buffer.from('png-bytes')),
    uploadPreview: vi.fn()
      .mockResolvedValueOnce('preview-1')
      .mockResolvedValueOnce('preview-2')
      .mockResolvedValue('preview-next'),
  };
  const adapter = {
    writeBuffer: vi.fn().mockResolvedValue('/uploads/export-preview.png'),
    readFile: vi.fn().mockResolvedValue(Buffer.from('existing-preview-bytes')),
    removeFile: vi.fn().mockResolvedValue(undefined),
  };
  const storageService = {
    resolveAdapterForFolder: vi.fn().mockResolvedValue(adapter),
  };
  const fileService = {
    getFileById: vi.fn(async () => ({
      id: 'source-preview', folderId: 'source-folder', path: '/uploads/source-preview.png',
    })),
    saveMediaInformation: vi.fn((orgId: string, data: any) => {
      const row = store.file.find((file) => file.id === data.id && file.organizationId === orgId);
      if (row) row.thumbnail = data.thumbnail;
      return Promise.resolve(row);
    }),
    deleteFile: vi.fn().mockResolvedValue(undefined),
  };

  return { prisma, store, designPreviewService, storageService, fileService, adapter };
}

const makeCommand = (mocks: ReturnType<typeof createMocks>) =>
  new BackfillDesignThumbnails(
    mocks.prisma as any,
    mocks.designPreviewService as any,
    mocks.fileService as any,
    mocks.storageService as any
  );

describe('BackfillDesignThumbnails', () => {
  it('uses the shared preview renderer for designs, templates and existing exports', async () => {
    const mocks = createMocks();
    const stats = await makeCommand(mocks).run('org-1');

    expect(stats).toEqual({ processed: 5, updated: 4, skipped: 1, dryRun: false });
    expect(mocks.store.design.find((row) => row.id === 'd-fill').previewFileId).toBe('preview-1');
    expect(mocks.store.designTemplate.find((row) => row.id === 't-fill').thumbnailFileId).toBe('preview-2');
    expect(mocks.store.file.find((row) => row.id === 'x-design').thumbnail).toBe('/uploads/export-preview.png');
    expect(mocks.store.file.find((row) => row.id === 'x-template').thumbnail).toBe('/uploads/export-preview.png');
    expect(mocks.store.file.find((row) => row.id === 'x-skip').thumbnail).toBe('/already.png');
    expect(mocks.store.file).toHaveLength(5);
    expect(mocks.designPreviewService.renderPreviewBuffer).toHaveBeenCalledTimes(2);
    expect(mocks.designPreviewService.renderPreviewBuffer).toHaveBeenCalledWith(VIDEO_DOC, { orgId: 'org-1' });
    expect(mocks.designPreviewService.uploadPreview).toHaveBeenCalledTimes(2);
    expect(mocks.adapter.readFile).toHaveBeenCalledWith('/uploads/source-preview.png');
    expect(mocks.storageService.resolveAdapterForFolder).toHaveBeenCalledWith('source-folder', 'org-1');
    expect(mocks.storageService.resolveAdapterForFolder).toHaveBeenCalledWith('folder-cloud', 'org-1');
    expect(mocks.fileService.saveMediaInformation).toHaveBeenCalledTimes(2);
  });

  it('counts all candidates in dry-run mode without rendering or writing', async () => {
    const mocks = createMocks();
    const stats = await makeCommand(mocks).run('dry-run');

    expect(stats).toEqual({ processed: 7, updated: 0, skipped: 1, dryRun: true });
    expect(mocks.designPreviewService.renderPreviewBuffer).not.toHaveBeenCalled();
    expect(mocks.designPreviewService.uploadPreview).not.toHaveBeenCalled();
    expect(mocks.adapter.writeBuffer).not.toHaveBeenCalled();
    expect(mocks.prisma.design.update).not.toHaveBeenCalled();
    expect(mocks.prisma.designTemplate.update).not.toHaveBeenCalled();
    expect(mocks.fileService.saveMediaInformation).not.toHaveBeenCalled();
  });

  it('applies org scoping to all three candidate types', async () => {
    const mocks = createMocks();
    const stats = await makeCommand(mocks).run('org-2');

    expect(stats).toEqual({ processed: 2, updated: 2, skipped: 0, dryRun: false });
    expect(mocks.store.design.find((row) => row.id === 'd-other').previewFileId).toBe('preview-1');
    expect(mocks.store.file.find((row) => row.id === 'x-other').thumbnail).toBe('/uploads/export-preview.png');
    expect(mocks.store.design.find((row) => row.id === 'd-fill').previewFileId).toBeNull();
    expect(mocks.store.file.find((row) => row.id === 'x-design').thumbnail).toBeNull();
  });

  it('continues after a render failure', async () => {
    const mocks = createMocks();
    mocks.designPreviewService.renderPreviewBuffer.mockRejectedValueOnce(new Error('canvas exploded'));

    const stats = await makeCommand(mocks).run('org-1');

    expect(stats).toEqual({ processed: 5, updated: 3, skipped: 2, dryRun: false });
    expect(mocks.store.design.find((row) => row.id === 'd-fill').previewFileId).toBeNull();
    expect(mocks.store.designTemplate.find((row) => row.id === 't-fill').thumbnailFileId).toBe('preview-1');
    expect(mocks.store.file.find((row) => row.id === 'x-design').thumbnail).toBe('/uploads/export-preview.png');
  });

  it('removes an unlinked preview when the design update fails', async () => {
    const mocks = createMocks();
    mocks.prisma.design.update.mockRejectedValueOnce(new Error('db down'));

    const stats = await makeCommand(mocks).run('org-1');

    expect(stats.updated).toBe(3);
    expect(mocks.fileService.deleteFile).toHaveBeenCalledWith('org-1', 'preview-1');
  });

  it('removes an export thumbnail object when its File update fails', async () => {
    const mocks = createMocks();
    mocks.fileService.saveMediaInformation.mockRejectedValueOnce(new Error('db down'));

    const stats = await makeCommand(mocks).run('org-1');

    expect(stats.updated).toBe(3);
    expect(mocks.adapter.removeFile).toHaveBeenCalledWith('/uploads/export-preview.png');
  });

  it('rejects an unknown mode', async () => {
    const mocks = createMocks();
    await expect(makeCommand(mocks).run('org-1', 'apply')).rejects.toThrow("Mode must be 'dry-run'");
  });
});
