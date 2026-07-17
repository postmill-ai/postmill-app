import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import { DesignerDesignTool } from './designer.design.tool';
import { DesignerDocService } from '@gitroom/nestjs-libraries/media/designer-doc/designer-doc.service';

const makeImageDoc = () => ({
  mode: 'image' as const,
  version: 2,
  outputs: [
    {
      id: 'out-1',
      formatId: 'instagram-square',
      name: 'Instagram Square',
      width: 1080,
      height: 1080,
      background: '#ffffff',
      children: [
        {
          id: 'el-1',
          type: 'text' as const,
          x: 0,
          y: 0,
          width: 100,
          height: 50,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          text: 'Hello',
        },
      ],
    },
  ],
});

const makeVideoDoc = () => ({
  mode: 'video' as const,
  version: 2,
  outputs: [
    {
      id: 'out-1',
      formatId: 'instagram-square',
      name: 'Instagram Square',
      width: 1080,
      height: 1080,
      fps: 30,
      durationMs: 10000,
      tracks: [{ id: 'trk-1', type: 'video' as const, clips: [] }],
    },
  ],
});

const makeContext = (access: Record<string, any> = { mode: 'user' }) => ({
  requestContext: {
    get: (key: string) => {
      if (key === 'organization') return JSON.stringify({ id: 'org-1' });
      if (key === 'user') return JSON.stringify({ id: 'user-1' });
      if (key === 'access') return JSON.stringify(access);
      return undefined;
    },
  },
});

