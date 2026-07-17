import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { randomBytes } from 'crypto';
import * as fileType from 'file-type';
import { CredentialField } from '../manifest';
import { ProviderModule, ProviderRuntimeContext } from '../module';
import { LoggerPort, SafeFetchPort } from '../ports';
import { StorageCapability, StorageFileEntry } from './storage';

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

const ALLOWED_MIME_TYPES = new Set<string>([
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

// §6.2: allowlist for `writeBuffer`, which lands provider/AI-generated artifacts (a
// broader set than user uploads: adds video/webm + audio/webm and the text/plain &
// application/json transcript/provenance sidecars). This blocks a provider from landing
// `text/html` (or any other active type) in the org bucket, where it could be served
// and executed. Text/JSON have no magic bytes, so they are trusted only from the caller's
// declared content-type — never sniffed.
const STORED_ARTIFACT_ALLOWED_MIME = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  'text/plain',
  'application/json',
]);

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
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
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
          Prefix: prefix,
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
      throw new Error('Unsupported file type.');
    }
    const extension = detected.ext;
    const safeContentType = detected.mime;
    const id = randomBytes(8).toString('hex');

    const key = `${id}.${extension}`;

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
      const detected = await fromBuffer(file.buffer);
      if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
        throw new Error('Unsupported file type.');
      }
      const id = randomBytes(8).toString('hex');
      const extension = detected.ext;
      const safeContentType = detected.mime;
      const key = `${id}.${extension}`;

      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file.buffer,
          ContentType: safeContentType,
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
    const key = stripQueryStringAndExtractKey(filePath);
    if (!key) return;
    await this.deleteFile(key);
  }

  async readFile(pathOrKey: string): Promise<Buffer> {
    const key = stripQueryStringAndExtractKey(pathOrKey);
    if (!key) throw new Error('Invalid object key');
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const byteArray = await response.Body!.transformToByteArray();
    return Buffer.from(byteArray);
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
    const id = randomBytes(8).toString('hex');
    const key = `${id}.${ext}`;

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
