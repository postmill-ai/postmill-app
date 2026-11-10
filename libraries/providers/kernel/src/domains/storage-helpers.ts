import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { randomBytes } from 'crypto';
import { createReadStream, statSync } from 'fs';
import type { Readable } from 'stream';
import * as fileType from 'file-type';
import { CredentialField } from '../manifest';
import { ProviderModule, ProviderRuntimeContext } from '../module';
import { LoggerPort, SafeFetchPort } from '../ports';
import { StorageCapability, StorageFileEntry } from './storage';
import { UploadValidationError } from '../errors';

// ── file-type compat shim ──────────────────────────────────────────────────
// `file-type` renamed its named exports between v16 (`fromBuffer` / `fromFile`)
// and v21 (`fileTypeFromBuffer` / `fileTypeFromFile`). A transitive dependency
// can hoist v21 over our declared ^16.5.4, which made every upload throw
// `fromBuffer is not a function`. Resolve whichever pair the loaded version
// actually exposes so we work under either major.
export type DetectedFileType = { ext: string; mime: string } | undefined;

const ft = fileType as unknown as Record<string, unknown>;

const pick = (...names: string[]): ((...a: any[]) => any) | undefined => {
  for (const name of names) {
    try {
      const fn = ft[name];
      if (typeof fn === 'function') return fn as (...a: any[]) => any;
    } catch {
      // strict module mock with no such export — keep looking.
    }
  }
  return undefined;
};

export const fromBuffer = (
  input: Uint8Array | ArrayBuffer,
): Promise<DetectedFileType> => {
  const fn = pick('fromBuffer', 'fileTypeFromBuffer');
  return fn ? fn(input) : Promise.resolve(undefined);
};

export const fromFile = (path: string): Promise<DetectedFileType> => {
  const fn = pick('fromFile', 'fileTypeFromFile');
  return fn ? fn(path) : Promise.resolve(undefined);
};

// ── data: URL parsing ───────────────────────────────────────────────────────
/**
 * Parses a `data:` URL into a Buffer and its mime type. Returns null when the
 * value is not a valid data URL.
 */
export function parseDataUrl(
  value: string,
): { buffer: Buffer; mime: string } | null {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(value);
  if (!match) {
    return null;
  }

  const mime = match[1] || 'application/octet-stream';
  const isBase64 = !!match[2];
  const data = match[3];

  const buffer = isBase64
    ? Buffer.from(data, 'base64')
    : Buffer.from(decodeURIComponent(data), 'utf-8');

  return { buffer, mime };
}

function stripQueryStringAndExtractKey(filePath: string): string | undefined {
  let pathname: string;
  try {
    pathname = new URL(filePath).pathname;
  } catch {
    pathname = filePath.split('?')[0];
  }
  return pathname.includes('/') ? pathname.split('/').pop() : pathname;
}

const withoutTrailingSlash = (value: string) => {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end--;
  return value.slice(0, end);
};

const encodeStorageKey = (key: string) =>
  key.split('/').map((segment) => encodeURIComponent(segment)).join('/');

const ALLOWED_MIME_TYPES = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'video/mp4',
  // Keep in lockstep with UPLOAD_ALLOWED_MIME_TYPES (helpers/upload-limits.client):
  // the upload pipe accepts these, and this adapter re-sniffs — a mismatch
  // rejects the file at the storage layer after the pipe let it through.
  'video/webm',
  'audio/webm',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
  'audio/x-m4a',
  'audio/aac',
  'audio/x-wav',
  'video/quicktime',
  'application/pdf',
  'font/ttf',
  'font/otf',
  'font/woff2',
]);

