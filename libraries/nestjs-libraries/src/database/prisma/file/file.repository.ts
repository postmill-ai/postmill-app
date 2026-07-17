import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { SaveMediaInformationDto } from '@gitroom/nestjs-libraries/dtos/file/save.media.information.dto';
import { Prisma } from '@prisma/client';
import { stat } from 'fs/promises';
import { extname, resolve, relative, isAbsolute } from 'path';

// Resolve a (possibly user-influenced) path and confine it to `root`, returning the
// resolved path only when it stays inside the root (else null). The containment test is a
// `path.relative` escape check — the sanitizer shape CodeQL's js/path-injection query
// recognizes — and callers must feed the RETURNED value into fs sinks, never the raw input.
const confineToRoot = (root: string, p: string): string | null => {
  const resolved = resolve(p);
  const rel = relative(root, resolved);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? resolved : null;
};

const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
};

const IMAGE_EXTS = new Set(['.jpg','.jpeg','.png','.gif','.webp','.avif','.bmp','.tiff']);
const VIDEO_EXTS = new Set(['.mp4','.webm','.mov','.avi','.mkv']);

function mimeFromName(name: string): string {
  const ext = extname(name).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

@Injectable()
export class FileRepository {
  private readonly _logger = new Logger(FileRepository.name);

  constructor(
    private _file: PrismaRepository<'file'>,
    private _fileFolder: PrismaRepository<'fileFolder'>
  ) {}

  /**
   * Verify a client-supplied folder id belongs to `org` before attaching a file
   * to it. Returns the id when owned, otherwise undefined so the file lands
   * unfoldered rather than in another org's folder.
   */
  private async _resolveOwnedFolderId(
    org: string,
    folderId?: string | null
  ): Promise<string | undefined> {
    if (!folderId) return undefined;
    const folder = await this._fileFolder.model.fileFolder.findFirst({
      where: { id: folderId, organizationId: org },
      select: { id: true },
    });
    return folder ? folder.id : undefined;
  }

  async saveFile(
    org: string,
    fileName: string,
    filePath: string,
    originalName?: string,
    folderId?: string,
    fileSize?: number
  ) {
    const mimeType = mimeFromName(fileName);
    const fileType = mimeType.startsWith('audio/') ? 'audio' : mimeType.startsWith('video/') ? 'video' : 'image';
    const meta: Record<string, unknown> = {
      mimeType,
      originalName: originalName || fileName,
    };

    let resolvedFileSize = fileSize ?? 0;

    // Only stat paths inside the configured upload root. Cloud adapters return
    // public URLs (https://…) where stat() will fail; the caller must supply fileSize.
    const uploadRoot = resolve(process.env.UPLOAD_DIRECTORY || './uploads');
    const safePath = confineToRoot(uploadRoot, filePath);
    if (resolvedFileSize === 0 && safePath) {
      try {
        const s = await stat(safePath);
        resolvedFileSize = s.size;

        if (IMAGE_EXTS.has(extname(fileName).toLowerCase())) {
          try {
            const sharp = (await import('sharp')).default;
            const metadata = await sharp(safePath).metadata();
            meta.dimensions = { width: metadata.width, height: metadata.height };
          } catch {
          }
        }
      } catch {
        this._logger.warn(`Could not stat file for metadata: ${filePath}`);
      }
    }

    meta.fileSize = resolvedFileSize;

    const ownedFolderId = await this._resolveOwnedFolderId(org, folderId);

    const data: any = {
      organization: {
        connect: {
          id: org,
        },
      },
      name: fileName,
      type: fileType,
      path: filePath,
      originalName: originalName || null,
      fileSize: resolvedFileSize,
      metadata: meta as Prisma.InputJsonValue,
      ...(ownedFolderId ? { folder: { connect: { id: ownedFolderId } } } : {}),
    };

    return this._file.model.file.create({
      data,
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        thumbnail: true,
        alt: true,
        folderId: true,
      },
    });
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
    const ownedFolderId = await this._resolveOwnedFolderId(org, data.folderId);
    return this._file.model.file.create({
      data: {
        organization: { connect: { id: org } },
        name: data.name,
        path: data.path,
        type: data.type,
        fileSize: data.fileSize ?? 0,
        ...(ownedFolderId ? { folder: { connect: { id: ownedFolderId } } } : {}),
        ...(data.metadata
          ? { metadata: data.metadata as Prisma.InputJsonValue }
          : {}),
      },
      select: {
        id: true,
        name: true,
        path: true,
        type: true,
        folderId: true,
      },
    });
  }

  getFileById(org: string, id: string) {
    return this._file.model.file.findUnique({
      where: {
        id,
        organizationId: org,
      },
      include: {
        folder: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  getFileByPath(org: string, filePath: string) {
    return this._file.model.file.findFirst({
      where: {
        organizationId: org,
        path: filePath,
        deletedAt: null as null,
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        thumbnail: true,
        alt: true,
        thumbnailTimestamp: true,
        fileSize: true,
        type: true,
        folderId: true,
      },
    });
  }

  // M-03: batched path lookup so callers (e.g. media studio listJobs) can resolve
  // many completed jobs in one query instead of N+1.
  getFilesByPaths(org: string, filePaths: string[]) {
    return this._file.model.file.findMany({
      where: {
        organizationId: org,
        path: { in: filePaths },
        deletedAt: null as null,
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        thumbnail: true,
        alt: true,
        thumbnailTimestamp: true,
        fileSize: true,
        type: true,
        folderId: true,
      },
    });
  }

  /**
   * Permanently remove the DB row. Callers must delete the underlying storage
   * object before invoking this.
   */
  async hardDelete(org: string, id: string) {
    return this._file.model.file.delete({
      where: {
        id,
        organizationId: org,
      },
    });
  }

  saveMediaInformation(org: string, data: SaveMediaInformationDto) {
    return this._file.model.file.update({
      where: {
        id: data.id,
        organizationId: org,
      },
      data: {
        alt: data.alt,
        thumbnail: data.thumbnail,
        thumbnailTimestamp: data.thumbnailTimestamp,
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        alt: true,
        thumbnail: true,
        path: true,
        thumbnailTimestamp: true,
      },
    });
  }

  async getFiles(
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
    const pageNum = (page || 1) - 1;
    const pageSize = limit || 18;
    const trimmedSearch = search?.trim();

    const where: any = {
      organizationId: org,
      deletedAt: null as null,
    };

    if (trimmedSearch) {
      where.OR = [
        { originalName: { contains: trimmedSearch, mode: 'insensitive' } },
        { name: { contains: trimmedSearch, mode: 'insensitive' } },
      ];
    }

    if (folderId !== undefined) {
      where.folderId = folderId === 'null' ? null : folderId;
    }

    if (type) {
      where.type = type;
    }

    if (tag) {
      where.tags = { contains: tag, mode: 'insensitive' };
    }

    const orderBy: any = {};
    if (sort === 'name') {
      orderBy.name = order === 'asc' ? 'asc' : 'desc';
    } else if (sort === 'size') {
      orderBy.fileSize = order === 'asc' ? 'asc' : 'desc';
    } else if (sort === 'type') {
      orderBy.type = order === 'asc' ? 'asc' : 'desc';
    } else {
      orderBy.createdAt = order === 'asc' ? 'asc' : 'desc';
    }

    const query = { where };

    const pages = Math.ceil((await this._file.model.file.count(query)) / pageSize);
    const results = await this._file.model.file.findMany({
      where,
      orderBy,
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        thumbnail: true,
        alt: true,
        thumbnailTimestamp: true,
        fileSize: true,
        type: true,
        tags: true,
        description: true,
        folderId: true,
        createdAt: true,
        folder: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      skip: pageNum * pageSize,
      take: pageSize,
    });

    return { pages, results };
  }

  // ── Folder CRUD ──────────────────────────────────────────────

  findFoldersByParent(org: string, parentId: string) {
    return this._fileFolder.model.fileFolder.findMany({
      where: { organizationId: org, parentId },
      select: { id: true, name: true },
    });
  }

  findFolderByName(org: string, name: string, parentId: string | null) {
    return this._fileFolder.model.fileFolder.findFirst({
      where: { organizationId: org, name, parentId },
      select: { id: true },
    });
  }

  createFolder(org: string, data: {
    name: string;
    parentId?: string;
    description?: string;
    tags?: string[];
    color?: string;
    storageProviderId?: string;
  }) {
    return this._fileFolder.model.fileFolder.create({
      data: {
        organizationId: org,
        name: data.name,
        parentId: data.parentId || null,
        description: data.description || null,
        tags: data.tags ? JSON.stringify(data.tags) : null,
        color: data.color || null,
        storageProviderId: data.storageProviderId || null,
      },
    });
  }

  getFolder(org: string, id: string) {
    return this._fileFolder.model.fileFolder.findFirst({
      where: { id, organizationId: org },
      include: {
        _count: {
          select: { files: true, children: true },
        },
      },
    });
  }

  updateFolder(
    org: string,
    id: string,
    data: {
      name?: string;
      description?: string;
      tags?: string[];
      color?: string;
    }
  ) {
    return this._fileFolder.model.fileFolder.update({
      where: { id, organizationId: org },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.tags !== undefined ? { tags: JSON.stringify(data.tags) } : {}),
        ...(data.color !== undefined ? { color: data.color } : {}),
      },
    });
  }

  async deleteFolder(org: string, id: string) {
    const folder = await this._fileFolder.model.fileFolder.findUnique({
      where: { id, organizationId: org },
      include: { _count: { select: { children: true } } },
    });

    if (!folder) {
      return null;
    }

    // Exclude soft-deleted files: a folder with only trashed files is deletable.
    const activeFiles = await this._file.model.file.count({
      where: { folderId: id, organizationId: org, deletedAt: null },
    });

    if (activeFiles > 0 || folder._count.children > 0) {
      throw new Error('Folder is not empty');
    }

    return this._fileFolder.model.fileFolder.delete({
      where: { id, organizationId: org },
    });
  }

  async getFolderTree(org: string) {
    const folders = await this._fileFolder.model.fileFolder.findMany({
      where: { organizationId: org },
      include: {
        _count: {
          select: { files: true, children: true },
        },
        storageProvider: {
          select: { id: true, type: true, name: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return this._buildTree(folders);
  }

  private _buildTree(folders: any[], parentId: string | null = null): any[] {
    return folders
      .filter((f) => f.parentId === parentId)
      .map((f) => ({
        ...f,
        children: this._buildTree(folders, f.id),
      }));
  }

  // ── File Operations ─────────────────────────────────────────

  moveFile(org: string, fileId: string, folderId: string | null) {
    return this._file.model.file.update({
      where: { id: fileId, organizationId: org },
      data: { folderId },
    });
  }

  async bulkDelete(org: string, ids: string[]) {
    await this._file.model.file.updateMany({
      where: {
        id: { in: ids },
        organizationId: org,
      },
      data: { deletedAt: new Date() },
    });
    return { success: true };
  }

  // 1.2: org-scoped so a foreign file id can never be relocated/detached, even
  // if a future caller forgets the controller-level ownership pre-filter.
  bulkMove(org: string, ids: string[], folderId: string | null) {
    return this._file.model.file.updateMany({
      where: { id: { in: ids }, organizationId: org },
      data: { folderId },
    });
  }

  // Full file records for a set of ids (org-scoped, non-deleted). Same select
  // shape as getFiles() so callers get the FileItem shape used by the /files UI.
  async getByIds(org: string, ids: string[]) {
    if (!ids.length) return [];
    return this._file.model.file.findMany({
      where: { id: { in: ids }, organizationId: org, deletedAt: null as null },
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        thumbnail: true,
        alt: true,
        thumbnailTimestamp: true,
        fileSize: true,
        type: true,
        tags: true,
        description: true,
        folderId: true,
        createdAt: true,
        folder: { select: { id: true, name: true } },
      },
    });
  }

  async searchFiles(org: string, query: string, folderId?: string) {
    const where: any = {
      organizationId: org,
      deletedAt: null as null,
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { originalName: { contains: query, mode: 'insensitive' } },
        { tags: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
      ],
    };

    if (folderId) {
      where.folderId = folderId;
    }

    return this._file.model.file.findMany({
      where,
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        thumbnail: true,
        alt: true,
        fileSize: true,
        type: true,
        tags: true,
        description: true,
        folderId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getFilesByFolder(org: string, folderId: string, page: number, limit: number = 18) {
    const pageNum = (page || 1) - 1;

    const where = {
      organizationId: org,
      deletedAt: null as null,
      folderId,
    };

    const pages = Math.ceil((await this._file.model.file.count({ where })) / limit);
    const results = await this._file.model.file.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        thumbnail: true,
        alt: true,
        thumbnailTimestamp: true,
        fileSize: true,
        type: true,
        tags: true,
        description: true,
        folderId: true,
        createdAt: true,
      },
      skip: pageNum * limit,
      take: limit,
    });

    return { pages, results };
  }

  async getFolderContents(org: string, folderId: string) {
    const [fileCount, childFolders] = await Promise.all([
      this._file.model.file.count({
        where: { folderId, organizationId: org, deletedAt: null as null },
      }),
      this._fileFolder.model.fileFolder.findMany({
        where: { parentId: folderId, organizationId: org },
        select: { id: true, name: true, _count: { select: { files: true } } },
      }),
    ]);

    return { fileCount, childFolders };
  }

  updateFileTags(org: string, fileId: string, tags: string[]) {
    return this._file.model.file.update({
      where: { id: fileId, organizationId: org },
      data: { tags: JSON.stringify(tags) },
    });
  }

  updateFileDescription(org: string, fileId: string, description: string) {
    return this._file.model.file.update({
      where: { id: fileId, organizationId: org },
      data: { description },
    });
  }

  renameFile(org: string, fileId: string, name: string) {
    return this._file.model.file.update({
      where: { id: fileId, organizationId: org },
      data: { name },
    });
  }

  softDeleteFile(org: string, fileId: string) {
    return this._file.model.file.update({
      where: { id: fileId, organizationId: org },
      data: { deletedAt: new Date() },
    });
  }

  restoreFile(org: string, fileId: string) {
    return this._file.model.file.update({
      where: { id: fileId, organizationId: org },
      data: { deletedAt: null },
    });
  }

  getTrashedFiles(org: string) {
    return this._file.model.file.findMany({
      where: {
        organizationId: org,
        deletedAt: { not: null },
      },
      orderBy: { deletedAt: 'desc' },
    });
  }

  async getStorageBytes(org: string): Promise<number> {
    const result = await this._file.model.file.aggregate({
      _sum: { fileSize: true },
      where: {
        organizationId: org,
        deletedAt: null,
      },
    });
    return result._sum.fileSize ?? 0;
  }
}
