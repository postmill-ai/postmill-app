import { HttpException, Injectable, Logger } from '@nestjs/common';
import { FileRepository } from '@gitroom/nestjs-libraries/database/prisma/file/file.repository';
import { Organization } from '@prisma/client';
import { SaveMediaInformationDto } from '@gitroom/nestjs-libraries/dtos/file/save.media.information.dto';
import { StorageService } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.service';
import { safeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';
import { readResponseCapped } from '@gitroom/nestjs-libraries/utils/capped-stream';
import { IStorageAdapter } from '@gitroom/nestjs-libraries/upload/upload.interface';
import { fromBuffer } from '@gitroom/nestjs-libraries/upload/file-type.compat';

export interface ImportFromPathResult {
  buffer: Buffer;
  fileSize: number;
}

// NOTE (6.3): `image/svg+xml` is intentionally NOT allowed. Iconify serves icons
// as raw SVG, and SVG is an active document (it can carry <script>/onload/xlink
// payloads) served from our own origin — importing it verbatim would be stored
// XSS. So icon "Save to Files" is a dead path by design: it must be RASTERIZED
// client-side (SVG → PNG on a canvas) before hitting /files/import, or ingested
// through a dedicated server-side SVG sanitizer. Do NOT "fix" the dead save by
// adding 'image/svg+xml' here without one of those in place.
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
  'image/bmp', 'image/tiff', 'video/mp4',
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg',
]);

const MAX_IMPORT_SIZE = 512 * 1024 * 1024; // 512 MB

@Injectable()
export class FileService {
  private readonly _logger = new Logger(FileService.name);

  constructor(
    private _fileRepository: FileRepository,
    private _storageService: StorageService
  ) {}

  /**
   * Permanently delete a file: remove the underlying storage object, then
   * hard-delete the DB row. This is the lifecycle endpoint for trash emptying.
   */
  async deleteFile(org: string, id: string) {
    const file = await this._fileRepository.getFileById(org, id);
    if (!file) {
      throw new HttpException('File not found', 404);
    }

    const adapter = await this._storageService.resolveAdapterForFolder(
      file.folderId,
      org
    );

    try {
      await adapter.removeFile(file.path);
    } catch (err) {
      // Log but continue: the DB row must still be removable even if the
      // storage object is already gone. This prevents a missing object from
      // blocking trash emptying.
      this._logger?.warn?.(
        `Could not remove storage object for file ${id}: ${(err as Error).message}`
      );
    }

    return this._fileRepository.hardDelete(org, id);
  }

  getFileById(org: string, id: string) {
    return this._fileRepository.getFileById(org, id);
  }

  getByIds(org: string, ids: string[]) {
    return this._fileRepository.getByIds(org, ids);
  }

  getFileByPath(org: string, filePath: string) {
    return this._fileRepository.getFileByPath(org, filePath);
  }

  getFilesByPaths(org: string, filePaths: string[]) {
    return this._fileRepository.getFilesByPaths(org, filePaths);
  }

  async saveFile(
    org: string,
    fileName: string,
    filePath: string,
    originalName?: string,
    folderId?: string,
    fileSize?: number
  ) {
    await this._storageService.assertWithinQuota(org, fileSize ?? 0);
    const ownedFolderId = await this.resolveOwnedFolderId(org, folderId);
    return this._fileRepository.saveFile(org, fileName, filePath, originalName, ownedFolderId, fileSize);
  }

  getFiles(
    org: string,
    page: number,
    search?: string,
    folderId?: string,
    type?: string,
    tag?: string,
    sort?: string,
    order?: string,
    limit?: number
  ) {
    return this._fileRepository.getFiles(org, page, search, folderId, type, tag, sort, order, limit);
  }

  saveMediaInformation(org: string, data: SaveMediaInformationDto) {
    return this._fileRepository.saveMediaInformation(org, data);
  }

  async saveGeneratedMedia(
    org: string,
    data: {
      name: string;
      path: string;
      type: string;
      folderId?: string | null;
      fileSize?: number;
      metadata?: Record<string, unknown>;
    },
  ) {
    await this._storageService.assertWithinQuota(org, data.fileSize ?? 0);
    return this._fileRepository.saveGeneratedMedia(org, data);
  }

  // ── Folder Operations ────────────────────────────────────────

  async createFolder(org: string, data: {
    name: string;
    parentId?: string;
    description?: string;
    tags?: string[];
    color?: string;
    storageProviderId?: string;
  }) {
    if (data.parentId) {
      const parent = await this._fileRepository.getFolder(org, data.parentId);
      if (!parent) {
        throw new HttpException('Parent folder not found', 404);
      }
    }

    return this._fileRepository.createFolder(org, data);
  }

  async getFolder(org: string, id: string) {
    const folder = await this._fileRepository.getFolder(org, id);
    if (!folder) {
      throw new HttpException('Folder not found', 404);
    }
    return folder;
  }