// §6.2: allowlist for `writeBuffer`, which lands provider/AI-generated artifacts (a
// broader set than user uploads: adds video/webm + audio/webm and the text/plain &
// application/json transcript/provenance sidecars). This blocks a provider from landing
// `text/html` (or any other active type) in the org bucket, where it could be served
// and executed. Types without dependable magic bytes use the caller's declared content-type only
// after passing this allowlist.
export const STORED_ARTIFACT_ALLOWED_MIME = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'video/mp4',
  'video/webm',
  // file-type sniffs .mov/.m4v provider artifacts as these; rejecting them here
  // would fail the whole media job after the (paid) render succeeded.
  'video/quicktime',
  'video/x-m4v',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  'text/plain',
  'application/json',
  'font/ttf',
  'font/otf',
  'font/woff2',
  // Inert archive type (never rendered/executed in place) — the Designer
  // `.pdesign` export artifact is a zip and lands through writeBuffer.
  'application/zip',
]);

const STORED_ARTIFACT_EXTENSIONS: Record<string, string> = {
  'application/json': 'json',
  'text/plain': 'txt',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'font/woff2': 'woff2',
};

export async function storedArtifactFile(filePath: string, contentType?: string) {
  const detected = await fromFile(filePath);
  const mime = detected?.mime || contentType || 'application/octet-stream';
  if (!STORED_ARTIFACT_ALLOWED_MIME.has(mime)) {
    throw new UploadValidationError(`Unsupported stored artifact type: ${mime}`);
  }
  return {
    mime,
    ext: detected?.ext || STORED_ARTIFACT_EXTENSIONS[mime] || 'bin',
    size: statSync(filePath).size,
  };
}

/**
 * Shared S3-protocol storage adapter. Used by every S3-compatible storage
 * provider (AWS S3, Backblaze B2, Wasabi, DigitalOcean Spaces, Hetzner, Storj,
 * Scaleway, Vultr, Linode, iDrive e2, generic S3-compatible). Outbound HTTP for
 * `uploadSimple` is threaded in as a `SafeFetchPort` so the package never has to
 * import the host's `safeFetch`.
 */
export class S3StorageBase implements StorageCapability {
  readonly type: string;
  protected client: S3Client;

