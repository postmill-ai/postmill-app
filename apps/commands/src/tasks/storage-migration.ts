import { Command, Positional } from 'nestjs-command';
import { Injectable, Logger } from '@nestjs/common';
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getPlatformS3Config, PlatformS3StorageConfig } from '@postmill-ai/helpers/storage/platform-storage';
import { createHash } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, isAbsolute, relative, resolve, sep } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

type Mode = 'inventory' | 'copy' | 'verify' | 'copy-back';
type ManifestEntry = { size: number; sha256: string };
type Manifest = {
  version: 1;
  sourceRoot: string;
  bucket: string;
  files: Record<string, ManifestEntry>;
};
type SourceFile = { key: string; path: string; size: number };
type ListedObject = { key: string; size: number };

const CONTENT_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.m4a': 'audio/mp4',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.otf': 'font/otf',
  '.pdesign': 'application/zip',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.zip': 'application/zip',
};

const validKey = (key: string) => {
  const segments = key.split('/');
  return (
    !!key &&
    !key.startsWith('/') &&
    !key.includes('\\') &&
    !key.includes('\0') &&
    segments.every((segment) => !!segment && segment !== '.' && segment !== '..')
  );
};

const hashStream = async (stream: AsyncIterable<Uint8Array>) => {
  const hash = createHash('sha256');
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
};

const hashFile = (path: string) => hashStream(createReadStream(path));

