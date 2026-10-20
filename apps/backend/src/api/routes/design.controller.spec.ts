import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CHECK_POLICIES_KEY } from '@postmill-ai/backend/services/auth/permissions/permissions.ability';
import { REQUIRE_PERMISSION_KEY } from '@postmill-ai/backend/services/auth/rbac/require-permission.decorator';
import {
  AuthorizationActions,
  Sections,
} from '@postmill-ai/backend/services/auth/permissions/permission.exception.class';

vi.mock('@postmill-ai/nestjs-libraries/database/prisma/design/design.service', () => ({
  DesignService: class {},
}));

vi.mock('@postmill-ai/nestjs-libraries/database/prisma/file/file.service', () => ({
  FileService: class {},
}));

vi.mock('@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.service', () => ({
  DesignerDocService: class {},
}));

vi.mock('@postmill-ai/nestjs-libraries/media/design-render/render-progress', () => ({
  reportRenderProgress: vi.fn(),
  renderPayloadKey: (jobId: string) => `video-render:payload:${jobId}`,
}));

vi.mock('@postmill-ai/nestjs-libraries/media/design-render/render-assets', () => ({
  resolveRenderAsset: vi.fn(),
  isSafeRenderAssetJobId: (jobId: string) => /^[a-z0-9]{20,40}$/i.test(jobId),
  safeRenderAssetFileName: (fileName: string) => {
    const match = /^asset-(\d+)\.([a-z0-9]{1,16})$/.exec(fileName);
    return match ? `asset-${match[1]}.${match[2]}` : null;
  },
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  DesignController,
  DesignRenderFrameController,
  DesignTemplateController,
} from './design.controller';
import { reportRenderProgress } from '@postmill-ai/nestjs-libraries/media/design-render/render-progress';
import { resolveRenderAsset } from '@postmill-ai/nestjs-libraries/media/design-render/render-assets';
import { PassThrough } from 'stream';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const org = { id: 'org-1' } as any;
const user = { id: 'user-1' } as any;

describe('DesignController', () => {
  let designService: {
    listDesigns: ReturnType<typeof vi.fn>;
    getDesign: ReturnType<typeof vi.fn>;
    createDesign: ReturnType<typeof vi.fn>;
    updateDesign: ReturnType<typeof vi.fn>;
    deleteDesign: ReturnType<typeof vi.fn>;
    listTemplates: ReturnType<typeof vi.fn>;
    getTemplate: ReturnType<typeof vi.fn>;
    createTemplate: ReturnType<typeof vi.fn>;
    deleteTemplate: ReturnType<typeof vi.fn>;
    getFolderTree: ReturnType<typeof vi.fn>;
    createFolder: ReturnType<typeof vi.fn>;
    updateFolder: ReturnType<typeof vi.fn>;
    deleteFolder: ReturnType<typeof vi.fn>;
    moveTemplate: ReturnType<typeof vi.fn>;
    regenPreviews: ReturnType<typeof vi.fn>;
  };
  let fileService: {
    getFileById: ReturnType<typeof vi.fn>;
  };
  let designerDocService: {
    validate: ReturnType<typeof vi.fn>;
    validateStrict: ReturnType<typeof vi.fn>;
    applyOps: ReturnType<typeof vi.fn>;
  };
  let controller: DesignController;
  let templateController: DesignTemplateController;

  beforeEach(() => {
    designService = {
      listDesigns: vi.fn(),
      getDesign: vi.fn(),
      createDesign: vi.fn(),
      updateDesign: vi.fn(),
      deleteDesign: vi.fn(),
      listTemplates: vi.fn(),
      getTemplate: vi.fn(),
      createTemplate: vi.fn(),
      deleteTemplate: vi.fn(),
      getFolderTree: vi.fn(),
      createFolder: vi.fn(),
      updateFolder: vi.fn(),
      deleteFolder: vi.fn(),
      moveTemplate: vi.fn(),
      regenPreviews: vi.fn(),
    };
    fileService = {
      getFileById: vi.fn(),
    };
    designerDocService = {
      validate: vi.fn(),
      validateStrict: vi.fn(),
      applyOps: vi.fn(),
    };
    controller = new DesignController(
      designService as any,
      fileService as any,
      {} as any,
      {} as any,
      {} as any,
      designerDocService as any,
      {} as any
    );
    templateController = new DesignTemplateController(designService as any);
  });

  describe('policy and RBAC metadata', () => {
    it(' DesignController list is gated on media:read and MEDIA read policy', () => {
      const policies = Reflect.getMetadata(
        CHECK_POLICIES_KEY,
        DesignController.prototype.list
      );
      expect(policies).toEqual([
        [AuthorizationActions.Read, Sections.MEDIA],
      ]);
      expect(
        Reflect.getMetadata(REQUIRE_PERMISSION_KEY, DesignController.prototype.list)
      ).toEqual({ resource: 'media', action: 'read' });
    });

    it(' DesignController get is gated on media:read and MEDIA read policy', () => {
      expect(
        Reflect.getMetadata(REQUIRE_PERMISSION_KEY, DesignController.prototype.get)
      ).toEqual({ resource: 'media', action: 'read' });
    });

    it(' DesignController create is gated on media:create and MEDIA create policy', () => {
      const policies = Reflect.getMetadata(
        CHECK_POLICIES_KEY,
        DesignController.prototype.create
      );
      expect(policies).toEqual([
        [AuthorizationActions.Create, Sections.MEDIA],
      ]);
      expect(
        Reflect.getMetadata(REQUIRE_PERMISSION_KEY, DesignController.prototype.create)
      ).toEqual({ resource: 'media', action: 'create' });
    });

    it(' DesignController update is gated on media:update and MEDIA update policy', () => {
      expect(
        Reflect.getMetadata(REQUIRE_PERMISSION_KEY, DesignController.prototype.update)
      ).toEqual({ resource: 'media', action: 'update' });
    });

    it(' DesignController delete is gated on media:delete and MEDIA delete policy', () => {
      expect(
        Reflect.getMetadata(REQUIRE_PERMISSION_KEY, DesignController.prototype.delete)
      ).toEqual({ resource: 'media', action: 'delete' });
    });

    it(' DesignTemplateController list is gated on media:read', () => {
      expect(
        Reflect.getMetadata(
          REQUIRE_PERMISSION_KEY,
          DesignTemplateController.prototype.list
        )
      ).toEqual({ resource: 'media', action: 'read' });
    });

    it(' DesignTemplateController create is gated on media:create', () => {
      expect(
        Reflect.getMetadata(
          REQUIRE_PERMISSION_KEY,
          DesignTemplateController.prototype.create
        )
      ).toEqual({ resource: 'media', action: 'create' });
    });

    it(' DesignTemplateController delete is gated on media:delete', () => {
      expect(
        Reflect.getMetadata(
          REQUIRE_PERMISSION_KEY,
          DesignTemplateController.prototype.delete
        )
      ).toEqual({ resource: 'media', action: 'delete' });
    });

    it(' validateDoc is gated on media:read', () => {
      expect(
        Reflect.getMetadata(
          REQUIRE_PERMISSION_KEY,
          DesignController.prototype.validateDoc
        )
      ).toEqual({ resource: 'media', action: 'read' });
    });

    it(' applyOps is gated on media:create', () => {
      expect(
        Reflect.getMetadata(
          REQUIRE_PERMISSION_KEY,
          DesignController.prototype.applyOps
        )
      ).toEqual({ resource: 'media', action: 'create' });
    });
  });

  describe('GET /media/designs', () => {
    it('lists designs with pagination defaults', async () => {
      const result = { designs: [{ id: 'd1' }], total: 1, page: 1, limit: 20 };
      designService.listDesigns.mockResolvedValue(result);

      expect(await controller.list(org)).toBe(result);
      expect(designService.listDesigns).toHaveBeenCalledWith('org-1', 1, 20);
    });

    it('passes explicit page and limit', async () => {
      designService.listDesigns.mockResolvedValue({ designs: [], total: 0, page: 2, limit: 10 });

      await controller.list(org, '2', '10');
      expect(designService.listDesigns).toHaveBeenCalledWith('org-1', 2, 10);
    });
  });

  describe('GET /media/designs/:id', () => {
    it('returns the org-scoped design', async () => {
      const design = { id: 'd1', name: 'Hero' };
      designService.getDesign.mockResolvedValue(design);

      expect(await controller.get(org, 'd1')).toBe(design);
      expect(designService.getDesign).toHaveBeenCalledWith('org-1', 'd1');
    });
  });

  describe('POST /media/designs', () => {
    it('creates a design scoped to the org and user', async () => {
      const body = {
        name: 'New Design',
        doc: { version: 1 },
        width: 1080,
        height: 1080,
        previewDataUrl: 'data:image/png;base64,abc',
        campaignId: 'camp-1',
      };
      const created = { id: 'd1', ...body };
      designService.createDesign.mockResolvedValue(created);

      expect(await controller.create(org, user, body)).toBe(created);
      expect(designService.createDesign).toHaveBeenCalledWith('org-1', 'user-1', body);
    });
  });

  describe('PUT /media/designs/:id', () => {
    it('updates the design and returns the result', async () => {
      const body = { name: 'Updated' };
      const updated = { id: 'd1', name: 'Updated' };
      designService.updateDesign.mockResolvedValue(updated);

      expect(await controller.update(org, 'd1', body)).toBe(updated);
      expect(designService.updateDesign).toHaveBeenCalledWith('org-1', 'd1', body);
    });
  });

  describe('DELETE /media/designs/:id', () => {
    it('deletes the design and reports success', async () => {
      designService.deleteDesign.mockResolvedValue({ id: 'd1' });

      expect(await controller.delete(org, 'd1')).toEqual({ success: true });
      expect(designService.deleteDesign).toHaveBeenCalledWith('org-1', 'd1');
    });
  });

  describe('POST /media/designs/validate', () => {
    it('returns valid:true when the doc passes lenient validation', async () => {
      const doc = { mode: 'image', outputs: [] } as any;
      designerDocService.validate.mockReturnValue(doc);

      expect(await controller.validateDoc({ doc })).toEqual({ valid: true });
      expect(designerDocService.validate).toHaveBeenCalledWith(doc);
    });

    it('returns valid:false with errors when validation throws BadRequestException', async () => {
      const err = new BadRequestException({
        message: 'Invalid DesignerDoc',
        issues: [{ path: ['outputs'], message: 'Required' }],
      });
      designerDocService.validate.mockImplementation(() => {
        throw err;
      });

      expect(await controller.validateDoc({ doc: {} })).toEqual({
        valid: false,
        errors: [{ path: ['outputs'], message: 'Required' }],
      });
    });
  });

  describe('POST /media/designs/apply-ops', () => {
    it('returns the transformed doc after strict validation and ops', async () => {
      const doc = { mode: 'image', outputs: [] } as any;
      const ops = [{ op: 'setDoc', doc }];
      const transformed = { mode: 'image', outputs: [{ id: 'out-1' }] };
      designerDocService.validateStrict.mockReturnValue(doc);
      designerDocService.applyOps.mockReturnValue(transformed);

      expect(await controller.applyOps({ doc, ops })).toEqual({ doc: transformed });
      expect(designerDocService.validateStrict).toHaveBeenCalledWith(doc);
      expect(designerDocService.applyOps).toHaveBeenCalledWith(doc, ops);
    });

    it('propagates BadRequestException from strict validation', async () => {
      designerDocService.validateStrict.mockImplementation(() => {
        throw new BadRequestException('bad doc');
      });

      await expect(controller.applyOps({ doc: {}, ops: [] })).rejects.toThrow(
        BadRequestException
      );
    });
  });

  describe('POST /media/designs/render', () => {
    it('validates the doc before rendering', async () => {
      const doc = { mode: 'image', outputs: [{ id: 'out-1' }] } as any;
      designerDocService.validate.mockReturnValue(doc);
      (controller as any)._designRenderService = {
        renderPage: vi.fn().mockResolvedValue(Buffer.from('png')),
      };

      const res = { setHeader: vi.fn(), end: vi.fn() } as any;
      await controller.render(org, { doc, format: 'png' } as any, res);

      expect(designerDocService.validate).toHaveBeenCalledWith(doc);
    });
  });

  describe('POST /media/designs/bulk-generate', () => {
    it('validates the doc and passes org context to the batch renderer', async () => {
      const doc = { mode: 'image', outputs: [] } as any;
      designerDocService.validate.mockReturnValue(doc);
      (controller as any)._designBulkService = {
        generateBatch: vi.fn().mockResolvedValue({ images: [], truncated: false, totalRows: 0 }),
      };

      await controller.bulkGenerate(org, { doc, rows: [] } as any);

      expect(designerDocService.validate).toHaveBeenCalledWith(doc);
      expect((controller as any)._designBulkService.generateBatch).toHaveBeenCalledWith(
        doc,
        [],
        { orgId: 'org-1' },
      );
    });
  });

  describe('GET /media/designs/render-video/:jobId (0.1 org-scope)', () => {
    it('404s when the video-render job is not visible to the org (getJob → null)', async () => {
      const videoRenderService = { getJob: vi.fn().mockResolvedValue(null) };
      (controller as any)._videoRenderService = videoRenderService;

      await expect(
        controller.getVideoRenderStatus(org, 'job-from-another-org'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(videoRenderService.getJob).toHaveBeenCalledWith('org-1', 'job-from-another-org');
    });

    it('returns the status for a job the org owns', async () => {
      const videoRenderService = {
        getJob: vi.fn().mockResolvedValue({ id: 'job-1', status: 'processing', artifactUrl: null }),
        // No progress reported yet → the 50 midpoint fallback holds.
        getRenderProgress: vi.fn().mockResolvedValue(null),
      };
      (controller as any)._videoRenderService = videoRenderService;

      const out = await controller.getVideoRenderStatus(org, 'job-1');
      expect(out).toMatchObject({ id: 'job-1', status: 'processing', progress: 50 });
    });

    it('returns the REAL frame-capture percent once the render reports progress', async () => {
      const videoRenderService = {
        getJob: vi.fn().mockResolvedValue({ id: 'job-1', status: 'processing', artifactUrl: null }),
        getRenderProgress: vi.fn().mockResolvedValue({ frame: 300, total: 1200, updatedAt: 1 }),
      };
      (controller as any)._videoRenderService = videoRenderService;

      const out = await controller.getVideoRenderStatus(org, 'job-1');
      expect(videoRenderService.getRenderProgress).toHaveBeenCalledWith('job-1');
      expect(out).toMatchObject({ id: 'job-1', status: 'processing', progress: 25 });
    });

    it('caps a reported percent at 99 while still processing', async () => {
      const videoRenderService = {
        getJob: vi.fn().mockResolvedValue({ id: 'job-1', status: 'processing', artifactUrl: null }),
        getRenderProgress: vi.fn().mockResolvedValue({ frame: 1200, total: 1200, updatedAt: 1 }),
      };
      (controller as any)._videoRenderService = videoRenderService;

      const out = await controller.getVideoRenderStatus(org, 'job-1');
      expect(out.progress).toBe(99);
    });
  });

  describe('GET /media/design-templates', () => {
    it('lists templates scoped to the org (legacy plain-array shape, no params)', async () => {
      const templates = [{ id: 't1' }];
      designService.listTemplates.mockResolvedValue(templates);

      expect(await templateController.list(org)).toBe(templates);
      expect(designService.listTemplates).toHaveBeenCalledWith('org-1');
    });

    it('passes page/limit through and returns the envelope when paginating', async () => {
      const envelope = { templates: [{ id: 't1' }], total: 1, page: 2, limit: 24 };
      designService.listTemplates.mockResolvedValue(envelope);

      expect(await templateController.list(org, '2', '24')).toBe(envelope);
      expect(designService.listTemplates).toHaveBeenCalledWith('org-1', 2, 24);
    });

    it('clamps out-of-range pagination params', async () => {
      designService.listTemplates.mockResolvedValue({ templates: [], total: 0, page: 1, limit: 100 });

      await templateController.list(org, '0', '99999');
      expect(designService.listTemplates).toHaveBeenCalledWith('org-1', 1, 100);

      await templateController.list(org, 'abc', undefined);
      expect(designService.listTemplates).toHaveBeenCalledWith('org-1', 1, 24);
    });
  });

  describe('POST /media/designs/maintenance/regen-previews', () => {
    it('is gated on media:update and delegates to the service', async () => {
      expect(
        Reflect.getMetadata(REQUIRE_PERMISSION_KEY, DesignController.prototype.regenPreviews)
      ).toEqual({ resource: 'media', action: 'update' });

      const result = {
        designs: { scanned: 3, regenerated: 2, skipped: 1, failed: 0 },
        templates: { scanned: 1, regenerated: 1, skipped: 0, failed: 0 },
      };
      designService.regenPreviews.mockResolvedValue(result);

      expect(await controller.regenPreviews(org)).toBe(result);
      expect(designService.regenPreviews).toHaveBeenCalledWith('org-1');
    });
  });

  describe('GET /media/design-templates/:id', () => {
    it('returns the template scoped to the org', async () => {
      const template = { id: 't1', name: 'Social Post' };
      designService.getTemplate.mockResolvedValue(template);

      expect(await templateController.get(org, 't1')).toBe(template);
      expect(designService.getTemplate).toHaveBeenCalledWith('org-1', 't1');
    });
  });

  describe('POST /media/design-templates', () => {
    it('creates a template for the org', async () => {
      const body = { name: 'Template', category: 'social', doc: { version: 1 } };
      const created = { id: 't1', ...body };
      designService.createTemplate.mockResolvedValue(created);

      expect(await templateController.create(org, body)).toBe(created);
      expect(designService.createTemplate).toHaveBeenCalledWith({
        organizationId: 'org-1',
        ...body,
      });
    });
  });

  describe('DELETE /media/design-templates/:id', () => {
    it('deletes the template and reports success', async () => {
      designService.deleteTemplate.mockResolvedValue({ id: 't1' });

      expect(await templateController.delete(org, 't1')).toEqual({ success: true });
      expect(designService.deleteTemplate).toHaveBeenCalledWith('org-1', 't1');
    });
  });

  describe('template folder endpoints', () => {
    it('GET /media/design-templates/folders is gated on media:read and returns the tree', async () => {
      expect(
        Reflect.getMetadata(
          REQUIRE_PERMISSION_KEY,
          DesignTemplateController.prototype.getFolderTree
        )
      ).toEqual({ resource: 'media', action: 'read' });

      const tree = [{ id: 'f1', name: 'Ads', children: [] }];
      designService.getFolderTree.mockResolvedValue(tree);

      expect(await templateController.getFolderTree(org)).toBe(tree);
      expect(designService.getFolderTree).toHaveBeenCalledWith('org-1');
    });

    it('POST /media/design-templates/folders is gated on media:create and creates the folder', async () => {
      expect(
        Reflect.getMetadata(
          REQUIRE_PERMISSION_KEY,
          DesignTemplateController.prototype.createFolder
        )
      ).toEqual({ resource: 'media', action: 'create' });

      const body = { name: 'Ads', parentId: 'f0' };
      const created = { id: 'f1', ...body };
      designService.createFolder.mockResolvedValue(created);

      expect(await templateController.createFolder(org, body)).toBe(created);
      expect(designService.createFolder).toHaveBeenCalledWith('org-1', body);
    });

    it('PUT /media/design-templates/folders/:id is gated on media:update and renames the folder', async () => {
      expect(
        Reflect.getMetadata(
          REQUIRE_PERMISSION_KEY,
          DesignTemplateController.prototype.updateFolder
        )
      ).toEqual({ resource: 'media', action: 'update' });

      const updated = { id: 'f1', name: 'Renamed' };
      designService.updateFolder.mockResolvedValue(updated);

      expect(await templateController.updateFolder(org, 'f1', { name: 'Renamed' })).toBe(updated);
      expect(designService.updateFolder).toHaveBeenCalledWith('org-1', 'f1', { name: 'Renamed' });
    });

    it('DELETE /media/design-templates/folders/:id is gated on media:delete and reports success', async () => {
      expect(
        Reflect.getMetadata(
          REQUIRE_PERMISSION_KEY,
          DesignTemplateController.prototype.deleteFolder
        )
      ).toEqual({ resource: 'media', action: 'delete' });

      designService.deleteFolder.mockResolvedValue({ id: 'f1' });

      expect(await templateController.deleteFolder(org, 'f1')).toEqual({ success: true });
      expect(designService.deleteFolder).toHaveBeenCalledWith('org-1', 'f1', false);

      // force=true unfiles the folder's contents instead of rejecting.
      expect(await templateController.deleteFolder(org, 'f1', 'true')).toEqual({ success: true });
      expect(designService.deleteFolder).toHaveBeenLastCalledWith('org-1', 'f1', true);
    });

    it('PUT /media/design-templates/:id/move is gated on media:update and defaults to root', async () => {
      expect(
        Reflect.getMetadata(
          REQUIRE_PERMISSION_KEY,
          DesignTemplateController.prototype.moveTemplate
        )
      ).toEqual({ resource: 'media', action: 'update' });

      designService.moveTemplate.mockResolvedValue({ id: 't1', folderId: null });

      await templateController.moveTemplate(org, 't1', {});
      expect(designService.moveTemplate).toHaveBeenCalledWith('org-1', 't1', null);

      await templateController.moveTemplate(org, 't1', { folderId: 'f1' });
      expect(designService.moveTemplate).toHaveBeenCalledWith('org-1', 't1', 'f1');
    });
  });
});

describe('DesignRenderFrameController render-progress route', () => {
  const frameController = new DesignRenderFrameController({} as any);
  const makeRes = () => {
    const res = {
      status: vi.fn(),
      send: vi.fn(),
      end: vi.fn(),
    };
    res.status.mockReturnValue(res);
    return res as any;
  };

  beforeEach(() => {
    vi.mocked(reportRenderProgress).mockReset();
  });

  it('204s a valid progress report and passes jobId/token/frame/total through', async () => {
    vi.mocked(reportRenderProgress).mockResolvedValue('ok');
    const res = makeRes();

    await frameController.renderProgress('job-1', 'tok', { frame: 30, total: 90 } as any, res);

    expect(reportRenderProgress).toHaveBeenCalledWith('job-1', 'tok', 30, 90);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it('403s a bad render token', async () => {
    vi.mocked(reportRenderProgress).mockResolvedValue('forbidden');
    const res = makeRes();

    await frameController.renderProgress('job-1', 'bad', { frame: 1, total: 90 } as any, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith('Invalid render token');
  });

  it('404s when the render payload is gone', async () => {
    vi.mocked(reportRenderProgress).mockResolvedValue('not-found');
    const res = makeRes();

    await frameController.renderProgress('job-1', 'tok', { frame: 1, total: 90 } as any, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('DesignRenderFrameController render-asset route', () => {
  const frameController = new DesignRenderFrameController({} as any);
  const jobId = 'clzrenderassetctrl0000001';
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-asset-route-'));
  const fixturePath = path.join(fixtureDir, 'asset-0.mp4');
  const fixtureBytes = Buffer.from('0123456789-video-bytes');
  fs.writeFileSync(fixturePath, fixtureBytes);

  const makeStreamRes = () => {
    const stream = new PassThrough();
    const res = Object.assign(stream, {
      status: vi.fn(),
      setHeader: vi.fn(),
      send: vi.fn(),
    }) as any;
    res.status.mockReturnValue(res);
    res.setHeader.mockReturnValue(res);
    // pipe() calls res.end() when the source drains — call through so the
    // PassThrough's readable side actually emits 'end' for readBody.
    const realEnd = stream.end.bind(stream);
    res.end = vi.fn((...args: any[]) => {
      (realEnd as any)(...args);
      return res;
    });
    return res as any;
  };

  const readBody = (res: PassThrough): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });

  beforeEach(() => {
    vi.mocked(resolveRenderAsset).mockReset();
  });

  it('400s a malformed jobId or file name before touching the resolver (path-injection guard)', async () => {
    for (const [badJobId, badFile] of [
      ['../../etc', 'asset-0.mp4'],
      ['job-1', 'asset-0.mp4'],
      [jobId, '../manifest.json'],
      [jobId, 'manifest.json'],
      [jobId, 'asset-0.mp4/..'],
    ] as const) {
      const res = makeStreamRes();
      await frameController.renderAsset(badJobId, badFile, 'tok', undefined, res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(resolveRenderAsset).not.toHaveBeenCalled();
  });

  it('403s an invalid render token and 404s a missing asset', async () => {
    vi.mocked(resolveRenderAsset).mockResolvedValue({ status: 'forbidden' });
    let res = makeStreamRes();
    await frameController.renderAsset(jobId, 'asset-0.mp4', 'bad', undefined, res);
    expect(res.status).toHaveBeenCalledWith(403);

    vi.mocked(resolveRenderAsset).mockResolvedValue({ status: 'not-found' });
    res = makeStreamRes();
    await frameController.renderAsset(jobId, 'asset-9.mp4', 'tok', undefined, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('streams the asset with its manifest content-type and a full-body 200', async () => {
    vi.mocked(resolveRenderAsset).mockResolvedValue({
      status: 'ok',
      filePath: fixturePath,
      contentType: 'video/mp4',
      size: fixtureBytes.byteLength,
    });
    const res = makeStreamRes();
    const body = readBody(res);

    await frameController.renderAsset(jobId, 'asset-0.mp4', 'tok', undefined, res);

    expect(resolveRenderAsset).toHaveBeenCalledWith(jobId, 'asset-0.mp4', 'tok');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'video/mp4');
    expect(res.setHeader).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', fixtureBytes.byteLength);
    expect(await body).toEqual(fixtureBytes);
  });

  it('honours a single byte-range request with a 206 (Chromium seeks issue ranges)', async () => {
    vi.mocked(resolveRenderAsset).mockResolvedValue({
      status: 'ok',
      filePath: fixturePath,
      contentType: 'video/mp4',
      size: fixtureBytes.byteLength,
    });
    const res = makeStreamRes();
    const body = readBody(res);

    await frameController.renderAsset(jobId, 'asset-0.mp4', 'tok', 'bytes=2-5', res);

    expect(res.status).toHaveBeenCalledWith(206);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Range',
      `bytes 2-5/${fixtureBytes.byteLength}`,
    );
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 4);
    expect(await body).toEqual(fixtureBytes.subarray(2, 6));
  });

  it('416s an unsatisfiable range', async () => {
    vi.mocked(resolveRenderAsset).mockResolvedValue({
      status: 'ok',
      filePath: fixturePath,
      contentType: 'video/mp4',
      size: fixtureBytes.byteLength,
    });
    const res = makeStreamRes();

    await frameController.renderAsset(jobId, 'asset-0.mp4', 'tok', 'bytes=9999-', res);

    expect(res.status).toHaveBeenCalledWith(416);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Range',
      `bytes */${fixtureBytes.byteLength}`,
    );
  });
});