  constructor(
    private readonly _logger: LoggerPort,
    protected _fetch: SafeFetchPort,
    type: string,
    protected region: string,
    protected credentials: { accessKeyId: string; secretAccessKey: string },
    protected bucket: string,
    protected endpoint?: string,
    protected publicUrl?: string,
  ) {
    this.type = type;
    this.client = new S3Client({
      region,
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
      },
      endpoint,
      // A custom endpoint means a self-hosted/S3-compatible service (MinIO,
      // Ceph, B2, R2, …) — the SDK's virtual-hosted default would resolve
      // `<bucket>.<endpoint-host>`, which does not exist there. Path-style is
      // universally supported by those services. Native AWS S3 (no custom
      // endpoint) keeps the virtual-hosted default.
      forcePathStyle: !!endpoint,
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }

  protected newKey(
    extension: string,
    id = randomBytes(8).toString('hex'),
  ): string {
    return `${id}.${extension}`;
  }

  protected objectKey(pathOrKey: string): string | undefined {
    return stripQueryStringAndExtractKey(pathOrKey);
  }

  protected listPrefix(prefix?: string): string | undefined {
    return prefix;
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message || 'Connection failed' };
    }
  }

  async listFiles(prefix?: string): Promise<StorageFileEntry[]> {
    const entries: StorageFileEntry[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: this.listPrefix(prefix),
          ContinuationToken: continuationToken,
        }),
      );

      if (response.Contents) {
        for (const obj of response.Contents) {
          if (obj.Key && !obj.Key.endsWith('/')) {
            entries.push({
              key: obj.Key,
              name: obj.Key.split('/').pop() || obj.Key,
              size: obj.Size || 0,
              mimeType: '',
              lastModified: obj.LastModified || new Date(),
            });
          }
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return entries;
  }

  getFileUrl(key: string): string {
    if (this.publicUrl) {
      return `${this.publicUrl}/${key}`;
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  async deleteFile(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  async getUsageBytes(): Promise<bigint | null> {
    try {
      let total = BigInt(0);
      let continuationToken: string | undefined;

      do {
        const response = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: this.listPrefix(),
            ContinuationToken: continuationToken,
          }),
        );

        if (response.Contents) {
          for (const obj of response.Contents) {
            if (obj.Size) {
              total += BigInt(obj.Size);
            }
          }
        }

        continuationToken = response.NextContinuationToken;
      } while (continuationToken);

      return total;
    } catch {
      return null;
    }
  }

  async uploadSimple(path: string): Promise<string> {
    const dataUrl = path.startsWith('data:') ? parseDataUrl(path) : null;

    let body: Buffer;
    if (dataUrl) {
      body = dataUrl.buffer;
    } else {
      const loadImage = await this._fetch(path);
      body = Buffer.from(await loadImage.arrayBuffer());
    }

    const detected = await fromBuffer(body);
    if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
      throw new UploadValidationError('Unsupported file type.');
    }
    const extension = detected.ext;
    const safeContentType = detected.mime;
    const key = this.newKey(extension);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: safeContentType,
      }),
    );

    return this.getFileUrl(key);
  }

  async uploadFile(file: any): Promise<any> {
    try {
      // `/files/upload-simple` uses multer's memoryStorage (file.buffer), while
      // `/files/upload-server` uses diskStorage (file.path, no buffer). Sniff from
      // whichever the caller supplied — reading only file.buffer made every
      // upload-server request fail with "Unsupported file type." on S3-backed orgs.
      const hasBuffer = !!file.buffer && Buffer.isBuffer(file.buffer);
      let detected: DetectedFileType;
      if (hasBuffer) {
        detected = await fromBuffer(file.buffer);
      } else if (file.path) {
        detected = await fromFile(file.path);
      } else {
        throw new UploadValidationError('Invalid file upload.');
      }

      if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
        throw new UploadValidationError('Unsupported file type.');
      }
      const id = randomBytes(8).toString('hex');
      const extension = detected.ext;
      const safeContentType = detected.mime;
      const key = this.newKey(extension, id);

      // PutObjectCommand cannot compute the length of a stream, so pass it
      // explicitly when streaming from disk.
      const contentLength = hasBuffer
        ? undefined
        : file.size || statSync(file.path).size;

      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: hasBuffer ? file.buffer : createReadStream(file.path),
          ContentType: safeContentType,
          ...(contentLength ? { ContentLength: contentLength } : {}),
        }),
      );

      return {
        filename: `${id}.${extension}`,
        mimetype: safeContentType,
        size: file.size,
        buffer: file.buffer,
        originalname: `${id}.${extension}`,
        fieldname: 'file',
        path: this.getFileUrl(key),
        destination: this.getFileUrl(key),
        encoding: '7bit',
        stream: file.buffer as any,
      };
    } catch (err) {
      this._logger.warn(`S3 upload failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async removeFile(filePath: string): Promise<void> {
    const key = this.objectKey(filePath);
    if (!key) return;
    await this.deleteFile(key);
  }

  async readFile(pathOrKey: string): Promise<Buffer> {
    const key = this.objectKey(pathOrKey);
    if (!key) throw new Error('Invalid object key');
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const byteArray = await response.Body!.transformToByteArray();
    return Buffer.from(byteArray);
  }

  async readFileStream(pathOrKey: string): Promise<Readable> {
    const key = this.objectKey(pathOrKey);
    if (!key) throw new Error('Invalid object key');
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) throw new Error('Storage object has no response body');
    return response.Body as unknown as Readable;
  }

  async writeBuffer(buffer: Buffer, contentType?: string): Promise<string> {
    const detected = await fromBuffer(buffer);
    // §6.2: prefer the sniffed type (magic bytes are trustworthy); text/JSON have no
    // magic and fall back to the caller's declared content-type. Reject anything not on
    // the allowlist so a provider can't land text/html in the org bucket.
    const mime = detected?.mime || contentType || 'application/octet-stream';
    if (!STORED_ARTIFACT_ALLOWED_MIME.has(mime)) {
      throw new Error(`Unsupported stored artifact type: ${mime}`);
    }
    const ext =
      detected?.ext ||
      (mime === 'application/json' ? 'json' : mime === 'text/plain' ? 'txt' : 'bin');
    const key = this.newKey(ext);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mime,
      }),
    );

    return this.getFileUrl(key);
  }

  async writeFileStream(filePath: string, contentType?: string): Promise<string> {
    const { mime, ext, size } = await storedArtifactFile(filePath, contentType);
    const key = this.newKey(ext);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: createReadStream(filePath),
      ContentType: mime,
      ContentLength: size,
    }));
    return this.getFileUrl(key);
  }
}

export class PlatformS3StorageBase extends S3StorageBase {
  private readonly tenantId: string;
  private readonly legacyPublicUrl?: string;

  constructor(
    logger: LoggerPort,
    fetch: SafeFetchPort,
    type: string,
    region: string,
    credentials: { accessKeyId: string; secretAccessKey: string },
    bucket: string,
    endpoint: string | undefined,
    publicUrl: string | undefined,
    tenantId: string,
    legacyPublicUrl?: string,
  ) {
    if (!/^[a-zA-Z0-9_-]+$/.test(tenantId)) {
      throw new Error('Invalid tenant storage prefix');
    }
    super(
      logger,
      fetch,
      type,
      region,
      credentials,
      bucket,
      endpoint,
      publicUrl ? withoutTrailingSlash(publicUrl) : undefined,
    );
    this.tenantId = tenantId;
    this.legacyPublicUrl = legacyPublicUrl
      ? withoutTrailingSlash(legacyPublicUrl)
      : undefined;
  }

  protected newKey(
    extension: string,
    id = randomBytes(8).toString('hex'),
  ): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${this.tenantId}/${year}/${month}/${day}/${id}.${extension}`;
  }

  protected objectKey(pathOrKey: string): string {
    const value = pathOrKey.trim();
    if (!value) throw new Error('Invalid object key');

    let raw = value.split('?')[0].split('#')[0];
    if (/^https?:\/\//i.test(value)) {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new Error('Invalid storage URL');
      }
      const candidates = [
        this.publicUrl,
        this.legacyPublicUrl,
        this.publicUrl
          ? undefined
          : `https://${this.bucket}.s3.${this.region}.amazonaws.com`,
      ].filter((base): base is string => !!base);
      const base = candidates.find((candidate) => {
        const baseUrl = new URL(candidate);
        const basePath = withoutTrailingSlash(baseUrl.pathname);
        return (
          url.origin === baseUrl.origin &&
          (url.pathname === basePath || url.pathname.startsWith(`${basePath}/`))
        );
      });
      if (!base) throw new Error('Storage URL does not belong to this provider');
      const basePath = withoutTrailingSlash(new URL(base).pathname);
      raw = url.pathname.slice(basePath.length);
    } else if (this.legacyPublicUrl) {
      const legacyPath = withoutTrailingSlash(new URL(this.legacyPublicUrl).pathname);
      const pathValue = raw.startsWith('/') ? raw : `/${raw}`;
      if (pathValue.startsWith(`${legacyPath}/`)) {
        raw = pathValue.slice(legacyPath.length);
      }
    }

    let segments: string[];
    try {
      segments = raw
        .replace(/^\/+/, '')
        .split('/')
        .map((segment) => decodeURIComponent(segment));
    } catch {
      throw new Error('Invalid object key');
    }
    if (
      segments.some(
        (segment) =>
          !segment ||
          segment === '.' ||
          segment === '..' ||
          segment.includes('/') ||
          segment.includes('\\') ||
          segment.includes('\0'),
      )
    ) {
      throw new Error('Invalid object key');
    }

    const key = segments.join('/');
    if (!key.startsWith(`${this.tenantId}/`)) {
      throw new Error('Storage object does not belong to this organization');
    }
    return key;
  }

  protected listPrefix(prefix?: string): string | undefined {
    const tenantPrefix = `${this.tenantId}/`;
    if (!prefix) return tenantPrefix;
    const clean = prefix.replace(/^\/+/, '');
    if (clean.split('/').some((segment) => segment === '..')) {
      throw new Error('Invalid object prefix');
    }
    return clean.startsWith(tenantPrefix) ? clean : `${tenantPrefix}${clean}`;
  }

  getFileUrl(key: string): string {
    const encoded = encodeStorageKey(this.objectKey(key));
    if (this.publicUrl) {
      return `${this.publicUrl}/${encoded}`;
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${encoded}`;
  }

  async deleteFile(key: string): Promise<void> {
    await super.deleteFile(this.objectKey(key));
  }
}

// ── S3-family module factory ────────────────────────────────────────────────
export interface S3StorageModuleConfig {
  /** StorageProviderType enum value, e.g. 'BACKBLAZE_B2'. Also the `.type`. */
  type: string;
  displayName: string;
  credentialFields: CredentialField[];
  /** Provider-specific region defaulting (matches the legacy adapter ctor). */
  resolveRegion?: (region: string | undefined) => string;
  /** Provider-specific endpoint defaulting, given the resolved region. */
  resolveEndpoint?: (
    region: string,
    endpoint: string | undefined,
  ) => string | undefined;
}

/**
 * Builds a storage `ProviderModule` for an S3-compatible provider. The returned
 * capability lazily constructs the underlying `S3StorageBase` on first use
 * (so `create()` is cheap and never throws — required for conformance) and
 * validates required credentials before constructing (preserving the legacy
 * `StorageAdapterFactory.validateCredentials` behaviour).
 */
export function makeS3StorageModule(
  cfg: S3StorageModuleConfig,
): ProviderModule<Record<string, never>, StorageCapability> {
  class S3FamilyStorageCapability implements StorageCapability {
    readonly type = cfg.type;
    private adapter?: S3StorageBase;

    constructor(private ctx: ProviderRuntimeContext) {}

    private get a(): S3StorageBase {
      if (!this.adapter) {
        for (const field of cfg.credentialFields) {
          if (!field.required) continue;
          const value = this.ctx.credentials?.[field.key];
          if (!value || typeof value !== 'string' || value.trim().length === 0) {
            throw new Error(
              `Missing or invalid credential "${field.label}" (${field.key}) for ${cfg.type}`,
            );
          }
        }
        const extras = (this.ctx.extras || {}) as Record<string, any>;
        const region = cfg.resolveRegion
          ? cfg.resolveRegion(extras.region)
          : extras.region;
        const endpoint = cfg.resolveEndpoint
          ? cfg.resolveEndpoint(region, extras.endpoint)
          : extras.endpoint;
        if (extras.tenantId) {
          this.adapter = new PlatformS3StorageBase(
            this.ctx.logger,
            this.ctx.fetch,
            cfg.type,
            region,
            this.ctx.credentials as any,
            extras.bucket,
            endpoint,
            extras.publicUrl,
            extras.tenantId,
            extras.legacyPublicUrl,
          );
        } else {
          this.adapter = new S3StorageBase(
            this.ctx.logger,
            this.ctx.fetch,
            cfg.type,
            region,
            this.ctx.credentials as any,
            extras.bucket,
            endpoint,
            extras.publicUrl,
          );
        }
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
    writeFileStream(path: string, contentType?: string) {
      return this.a.writeFileStream(path, contentType);
    }
    readFile(pathOrKey: string) {
      return this.a.readFile(pathOrKey);
    }
    readFileStream(pathOrKey: string) {
      return this.a.readFileStream(pathOrKey);
    }
  }

  return {
    manifest: {
      domain: 'storage',
      providerId: cfg.type.toLowerCase(),
      version: 'v1',
      displayName: cfg.displayName,
      status: 'active',
      credentialFields: cfg.credentialFields,
      capabilities: {},
    },
    create: (ctx) => new S3FamilyStorageCapability(ctx),
  };
}
