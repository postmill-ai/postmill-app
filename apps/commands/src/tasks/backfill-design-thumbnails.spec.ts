import { describe, it, expect, vi } from 'vitest';
import { BackfillDesignThumbnails } from './backfill-design-thumbnails';

const VALID_DOC = {
  mode: 'image',
  outputs: [{ id: 'out-1', width: 1080, height: 1080, children: [] }],
};

function createMocks() {
  const store: Record<string, any[]> = {
    design: [
      // Already has a file preview — must not be touched.
      { id: 'd-skip-file', organizationId: 'org-1', name: 'A', doc: VALID_DOC, deletedAt: null, previewFileId: 'file-x', previewDataUrl: null },
      // Already has a data-URL preview — must not be touched.
      { id: 'd-skip-data', organizationId: 'org-1', name: 'B', doc: VALID_DOC, deletedAt: null, previewFileId: null, previewDataUrl: 'data:image/jpeg;base64,bbb' },
      // Soft-deleted — must not be touched.
      { id: 'd-deleted', organizationId: 'org-1', name: 'C', doc: VALID_DOC, deletedAt: new Date(), previewFileId: null, previewDataUrl: null },
      // Missing both previews — the only row to backfill.
      { id: 'd-fill', organizationId: 'org-1', name: 'D', doc: VALID_DOC, deletedAt: null, previewFileId: null, previewDataUrl: null },
    ],
    designTemplate: [
      // System template — can never own a File, must be skipped.
      { id: 't-system', organizationId: null, name: 'Sys', doc: VALID_DOC, deletedAt: null, isSystem: true, thumbnailFileId: null },
      // Already has a thumbnail — must not be touched.
      { id: 't-skip', organizationId: 'org-1', name: 'T1', doc: VALID_DOC, deletedAt: null, isSystem: false, thumbnailFileId: 'file-y' },
      // Org template without a thumbnail — the only row to backfill.
      { id: 't-fill', organizationId: 'org-1', name: 'T2', doc: VALID_DOC, deletedAt: null, isSystem: false, thumbnailFileId: null },
    ],
  };

  const matches = (row: any, where: any) =>
    Object.entries(where).every(([key, value]) => row[key] === value);

  const modelProxy = (modelName: string) => ({
    findMany: ({ where, select }: { where: any; select?: any }) =>
      Promise.resolve(
        (store[modelName] || [])
          .filter((row) => matches(row, where))
          .map((row) => {
            if (!select) return row;
            const selected: any = {};
            for (const key of Object.keys(select)) selected[key] = row[key];
            return selected;
          })
      ),
    update: ({ where, data }: { where: { id: string }; data: any }) => {
      const row = (store[modelName] || []).find((r) => r.id === where.id);
      if (row) Object.assign(row, data);
      return Promise.resolve(row);
    },
  });

  const prisma = {
    design: modelProxy('design'),
    designTemplate: modelProxy('designTemplate'),
  };

  const designRenderService = {
    renderPage: vi.fn().mockResolvedValue(Buffer.from('png-bytes')),
  };
  const storageService = {
    resolveAdapterForFolderWithConfigId: vi.fn().mockResolvedValue({
      adapter: { writeBuffer: vi.fn().mockResolvedValue('http://localhost/uploads/thumb.png') },
      configId: null,
    }),
  };
  const fileService = {
    saveFile: vi.fn().mockImplementation((_org: string, name: string) =>
      Promise.resolve({ id: `file-for-${name}`, path: 'http://localhost/uploads/thumb.png' })
    ),
  };

  return { prisma, store, designRenderService, storageService, fileService };
}

describe('BackfillDesignThumbnails', () => {
  it('only processes rows with no preview at all', async () => {
    const { prisma, store, designRenderService, storageService, fileService } = createMocks();
    const command = new BackfillDesignThumbnails(
      prisma as any,
      designRenderService as any,
      fileService as any,
      storageService as any
    );

    await command.run();

    const designs = Object.fromEntries(store.design.map((d) => [d.id, d]));
    expect(designs['d-fill'].previewFileId).toBe('file-for-design-d-fill-thumbnail.png');
    expect(designs['d-skip-file'].previewFileId).toBe('file-x');
    expect(designs['d-skip-data'].previewFileId).toBeNull();
    expect(designs['d-deleted'].previewFileId).toBeNull();

    const templates = Object.fromEntries(store.designTemplate.map((t) => [t.id, t]));
    expect(templates['t-fill'].thumbnailFileId).toBe('file-for-design-template-t-fill-thumbnail.png');
    expect(templates['t-skip'].thumbnailFileId).toBe('file-y');
    // System templates are never rendered or updated.
    expect(templates['t-system'].thumbnailFileId).toBeNull();

    // Two renders only: d-fill and t-fill.
    expect(designRenderService.renderPage).toHaveBeenCalledTimes(2);
  });

  it('skips a row whose render fails and continues with the rest', async () => {
    const { prisma, store, designRenderService, storageService, fileService } = createMocks();
    // Fail only the design render (first call), succeed for the template.
    designRenderService.renderPage
      .mockRejectedValueOnce(new Error('canvas exploded'))
      .mockResolvedValue(Buffer.from('png'));

    const command = new BackfillDesignThumbnails(
      prisma as any,
      designRenderService as any,
      fileService as any,
      storageService as any
    );

    await command.run();

    const designs = Object.fromEntries(store.design.map((d) => [d.id, d]));
    expect(designs['d-fill'].previewFileId).toBeNull();
    const templates = Object.fromEntries(store.designTemplate.map((t) => [t.id, t]));
    expect(templates['t-fill'].thumbnailFileId).toBe('file-for-design-template-t-fill-thumbnail.png');
  });

  it('limits the run to a single org when the positional arg is given', async () => {
    const { prisma, store, designRenderService, storageService, fileService } = createMocks();
    store.design.push({
      id: 'd-other-org', organizationId: 'org-2', name: 'E', doc: VALID_DOC, deletedAt: null, previewFileId: null, previewDataUrl: null,
    });

    const command = new BackfillDesignThumbnails(
      prisma as any,
      designRenderService as any,
      fileService as any,
      storageService as any
    );

    await command.run('org-2');

    const designs = Object.fromEntries(store.design.map((d) => [d.id, d]));
    expect(designs['d-other-org'].previewFileId).toBe('file-for-design-d-other-org-thumbnail.png');
    expect(designs['d-fill'].previewFileId).toBeNull();
  });
});
