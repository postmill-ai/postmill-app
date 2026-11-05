import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';
import type { StorageService } from '@postmill-ai/nestjs-libraries/database/prisma/storage/storage.service';
import { MAX_INLINE_SRC_LEN } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import { parseDataUrl } from '@postmill-ai/nestjs-libraries/upload/data.url';

const MAX_INLINE_ASSET_BYTES = 20 * 1024 * 1024;
const INLINE_RASTER_RE = /^data:image\/(?:png|jpe?g|webp|gif|avif|bmp|tiff);base64,/i;
const REFERENCES = [
  ['src', 'fileId'],
  ['originalSrc', 'originalFileId'],
  ['maskSrc', 'maskFileId'],
] as const;
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
};

type FileServiceLike = Pick<
  FileService,
  'findInlineAssetByHash' | 'saveGeneratedMedia' | 'deleteFile'
>;
type StorageServiceLike = Pick<StorageService, 'getLocalAdapterForOrg'>;
type FileReference = { id: string; path: string };

export const cleanupDesignerInlineFiles = async (
  orgId: string,
  fileIds: string[],
  fileService: FileServiceLike
): Promise<void> => {
  for (const id of new Set(fileIds)) {
    await fileService.deleteFile(orgId, id).catch(() => undefined);
  }
};

export const materializeDesignerInlineAssets = async (
  orgId: string,
  sourceDoc: unknown,
  fileService: FileServiceLike,
  storageService: StorageServiceLike
): Promise<{ doc: unknown; createdFileIds: string[] }> => {
  const doc = sourceDoc && typeof sourceDoc === 'object'
    ? structuredClone(sourceDoc)
    : sourceDoc;
  const createdFileIds: string[] = [];
  const resolved = new Map<string, Promise<FileReference>>();

  const persist = async (dataUrl: string): Promise<FileReference> => {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed || parsed.buffer.length > MAX_INLINE_ASSET_BYTES) {
      throw new BadRequestException('An inline design image is invalid or too large');
    }
    const hash = createHash('sha256').update(parsed.buffer).digest('hex');
    const existing = await fileService.findInlineAssetByHash(orgId, hash);
    if (existing) return existing;

    const adapter = await storageService.getLocalAdapterForOrg(orgId, true);
    let path: string;
    try {
      path = await adapter.writeBuffer(parsed.buffer, parsed.mime);
    } catch {
      throw new BadRequestException('An inline design image could not be stored');
    }
    try {
      const file = await fileService.saveGeneratedMedia(orgId, {
        name: `designer-inline-${hash.slice(0, 16)}.${EXTENSIONS[parsed.mime] || 'bin'}`,
        path,
        type: 'image',
        fileSize: parsed.buffer.length,
        metadata: {
          source: 'designer-inline',
          designerInlineSha256: hash,
          mime: parsed.mime,
        },
      });
      createdFileIds.push(file.id);
      return { id: file.id, path: file.path };
    } catch (error) {
      await adapter.removeFile(path).catch(() => undefined);
      throw error;
    }
  };

  const walk = async (node: unknown): Promise<void> => {
    if (Array.isArray(node)) {
      for (const item of node) await walk(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const object = node as Record<string, unknown>;
    for (const [srcKey, idKey] of REFERENCES) {
      const value = object[srcKey];
      if (
        typeof value !== 'string' ||
        value.length <= MAX_INLINE_SRC_LEN ||
        !INLINE_RASTER_RE.test(value)
      ) {
        continue;
      }
      let pending = resolved.get(value);
      if (!pending) {
        pending = persist(value);
        resolved.set(value, pending);
      }
      const file = await pending;
      object[srcKey] = file.path;
      object[idKey] = file.id;
    }
    for (const value of Object.values(object)) await walk(value);
  };

  try {
    await walk(doc);
    return { doc, createdFileIds };
  } catch (error) {
    await cleanupDesignerInlineFiles(orgId, createdFileIds, fileService);
    throw error;
  }
};