  /**
   * 1.3 — Validate a client-supplied `folderId` belongs to `org`. Returns the
   * id when owned, otherwise `undefined` (caller falls back to the org's
   * standard/default folder). Non-throwing so a foreign/bogus id can't 500 a
   * generate/import; it simply never attaches to a foreign org's folder.
   */
  async resolveOwnedFolderId(
    org: string,
    folderId?: string | null,
  ): Promise<string | undefined> {
    if (!folderId) {
      return undefined;
    }
    const folder = await this._fileRepository.getFolder(org, folderId);
    return folder ? folderId : undefined;
  }

  /**
   * Resolve a "/a/b/c"-style path to a folder id, creating missing segments
   * (find-or-create per level, org-scoped). Returns null for an empty path.
   */
  async resolveFolderPath(org: string, path: string): Promise<string | null> {
    const segments = path
      .split('/')
      .map((s) => s.trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 10);
    if (segments.length === 0) {
      return null;
    }

    let parentId: string | null = null;
    for (const name of segments) {
      const existing = await this._fileRepository.findFolderByName(
        org,
        name,
        parentId
      );
      if (existing) {
        parentId = existing.id;
        continue;
      }
      const created = await this._fileRepository.createFolder(org, {
        name,
        parentId: parentId ?? undefined,
      });
      parentId = created.id;
    }
    return parentId;
  }

  async updateFolder(org: string, id: string, data: {
    name?: string;
    description?: string;
    tags?: string[];
    color?: string;
  }) {
    const folder = await this._fileRepository.getFolder(org, id);
    if (!folder) {
      throw new HttpException('Folder not found', 404);
    }
    return this._fileRepository.updateFolder(org, id, data);
  }

  async deleteFolder(org: string, id: string) {
    const folder = await this._fileRepository.getFolder(org, id);
    if (!folder) {
      throw new HttpException('Folder not found', 404);
    }
    return this._fileRepository.deleteFolder(org, id);
  }

  async getFolderTree(org: string) {
    return this._fileRepository.getFolderTree(org);
  }

  findFoldersByParent(org: string, parentId: string) {
    return this._fileRepository.findFoldersByParent(org, parentId);
  }

  // ── File Operations ────────────────────────────────────

  async moveFile(org: string, fileId: string, folderId: string | null) {
    const file = await this._fileRepository.getFileById(org, fileId);
    if (!file) {
      throw new HttpException('File not found', 404);
    }

    if (folderId) {
      const folder = await this._fileRepository.getFolder(org, folderId);
      if (!folder) {
        throw new HttpException('Folder not found', 404);
      }
    }

    return this._fileRepository.moveFile(org, fileId, folderId);
  }

  async bulkDelete(org: string, ids: string[]) {
    return this._fileRepository.bulkDelete(org, ids);
  }

  async bulkMove(org: string, ids: string[], folderId: string | null) {
    if (folderId) {
      const folder = await this._fileRepository.getFolder(org, folderId);
      if (!folder) {
        throw new HttpException('Folder not found', 404);
      }
    }
    return this._fileRepository.bulkMove(org, ids, folderId);
  }

  searchFiles(org: string, query: string, folderId?: string) {
    return this._fileRepository.searchFiles(org, query, folderId);
  }

  async getFilesByFolder(org: string, folderId: string, page: number) {
    const folder = await this._fileRepository.getFolder(org, folderId);
    if (!folder) {
      throw new HttpException('Folder not found', 404);
    }
    return this._fileRepository.getFilesByFolder(org, folderId, page);
  }

  getFolderContents(org: string, folderId: string) {
    return this._fileRepository.getFolderContents(org, folderId);
  }

  async updateFileTags(org: string, fileId: string, tags: string[]) {
    const file = await this._fileRepository.getFileById(org, fileId);
    if (!file) {
      throw new HttpException('File not found', 404);
    }
    return this._fileRepository.updateFileTags(org, fileId, tags);
  }

  async updateFileDescription(org: string, fileId: string, description: string) {
    const file = await this._fileRepository.getFileById(org, fileId);
    if (!file) {
      throw new HttpException('File not found', 404);
    }
    return this._fileRepository.updateFileDescription(org, fileId, description);
  }

  async renameFile(org: string, fileId: string, name: string) {
    const file = await this._fileRepository.getFileById(org, fileId);
    if (!file) {
      throw new HttpException('File not found', 404);
    }
    return this._fileRepository.renameFile(org, fileId, name);
  }

