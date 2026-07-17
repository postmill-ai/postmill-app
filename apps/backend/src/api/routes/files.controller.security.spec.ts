import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Organization } from '@prisma/client';
import { HttpException } from '@nestjs/common';
import { ContentPackDailyCapError } from '@gitroom/nestjs-libraries/media/stock/content-packs/content-pack.interface';

import { FilesController } from './files.controller';

const org: Organization = { id: 'org-1' } as any;

function makeController() {
  const adapter = {
    readFile: vi.fn(),
  };
  const storageService = {
    getOrgStoragePublicPrefixes: vi.fn().mockResolvedValue(['https://app.example.com/uploads/']),
    resolveAdapterForFolder: vi.fn().mockResolvedValue(adapter),
  };
  const fileService = {
    getFolder: vi.fn().mockResolvedValue({ id: 'f1', organizationId: 'org-1' }),
    getFolderContents: vi.fn().mockResolvedValue({ count: 3 }),
    getByIds: vi.fn().mockResolvedValue([]),
    bulkMove: vi.fn().mockResolvedValue({ count: 0 }),
    importFromUrl: vi.fn().mockResolvedValue({ id: 'file-1' }),
    saveFile: vi.fn().mockResolvedValue({ id: 'file-1' }),
    bulkSave: vi.fn().mockResolvedValue([{ id: 'file-1' }, { id: 'file-2' }]),
    importFromPath: vi.fn(async (orgId: string, filePath: string, folderId?: string | null) => {
      const prefixes = await storageService.getOrgStoragePublicPrefixes(orgId);
      if (!prefixes.some((prefix: string) => filePath.startsWith(prefix))) {
        throw new HttpException('Invalid storage path', 400);
      }
      const resolvedAdapter = await storageService.resolveAdapterForFolder(folderId, orgId);
      try {
        const buffer = await resolvedAdapter.readFile(filePath);
        return { buffer, fileSize: buffer.length };
      } catch (err) {
        throw new HttpException('Storage object not found', 404);
      }
    }),
  };
  const contentPackCapabilityMap: Record<string, string> = {
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
  };
  const stockMediaService = {
    importContentPackAsset: vi.fn(async (_orgId: string, source: string, downloadLocation: string, type?: string) => {
      const capability = contentPackCapabilityMap[(type || 'photos').toLowerCase()];
      if (!capability) {
        throw new Error(`Unsupported content pack type: ${type}`);
      }
      return { url: 'https://cdn/licensed.jpg', capability };
    }),
    triggerDownload: vi.fn().mockResolvedValue(undefined),
  };
  const resolution = {
    listManifests: vi.fn().mockReturnValue([{ providerId: 'magnific' }]),
  };
  const ctrl = new FilesController(
    fileService as any,
    storageService as any,
    stockMediaService as any,
    resolution as any,
  );
  return { ctrl, fileService, storageService, adapter, stockMediaService, resolution };
}

beforeEach(() => vi.clearAllMocks());

