import { StorageProviderType } from '@prisma/client';

export interface StorageFileEntry {
  key: string;
  name: string;
  size: number;
  mimeType: string;
  lastModified: Date;
}

export interface IUploadProvider {
  uploadSimple(path: string): Promise<string>;
  uploadFile(file: Express.Multer.File): Promise<any>;
  removeFile(filePath: string): Promise<void>;
}

export interface IStorageAdapter extends IUploadProvider {
  readonly type: StorageProviderType;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
  listFiles(prefix?: string): Promise<StorageFileEntry[]>;
  getFileUrl(key: string): string;
  deleteFile(key: string): Promise<void>;
  getUsageBytes(): Promise<bigint | null>;
  writeBuffer(buffer: Buffer, contentType?: string): Promise<string>;
  // Read raw bytes for a stored object by its public path/URL or key. Used by
  // cross-provider migration so source bytes are read through the owning adapter
  // (disk read for local, GetObject for S3-family) rather than via safeFetch.
  readFile(pathOrKey: string): Promise<Buffer>;
}
