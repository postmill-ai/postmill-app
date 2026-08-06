import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiDesignerSaverService } from './ai-designer-saver.service';

const makeDoc = () =>
  ({
    mode: 'image',
    outputs: [
      {
        id: 'o1',
        formatId: 'ig-post',
        name: 'IG',
        width: 1080,
        height: 1080,
        background: '#ffffff',
        children: [],
      },
    ],
  } as any);

describe('AiDesignerSaverService file naming', () => {
  let renderService: {
    renderAllPages: ReturnType<typeof vi.fn>;
    renderContactSheet: ReturnType<typeof vi.fn>;
    auditTextContrast: ReturnType<typeof vi.fn>;
    docHasTextOverImagery: ReturnType<typeof vi.fn>;
  };
  let adapter: {
    writeBuffer: ReturnType<typeof vi.fn>;
    removeFile: ReturnType<typeof vi.fn>;
  };
  let storageService: { getLocalAdapterForOrg: ReturnType<typeof vi.fn> };
  let fileService: { saveGeneratedMedia: ReturnType<typeof vi.fn> };
  let designService: {
    createDesign: ReturnType<typeof vi.fn>;
    updateDesign: ReturnType<typeof vi.fn>;
  };
  let service: AiDesignerSaverService;

  const savedNames = () =>
    fileService.saveGeneratedMedia.mock.calls.map(([, data]) => data.name);

  beforeEach(() => {
    renderService = {
      renderAllPages: vi.fn(async () => [Buffer.from('page')]),
      renderContactSheet: vi.fn(async () => Buffer.from('sheet')),
      auditTextContrast: vi.fn(async () => []),
      docHasTextOverImagery: vi.fn(() => false),
    };
    adapter = {
      writeBuffer: vi.fn(async () => '/uploads/render.png'),
      removeFile: vi.fn(async () => undefined),
    };
    storageService = {
      getLocalAdapterForOrg: vi.fn(async () => adapter),
    };
    fileService = {
      saveGeneratedMedia: vi.fn(async (_org: string, data: { path: string }) => ({
        id: 'file-1',
        path: data.path,
      })),
    };
    designService = {
      createDesign: vi.fn(async () => ({ id: 'design-1' })),
      updateDesign: vi.fn(async () => undefined),
    };
    service = new AiDesignerSaverService(
      renderService as any,
      storageService as any,
      fileService as any,
      designService as any
    );
  });

  it('uses the caller-supplied name as the full base (variantId is not re-appended)', async () => {
    // The initial-pipeline shape: the name already embeds the variantId.
    await service.saveDesign('org1', 'user1', 'v1', makeDoc(), {
      name: 'announcement-v1',
    });

    // Old behavior doubled the id: `announcement-v1-v1-ig-post.png`.
    expect(savedNames()).toEqual(['announcement-v1-ig-post.png']);
  });

  it('keeps critic auto-fix re-renders on a single clean `-revised` base', async () => {
    // The conductor re-renders the SAME design with `<base>-revised` — the
    // saver must not append the `…-revised` variantId a second time.
    await service.updateDesign('org1', 'design-1', 'v1-revised', makeDoc(), {
      name: 'announcement-v1-revised',
    });

    // Old behavior compounded: `announcement-v1-revised-v1-revised-ig-post.png`.
    expect(savedNames()).toEqual(['announcement-v1-revised-ig-post.png']);
    for (const name of savedNames()) {
      expect(name).not.toMatch(/revised.*revised/);
    }
  });

  it('gives a chat revision one clean `ai-design-revised-<ts>` base (no revised-revised)', async () => {
    await service.saveDesign('org1', 'user1', 'revised-1785423665631', makeDoc(), {
      name: 'ai-design-revised-1785423665631',
    });

    // Old behavior nested the marker: `ai-design-revised-revised-<ts>-…`.
    expect(savedNames()).toEqual([
      'ai-design-revised-1785423665631-ig-post.png',
    ]);
    for (const name of savedNames()) {
      expect(name).not.toContain('revised-revised');
    }
  });

  it('falls back to the `ai-design` base when no name is supplied', async () => {
    await service.saveDesign('org1', 'user1', 'v1', makeDoc());

    expect(savedNames()).toEqual(['ai-design-ig-post.png']);
  });

  it('keeps the contact sheet in memory — a data URI for the critic, never storage and never a File row', async () => {
    const result = await service.saveDesign('org1', 'user1', 'v1', makeDoc(), {
      name: 'announcement-v1',
    });

    // The critic still gets an image it can inline…
    expect(result.contactSheetUrl).toMatch(/^data:image\/png;base64,/);
    // …but the sheet is not written to storage at all (the only writeBuffer
    // call is the one page) and no File row names it.
    expect(adapter.writeBuffer).toHaveBeenCalledTimes(1);
    expect(fileService.saveGeneratedMedia).toHaveBeenCalledTimes(1);
    expect(savedNames().some((name) => name.includes('contact-sheet'))).toBe(
      false
    );
    expect(result).not.toHaveProperty('contactSheetFileId');
  });

  it('skips the backdrop render when no text can sit over imagery', async () => {
    await service.saveDesign('org1', 'user1', 'v1', makeDoc(), {
      name: 'announcement-v1',
    });

    // One composite render only — the hideText pass would be a second call.
    expect(renderService.renderAllPages).toHaveBeenCalledTimes(1);
    expect(renderService.auditTextContrast).not.toHaveBeenCalled();
  });

  it('renders the backdrop when text CAN sit over imagery', async () => {
    renderService.docHasTextOverImagery.mockReturnValue(true);
    await service.saveDesign('org1', 'user1', 'v1', makeDoc(), {
      name: 'announcement-v1',
    });

    expect(renderService.renderAllPages).toHaveBeenCalledTimes(2);
    expect(renderService.renderAllPages.mock.calls[1][1]).toEqual(
      expect.objectContaining({ hideText: true })
    );
    expect(renderService.auditTextContrast).toHaveBeenCalledTimes(1);
  });
});

