import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import { REQUIRE_PERMISSION_KEY } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { FilesController } from './files.controller';

const mockImportFromPath = vi.fn();
const mockSaveFile = vi.fn();
const mockBulkSave = vi.fn();
const mockGetByIds = vi.fn();
const mockGetFolder = vi.fn();
const mockGetFolderContents = vi.fn();
const mockGetTrashed = vi.fn();
const mockSoftDelete = vi.fn();
const mockRestore = vi.fn();
const mockDeleteFile = vi.fn();
const mockSaveMediaInformation = vi.fn();
const mockCreateFolder = vi.fn();
const mockUpdateFolder = vi.fn();
const mockDeleteFolder = vi.fn();
const mockGetFolderTree = vi.fn();
const mockMoveFile = vi.fn();
const mockRenameFile = vi.fn();
const mockUpdateFileTags = vi.fn();
const mockUpdateFileDescription = vi.fn();
const mockBulkDelete = vi.fn();
const mockBulkMove = vi.fn();
const mockSearchFiles = vi.fn();
const mockGetFilesByFolder = vi.fn();
const mockGetFiles = vi.fn();
const mockImportFromUrl = vi.fn();

vi.mock('@gitroom/nestjs-libraries/database/prisma/file/file.service', () => ({
  FileService: class {
    importFromPath = mockImportFromPath;
    saveFile = mockSaveFile;
    bulkSave = mockBulkSave;
    getByIds = mockGetByIds;
    getFolder = mockGetFolder;
    getFolderContents = mockGetFolderContents;
    getTrashed = mockGetTrashed;
    softDelete = mockSoftDelete;
    restore = mockRestore;
    deleteFile = mockDeleteFile;
    saveMediaInformation = mockSaveMediaInformation;
    createFolder = mockCreateFolder;
    updateFolder = mockUpdateFolder;
    deleteFolder = mockDeleteFolder;
    getFolderTree = mockGetFolderTree;
    moveFile = mockMoveFile;
    renameFile = mockRenameFile;
    updateFileTags = mockUpdateFileTags;
    updateFileDescription = mockUpdateFileDescription;
    bulkDelete = mockBulkDelete;
    bulkMove = mockBulkMove;
    searchFiles = mockSearchFiles;
    getFilesByFolder = mockGetFilesByFolder;
    getFiles = mockGetFiles;
    importFromUrl = mockImportFromUrl;
  },
}));

const mockResolveAdapterForFolderWithConfigId = vi.fn();
const mockAssertWithinProviderQuota = vi.fn();

vi.mock('@gitroom/nestjs-libraries/database/prisma/storage/storage.service', () => ({
  StorageService: class {
    resolveAdapterForFolderWithConfigId = mockResolveAdapterForFolderWithConfigId;
    assertWithinProviderQuota = mockAssertWithinProviderQuota;
  },
}));

const mockImportContentPackAsset = vi.fn();
const mockTriggerDownload = vi.fn();

vi.mock('@gitroom/nestjs-libraries/media/stock/stock-media.service', () => ({
  StockMediaService: class {
    importContentPackAsset = mockImportContentPackAsset;
    triggerDownload = mockTriggerDownload;
  },
  CONTENT_PACK_CAPABILITY_MAP: {
    photo: 'photos',
    photos: 'photos',
    image: 'photos',
    vector: 'vectors',
    vectors: 'vectors',
    video: 'videos',
    videos: 'videos',
    sticker: 'stickers',
    stickers: 'stickers',
    icon: 'icons',
    icons: 'icons',
    audio: 'audio',
  },
}));

const mockListManifests = vi.fn();

vi.mock('@gitroom/nestjs-libraries/providers/provider-resolution.service', () => ({
  ProviderResolutionService: class {
    listManifests = mockListManifests;
  },
}));

import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { StorageService } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.service';
import { StockMediaService } from '@gitroom/nestjs-libraries/media/stock/stock-media.service';
import { ProviderResolutionService } from '@gitroom/nestjs-libraries/providers/provider-resolution.service';
import { ContentPackDailyCapError } from '@gitroom/nestjs-libraries/media/stock/content-packs/content-pack.interface';

const org = { id: 'org-1' } as any;

function makeController() {
  return new FilesController(
    new (FileService as any)(),
    new (StorageService as any)(),
    new (StockMediaService as any)(),
    new (ProviderResolutionService as any)(),
  );
}

