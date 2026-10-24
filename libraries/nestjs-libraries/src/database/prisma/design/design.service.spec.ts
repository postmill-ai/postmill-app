import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { zipSync, strToU8 } from 'fflate';
import { Readable } from 'stream';
import * as postmillFile from '@postmill-ai/nestjs-libraries/media/designer-doc/postmill-file';
import { DesignService } from './design.service';
import { DesignerDocService } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.service';
import { DESIGNER_DOC_VERSION } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import {
  POSTMILL_FILE_TYPE,
  POSTMILL_FORMAT_VERSION,
  buildPostmillFile,
  buildPostmillManifest,
  parsePostmillFile,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/postmill-file';

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
    setTemplateThumbnail: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findTemplateForOrg: ReturnType<typeof vi.fn>;
    findByOrg: ReturnType<typeof vi.fn>;
    countByOrg: ReturnType<typeof vi.fn>;
    findTemplatesByOrg: ReturnType<typeof vi.fn>;
    countTemplatesByOrg: ReturnType<typeof vi.fn>;
    findDesignsForPreviewRegen: ReturnType<typeof vi.fn>;
    findTemplatesForPreviewRegen: ReturnType<typeof vi.fn>;
    createFolder: ReturnType<typeof vi.fn>;
    getFolder: ReturnType<typeof vi.fn>;
    updateFolder: ReturnType<typeof vi.fn>;
    deleteFolder: ReturnType<typeof vi.fn>;
    countFolderActiveContents: ReturnType<typeof vi.fn>;
    getFolderTree: ReturnType<typeof vi.fn>;
    moveTemplate: ReturnType<typeof vi.fn>;
    createVersion: ReturnType<typeof vi.fn>;
    listVersions: ReturnType<typeof vi.fn>;
    findVersion: ReturnType<typeof vi.fn>;
    deleteVersion: ReturnType<typeof vi.fn>;
    trimVersions: ReturnType<typeof vi.fn>;
  };
  let fileService: {
    importFromUrl: ReturnType<typeof vi.fn>;
    getFileById: ReturnType<typeof vi.fn>;
    softDelete: ReturnType<typeof vi.fn>;
    saveFile: ReturnType<typeof vi.fn>;
    backfillDesignMetadata: ReturnType<typeof vi.fn>;
  };
  let previewService: {
    renderPreviewBuffer: ReturnType<typeof vi.fn>;
    uploadPreview: ReturnType<typeof vi.fn>;
  };
  let storageService: {
    getLocalAdapterForOrg: ReturnType<typeof vi.fn>;
    resolveAdapterForFolder: ReturnType<typeof vi.fn>;
  };
  let brandsService: {
    getCustomFonts: ReturnType<typeof vi.fn>;
    addCustomFont: ReturnType<typeof vi.fn>;
  };
  let videoThumbnailService: {
    backfillOrgThumbnails: ReturnType<typeof vi.fn>;
  };
  let service: DesignService;

  beforeEach(() => {
    repository = {
      create: vi.fn(),
      update: vi.fn(),
      createTemplate: vi.fn(),
      updateTemplate: vi.fn(),
      setTemplateThumbnail: vi.fn(),
      findById: vi.fn(),
      findTemplateForOrg: vi.fn(),
      findByOrg: vi.fn(),
      countByOrg: vi.fn(),
      findTemplatesByOrg: vi.fn(),
      countTemplatesByOrg: vi.fn(),
      findDesignsForPreviewRegen: vi.fn(),
      findTemplatesForPreviewRegen: vi.fn(),
      createFolder: vi.fn(),
      getFolder: vi.fn(),
      updateFolder: vi.fn(),
      deleteFolder: vi.fn(),
      countFolderActiveContents: vi.fn(),
      getFolderTree: vi.fn(),
      moveTemplate: vi.fn(),
      createVersion: vi.fn(),
      listVersions: vi.fn(),
      findVersion: vi.fn(),
      deleteVersion: vi.fn(),
      trimVersions: vi.fn(),
    };
    fileService = {
      importFromUrl: vi.fn(),
      getFileById: vi.fn(),
      softDelete: vi.fn(),
      saveFile: vi.fn(),
      backfillDesignMetadata: vi
        .fn()
        .mockResolvedValue({ scanned: 0, updated: 0, skipped: 0, failed: 0 }),
    };
    previewService = {
      renderPreviewBuffer: vi.fn(),
      uploadPreview: vi.fn(),
    };
    storageService = {
      getLocalAdapterForOrg: vi.fn(),
      resolveAdapterForFolder: vi.fn(),
    };
    brandsService = {
      getCustomFonts: vi.fn().mockResolvedValue([]),
      addCustomFont: vi.fn(),
    };
    videoThumbnailService = {
      backfillOrgThumbnails: vi
        .fn()
        .mockResolvedValue({ scanned: 0, generated: 0, failed: 0 }),
    };
    service = new DesignService(
      repository as any,
      new DesignerDocService(),
      fileService as any,
      previewService as any,
      storageService as any,
      brandsService as any,
      videoThumbnailService as any
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

  describe('listTemplates', () => {
    it('slims each doc to its mode and maps the thumbnail file', async () => {
      repository.findTemplatesByOrg.mockResolvedValue([
        {
          id: 't1',
          name: 'Video Ad',
          doc: makeDoc({ doc: { mode: 'video' } }),
          thumbnailFile: { path: '/uploads/thumb.jpg' },
        },
        {
          id: 't2',
          name: 'Square',
          doc: makeDoc(),
          thumbnailFile: null,
        },
      ]);

      const out = await service.listTemplates('org-1');

      // The gallery reads the mode (badge/bucketing/confirm) but never the
      // document — the apply flow fetches it via getTemplate.
      expect(out[0].doc).toEqual({ mode: 'video' });
      expect(out[0].thumbnail).toBe('/uploads/thumb.jpg');
      expect(out[1].doc).toEqual({ mode: 'image' });
      expect(out[1].thumbnail).toBeNull();
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

  describe('template folders', () => {
    it('createFolder validates the parent belongs to the org', async () => {
      repository.getFolder.mockResolvedValue({ id: 'f0' });

      await service.createFolder('org-1', { name: 'Ads', parentId: 'f0' });

      expect(repository.createFolder).toHaveBeenCalledWith('org-1', {
        name: 'Ads',
        parentId: 'f0',
      });
    });

    it('createFolder rejects a foreign parent folder', async () => {
      repository.getFolder.mockResolvedValue(null);

      await expect(
        service.createFolder('org-1', { name: 'Ads', parentId: 'foreign' })
      ).rejects.toThrow(NotFoundException);
      expect(repository.createFolder).not.toHaveBeenCalled();
    });

    it('updateFolder 404s on a missing folder', async () => {
      repository.getFolder.mockResolvedValue(null);

      await expect(
        service.updateFolder('org-1', 'nope', { name: 'x' })
      ).rejects.toThrow(NotFoundException);
      expect(repository.updateFolder).not.toHaveBeenCalled();
    });

    it('deleteFolder 404s on a missing folder and delegates otherwise', async () => {
      repository.getFolder.mockResolvedValueOnce(null);
      await expect(service.deleteFolder('org-1', 'nope')).rejects.toThrow(NotFoundException);

      repository.getFolder.mockResolvedValueOnce({ id: 'f1' });
      repository.countFolderActiveContents.mockResolvedValue({ templates: 0, children: 0 });
      repository.deleteFolder.mockResolvedValue({ id: 'f1' });
      expect(await service.deleteFolder('org-1', 'f1')).toEqual({ id: 'f1' });
    });

    it('deleteFolder rejects a non-empty folder with a readable 400', async () => {
      repository.getFolder.mockResolvedValueOnce({ id: 'f1' });
      repository.countFolderActiveContents.mockResolvedValue({ templates: 2, children: 0 });

      await expect(service.deleteFolder('org-1', 'f1')).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.deleteFolder).not.toHaveBeenCalled();
    });

    it('deleteFolder with force unfiles contents instead of rejecting', async () => {
      repository.getFolder.mockResolvedValueOnce({ id: 'f1' });
      repository.deleteFolder.mockResolvedValue({ id: 'f1' });

      expect(await service.deleteFolder('org-1', 'f1', true)).toEqual({ id: 'f1' });
      // The emptiness check is skipped entirely in force mode.
      expect(repository.countFolderActiveContents).not.toHaveBeenCalled();
    });

    it('moveTemplate moves an org-owned template into an owned folder', async () => {
      repository.findTemplateForOrg.mockResolvedValue({
        id: 't1',
        organizationId: 'org-1',
        isSystem: false,
      });
      repository.getFolder.mockResolvedValue({ id: 'f1' });

      await service.moveTemplate('org-1', 't1', 'f1');

      expect(repository.moveTemplate).toHaveBeenCalledWith('org-1', 't1', 'f1');
    });

    it('moveTemplate null moves a template back to root without a folder lookup', async () => {
      repository.findTemplateForOrg.mockResolvedValue({
        id: 't1',
        organizationId: 'org-1',
        isSystem: false,
      });

      await service.moveTemplate('org-1', 't1', null);

      expect(repository.getFolder).not.toHaveBeenCalled();
      expect(repository.moveTemplate).toHaveBeenCalledWith('org-1', 't1', null);
    });

    it('moveTemplate rejects a system template (organizationId null)', async () => {
      repository.findTemplateForOrg.mockResolvedValue({
        id: 't1',
        organizationId: null,
        isSystem: true,
      });

      await expect(service.moveTemplate('org-1', 't1', 'f1')).rejects.toThrow(
        NotFoundException
      );
      expect(repository.moveTemplate).not.toHaveBeenCalled();
    });

    it('moveTemplate rejects a foreign folder', async () => {
      repository.findTemplateForOrg.mockResolvedValue({
        id: 't1',
        organizationId: 'org-1',
        isSystem: false,
      });
      repository.getFolder.mockResolvedValue(null);

      await expect(service.moveTemplate('org-1', 't1', 'foreign')).rejects.toThrow(
        NotFoundException
      );
      expect(repository.moveTemplate).not.toHaveBeenCalled();
    });

    it('resolveOwnedFolderId returns undefined for missing or foreign folders', async () => {
      expect(await service.resolveOwnedFolderId('org-1', null)).toBeUndefined();

      repository.getFolder.mockResolvedValue(null);
      expect(await service.resolveOwnedFolderId('org-1', 'foreign')).toBeUndefined();

      repository.getFolder.mockResolvedValue({ id: 'f1' });
      expect(await service.resolveOwnedFolderId('org-1', 'f1')).toBe('f1');
    });

    it('createTemplate attaches an owned folderId and drops a foreign one', async () => {
      repository.getFolder.mockResolvedValue({ id: 'f1' });
      await service.createTemplate({
        organizationId: 'org-1',
        name: 'Tmpl',
        category: 'social',
        doc: makeDoc(),
        folderId: 'f1',
      });
      expect(repository.createTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ folderId: 'f1' })
      );

      repository.createTemplate.mockClear();
      repository.getFolder.mockResolvedValue(null);
      await service.createTemplate({
        organizationId: 'org-1',
        name: 'Tmpl',
        category: 'social',
        doc: makeDoc(),
        folderId: 'foreign',
      });
      expect(repository.createTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ folderId: undefined })
      );
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

  describe('version history', () => {
    const designRow = () => ({
      id: 'd1',
      organizationId: 'org-1',
      name: 'Live',
      doc: makeDoc(),
      width: 1080,
      height: 1080,
      previewDataUrl: null,
      deletedAt: null,
    });

    it('createVersion snapshots the validated doc and enforces the named cap', async () => {
      repository.findById.mockResolvedValue(designRow());
      repository.createVersion.mockResolvedValue({ id: 'v1' });
      repository.trimVersions.mockResolvedValue(0);

      await service.createVersion('org-1', 'user-1', 'd1', { name: 'Before launch' });

      expect(repository.createVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          designId: 'd1',
          organizationId: 'org-1',
          name: 'Before launch',
          auto: false,
          createdById: 'user-1',
          width: 1080,
          height: 1080,
          doc: expect.objectContaining({ mode: 'image' }),
        })
      );
      expect(repository.trimVersions).toHaveBeenCalledWith('d1', false, 20);
    });

    it('createVersion trims auto snapshots against the smaller auto cap', async () => {
      repository.findById.mockResolvedValue(designRow());
      repository.createVersion.mockResolvedValue({ id: 'v2' });
      repository.trimVersions.mockResolvedValue(0);

      await service.createVersion('org-1', 'user-1', 'd1', { auto: true });

      expect(repository.trimVersions).toHaveBeenCalledWith('d1', true, 10);
    });

    it('createVersion 404s on a missing design and never writes', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.createVersion('org-1', 'user-1', 'gone', {})
      ).rejects.toThrow(NotFoundException);
      expect(repository.createVersion).not.toHaveBeenCalled();
    });

    it('restoreVersion snapshots the live doc (auto) BEFORE overwriting', async () => {
      const versionDoc = makeDoc({ output: { name: 'Old layout' } });
      repository.findById.mockResolvedValue(designRow());
      repository.findVersion.mockResolvedValue({
        id: 'v1',
        designId: 'd1',
        doc: versionDoc,
      });
      repository.createVersion.mockResolvedValue({ id: 'auto-1' });
      repository.trimVersions.mockResolvedValue(0);
      repository.update.mockResolvedValue({ id: 'd1' });

      await service.restoreVersion('org-1', 'user-1', 'd1', 'v1');

      // Snapshot ran with auto:true before the design update.
      const snapshotOrder = repository.createVersion.mock.invocationCallOrder[0];
      const updateOrder = repository.update.mock.invocationCallOrder[0];
      expect(snapshotOrder).toBeLessThan(updateOrder);
      expect(repository.createVersion).toHaveBeenCalledWith(
        expect.objectContaining({ designId: 'd1', auto: true })
      );
      expect(repository.update).toHaveBeenCalledWith(
        'd1',
        'org-1',
        expect.objectContaining({
          doc: expect.objectContaining({ mode: 'image' }),
        })
      );
    });

    it('restoreVersion 404s on a foreign/unknown version', async () => {
      repository.findById.mockResolvedValue(designRow());
      repository.findVersion.mockResolvedValue(null);

      await expect(
        service.restoreVersion('org-1', 'user-1', 'd1', 'nope')
      ).rejects.toThrow(NotFoundException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('deleteVersion removes the row and confirms', async () => {
      repository.findVersion.mockResolvedValue({ id: 'v1', designId: 'd1' });
      repository.deleteVersion.mockResolvedValue({ count: 1 });

      await expect(
        service.deleteVersion('org-1', 'd1', 'v1')
      ).resolves.toEqual({ success: true });
      expect(repository.deleteVersion).toHaveBeenCalledWith('org-1', 'd1', 'v1');
    });
  });

  describe('listTemplates pagination', () => {
    it('without params returns the plain array and never counts', async () => {
      repository.findTemplatesByOrg.mockResolvedValue([
        { id: 't1', doc: { mode: 'image' }, thumbnailFile: null },
      ]);

      const out = await service.listTemplates('org-1');

      expect(Array.isArray(out)).toBe(true);
      expect((out as any[])[0]).toMatchObject({ id: 't1', thumbnail: null });
      expect(repository.findTemplatesByOrg).toHaveBeenCalledWith('org-1');
      expect(repository.countTemplatesByOrg).not.toHaveBeenCalled();
    });

    it('with page/limit returns the envelope and pages the repository', async () => {
      repository.findTemplatesByOrg.mockResolvedValue([
        { id: 't2', doc: { mode: 'video' }, thumbnailFile: { path: '/up/t2.png' } },
      ]);
      repository.countTemplatesByOrg.mockResolvedValue(42);

      const out = await service.listTemplates('org-1', 2, 24);

      expect(repository.findTemplatesByOrg).toHaveBeenCalledWith('org-1', 2, 24);
      expect(repository.countTemplatesByOrg).toHaveBeenCalledWith('org-1');
      expect(out).toMatchObject({ total: 42, page: 2, limit: 24 });
      // Same slimmed mapping as the plain-array shape.
      expect((out as any).templates[0]).toMatchObject({
        id: 't2',
        doc: { mode: 'video' },
        thumbnail: '/up/t2.png',
      });
    });
  });

  describe('video preview regen on save', () => {
    const videoDoc = {
      mode: 'video',
      outputs: [
        {
          id: 'out-1',
          formatId: 'reel',
          name: 'Reel',
          width: 1080,
          height: 1920,
          fps: 30,
          durationMs: 5000,
          tracks: [],
        },
      ],
    };

    beforeEach(() => {
      // Pass-through validation: these tests exercise the regen behavior, not
      // the doc schema.
      (service as any)._designerDocService = { validate: (d: any) => d };
      fileService.getFileById.mockResolvedValue({ id: 'client-file' });
    });

    it('createDesign regenerates the preview server-side for a video doc', async () => {
      previewService.renderPreviewBuffer.mockResolvedValue(Buffer.from('png'));
      previewService.uploadPreview.mockResolvedValue('regen-file');

      await service.createDesign('org-1', 'user-1', {
        name: 'Video',
        doc: videoDoc,
        previewFileId: 'client-file',
      });

      expect(previewService.renderPreviewBuffer).toHaveBeenCalled();
      expect(previewService.uploadPreview).toHaveBeenCalledWith('org-1', Buffer.from('png'));
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ previewFileId: 'regen-file' })
      );
      // The superseded client snapshot is trashed.
      expect(fileService.softDelete).toHaveBeenCalledWith('client-file', 'org-1');
    });

    it('createDesign keeps the client preview when regen fails', async () => {
      previewService.renderPreviewBuffer.mockRejectedValue(new Error('no canvas'));

      await service.createDesign('org-1', 'user-1', {
        name: 'Video',
        doc: videoDoc,
        previewFileId: 'client-file',
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ previewFileId: 'client-file' })
      );
    });

    it('createDesign does not render a preview for an image doc', async () => {
      await service.createDesign('org-1', 'user-1', {
        name: 'Image',
        doc: makeDoc(),
      });

      expect(previewService.renderPreviewBuffer).not.toHaveBeenCalled();
    });

    it('updateDesign regenerates once per design inside the throttle window', async () => {
      previewService.renderPreviewBuffer.mockResolvedValue(Buffer.from('png'));
      previewService.uploadPreview.mockResolvedValue('regen-file');
      repository.findById.mockResolvedValue({ id: 'd1', previewFileId: 'old-file' });

      await service.updateDesign('org-1', 'd1', { doc: videoDoc });
      await service.updateDesign('org-1', 'd1', { doc: videoDoc });

      expect(previewService.renderPreviewBuffer).toHaveBeenCalledTimes(1);
      // The first (un-throttled) save wrote the regen preview.
      expect(repository.update).toHaveBeenNthCalledWith(
        1,
        'd1',
        'org-1',
        expect.objectContaining({ previewFileId: 'regen-file' })
      );
      expect(fileService.softDelete).toHaveBeenCalledWith('old-file', 'org-1');
    });

    it('updateDesign still saves the doc when regen fails', async () => {
      previewService.renderPreviewBuffer.mockRejectedValue(new Error('render down'));
      repository.findById.mockResolvedValue({ id: 'd1', previewFileId: 'old-file' });

      await service.updateDesign('org-1', 'd1', {
        doc: videoDoc,
        previewDataUrl: 'data:image/jpeg;base64,zzz',
      });

      expect(repository.update).toHaveBeenCalledWith(
        'd1',
        'org-1',
        expect.objectContaining({
          doc: expect.objectContaining({ mode: 'video' }),
        })
      );
    });
  });

  describe('regenPreviews', () => {
    const imageDoc = { mode: 'image', outputs: [{ children: [{ type: 'text' }] }] };
    const blankDoc = { mode: 'image', outputs: [{ children: [] }] };
    const videoDoc = { mode: 'video', outputs: [{ tracks: [{ clips: [{ id: 'c1' }] }] }] };

    beforeEach(() => {
      // Pass-through validation: these tests exercise the selection rule, not
      // the doc schema.
      (service as any)._designerDocService = { validate: (d: any) => d };
      previewService.renderPreviewBuffer.mockResolvedValue(Buffer.from('png'));
      previewService.uploadPreview.mockResolvedValue('new-file');
      repository.findDesignsForPreviewRegen.mockResolvedValue([
        // Missing preview AND non-blank → regen.
        { id: 'd1', doc: imageDoc, previewFileId: null, previewDataUrl: null },
        // Video mode → regen even though a preview exists.
        { id: 'd2', doc: videoDoc, previewFileId: 'old-file', previewDataUrl: null },
        // Image doc with a preview → skipped.
        { id: 'd3', doc: imageDoc, previewFileId: 'keep-file', previewDataUrl: null },
        // Blank doc → skipped even though the preview is missing.
        { id: 'd4', doc: blankDoc, previewFileId: null, previewDataUrl: null },
      ]);
      repository.findTemplatesForPreviewRegen.mockResolvedValue([
        { id: 't1', organizationId: 'org-1', doc: imageDoc, thumbnailFileId: null },
        { id: 't2', organizationId: 'org-1', doc: imageDoc, thumbnailFileId: 'keep-thumb' },
        // System template (shared, organizationId null) with no thumbnail →
        // regen via the minimal unscoped thumbnail write.
        { id: 't3', organizationId: null, doc: imageDoc, thumbnailFileId: null },
      ]);
    });

    it('regenerates missing previews and video docs, skips the rest', async () => {
      const result = await service.regenPreviews('org-1');

      expect(repository.update).toHaveBeenCalledTimes(2);
      expect(repository.update).toHaveBeenCalledWith(
        'd1',
        'org-1',
        expect.objectContaining({ previewFileId: 'new-file' })
      );
      expect(repository.update).toHaveBeenCalledWith(
        'd2',
        'org-1',
        expect.objectContaining({ previewFileId: 'new-file' })
      );
      expect(repository.updateTemplate).toHaveBeenCalledTimes(1);
      expect(repository.updateTemplate).toHaveBeenCalledWith(
        't1',
        'org-1',
        expect.objectContaining({ thumbnailFileId: 'new-file' })
      );
      expect(repository.setTemplateThumbnail).toHaveBeenCalledTimes(1);
      expect(repository.setTemplateThumbnail).toHaveBeenCalledWith('t3', 'new-file');
      expect(result).toEqual({
        videoThumbnails: { scanned: 0, generated: 0, failed: 0 },
        designFileMetadata: { scanned: 0, updated: 0, skipped: 0, failed: 0 },
        designs: { scanned: 4, regenerated: 2, skipped: 2, failed: 0 },
        templates: { scanned: 3, regenerated: 2, skipped: 1, failed: 0 },
      });
      // Missing video file thumbnails are backfilled BEFORE the preview sweep.
      expect(videoThumbnailService.backfillOrgThumbnails).toHaveBeenCalledWith('org-1');
      // The replaced stored preview file is trashed.
      expect(fileService.softDelete).toHaveBeenCalledWith('old-file', 'org-1');
    });

    it('counts a per-item failure without aborting the run', async () => {
      previewService.renderPreviewBuffer
        .mockRejectedValueOnce(new Error('bad doc'))
        .mockResolvedValue(Buffer.from('png'));

      const result = await service.regenPreviews('org-1');

      expect(result.designs.failed + result.templates.failed).toBe(1);
      expect(result.designs.regenerated + result.templates.regenerated).toBe(3);
    });
  });

  describe('importLibraryDesign', () => {
    const snapshot = () => Buffer.from(buildPostmillFile(makeDoc({
      doc: { version: DESIGNER_DOC_VERSION },
      output: {
        id: 'source-output',
        children: [{
          id: 'source-element',
          type: 'text',
          x: 0,
          y: 0,
          width: 100,
          height: 50,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          text: 'Exported snapshot',
        }],
      },
    }) as any, 'Snapshot'));

    it('rejects a missing or foreign file without reading storage', async () => {
      fileService.getFileById.mockResolvedValue(null);

      await expect(service.importLibraryDesign('org-1', 'user-1', 'file-1'))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(storageService.resolveAdapterForFolder).not.toHaveBeenCalled();
    });

    it('rejects non-pdesign and over-1GB files', async () => {
      fileService.getFileById.mockResolvedValueOnce({
        id: 'file-1', name: 'image.png', originalName: null, fileSize: 10,
      });
      await expect(service.importLibraryDesign('org-1', 'user-1', 'file-1'))
        .rejects.toBeInstanceOf(BadRequestException);

      fileService.getFileById.mockResolvedValueOnce({
        id: 'file-1', name: 'huge.pdesign', originalName: null,
        fileSize: 1024 * 1024 * 1024 + 1,
      });
      await expect(service.importLibraryDesign('org-1', 'user-1', 'file-1'))
        .rejects.toThrow(/max 1 GB/);
      expect(storageService.resolveAdapterForFolder).not.toHaveBeenCalled();
    });

    it('reads through the folder adapter and creates a new design from the snapshot', async () => {
      const bytes = snapshot();
      const readFile = vi.fn().mockResolvedValue(bytes);
      storageService.resolveAdapterForFolder.mockResolvedValue({ readFile });
      fileService.getFileById.mockResolvedValue({
        id: 'file-1',
        name: 'generated-storage-name',
        originalName: 'original.pdesign',
        path: 'org/file.zip',
        folderId: 'folder-1',
        fileSize: bytes.length,
      });
      repository.create.mockImplementation((payload: any) => ({ id: 'new-design', ...payload }));

      const created = await service.importLibraryDesign('org-1', 'user-1', 'file-1');

      expect(storageService.resolveAdapterForFolder).toHaveBeenCalledWith('folder-1', 'org-1');
      expect(readFile).toHaveBeenCalledWith('org/file.zip');
      expect(created.id).toBe('new-design');
      expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
        organizationId: 'org-1',
        createdById: 'user-1',
        name: 'Snapshot',
        doc: expect.objectContaining({
          outputs: [expect.objectContaining({
            id: expect.not.stringMatching('source-output'),
            children: [expect.objectContaining({
              id: expect.not.stringMatching('source-element'),
              text: 'Exported snapshot',
            })],
          })],
        }),
      }));
      expect(repository.update).not.toHaveBeenCalled();
      expect(repository.updateTemplate).not.toHaveBeenCalled();
    });
  });

  describe('importDesign (.pdesign / .json)', () => {
    const docWithIds = () =>
      makeDoc({
        doc: { version: DESIGNER_DOC_VERSION },
        output: {
          id: 'out-source',
          children: [
            {
              id: 'el-source',
              type: 'text',
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
      });

    it('imports a .pdesign: re-mints ids and names the design from the manifest', async () => {
      const bytes = buildPostmillFile(docWithIds() as any, 'Party Invite');
      repository.create.mockImplementation((payload: any) => payload);

      const created = await service.importDesign('org-1', 'user-1', {
        buffer: Buffer.from(bytes),
        originalname: 'whatever.pdesign',
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-1', createdById: 'user-1', name: 'Party Invite' })
      );
      const out = created.doc.outputs[0];
      expect(out.id).not.toBe('out-source');
      expect(out.id).toMatch(/^out-/);
      expect(out.children[0].id).not.toBe('el-source');
      expect(out.children[0].id).toMatch(/^el-/);
      // ...while the content survives verbatim.
      expect(out.children[0].text).toBe('Hello');
    });

    it('uses the capped streaming parser for buffered ZIP imports', async () => {
      const parser = vi.spyOn(postmillFile, 'parsePostmillFileStream');
      try {
        await service.importDesign('org-1', 'user-1', {
          buffer: Buffer.from(buildPostmillFile(docWithIds() as any, 'Buffered')),
          originalname: 'buffered.pdesign',
        });

        expect(parser).toHaveBeenCalledWith(
          expect.any(Readable),
          1024 * 1024 * 1024
        );
      } finally {
        parser.mockRestore();
      }
    });

    it('imports a raw .json DesignerDoc and names it from the filename', async () => {
      repository.create.mockImplementation((payload: any) => payload);

      const created = await service.importDesign('org-1', 'user-1', {
        buffer: Buffer.from(JSON.stringify(docWithIds())),
        originalname: 'My Design.json',
      });

      expect(created.name).toBe('My Design');
      expect(created.doc.outputs[0].id).toMatch(/^out-/);
    });

    it('falls back to "Imported design" when there is no usable name', async () => {
      repository.create.mockImplementation((payload: any) => payload);

      const created = await service.importDesign('org-1', 'user-1', {
        buffer: Buffer.from(JSON.stringify(docWithIds())),
      });

      expect(created.name).toBe('Imported design');
    });

    it('rejects a .pdesign whose doc is newer than this Postmill with a dedicated message', async () => {
      const bytes = zipSync({
        'manifest.json': strToU8(
          JSON.stringify({ type: POSTMILL_FILE_TYPE, formatVersion: 1, name: 'Future' })
        ),
        'doc.json': strToU8(JSON.stringify(docWithIds())),
      });
      // Simulate a file from the future: docVersion above what we understand.
      const future = parsePostmillFile(bytes);
      const bumped = buildPostmillFile(
        { ...(future.doc as any), version: DESIGNER_DOC_VERSION + 1 },
        'Future'
      );

      await expect(
        service.importDesign('org-1', 'user-1', { buffer: Buffer.from(bumped), originalname: 'f.pdesign' })
      ).rejects.toThrow(/newer version of Postmill/);
    });

    it('rejects a raw .json whose doc version is newer than supported', async () => {
      const doc = { ...docWithIds(), version: DESIGNER_DOC_VERSION + 1 };
      await expect(
        service.importDesign('org-1', 'user-1', {
          buffer: Buffer.from(JSON.stringify(doc)),
          originalname: 'f.json',
        })
      ).rejects.toThrow(/newer version of Postmill/);
    });

    it('rejects non-zip garbage with a 400', async () => {
      await expect(
        service.importDesign('org-1', 'user-1', {
          buffer: Buffer.from('this is not a design file'),
          originalname: 'notes.json',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a schema-invalid doc with the shared Invalid DesignerDoc shape', async () => {
      await expect(
        service.importDesign('org-1', 'user-1', {
          buffer: Buffer.from(JSON.stringify({ version: 8, mode: 'image', outputs: [] })),
          originalname: 'bad.json',
        })
      ).rejects.toThrow(BadRequestException);
    });

    describe('v2 bundled assets', () => {
      // A 1x1 transparent PNG.
      const PNG_BYTES = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64'
      );

      const docWithMedia = () =>
        makeDoc({
          doc: { version: DESIGNER_DOC_VERSION },
          output: {
            id: 'out-src',
            children: [
              {
                id: 'el-src',
                type: 'image',
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                rotation: 0,
                opacity: 1,
                locked: false,
                hidden: false,
                fileId: 'old-file-1',
                src: '/uploads/org-a/aaaa.png',
              },
            ],
          },
        });

      const v2Bundle = (opts: { withFont?: boolean; doc?: any } = {}) => {
        const manifest = buildPostmillManifest(
          opts.doc ?? docWithMedia(),
          'Bundled Design',
          {
            'old-file-1': {
              path: 'assets/old-file-1.png',
              mime: 'image/png',
              originalName: 'hero.png',
              size: PNG_BYTES.length,
            },
          },
          opts.withFont
            ? [{ family: 'Acme', weight: 700, italic: true, path: 'assets/fonts/acme-700i.ttf' }]
            : undefined
        );
        return zipSync({
          'manifest.json': strToU8(JSON.stringify(manifest)),
          'doc.json': strToU8(JSON.stringify(opts.doc ?? docWithMedia())),
          'assets/old-file-1.png': new Uint8Array(PNG_BYTES),
          ...(opts.withFont
            ? // Minimal TTF header bytes — the local adapter only sniffs.
              { 'assets/fonts/acme-700i.ttf': new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x00, 0x00]) }
            : {}),
        });
      };

      const mockLocalAdapter = () => {
        const adapter = {
          writeBuffer: vi.fn().mockResolvedValue('https://host.test/uploads/org-1/newpath.png'),
          uploadFile: vi.fn().mockResolvedValue({
            filename: 'newfont.ttf',
            originalname: 'newfont.ttf',
            path: 'https://host.test/uploads/org-1/newfont.ttf',
          }),
          readFile: vi.fn(),
        };
        storageService.getLocalAdapterForOrg.mockResolvedValue(adapter);
        return adapter;
      };

      it('re-uploads bundled assets and remaps fileId + paired src', async () => {
        const adapter = mockLocalAdapter();
        fileService.saveFile.mockResolvedValue({ id: 'new-file-1' });
        repository.create.mockImplementation((payload: any) => payload);

        const created = await service.importDesign('org-1', 'user-1', {
          buffer: Buffer.from(v2Bundle()),
          originalname: 'bundle.pdesign',
        });

        expect(adapter.writeBuffer).toHaveBeenCalledTimes(1);
        expect(fileService.saveFile).toHaveBeenCalledWith(
          'org-1', 'hero.png', 'https://host.test/uploads/org-1/newpath.png', 'hero.png', undefined, PNG_BYTES.length
        );
        const el = created.doc.outputs[0].children[0];
        expect(el.fileId).toBe('new-file-1');
        expect(el.src).toBe('https://host.test/uploads/org-1/newpath.png');
        // ids re-minted, content intact
        expect(el.id).toMatch(/^el-/);
        expect(created.name).toBe('Bundled Design');
      });

      it('restores bundled fonts through the deduped addCustomFont path', async () => {
        mockLocalAdapter();
        fileService.saveFile.mockResolvedValue({ id: 'new-file-1' });
        repository.create.mockImplementation((payload: any) => payload);

        await service.importDesign('org-1', 'user-1', {
          buffer: Buffer.from(v2Bundle({ withFont: true })),
          originalname: 'bundle.pdesign',
        });

        expect(brandsService.addCustomFont).toHaveBeenCalledWith('org-1', {
          family: 'Acme',
          fileId: 'newfont.ttf',
          path: 'https://host.test/uploads/org-1/newfont.ttf',
          weights: [700],
          italic: true,
          serverRender: true,
        });
      });

      it('imports a v1 file (no assets manifest) exactly like stage 1 — references verbatim', async () => {
        const v1 = zipSync({
          'manifest.json': strToU8(
            JSON.stringify({
              type: POSTMILL_FILE_TYPE,
              formatVersion: 1,
              docVersion: DESIGNER_DOC_VERSION,
              mode: 'image',
              app: 'postmill',
              exportedAt: new Date().toISOString(),
              name: 'V1 File',
            })
          ),
          'doc.json': strToU8(JSON.stringify(docWithMedia())),
        });
        repository.create.mockImplementation((payload: any) => payload);

        const created = await service.importDesign('org-1', 'user-1', {
          buffer: Buffer.from(v1),
          originalname: 'v1.pdesign',
        });

        expect(storageService.getLocalAdapterForOrg).not.toHaveBeenCalled();
        const el = created.doc.outputs[0].children[0];
        expect(el.fileId).toBe('old-file-1');
        expect(el.src).toBe('/uploads/org-a/aaaa.png');
      });

      it('rejects a bundle whose manifest asset has no zip entry (truncated file)', async () => {
        const broken = zipSync({
          'manifest.json': strToU8(
            JSON.stringify(
              buildPostmillManifest(docWithMedia(), 'Broken', {
                'old-file-1': { path: 'assets/old-file-1.png', mime: 'image/png', originalName: 'hero.png', size: 10 },
              })
            )
          ),
          'doc.json': strToU8(JSON.stringify(docWithMedia())),
          // no assets/old-file-1.png entry
        });

        await expect(
          service.importDesign('org-1', 'user-1', { buffer: Buffer.from(broken), originalname: 'x.pdesign' })
        ).rejects.toThrow(/missing the bundled asset/);
      });

      it('rejects a bundled asset the storage layer refuses (clean 400)', async () => {
        const adapter = mockLocalAdapter();
        adapter.writeBuffer.mockRejectedValue(new Error('Unsupported stored artifact type: text/html'));
        repository.create.mockImplementation((payload: any) => payload);

        await expect(
          service.importDesign('org-1', 'user-1', {
            buffer: Buffer.from(v2Bundle()),
            originalname: 'x.pdesign',
          })
        ).rejects.toThrow(/could not be stored/);
      });
    });
  });
});
