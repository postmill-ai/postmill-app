export interface StorageFileEntry {
  key: string;
  name: string;
  size: number;
  mimeType: string;
  lastModified: Date;
}

export interface StorageUploadProvider {
  uploadSimple(path: string): Promise<string>;
  uploadFile(file: unknown): Promise<unknown>;
  removeFile(filePath: string): Promise<void>;
}

export interface StorageCapability extends StorageUploadProvider {
  readonly type: string;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
  listFiles(prefix?: string): Promise<StorageFileEntry[]>;
  getFileUrl(key: string): string;
  deleteFile(key: string): Promise<void>;
  getUsageBytes(): Promise<bigint | null>;
  writeBuffer(buffer: Buffer, contentType?: string): Promise<string>;
  readFile(pathOrKey: string): Promise<Buffer>;
}