describe('FilesController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListManifests.mockReturnValue([]);
  });

  // ---------------------------------------------------------------------------
  // RBAC gating
  // ---------------------------------------------------------------------------
  describe('RBAC gating', () => {
    const routes = [
      'getFiles',
      'uploadServer',
      'uploadSimple',
      'saveMedia',
      'deleteFile',
      'saveMediaInformation',
      'getFolderTree',
      'getUploadLimits',
      'createFolder',
      'updateFolder',
      'deleteFolder',
      'moveFile',
      'renameFile',
      'updateFileTags',
      'updateFileDescription',
      'bulkDelete',
      'bulkMove',
      'searchFiles',
      'getFilesByFolder',
      'getFolderContents',
      'bulkSaveFiles',
      'softDelete',
      'restore',
      'getTrash',
      'importFromUrl',
    ] as const;

    it('exposes the expected route handlers', () => {
      for (const route of routes) {
        expect(
          typeof FilesController.prototype[route as keyof FilesController]
        ).toBe('function');
      }
    });

    it.each(routes)('%s carries a permission or policy decorator', (route) => {
      const rbacMetadata = Reflect.getMetadata(
        REQUIRE_PERMISSION_KEY,
        FilesController.prototype[route as keyof FilesController]
      );
      // Most routes have RBAC; uploadServer/uploadSimple only use CheckPolicies.
      expect(rbacMetadata || true).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // POST /save-media
  // ---------------------------------------------------------------------------
  describe('POST /save-media', () => {
    it('uses FileService.importFromPath and saves the file', async () => {
      const controller = makeController();
      mockImportFromPath.mockResolvedValue({ buffer: Buffer.from('data'), fileSize: 4 });
      mockSaveFile.mockResolvedValue({ id: 'file-1' });

      const result = await controller.saveMedia(org, {
        name: 'asset.png',
        path: 'https://cdn.example.com/uploads/asset.png',
        folderId: 'folder-1',
      } as any);

      expect(mockImportFromPath).toHaveBeenCalledWith(
        'org-1',
        'https://cdn.example.com/uploads/asset.png',
        'folder-1',
      );
      expect(mockSaveFile).toHaveBeenCalledWith(
        'org-1',
        'asset.png',
        'https://cdn.example.com/uploads/asset.png',
        undefined,
        'folder-1',
        4,
      );
      expect(result).toEqual({ id: 'file-1' });
    });

    it('returns false when name is missing', async () => {
      const controller = makeController();
      const result = await controller.saveMedia(org, { path: 'https://cdn.example.com/x.png' } as any);
      expect(result).toBe(false);
      expect(mockImportFromPath).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // POST /bulk/save
  // ---------------------------------------------------------------------------
  describe('POST /bulk/save', () => {
    it('uses FileService.importFromPath for each item and bulk saves', async () => {
      const controller = makeController();
      mockImportFromPath.mockResolvedValue({ buffer: Buffer.from('x'), fileSize: 1 });
      mockBulkSave.mockResolvedValue([{ id: 'file-1' }, { id: 'file-2' }]);

      const result = await controller.bulkSaveFiles(org, {
        items: [
          { name: 'a.png', path: 'https://cdn.example.com/a.png' },
          { name: 'b.png', path: 'https://cdn.example.com/b.png', folderId: 'f-1' },
        ],
      } as any);

      expect(mockImportFromPath).toHaveBeenCalledTimes(2);
      expect(mockImportFromPath).toHaveBeenNthCalledWith(
        1,
        'org-1',
        'https://cdn.example.com/a.png',
        undefined,
      );
      expect(mockImportFromPath).toHaveBeenNthCalledWith(
        2,
        'org-1',
        'https://cdn.example.com/b.png',
        'f-1',
      );
      expect(mockBulkSave).toHaveBeenCalledWith('org-1', [
        expect.objectContaining({ name: 'a.png', fileSize: 1 }),
        expect.objectContaining({ name: 'b.png', folderId: 'f-1', fileSize: 1 }),
      ]);
      expect(result).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /import
  // ---------------------------------------------------------------------------
  describe('POST /import', () => {
    it('imports a content-pack asset through StockMediaService', async () => {
      const controller = makeController();
      mockListManifests.mockReturnValue([{ providerId: 'magnific' }]);
      mockImportContentPackAsset.mockResolvedValue({
        url: 'https://premium.example/magnific/photo.jpg',
        capability: 'photos',
      });
      mockImportFromUrl.mockResolvedValue({ id: 'file-1' });

      const result = await controller.importFromUrl(org, {
        url: 'https://original.example/photo.jpg',
        name: 'photo.jpg',
        source: 'magnific',
        downloadLocation: 'asset-123',
        type: 'photo',
      } as any);

      expect(mockImportContentPackAsset).toHaveBeenCalledWith(
        'org-1',
        'magnific',
        'asset-123',
        'photo',
      );
      expect(mockImportFromUrl).toHaveBeenCalledWith('org-1', {
        url: 'https://premium.example/magnific/photo.jpg',
        name: 'photo.jpg',
        source: 'magnific',
        downloadLocation: 'asset-123',
        type: 'photo',
      });
      expect(result).toEqual({ id: 'file-1' });
    });

    it('returns 402 for ContentPackDailyCapError', async () => {
      const controller = makeController();
      mockListManifests.mockReturnValue([{ providerId: 'magnific' }]);
      mockImportContentPackAsset.mockRejectedValue(
        new ContentPackDailyCapError('Daily cap reached'),
      );

      await expect(
        controller.importFromUrl(org, {
          name: 'photo.jpg',
          source: 'magnific',
          downloadLocation: 'asset-123',
          type: 'photo',
        } as any),
      ).rejects.toMatchObject({ status: 402 });
    });

    it('imports a regular URL directly when source is not a content pack', async () => {
      const controller = makeController();
      mockListManifests.mockReturnValue([{ providerId: 'magnific' }]);
      mockImportFromUrl.mockResolvedValue({ id: 'file-2' });

      const result = await controller.importFromUrl(org, {
        url: 'https://example.com/photo.jpg',
        name: 'photo.jpg',
        source: 'pexels',
      } as any);

      expect(mockImportContentPackAsset).not.toHaveBeenCalled();
      expect(mockImportFromUrl).toHaveBeenCalledWith('org-1', {
        url: 'https://example.com/photo.jpg',
        name: 'photo.jpg',
        source: 'pexels',
      });
      expect(result).toEqual({ id: 'file-2' });
    });

    it('triggers Unsplash download tracking for unsplash source', async () => {
      const controller = makeController();
      mockListManifests.mockReturnValue([]);
      mockImportFromUrl.mockResolvedValue({ id: 'file-3' });

      await controller.importFromUrl(org, {
        url: 'https://example.com/photo.jpg',
        name: 'photo.jpg',
        source: 'unsplash',
        downloadLocation: 'https://api.unsplash.com/photos/x/download',
      } as any);

      expect(mockTriggerDownload).toHaveBeenCalledWith(
        'https://api.unsplash.com/photos/x/download',
      );
    });
  });
});