  async bulkSave(
    org: string,
    items: Array<{ name: string; path: string; originalName?: string; fileSize?: number; folderId?: string }>
  ) {
    return Promise.all(
      items.map(async (item) => {
        await this._storageService.assertWithinQuota(org, item.fileSize ?? 0);
        const ownedFolderId = await this.resolveOwnedFolderId(org, item.folderId);
        return this._fileRepository.saveFile(
          org,
          item.name,
          item.path,
          item.originalName,
          ownedFolderId,
          item.fileSize
        );
      })
    );
  }

  async softDelete(fileId: string, org: string) {
    const file = await this._fileRepository.getFileById(org, fileId);
    if (!file) {
      throw new HttpException('File not found', 404);
    }
    return this._fileRepository.softDeleteFile(org, fileId);
  }

  async restore(fileId: string, org: string) {
    const file = await this._fileRepository.getFileById(org, fileId);
    if (!file) {
      throw new HttpException('File not found', 404);
    }
    return this._fileRepository.restoreFile(org, fileId);
  }

  async getTrashed(org: string) {
    return this._fileRepository.getTrashedFiles(org);
  }

  /**
   * Validate a client-supplied storage path belongs to the org and read the object.
   * Throws HttpException(400) when the path does not match an org-owned prefix and
   * HttpException(404) when the object cannot be read.
   */
  async importFromPath(
    orgId: string,
    filePath: string,
    folderId?: string | null,
  ): Promise<ImportFromPathResult> {
    const prefixes = await this._storageService.getOrgStoragePublicPrefixes(orgId);
    const matchesPrefix = prefixes.some((prefix) => filePath.startsWith(prefix));
    if (!matchesPrefix) {
      throw new HttpException('Invalid storage path', 400);
    }

    const adapter = await this._storageService.resolveAdapterForFolder(
      folderId,
      orgId,
    );
    try {
      const buffer = await adapter.readFile(filePath);
      await this._storageService.assertWithinQuota(orgId, buffer.length);
      return { buffer, fileSize: buffer.length };
    } catch (err) {
      this._logger.warn(
        `save-media path probe failed for org=${orgId}: ${(err as Error).message}`
      );
      throw new HttpException('Storage object not found', 404);
    }
  }

  // ── Import from URL ──────────────────────────────────────────

  async importFromUrl(
    orgId: string,
    data: {
      url: string;
      name: string;
      folderId?: string | null;
      type?: string;
      source?: string;
      attribution?: Record<string, unknown>;
    }
  ) {
    // 1.3: never trust a client folderId — attach only to a folder the caller's
    // org owns, else fall back to the org's default folder (null).
    const ownedFolderId = await this.resolveOwnedFolderId(orgId, data.folderId);

    const { adapter, configId } =
      await this._storageService.resolveAdapterForFolderWithConfigId(
        ownedFolderId,
        orgId
      );

    const response = await safeFetch(data.url);
    if (!response.ok) {
      throw new HttpException(
        `Could not download the file (source returned ${response.status})`,
        422
      );
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (size > MAX_IMPORT_SIZE) {
        throw new HttpException('File too large (max 512 MB)', 413);
      }
    }

    // 1.6: stream with a running byte cap — content-length is advisory
    // (absent on chunked, spoofable), so abort mid-transfer rather than
    // buffering a multi-GB body into a 2 GB-heap backend.
    let buffer: Buffer;
    try {
      buffer = await readResponseCapped(
        response,
        MAX_IMPORT_SIZE,
        'File too large (max 512 MB)',
      );
    } catch (e) {
      throw new HttpException(
        (e as Error)?.message || 'File too large (max 512 MB)',
        413,
      );
    }

    await this._storageService.assertWithinProviderQuota(
      adapter,
      orgId,
      buffer.length,
      configId
    );

    // Validate the ACTUAL downloaded MIME, not the caller's category hint
    // (`data.type` is 'photo'/'audio'/… — not a MIME — and would never match).
    let contentType =
      (response.headers.get('content-type') || '').split(';')[0].trim() ||
      'application/octet-stream';
    if (!ALLOWED_MIME_TYPES.has(contentType)) {
      // Some sources mislabel the type (e.g. Jamendo serves an MP3 as text/html).
      // Sniff the real type from the bytes before rejecting.
      const sniffed = await fromBuffer(buffer);
      if (sniffed?.mime) contentType = sniffed.mime;
    }
    if (!ALLOWED_MIME_TYPES.has(contentType)) {
      throw new HttpException(`File type not allowed: ${contentType}`, 415);
    }

    const path = await adapter.writeBuffer(buffer, contentType);

    const fileSize = buffer.length;

    return this._fileRepository.saveGeneratedMedia(orgId, {
      name: data.name,
      path,
      type: contentType.startsWith('audio/') ? 'audio' : contentType.startsWith('video/') ? 'video' : 'image',
      folderId: ownedFolderId,
      fileSize,
      metadata: {
        ...(data.source ? { source: data.source } : {}),
        ...(data.attribution ? { attribution: data.attribution } : {}),
      },
    });
  }
}
