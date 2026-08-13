import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DesignService } from './design.service';
import { DesignerDocService } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.service';

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
    findById: ReturnType<typeof vi.fn>;
    findTemplateForOrg: ReturnType<typeof vi.fn>;
    findByOrg: ReturnType<typeof vi.fn>;
    countByOrg: ReturnType<typeof vi.fn>;
    findTemplatesByOrg: ReturnType<typeof vi.fn>;
  };
  let fileService: {
    importFromUrl: ReturnType<typeof vi.fn>;
    getFileById: ReturnType<typeof vi.fn>;
    softDelete: ReturnType<typeof vi.fn>;
  };
  let service: DesignService;

  beforeEach(() => {
    repository = {
      create: vi.fn(),
      update: vi.fn(),
      createTemplate: vi.fn(),
      updateTemplate: vi.fn(),
      findById: vi.fn(),
      findTemplateForOrg: vi.fn(),
      findByOrg: vi.fn(),
      countByOrg: vi.fn(),
      findTemplatesByOrg: vi.fn(),
    };
    fileService = {
      importFromUrl: vi.fn(),
      getFileById: vi.fn(),
      softDelete: vi.fn(),
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

  describe('listDesigns', () => {
    it('maps previewUrl from the preview file path, falling back to the data URL', async () => {
      repository.findByOrg.mockResolvedValue([
        {
          id: 'd1',
          previewDataUrl: 'data:image/jpeg;base64,aaa',
          previewFile: { path: 'http://localhost/uploads/d1.png' },
        },
        { id: 'd2', previewDataUrl: 'data:image/jpeg;base64,bbb', previewFile: null },
        { id: 'd3', previewDataUrl: null, previewFile: null },
      ]);
      repository.countByOrg.mockResolvedValue(3);

      const { designs, total } = await service.listDesigns('org-1');

      expect(total).toBe(3);
      // File path wins over the data URL.
      expect(designs[0].previewUrl).toBe('http://localhost/uploads/d1.png');
      // Existing fields (incl. previewDataUrl) are preserved.
      expect(designs[0].previewDataUrl).toBe('data:image/jpeg;base64,aaa');
      // Data-URL fallback when no file is attached.
      expect(designs[1].previewUrl).toBe('data:image/jpeg;base64,bbb');
      // Null when neither exists.
      expect(designs[2].previewUrl).toBeNull();
    });
  });

  describe('listTemplates', () => {
    it('maps thumbnail from the thumbnail file path', async () => {
      repository.findTemplatesByOrg.mockResolvedValue([
        { id: 't1', thumbnailFile: { path: 'http://localhost/uploads/t1.png' } },
        { id: 't2', thumbnailFile: null },
      ]);

      const templates = await service.listTemplates('org-1');

      expect(templates[0].thumbnail).toBe('http://localhost/uploads/t1.png');
      expect(templates[1].thumbnail).toBeNull();
    });
  });

  describe('file ownership guard', () => {
    it('createTemplate passes thumbnailFileId through when the file is owned', async () => {
      fileService.getFileById.mockResolvedValue({ id: 'file-1' });
      const doc = makeDoc();

      await service.createTemplate({
        organizationId: 'org-1',
        name: 'Tmpl',
        category: 'social',
        doc,
        thumbnailFileId: 'file-1',
      });

      expect(fileService.getFileById).toHaveBeenCalledWith('org-1', 'file-1');
      expect(repository.createTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ thumbnailFileId: 'file-1' })
      );
    });

    it('createDesign rejects a foreign previewFileId', async () => {
      fileService.getFileById.mockResolvedValue(null);

      await expect(
        service.createDesign('org-1', 'user-1', {
          name: 'Hero',
          doc: makeDoc(),
          previewFileId: 'foreign-file',
        })
      ).rejects.toThrow(BadRequestException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('updateDesign rejects a foreign previewFileId', async () => {
      fileService.getFileById.mockResolvedValue(null);

      await expect(
        service.updateDesign('org-1', 'd1', { previewFileId: 'foreign-file' })
      ).rejects.toThrow(BadRequestException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('updateTemplate rejects a foreign thumbnailFileId', async () => {
      fileService.getFileById.mockResolvedValue(null);

      await expect(
        service.updateTemplate('org-1', 't1', { thumbnailFileId: 'foreign-file' })
      ).rejects.toThrow(BadRequestException);
      expect(repository.updateTemplate).not.toHaveBeenCalled();
    });

    it('createTemplate rejects a thumbnailFileId without an organizationId', async () => {
      await expect(
        service.createTemplate({
          name: 'System',
          category: 'social',
          doc: makeDoc(),
          isSystem: true,
          thumbnailFileId: 'file-1',
        })
      ).rejects.toThrow(BadRequestException);
      expect(fileService.getFileById).not.toHaveBeenCalled();
      expect(repository.createTemplate).not.toHaveBeenCalled();
    });
  });

  describe('replaced preview file cleanup', () => {
    it('updateDesign soft-deletes the previous preview file when it is replaced', async () => {
      fileService.getFileById.mockResolvedValue({ id: 'new-file' });
      repository.findById.mockResolvedValue({ id: 'd1', previewFileId: 'old-file' });

      await service.updateDesign('org-1', 'd1', { previewFileId: 'new-file' });

      expect(repository.update).toHaveBeenCalledWith(
        'd1',
        'org-1',
        expect.objectContaining({ previewFileId: 'new-file' })
      );
      expect(fileService.softDelete).toHaveBeenCalledWith('old-file', 'org-1');
    });

    it('updateDesign keeps the previous preview file when the id is unchanged', async () => {
      fileService.getFileById.mockResolvedValue({ id: 'same-file' });
      repository.findById.mockResolvedValue({ id: 'd1', previewFileId: 'same-file' });

      await service.updateDesign('org-1', 'd1', { previewFileId: 'same-file' });

      expect(fileService.softDelete).not.toHaveBeenCalled();
    });

    it('updateDesign clears previewFileId and deletes the old file on a data-URL fallback', async () => {
      repository.findById.mockResolvedValue({ id: 'd1', previewFileId: 'old-file' });

      await service.updateDesign('org-1', 'd1', {
        previewDataUrl: 'data:image/jpeg;base64,ccc',
      });

      expect(repository.update).toHaveBeenCalledWith(
        'd1',
        'org-1',
        expect.objectContaining({
          previewDataUrl: 'data:image/jpeg;base64,ccc',
          previewFileId: null,
        })
      );
      expect(fileService.softDelete).toHaveBeenCalledWith('old-file', 'org-1');
    });

    it('updateDesign does not touch preview files when no preview is in the payload', async () => {
      await service.updateDesign('org-1', 'd1', { name: 'Renamed' });

      expect(repository.findById).not.toHaveBeenCalled();
      expect(fileService.softDelete).not.toHaveBeenCalled();
    });

    it('updateDesign still saves when the old-file deletion fails', async () => {
      fileService.getFileById.mockResolvedValue({ id: 'new-file' });
      repository.findById.mockResolvedValue({ id: 'd1', previewFileId: 'old-file' });
      repository.update.mockResolvedValue({ id: 'd1' });
      fileService.softDelete.mockRejectedValue(new Error('storage down'));

      await expect(
        service.updateDesign('org-1', 'd1', { previewFileId: 'new-file' })
      ).resolves.toEqual({ id: 'd1' });
    });

    it('updateTemplate soft-deletes the previous thumbnail file when it is replaced', async () => {
      fileService.getFileById.mockResolvedValue({ id: 'new-thumb' });
      repository.findTemplateForOrg.mockResolvedValue({
        id: 't1',
        thumbnailFileId: 'old-thumb',
      });

      await service.updateTemplate('org-1', 't1', { thumbnailFileId: 'new-thumb' });

      expect(repository.updateTemplate).toHaveBeenCalledWith(
        't1',
        'org-1',
        expect.objectContaining({ thumbnailFileId: 'new-thumb' })
      );
      expect(fileService.softDelete).toHaveBeenCalledWith('old-thumb', 'org-1');
    });

    it('updateTemplate still saves when the old-file deletion fails', async () => {
      fileService.getFileById.mockResolvedValue({ id: 'new-thumb' });
      repository.findTemplateForOrg.mockResolvedValue({
        id: 't1',
        thumbnailFileId: 'old-thumb',
      });
      repository.updateTemplate.mockResolvedValue({ id: 't1' });
      fileService.softDelete.mockRejectedValue(new Error('storage down'));

      await expect(
        service.updateTemplate('org-1', 't1', { thumbnailFileId: 'new-thumb' })
      ).resolves.toEqual({ id: 't1' });
    });
  });
});
