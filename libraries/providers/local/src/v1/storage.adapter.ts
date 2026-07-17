import {
  mkdirSync,
  unlink,
  writeFileSync,
  readdirSync,
  statSync,
  readFileSync,
  copyFileSync,
} from 'fs';
import { randomBytes } from 'crypto';
import path from 'path';
import { metadata as providerMetadata } from './metadata';
import {
  ProviderModule,
  ProviderRuntimeContext,
  SafeFetchPort,
  StorageCapability,
  StorageFileEntry,
  CredentialField,
  LoggerPort,
  parseDataUrl,
  fromBuffer,
  fromFile,
} from '@gitroom/provider-kernel';

const TYPE = 'LOCAL';
const DISPLAY = 'Local Filesystem';
const CREDENTIAL_FIELDS: CredentialField[] = [];

const LOCAL_STORAGE_ALLOWED_MIME = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'video/mp4',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
  'font/ttf',
  'font/otf',
  'font/woff2',
]);

export class LocalStorage implements StorageCapability {
  readonly type = TYPE;

  constructor(
    private readonly _logger: LoggerPort,
    private uploadDirectory: string,
    private tenantId?: string,
    private _fetch?: SafeFetchPort,
  ) {}

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      mkdirSync(this.uploadDirectory, { recursive: true });
      const testFile = path.join(this.uploadDirectory, '.test-write');
      writeFileSync(testFile, '');
      unlink(testFile, () => {});
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  async listFiles(prefix?: string): Promise<StorageFileEntry[]> {
    const baseDir = this.tenantId
      ? path.join(this.uploadDirectory, this.tenantId)
      : this.uploadDirectory;
    const dir = prefix ? path.join(baseDir, prefix) : baseDir;
    const entries: StorageFileEntry[] = [];

    const walk = (dirPath: string, relativePrefix: string) => {
      let files: string[];
      try {
        files = readdirSync(dirPath);
      } catch {
        return;
      }

      for (const file of files) {
        const fullPath = path.join(dirPath, file);
        let stat: ReturnType<typeof statSync>;
        try {
          stat = statSync(fullPath);
        } catch {
          continue;
        }

        if (stat.isDirectory()) {
          walk(fullPath, path.join(relativePrefix, file));
        } else {
          entries.push({
            key: path.join(relativePrefix, file),
            name: file,
            size: stat.size,
            mimeType: '',
            lastModified: stat.mtime,
          });
        }
      }
    };

    walk(dir, prefix || '');
    return entries;
  }

  getFileUrl(key: string): string {
    return (
      (process.env.FRONTEND_URL || '') + '/uploads/' + key.replace(/^\//, '')
    );
  }

  // Resolve `relative` against the upload directory and assert the result stays
  // within it — defends deleteFile/removeFile against `../` path traversal.
  private _safeJoin(relative: string): string {
    const root = path.resolve(this.uploadDirectory);
    const resolved = path.resolve(root, relative);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error('Invalid storage key: path traversal detected');
    }
    return resolved;
  }

