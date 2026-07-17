import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DesignService } from './design.service';
import { DesignerDocService } from '@gitroom/nestjs-libraries/media/designer-doc/designer-doc.service';

const makeDoc = (overrides: any = {}) => ({
  mode: 'image',
  outputs: [
    {
      id: 'out-1',
      formatId: 'instagram-square',
      name: 'Instagram Square',
      width: 1080,
      height: 1080,
      background: '#ffffff',
      children: [],
      ...overrides.output,
    },
  ],
  ...overrides.doc,
});

describe('DesignService', () => {
  let repository: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    createTemplate: ReturnType<typeof vi.fn>;
    updateTemplate: ReturnType<typeof vi.fn>;
    findTemplateForOrg: ReturnType<typeof vi.fn>;
  };
  let fileService: {
    importFromUrl: ReturnType<typeof vi.fn>;
  };
  let service: DesignService;

  beforeEach(() => {
    repository = {
      create: vi.fn(),
      update: vi.fn(),
      createTemplate: vi.fn(),
      updateTemplate: vi.fn(),
      findTemplateForOrg: vi.fn(),
    };
    fileService = {
      importFromUrl: vi.fn(),
    };
    service = new DesignService(
      repository as any,
      new DesignerDocService(),
      fileService as any
    );
  });

  describe('createDesign', () => {
    it('validates the doc and reconciles width/height from outputs[0]', async () => {
      const doc = makeDoc({ output: { width: 1200, height: 628 } });
      await service.createDesign('org-1', 'user-1', {
        name: 'Hero',
        doc,
        width: 1080,
        height: 1080,
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          createdById: 'user-1',
          name: 'Hero',
          width: 1200,
          height: 628,
          doc: expect.objectContaining({
            mode: 'image',
            outputs: expect.arrayContaining([
              expect.objectContaining({ width: 1200, height: 628 }),
            ]),
          }),
        })
      );
    });

    it('rejects an invalid doc with BadRequestException', async () => {
      await expect(
        service.createDesign('org-1', 'user-1', {
          name: 'Bad',
          doc: { mode: 'image', outputs: [] },
          width: 1080,
          height: 1080,
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('clamps an out-of-range legacy doc instead of rejecting', async () => {
      const doc = makeDoc({
        output: { width: 99999, height: 99999, opacity: 1.5 },
      });
      await service.createDesign('org-1', 'user-1', {
        name: 'Legacy',
        doc,
        width: 1080,
        height: 1080,
      });

      const saved = repository.create.mock.calls[0][0].doc;
      expect(saved.outputs[0].width).toBeLessThanOrEqual(16384);
      expect(saved.outputs[0].height).toBeLessThanOrEqual(16384);
    });
  });

  describe('updateDesign', () => {
    it('derives width/height from doc when doc is provided', async () => {
      const doc = makeDoc({ output: { width: 1920, height: 1080 } });
      await service.updateDesign('org-1', 'd1', {
        name: 'Updated',
        doc,
        width: 100,
        height: 100,
      });

      expect(repository.update).toHaveBeenCalledWith(
        'd1',
        'org-1',
        expect.objectContaining({
          name: 'Updated',
          width: 1920,
          height: 1080,
        })
      );
    });

    it('passes caller width/height through when doc is absent', async () => {
      await service.updateDesign('org-1', 'd1', {
        name: 'Renamed',
        width: 400,
        height: 300,
      });

      expect(repository.update).toHaveBeenCalledWith(
        'd1',
        'org-1',
        expect.objectContaining({
          name: 'Renamed',
          width: 400,
          height: 300,
        })
      );
    });
  });

  describe('createTemplate', () => {
    it('validates and persists the clamped doc', async () => {
      const doc = makeDoc();
      await service.createTemplate({
        organizationId: 'org-1',
        name: 'Tmpl',
        category: 'social',
        doc,
      });

      expect(repository.createTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          name: 'Tmpl',
          category: 'social',
          doc: expect.objectContaining({ mode: 'image' }),
        })
      );
    });

    it('rejects a bad template doc', async () => {
      await expect(
        service.createTemplate({
          organizationId: 'org-1',
          name: 'Bad',
          category: 'social',
          doc: { mode: 'image', outputs: [] },
        })
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateTemplate', () => {
    it('validates the doc when present', async () => {
      const doc = makeDoc();
      await service.updateTemplate('org-1', 't1', { doc });

      expect(repository.updateTemplate).toHaveBeenCalledWith(
        't1',
        'org-1',
        expect.objectContaining({
          doc: expect.objectContaining({ mode: 'image' }),
        })
      );
    });
  });

  describe('instantiateTemplate', () => {
    it('returns a detached, re-identified doc for a system template', async () => {
      const doc = makeDoc({ output: { id: 'tpl-out-1' } });
      repository.findTemplateForOrg.mockResolvedValue({
        id: 't1',
        organizationId: null,
        isSystem: true,
        doc,
      });

      const instance = await service.instantiateTemplate('org-1', 't1');

      expect(repository.findTemplateForOrg).toHaveBeenCalledWith('t1', 'org-1');
      expect(instance.outputs[0].id).not.toBe('tpl-out-1');
      expect(instance.outputs[0].id).toMatch(/^out-/);
    });

    it('throws NotFoundException for a cross-org template', async () => {
      repository.findTemplateForOrg.mockResolvedValue(null);

      await expect(
        service.instantiateTemplate('org-1', 't1')
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('placeAsset', () => {
    it('imports the url, lands a renderable image element, and returns fileId', async () => {
      const doc = makeDoc();
      fileService.importFromUrl.mockResolvedValue({
        id: 'file-1',
        path: 'http://localhost/uploads/file-1.png',
      });

      const { doc: updated, fileId } = await service.placeAsset('org-1', doc, {
        url: 'https://cdn/image.png',
        outputIndex: 0,
        name: 'Hero image',
      });

      expect(fileService.importFromUrl).toHaveBeenCalledWith('org-1', {
        url: 'https://cdn/image.png',
        name: 'Hero image',
      });
      expect(fileId).toBe('file-1');
      const imageEl = updated.outputs[0].children.find((c: any) => c.type === 'image');
      expect(imageEl).toBeDefined();
      expect(imageEl.src).toBe('http://localhost/uploads/file-1.png');
      expect(imageEl.fileId).toBe('file-1');
    });

    it('lets HttpException from importFromUrl propagate', async () => {
      const doc = makeDoc();
      const err = new BadRequestException('File type not allowed');
      fileService.importFromUrl.mockRejectedValue(err);

      await expect(
        service.placeAsset('org-1', doc, {
          url: 'https://cdn/bad.exe',
          outputIndex: 0,
        })
      ).rejects.toThrow(BadRequestException);
    });
  });
});