const mapWithConcurrency = async <T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
) => {
  const results = new Array<R>(values.length);
  let next = 0;
  const run = async () => {
    for (;;) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await worker(values[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, run),
  );
  return results;
};

@Injectable()
export class StorageMigration {
  private readonly _logger = new Logger(StorageMigration.name);
  private client?: S3Client;
  private config?: PlatformS3StorageConfig;

  protected createClient(config: PlatformS3StorageConfig) {
    return new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: !!config.endpoint,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  private get s3() {
    if (!this.config) throw new Error('Storage migration is not initialized');
    if (!this.client) this.client = this.createClient(this.config);
    return this.client;
  }

  private get manifestPath() {
    const directory =
      process.env.STORAGE_MIGRATION_DIRECTORY ||
      resolve(tmpdir(), 'postmill-storage-migration');
    return resolve(directory, 'manifest.json');
  }

  private get sourceRoot() {
    const root = process.env.UPLOAD_DIRECTORY?.trim();
    if (!root) throw new Error('UPLOAD_DIRECTORY is required for storage migration.');
    return resolve(root);
  }

  private async emptyManifest(): Promise<Manifest> {
    if (!this.config) throw new Error('Storage migration is not initialized');
    return {
      version: 1,
      sourceRoot: this.sourceRoot,
      bucket: this.config.bucket,
      files: {},
    };
  }

  private async loadManifest(): Promise<Manifest> {
    let manifest: Manifest;
    try {
      manifest = JSON.parse(await readFile(this.manifestPath, 'utf8')) as Manifest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return this.emptyManifest();
    }
    if (
      manifest.version !== 1 ||
      manifest.sourceRoot !== this.sourceRoot ||
      manifest.bucket !== this.config?.bucket
    ) {
      throw new Error('Migration manifest belongs to a different source or bucket.');
    }
    return manifest;
  }

  private async saveManifest(manifest: Manifest) {
    await mkdir(dirname(this.manifestPath), { recursive: true });
    const temporary = `${this.manifestPath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, this.manifestPath);
  }

  private localPath(key: string) {
    if (!validKey(key)) throw new Error(`Invalid storage key: ${key}`);
    const root = this.sourceRoot;
    const path = resolve(root, key);
    const rel = relative(root, path);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`Storage key escapes the upload root: ${key}`);
    }
    return path;
  }

  private async scanSource() {
    const files: SourceFile[] = [];
    const skipped: string[] = [];
    const walk = async (directory: string) => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const path = resolve(directory, entry.name);
        const info = await lstat(path);
        const rel = relative(this.sourceRoot, path).split(sep).join('/');
        if (info.isSymbolicLink()) {
          skipped.push(rel);
          continue;
        }
        if (info.isDirectory()) {
          await walk(path);
        } else if (info.isFile()) {
          if (!validKey(rel)) throw new Error(`Invalid source key: ${rel}`);
          files.push({ key: rel, path, size: info.size });
        } else {
          skipped.push(rel);
        }
      }
    };
    await walk(this.sourceRoot);
    files.sort((a, b) => a.key.localeCompare(b.key));
    return { files, skipped };
  }

  private async head(key: string): Promise<ListedObject | null> {
    if (!this.config) throw new Error('Storage migration is not initialized');
    try {
      const response = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return { key, size: response.ContentLength ?? 0 };
    } catch (error) {
      const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (
        err.name === 'NotFound' ||
        err.name === 'NoSuchKey' ||
        err.$metadata?.httpStatusCode === 404
      ) {
        return null;
      }
      throw error;
    }
  }

  private async remoteHash(key: string) {
    if (!this.config) throw new Error('Storage migration is not initialized');
    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    if (!response.Body) throw new Error(`Destination object has no body: ${key}`);
    return hashStream(response.Body as AsyncIterable<Uint8Array>);
  }

  private async listRemote(): Promise<ListedObject[]> {
    if (!this.config) throw new Error('Storage migration is not initialized');
    const objects: ListedObject[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of response.Contents ?? []) {
        if (object.Key && !object.Key.endsWith('/')) {
          objects.push({ key: object.Key, size: object.Size ?? 0 });
        }
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);
    return objects;
  }

  private async put(file: SourceFile) {
    if (!this.config) throw new Error('Storage migration is not initialized');
    const extension = file.key.includes('.')
      ? `.${file.key.split('.').pop()?.toLowerCase()}`
      : '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.s3.send(
          new PutObjectCommand({
            Bucket: this.config.bucket,
            Key: file.key,
            Body: createReadStream(file.path),
            ContentLength: file.size,
            ContentType: CONTENT_TYPES[extension] || 'application/octet-stream',
          }),
        );
        return;
      } catch (error) {
        if (attempt === 3) throw error;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 250));
      }
    }
  }

  private async copySourceFile(file: SourceFile, manifest: Manifest) {
    const sha256 = await hashFile(file.path);
    const entry = { size: file.size, sha256 };
    const previous = manifest.files[file.key];
    const remote = await this.head(file.key);
    if (
      previous?.sha256 === sha256 &&
      previous.size === file.size &&
      remote?.size === file.size
    ) {
      return { status: 'skipped' as const, entry };
    }
    if (remote && !previous) {
      const existingHash = await this.remoteHash(file.key);
      if (existingHash !== sha256) {
        throw new Error(`Destination contains a different object: ${file.key}`);
      }
      return { status: 'adopted' as const, entry };
    }
    await this.put(file);
    return { status: 'copied' as const, entry };
  }

  @Command({
    command: 'storage:local-to-s3 <mode>',
    describe: 'Inventory, copy, verify, or copy back platform objects without deleting either side',
  })
  async run(
    @Positional({ name: 'mode', type: 'string' })
    mode: Mode,
  ) {
    if (!['inventory', 'copy', 'verify', 'copy-back'].includes(mode)) {
      throw new Error('Mode must be inventory, copy, verify, or copy-back.');
    }
    this.config = getPlatformS3Config();
    const scanned = await this.scanSource();
    const sourceBytes = scanned.files.reduce((total, file) => total + file.size, 0);
    this._logger.log(
      `Storage source: files=${scanned.files.length} bytes=${sourceBytes} skipped=${scanned.skipped.length}`,
    );
    if (scanned.skipped.length) {
      this._logger.warn(
        `Skipped symlinks/non-regular files: ${scanned.skipped.join(', ')}`,
      );
    }
    if (mode === 'inventory') {
      return {
        files: scanned.files.length,
        bytes: sourceBytes,
        skipped: scanned.skipped,
      };
    }

    const manifest = await this.loadManifest();
    if (mode === 'copy') {
      const stats = { copied: 0, adopted: 0, skipped: 0, bytes: 0 };
      for (let offset = 0; offset < scanned.files.length; offset += 25) {
        const batch = scanned.files.slice(offset, offset + 25);
        const results = await mapWithConcurrency(batch, 4, async (file) => {
          const result = await this.copySourceFile(file, manifest);
          return { key: file.key, ...result };
        });
        for (const result of results) {
          stats[result.status]++;
          if (result.status === 'copied') stats.bytes += result.entry.size;
          manifest.files[result.key] = result.entry;
        }
        await this.saveManifest(manifest);
        this._logger.log(
          `Storage copy progress: ${Math.min(offset + batch.length, scanned.files.length)}/${scanned.files.length}`,
        );
      }
      await this.saveManifest(manifest);
      return stats;
    }

    if (mode === 'verify') {
      const missing: string[] = [];
      const mismatched: string[] = [];
      for (let offset = 0; offset < scanned.files.length; offset += 10) {
        const batch = scanned.files.slice(offset, offset + 10);
        await mapWithConcurrency(batch, 3, async (file) => {
          const remote = await this.head(file.key);
          if (!remote) {
            missing.push(file.key);
            return;
          }
          const sha256 = await hashFile(file.path);
          if (remote.size !== file.size || (await this.remoteHash(file.key)) !== sha256) {
            mismatched.push(file.key);
            return;
          }
          manifest.files[file.key] = { size: file.size, sha256 };
        });
        await this.saveManifest(manifest);
      }
      const remote = await this.listRemote();
      const sourceKeys = new Set(scanned.files.map((file) => file.key));
      const unexpected = remote.filter((object) => !sourceKeys.has(object.key));
      if (missing.length || mismatched.length) {
        throw new Error(
          `Storage verification failed: missing=${missing.length} mismatched=${mismatched.length} ` +
            `sample=${[...missing, ...mismatched].slice(0, 10).join(', ')}`,
        );
      }
      return {
        verified: scanned.files.length,
        bytes: sourceBytes,
        unexpected: unexpected.map((object) => object.key),
      };
    }

    const remote = await this.listRemote();
    const stats = { copied: 0, skipped: 0, bytes: 0 };
    for (const object of remote) {
      if (!validKey(object.key)) throw new Error(`Invalid destination key: ${object.key}`);
      const path = this.localPath(object.key);
      let localHash: string | undefined;
      try {
        const info = await stat(path);
        if (info.isFile()) localHash = await hashFile(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (localHash) {
        const remoteHash = await this.remoteHash(object.key);
        if (localHash !== remoteHash) {
          throw new Error(`Local and destination objects differ: ${object.key}`);
        }
        stats.skipped++;
        continue;
      }
      if (!this.config) throw new Error('Storage migration is not initialized');
      const response = await this.s3.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: object.key }),
      );
      if (!response.Body) throw new Error(`Destination object has no body: ${object.key}`);
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${process.pid}.tmp`;
      const body = response.Body as AsyncIterable<Uint8Array>;
      await pipeline(Readable.from(body), createWriteStream(temporary, { mode: 0o600 }));
      await rename(temporary, path);
      stats.copied++;
      stats.bytes += object.size;
      manifest.files[object.key] = {
        size: object.size,
        sha256: await hashFile(path),
      };
      await this.saveManifest(manifest);
    }
    return stats;
  }
}
