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
    };
    storageService = {
      getLocalAdapterForOrg: vi.fn(async () => ({
        writeBuffer: vi.fn(async () => '/uploads/render.png'),
      })),
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

  it('keeps the contact sheet transient — a storage path for the critic, never a File row in the library', async () => {
    const result = await service.saveDesign('org1', 'user1', 'v1', makeDoc(), {
      name: 'announcement-v1',
    });

    // The critic still gets a reachable URL…
    expect(result.contactSheetUrl).toBe('/uploads/render.png');
    // …but the library listing only ever sees the deliverable previews —
    // no framed, labeled contact-sheet artifact.
    expect(fileService.saveGeneratedMedia).toHaveBeenCalledTimes(1);
    expect(savedNames().some((name) => name.includes('contact-sheet'))).toBe(
      false
    );
    expect(result).not.toHaveProperty('contactSheetFileId');
  });
});