  async deleteFile(key: string): Promise<void> {
    const filePath = this._safeJoin(key.replace(/^\//, ''));
    return new Promise((resolve, reject) => {
      unlink(filePath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async getUsageBytes(): Promise<bigint | null> {
    try {
      let total = BigInt(0);
      const rootDir = this.tenantId
        ? path.join(this.uploadDirectory, this.tenantId)
        : this.uploadDirectory;
      const walk = (dirPath: string) => {
        let files: string[];
        try {
          files = readdirSync(dirPath);
        } catch {
          return;
        }
        for (const file of files) {
          const fullPath = path.join(dirPath, file);
          let stat: ReturnType<typeof statSync>;
          try {
            stat = statSync(fullPath);
          } catch {
            continue;
          }
          if (stat.isDirectory()) {
            walk(fullPath);
          } else {
            total += BigInt(stat.size);
          }
        }
      };
      walk(rootDir);
      return total;
    } catch {
      return null;
    }
  }

  async uploadSimple(path: string) {
    const dataUrl = path.startsWith('data:') ? parseDataUrl(path) : null;

    let body: Buffer;
    if (dataUrl) {
      body = dataUrl.buffer;
    } else {
      if (!this._fetch) throw new Error('No fetch implementation available');
      const loadImage = await this._fetch(path);
      body = Buffer.from(await loadImage.arrayBuffer());
    }

    const detected = await fromBuffer(body);
    if (!detected || !LOCAL_STORAGE_ALLOWED_MIME.has(detected.mime)) {
      throw new Error('Unsupported file type.');
    }
    const findExtension = detected.ext;

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    const tenantPart = this.tenantId ? `/${this.tenantId}` : '';
    const innerPath = `${tenantPart}/${year}/${month}/${day}`;
    const dir = `${this.uploadDirectory}${innerPath}`;
    mkdirSync(dir, { recursive: true });

    const randomName = randomBytes(16).toString('hex');

    const filePath = `${dir}/${randomName}.${findExtension}`;
    const publicPath = `${innerPath}/${randomName}.${findExtension}`;
    writeFileSync(filePath, body);

    return process.env.FRONTEND_URL + '/uploads' + publicPath;
  }

  async uploadFile(file: any): Promise<any> {
    try {
      let detected: { ext: string; mime: string } | undefined;
      let isBufferPath = true;

      if (file.buffer && Buffer.isBuffer(file.buffer)) {
        detected = await fromBuffer(file.buffer);
      } else if (file.path) {
        detected = (await fromFile(file.path)) as any;
        isBufferPath = false;
      } else {
        throw new Error('Invalid file upload.');
      }

      if (!detected || !LOCAL_STORAGE_ALLOWED_MIME.has(detected.mime)) {
        throw new Error('Unsupported file type.');
      }
      const safeExt = `.${detected.ext}`;
      const safeMime = detected.mime;

      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');

      const tenantPart = this.tenantId ? `/${this.tenantId}` : '';
      const innerPath = `${tenantPart}/${year}/${month}/${day}`;
      const dir = `${this.uploadDirectory}${innerPath}`;
      mkdirSync(dir, { recursive: true });

      const randomName = randomBytes(16).toString('hex');

      const filePath = `${dir}/${randomName}${safeExt}`;
      const publicPath = `${innerPath}/${randomName}${safeExt}`;

      if (isBufferPath) {
        writeFileSync(filePath, file.buffer);
      } else {
        copyFileSync(file.path!, filePath);
      }

      return {
        filename: `${randomName}${safeExt}`,
        path: process.env.FRONTEND_URL + '/uploads' + publicPath,
        mimetype: safeMime,
        originalname: `${randomName}${safeExt}`,
      };
    } catch (err) {
      this._logger.warn(`Local storage upload failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async removeFile(filePath: string): Promise<void> {
    let targetPath = filePath;
    const frontendUrl = process.env.FRONTEND_URL || '';
    if (targetPath.startsWith(frontendUrl + '/uploads/')) {
      targetPath = targetPath.slice((frontendUrl + '/uploads/').length);
    } else if (targetPath.startsWith('/uploads/')) {
      targetPath = targetPath.slice('/uploads/'.length);
    }
    targetPath = this._safeJoin(targetPath);
    return new Promise((resolve, reject) => {
      unlink(targetPath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async readFile(pathOrKey: string): Promise<Buffer> {
    let targetPath = pathOrKey;
    const frontendUrl = process.env.FRONTEND_URL || '';
    if (targetPath.startsWith(frontendUrl + '/uploads/')) {
      targetPath = targetPath.slice((frontendUrl + '/uploads/').length);
    } else if (targetPath.startsWith('/uploads/')) {
      targetPath = targetPath.slice('/uploads/'.length);
    }
    targetPath = this._safeJoin(targetPath);
    return readFileSync(targetPath);
  }

  async writeBuffer(buffer: Buffer, contentType?: string): Promise<string> {
    const detected = await fromBuffer(buffer);
    const ext = detected?.ext || 'bin';
    const mime = detected?.mime || contentType || 'application/octet-stream';

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    const tenantPart = this.tenantId ? `/${this.tenantId}` : '';
    const innerPath = `${tenantPart}/${year}/${month}/${day}`;
    const dir = `${this.uploadDirectory}${innerPath}`;
    mkdirSync(dir, { recursive: true });

    const randomName = randomBytes(16).toString('hex');
    const filePath = `${dir}/${randomName}.${ext}`;
    writeFileSync(filePath, buffer);

    const publicPath = `${innerPath}/${randomName}.${ext}`;
    return (process.env.FRONTEND_URL || '') + '/uploads' + publicPath;
  }
}

class LocalStorageCapability implements StorageCapability {
  readonly type = TYPE;
  private adapter?: LocalStorage;

  constructor(private ctx: ProviderRuntimeContext) {}

  private get a(): LocalStorage {
    if (!this.adapter) {
      this.adapter = new LocalStorage(
        this.ctx.logger,
        process.env.UPLOAD_DIRECTORY || './uploads',
        this.ctx.orgId,
        this.ctx.fetch,
      );
    }
    return this.adapter;
  }

  uploadSimple(path: string) {
    return this.a.uploadSimple(path);
  }
  uploadFile(file: unknown) {
    return this.a.uploadFile(file);
  }
  removeFile(filePath: string) {
    return this.a.removeFile(filePath);
  }
  testConnection() {
    return this.a.testConnection();
  }
  listFiles(prefix?: string) {
    return this.a.listFiles(prefix);
  }
  getFileUrl(key: string) {
    return this.a.getFileUrl(key);
  }
  deleteFile(key: string) {
    return this.a.deleteFile(key);
  }
  getUsageBytes() {
    return this.a.getUsageBytes();
  }
  writeBuffer(buffer: Buffer, contentType?: string) {
    return this.a.writeBuffer(buffer, contentType);
  }
  readFile(pathOrKey: string) {
    return this.a.readFile(pathOrKey);
  }
}

export const localStorageModule: ProviderModule<
  Record<string, never>,
  StorageCapability
> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'storage',
    providerId: TYPE.toLowerCase(),
    version: 'v1',
    displayName: DISPLAY,
    status: 'active',
    credentialFields: CREDENTIAL_FIELDS,
    capabilities: {},
  },
  create: (ctx) => new LocalStorageCapability(ctx),
};