describe('AiDesignerSaverService deferred preview registration', () => {
  let renderService: any;
  let adapter: {
    writeBuffer: ReturnType<typeof vi.fn>;
    removeFile: ReturnType<typeof vi.fn>;
  };
  let fileService: { saveGeneratedMedia: ReturnType<typeof vi.fn> };
  let designService: {
    createDesign: ReturnType<typeof vi.fn>;
    updateDesign: ReturnType<typeof vi.fn>;
  };
  let service: AiDesignerSaverService;

  beforeEach(() => {
    renderService = {
      renderAllPages: vi.fn(async () => [Buffer.from('page')]),
      renderContactSheet: vi.fn(async () => Buffer.from('sheet')),
      auditTextContrast: vi.fn(async () => []),
      docHasTextOverImagery: vi.fn(() => false),
    };
    adapter = {
      writeBuffer: vi
        .fn()
        .mockResolvedValueOnce('/uploads/pass-1.png')
        .mockResolvedValueOnce('/uploads/pass-2.png')
        .mockResolvedValue('/uploads/pass-n.png'),
      removeFile: vi.fn(async () => undefined),
    };
    fileService = {
      saveGeneratedMedia: vi.fn(async (_org: string, data: { path: string }) => ({
        id: `file-for-${data.path}`,
        path: data.path,
      })),
    };
    designService = {
      createDesign: vi.fn(async () => ({ id: 'design-1' })),
      updateDesign: vi.fn(async () => undefined),
    };
    service = new AiDesignerSaverService(
      renderService as any,
      { getLocalAdapterForOrg: vi.fn(async () => adapter) } as any,
      fileService as any,
      designService as any
    );
  });

  it('registers no File rows on intermediate QC saves, then mints them once at delivery', async () => {
    // The QC loop: save + fix pass, both unregistered.
    const saved = await service.saveDesign('org1', 'user1', 'v1', makeDoc(), {
      name: 'announcement-v1',
      registerPreviews: false,
    });
    const revised = await service.updateDesign(
      'org1',
      saved.designId,
      'v1-revised',
      makeDoc(),
      { name: 'announcement-v1', registerPreviews: false }
    );

    expect(fileService.saveGeneratedMedia).not.toHaveBeenCalled();
    // Previews stay reachable (critic + progressive preview) with no fileId.
    expect(revised.outputPreviews[0].url).toBe('/uploads/pass-2.png');
    expect(revised.outputPreviews[0].fileId).toBe('');
    // The design row never points at a non-existent File mid-loop.
    expect(designService.updateDesign).not.toHaveBeenCalledWith(
      'org1',
      'design-1',
      expect.objectContaining({ previewFileId: expect.anything() })
    );

    // Delivery: the rows are minted from the buffers the last pass wrote —
    // no re-render — and the design preview lands on the first page.
    const registered = await service.registerPreviews(
      'org1',
      saved.designId,
      revised,
      { name: 'announcement-v1' }
    );
    expect(renderService.renderAllPages).toHaveBeenCalledTimes(2); // the two saves
    expect(fileService.saveGeneratedMedia).toHaveBeenCalledTimes(1);
    expect(registered[0].fileId).toBe('file-for-/uploads/pass-2.png');
    expect(registered[0].url).toBe('/uploads/pass-2.png');
    expect(designService.updateDesign).toHaveBeenCalledWith('org1', 'design-1', {
      previewFileId: 'file-for-/uploads/pass-2.png',
    });
  });

  it('deletes the superseded buffer set on each intermediate save, but never the delivered one', async () => {
    const saved = await service.saveDesign('org1', 'user1', 'v1', makeDoc(), {
      registerPreviews: false,
    });
    expect(adapter.removeFile).not.toHaveBeenCalled();

    const revised = await service.updateDesign(
      'org1',
      saved.designId,
      'v1-revised',
      makeDoc(),
      { registerPreviews: false }
    );
    // The first pass's buffer is trash once the second is written.
    expect(adapter.removeFile).toHaveBeenCalledTimes(1);
    expect(adapter.removeFile).toHaveBeenCalledWith('/uploads/pass-1.png');

    await service.registerPreviews('org1', saved.designId, revised, {});
    // Registration hands the final set to the File library — a later
    // intermediate save (a revise cycle reusing the row) must not delete it.
    adapter.removeFile.mockClear();
    await service.updateDesign('org1', saved.designId, 'v1-r2', makeDoc(), {
      registerPreviews: false,
    });
    expect(adapter.removeFile).not.toHaveBeenCalledWith('/uploads/pass-2.png');
  });
});
