import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomBytes } from 'crypto';
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
} from '@gitroom/provider-kernel';

const TYPE = 'CLOUDFLARE_R2';
const DISPLAY = 'Cloudflare R2';
const CREDENTIAL_FIELDS: CredentialField[] = [
  { key: 'accessKeyId', label: 'Access Key ID', type: 'password', required: true },
  { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true },
];

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

const ALLOWED_EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.mp4': 'video/mp4',
};

function stripQueryStringAndExtractKey(filePath: string): string | undefined {
  let pathname: string;
  try {
    pathname = new URL(filePath).pathname;
  } catch {
    pathname = filePath.split('?')[0];
  }
  return pathname.includes('/') ? pathname.split('/').pop() : pathname;
}

export class R2Storage implements StorageCapability {
  readonly type = TYPE;
  private client: S3Client;

  constructor(
    private readonly _logger: LoggerPort,
    private _fetch: SafeFetchPort,
    private credentials: { accessKeyId: string; secretAccessKey: string },
    private bucket: string,
    private endpoint?: string,
    private publicUrl?: string,
  ) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: endpoint || this.buildEndpoint(),
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }

  private buildEndpoint(): string {
    throw new Error(
      'Cloudflare R2 requires an endpoint URL. ' +
        'Provide the endpoint in the storage provider config (https://<accountId>.r2.cloudflarestorage.com).',
    );
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
    return `/${key}`;
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
      this._logger.warn(`R2 upload failed: ${(err as Error).message}`);
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

  async createMultipartUpload(
    fileName: string,
    fileHash?: string,
  ): Promise<{ uploadId: string; key: string }> {
    const mimeType = this.getMimeByExtension(fileName);
    // Enforce the same allowlist as single uploads — multipart must not be a
    // bypass for arbitrary file types (magic-byte sniffing isn't possible at
    // create time, so gate on the extension→MIME allowlist here).
    if (!mimeType) {
      throw new Error('Unsupported file type.');
    }
    const randomFilename = this.generateRandomKey(fileName);

    const response = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: randomFilename,
        ContentType: mimeType,
        Metadata: fileHash ? { 'x-amz-meta-file-hash': fileHash } : undefined,
      }),
    );

    return {
      uploadId: response.UploadId!,
      key: response.Key!,
    };
  }

  async prepareUploadParts(
    key: string,
    uploadId: string,
    partNumbers: number[],
  ): Promise<Record<string, string>> {
    const presignedUrls: Record<string, string> = {};

    for (const partNumber of partNumbers) {
      const url = await getSignedUrl(
        this.client,
        new UploadPartCommand({
          Bucket: this.bucket,
          Key: key,
          PartNumber: partNumber,
          UploadId: uploadId,
        }),
        { expiresIn: 3600 },
      );

      presignedUrls[partNumber] = url;
    }

    return presignedUrls;
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: { PartNumber: number; ETag: string }[],
  ): Promise<{ Location: string; key: string }> {
    const response = await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }),
    );

    const location = this.getFileUrl(response.Key || key);
    return { Location: location, key: response.Key || key };
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  async listParts(key: string, uploadId: string): Promise<any[]> {
    const response = await this.client.send(
      new ListPartsCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
    return response.Parts || [];
  }

  async signPart(
    key: string,
    uploadId: string,
    partNumber: number,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        PartNumber: partNumber,
        UploadId: uploadId,
      }),
      { expiresIn: 3600 },
    );
  }

  async writeBuffer(buffer: Buffer, contentType?: string): Promise<string> {
    const detected = await fromBuffer(buffer);
    const ext = detected?.ext || 'bin';
    const mime = detected?.mime || contentType || 'application/octet-stream';
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

  private getMimeByExtension(filename: string): string | undefined {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (!ext) return undefined;
    return ALLOWED_EXT_TO_MIME[`.${ext}`];
  }

  private generateRandomKey(fileName: string): string {
    const ext = fileName.split('.').pop();
    return `${randomBytes(10).toString('hex')}.${ext}`;
  }
}

class CloudflareR2StorageCapability implements StorageCapability {
  readonly type = TYPE;
  private adapter?: R2Storage;

  constructor(private ctx: ProviderRuntimeContext) {}

  private get a(): R2Storage {
    if (!this.adapter) {
      for (const field of CREDENTIAL_FIELDS) {
        if (!field.required) continue;
        const value = this.ctx.credentials?.[field.key];
        if (!value || typeof value !== 'string' || value.trim().length === 0) {
          throw new Error(
            `Missing or invalid credential "${field.label}" (${field.key}) for ${TYPE}`,
          );
        }
      }
      const extras = (this.ctx.extras || {}) as Record<string, any>;
      this.adapter = new R2Storage(
        this.ctx.logger,
        this.ctx.fetch,
        this.ctx.credentials as any,
        extras.bucket,
        extras.endpoint || undefined,
        extras.publicUrl || undefined,
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

export const cloudflarer2StorageModule: ProviderModule<
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
  create: (ctx) => new CloudflareR2StorageCapability(ctx),
};
