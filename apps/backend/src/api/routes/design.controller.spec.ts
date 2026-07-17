import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CHECK_POLICIES_KEY } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { REQUIRE_PERMISSION_KEY } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';

vi.mock('@gitroom/nestjs-libraries/database/prisma/design/design.service', () => ({
  DesignService: class {},
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/file/file.service', () => ({
  FileService: class {},
}));

vi.mock('@gitroom/nestjs-libraries/media/designer-doc/designer-doc.service', () => ({
  DesignerDocService: class {},
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  DesignController,
  DesignTemplateController,
} from './design.controller';

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
      designerDocService as any
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
      };
      (controller as any)._videoRenderService = videoRenderService;

      const out = await controller.getVideoRenderStatus(org, 'job-1');
      expect(out).toMatchObject({ id: 'job-1', status: 'processing', progress: 50 });
    });
  });

  describe('GET /media/design-templates', () => {
    it('lists templates scoped to the org', async () => {
      const templates = [{ id: 't1' }];
      designService.listTemplates.mockResolvedValue(templates);

      expect(await templateController.list(org)).toBe(templates);
      expect(designService.listTemplates).toHaveBeenCalledWith('org-1');
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
});