describe('FilesController — tenant isolation & content-pack mint', () => {
  describe('1.1 getFolderContents is org-scoped', () => {
    it('validates folder ownership before returning contents', async () => {
      const { ctrl, fileService } = makeController();

      const result = await ctrl.getFolderContents(org, 'folder-b');

      expect(fileService.getFolder).toHaveBeenCalledWith('org-1', 'folder-b');
      expect(fileService.getFolderContents).toHaveBeenCalledWith('org-1', 'folder-b');
      expect(result).toEqual({ count: 3 });
    });

    it('propagates the 404 for a folder the org does not own', async () => {
      const { ctrl, fileService } = makeController();
      fileService.getFolder.mockRejectedValue(new HttpException('Folder not found', 404));

      await expect(ctrl.getFolderContents(org, 'folder-b')).rejects.toThrow('Folder not found');
      expect(fileService.getFolderContents).not.toHaveBeenCalled();
    });
  });

  describe('1.2 bulkMove restricts to owned ids', () => {
    it('moves only ids the org owns (foreign ids drop out → 0 rows)', async () => {
      const { ctrl, fileService } = makeController();
      // requested [own-1, foreign-1]; org only owns own-1
      fileService.getByIds.mockResolvedValue([{ id: 'own-1' }]);

      await ctrl.bulkMove(org, { ids: ['own-1', 'foreign-1'], folderId: 'dest' } as any);

      expect(fileService.getByIds).toHaveBeenCalledWith('org-1', ['own-1', 'foreign-1']);
      expect(fileService.bulkMove).toHaveBeenCalledWith('org-1', ['own-1'], 'dest');
    });

    it('passes an empty id set (0 rows) when none are owned', async () => {
      const { ctrl, fileService } = makeController();
      fileService.getByIds.mockResolvedValue([]);

      await ctrl.bulkMove(org, { ids: ['foreign-1'], folderId: null } as any);

      expect(fileService.bulkMove).toHaveBeenCalledWith('org-1', [], null);
    });
  });

  describe('0.4 content-pack singular→plural capability mapping', () => {
    const body = (type: string) => ({
      url: '',
      name: 'x',
      source: 'magnific',
      downloadLocation: 'item-123',
      type,
    });

    it.each([
      ['photo', 'photos'],
      ['image', 'photos'],
      ['vector', 'vectors'],
      ['video', 'videos'],
      ['sticker', 'stickers'],
      ['icon', 'icons'],
      ['audio', 'audio'],
    ])('maps client type "%s" → capability "%s"', async (clientType, expected) => {
      const { ctrl, stockMediaService } = makeController();

      await ctrl.importFromUrl(org, body(clientType) as any);

      expect(stockMediaService.importContentPackAsset).toHaveBeenCalledWith(
        'org-1',
        'magnific',
        'item-123',
        clientType,
      );
    });

    it('rejects an unknown type with 400 (no silent default)', async () => {
      const { ctrl, stockMediaService } = makeController();

      await expect(ctrl.importFromUrl(org, body('bogus') as any)).rejects.toMatchObject({
        status: 400,
      });
      expect(stockMediaService.importContentPackAsset).not.toHaveBeenCalled();
    });

    it('maps a daily-cap error to 402', async () => {
      const { ctrl, stockMediaService } = makeController();
      stockMediaService.importContentPackAsset.mockRejectedValue(
        new ContentPackDailyCapError('cap reached'),
      );

      await expect(ctrl.importFromUrl(org, body('photo') as any)).rejects.toMatchObject({
        status: 402,
      });
    });

    it('returns a generic 502 (not raw provider text) on a mint failure', async () => {
      const { ctrl, stockMediaService } = makeController();
      stockMediaService.importContentPackAsset.mockRejectedValue(
        new Error('upstream 500 <html>secret</html>'),
      );

      await expect(ctrl.importFromUrl(org, body('photo') as any)).rejects.toMatchObject({
        status: 502,
        message: 'Could not retrieve the licensed asset',
      });
    });
  });

  describe('1.4 path ownership validation for save-media', () => {
    it('rejects a foreign-origin URL with 400', async () => {
      const { ctrl, storageService, fileService } = makeController();

      await expect(
        ctrl.saveMedia(org, { name: 'name', path: 'https://evil.com/uploads/x.png', originalName: 'x.png' } as any),
      ).rejects.toMatchObject({ status: 400, message: 'Invalid storage path' });

      expect(storageService.resolveAdapterForFolder).not.toHaveBeenCalled();
      expect(fileService.saveFile).not.toHaveBeenCalled();
    });

    it('rejects a matching-prefix but non-existent object with 404', async () => {
      const { ctrl, adapter, storageService, fileService } = makeController();
      adapter.readFile.mockRejectedValue(new Error('NoSuchKey'));

      await expect(
        ctrl.saveMedia(org, { name: 'name', path: 'https://app.example.com/uploads/missing.png', originalName: 'missing.png' } as any),
      ).rejects.toMatchObject({ status: 404, message: 'Storage object not found' });

      expect(storageService.resolveAdapterForFolder).toHaveBeenCalledWith(undefined, 'org-1');
      expect(fileService.saveFile).not.toHaveBeenCalled();
    });

    it('accepts a valid org-owned object and persists it', async () => {
      const { ctrl, adapter, storageService, fileService } = makeController();
      adapter.readFile.mockResolvedValue(Buffer.from('bytes'));

      const result = await ctrl.saveMedia(
        org,
        { name: 'saved.png', path: 'https://app.example.com/uploads/owned.png', originalName: 'owned.png' } as any,
      );

      expect(storageService.resolveAdapterForFolder).toHaveBeenCalledWith(undefined, 'org-1');
      expect(adapter.readFile).toHaveBeenCalledWith('https://app.example.com/uploads/owned.png');
      expect(fileService.saveFile).toHaveBeenCalledWith(
        'org-1',
        'saved.png',
        'https://app.example.com/uploads/owned.png',
        'owned.png',
        undefined,
        5,
      );
      expect(result).toEqual({ id: 'file-1' });
    });
  });

  describe('1.4 path ownership validation for bulk/save', () => {
    it('rejects the batch if any path is foreign', async () => {
      const { ctrl, fileService } = makeController();

      await expect(
        ctrl.bulkSaveFiles(org, {
          items: [
            { name: 'a.png', path: 'https://app.example.com/uploads/a.png' },
            { name: 'b.png', path: 'https://evil.com/uploads/b.png' },
          ],
        } as any),
      ).rejects.toMatchObject({ status: 400, message: 'Invalid storage path' });

      expect(fileService.bulkSave).not.toHaveBeenCalled();
    });

    it('rejects the batch if any object does not exist', async () => {
      const { ctrl, adapter, fileService } = makeController();
      adapter.readFile
        .mockResolvedValueOnce(Buffer.from('bytes'))
        .mockRejectedValueOnce(new Error('NoSuchKey'));

      await expect(
        ctrl.bulkSaveFiles(org, {
          items: [
            { name: 'a.png', path: 'https://app.example.com/uploads/a.png' },
            { name: 'b.png', path: 'https://app.example.com/uploads/b.png' },
          ],
        } as any),
      ).rejects.toMatchObject({ status: 404, message: 'Storage object not found' });

      expect(fileService.bulkSave).not.toHaveBeenCalled();
    });

    it('saves the batch when every path is valid and reachable', async () => {
      const { ctrl, adapter, fileService } = makeController();
      adapter.readFile.mockResolvedValue(Buffer.from('bytes'));

      const result = await ctrl.bulkSaveFiles(org, {
        items: [
          { name: 'a.png', path: 'https://app.example.com/uploads/a.png' },
          { name: 'b.png', path: 'https://app.example.com/uploads/b.png' },
        ],
      } as any);

      expect(adapter.readFile).toHaveBeenCalledTimes(2);
      expect(fileService.bulkSave).toHaveBeenCalledWith('org-1', [
        { name: 'a.png', path: 'https://app.example.com/uploads/a.png', fileSize: 5 },
        { name: 'b.png', path: 'https://app.example.com/uploads/b.png', fileSize: 5 },
      ]);
      expect(result).toEqual([{ id: 'file-1' }, { id: 'file-2' }]);
    });
  });
});