describe('DesignerDesignTool', () => {
  let designerDocService: DesignerDocService;
  let designService: {
    instantiateTemplate: ReturnType<typeof vi.fn>;
    createDesign: ReturnType<typeof vi.fn>;
    updateDesign: ReturnType<typeof vi.fn>;
  };
  let designRenderService: {
    renderPage: ReturnType<typeof vi.fn>;
  };
  let storageService: {
    getLocalAdapterForOrg: ReturnType<typeof vi.fn>;
  };
  let fileService: {
    saveFile: ReturnType<typeof vi.fn>;
  };
  let tool: DesignerDesignTool;

  beforeEach(() => {
    designerDocService = new DesignerDocService();
    designService = {
      instantiateTemplate: vi.fn(),
      createDesign: vi.fn(),
      updateDesign: vi.fn(),
    };
    designRenderService = {
      renderPage: vi.fn().mockResolvedValue(Buffer.from('png')),
    };
    storageService = {
      getLocalAdapterForOrg: vi.fn().mockResolvedValue({
        writeBuffer: vi.fn().mockResolvedValue('http://localhost/uploads/preview.png'),
      }),
    };
    fileService = {
      saveFile: vi.fn().mockResolvedValue({
        id: 'file-1',
        path: 'http://localhost/uploads/preview.png',
      }),
    };
    tool = new DesignerDesignTool(
      designerDocService,
      designService as any,
      designRenderService as any,
      storageService as any,
      fileService as any
    );
  });

  it('creates an image design with a preview file and URL', async () => {
    designService.createDesign.mockResolvedValue({ id: 'd1' });

    const t = tool.run();
    const res = await t.execute({ name: 'Hero', doc: makeImageDoc() } as any, makeContext() as any);

    expect(designService.createDesign).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      expect.objectContaining({
        name: 'Hero',
        width: 1080,
        height: 1080,
        previewFileId: 'file-1',
      })
    );
    const savedDoc = designService.createDesign.mock.calls[0][2].doc;
    expect(savedDoc.mode).toBe('image');
    expect(savedDoc.outputs[0].children[0].originId).toBe(savedDoc.outputs[0].children[0].id);
    expect(res).toEqual({
      designId: 'd1',
      previewFileId: 'file-1',
      previewUrl: 'http://localhost/uploads/preview.png',
    });
  });

  it('uses a template when templateId is provided', async () => {
    designService.instantiateTemplate.mockResolvedValue(makeImageDoc());
    designService.createDesign.mockResolvedValue({ id: 'd2' });

    const t = tool.run();
    const res = await t.execute({ name: 'From template', templateId: 't1' } as any, makeContext() as any);

    expect(designService.instantiateTemplate).toHaveBeenCalledWith('org-1', 't1');
    expect(designService.createDesign).toHaveBeenCalled();
    expect(res.designId).toBe('d2');
  });

  it('updates an existing design when designId is provided', async () => {
    designService.updateDesign.mockResolvedValue({ id: 'd3' });

    const t = tool.run();
    const res = await t.execute(
      { name: 'Renamed', designId: 'd3', doc: makeImageDoc() } as any,
      makeContext() as any
    );

    expect(designService.updateDesign).toHaveBeenCalledWith(
      'org-1',
      'd3',
      expect.objectContaining({ name: 'Renamed', width: 1080, height: 1080 })
    );
    expect(res.designId).toBe('d3');
  });

  it('does not overwrite name on update when it is absent', async () => {
    designService.updateDesign.mockResolvedValue({ id: 'd3' });

    const t = tool.run();
    await t.execute({ designId: 'd3', doc: makeImageDoc() } as any, makeContext() as any);

    const payload = designService.updateDesign.mock.calls[0][2];
    expect(payload).not.toHaveProperty('name');
  });

  it('does not null out previewFileId when updating a video-mode design', async () => {
    designService.updateDesign.mockResolvedValue({ id: 'd5' });

    const t = tool.run();
    await t.execute({ designId: 'd5', doc: makeVideoDoc() } as any, makeContext() as any);

    const payload = designService.updateDesign.mock.calls[0][2];
    expect(payload).not.toHaveProperty('previewFileId');
  });

  it('skips preview for video-mode docs and returns null preview fields', async () => {
    designService.createDesign.mockResolvedValue({ id: 'd4' });

    const t = tool.run();
    const res = await t.execute({ name: 'Video', doc: makeVideoDoc() } as any, makeContext() as any);

    expect(designRenderService.renderPage).not.toHaveBeenCalled();
    expect(res).toEqual({ designId: 'd4', previewFileId: null, previewUrl: null });
  });

  it('returns a structured error when rendering fails', async () => {
    designRenderService.renderPage.mockRejectedValue(new HttpException('Render failed', 500));

    const t = tool.run();
    const res = await t.execute({ name: 'Bad', doc: makeImageDoc() } as any, makeContext() as any);

    expect(res).toEqual(expect.objectContaining({ error: 'Render failed', code: 500 }));
    expect(res.designId).toBeUndefined();
  });

  it('returns MISSING_USER when user context is absent', async () => {
    const t = tool.run();
    const res = await t.execute(
      { name: 'No user', doc: makeImageDoc() } as any,
      {
        requestContext: {
          get: (key: string) => {
            if (key === 'organization') return JSON.stringify({ id: 'org-1' });
            if (key === 'access') return JSON.stringify({ mode: 'user' });
            return undefined;
          },
        },
      } as any
    );

    expect(res).toEqual({ error: 'User context missing', code: 'MISSING_USER' });
  });

  it('denies write in headless mode (returns structured error, no persist)', async () => {
    const t = tool.run();
    const res = await t.execute(
      { name: 'Denied', doc: makeImageDoc() } as any,
      makeContext({ mode: 'headless' }) as any
    );

    expect(res.error).toMatch(/headless runs are read-only/);
    expect(designService.createDesign).not.toHaveBeenCalled();
  });

  it('denies write for an mcp token lacking mcp:posts:write', async () => {
    const t = tool.run();
    const res = await t.execute(
      { name: 'Denied', doc: makeImageDoc() } as any,
      makeContext({ mode: 'mcp', scopes: ['mcp:read'] }) as any
    );

    expect(res.error).toMatch(/mcp:posts:write scope required/);
    expect(designService.createDesign).not.toHaveBeenCalled();
  });
});
