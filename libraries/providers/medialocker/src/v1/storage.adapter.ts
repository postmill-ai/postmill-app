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

const TYPE = 'MEDIALOCKER';
const DISPLAY = 'MediaLocker';
const DEFAULT_BASE_URL = 'https://api.medialocker.io';
// listFiles paginates via offset/hasMore — cap the total so a huge bucket
// cannot page forever.
const LIST_PAGE_SIZE = 100;
const LIST_MAX_ENTRIES = 1000;

const CREDENTIAL_FIELDS: CredentialField[] = [
  { key: 'apiKey', label: 'Secret Access Key', type: 'password', required: true },
  { key: 'bucketId', label: 'Bucket ID', type: 'text', required: true },
  { key: 'baseUrl', label: 'API Base URL', type: 'text', required: false },
  { key: 'publicUrl', label: 'Public URL', type: 'text', required: false },
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

// MediaLocker REST shapes (docs.medialocker.io).
interface PresignUploadResponse {
  url: string;
  method?: string;
  key?: string;
  expiresIn?: number;
  headers?: Record<string, string>;
}

interface PresignDownloadResponse {
  url: string;
  method?: string;
  objectId?: string;
  key?: string;
  expiresIn?: number;
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

// The /api/media per-item field names are not documented — accept every known
// variant when mapping a list entry.
function toFileEntry(item: any): StorageFileEntry | undefined {
  const key = item?.key;
  if (!key || typeof key !== 'string' || key.endsWith('/')) return undefined;
  const size = Number(item.size);
  const created = item.created_at ?? item.createdAt ?? item.lastModified;
  return {
    key,
    name: key.split('/').pop() || key,
    size: Number.isFinite(size) ? size : 0,
    mimeType: item.contentType ?? item.mimeType ?? '',
    lastModified: created ? new Date(created) : new Date(),
  };
}

export class MediaLockerStorage implements StorageCapability {
  readonly type = TYPE;

  constructor(
    private readonly _logger: LoggerPort,
    private _fetch: SafeFetchPort,
    private apiKey: string,
    private bucketId: string,
    private baseUrl: string,
    private publicUrl?: string,
  ) {}

  // Bearer-authenticated JSON call against the MediaLocker REST API.
  private async api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this._fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) {
      throw new Error(await this.errorMessage(res));
    }
    // Some endpoints (presign/confirm, DELETE) return 2xx with an empty body.
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  // Two error envelopes exist: application errors `{ error: { code, message } }`
  // (401/403) and the Fastify infrastructure shape `{ statusCode, error,
  // message }` (429) — tolerate both when extracting the message.
  private async errorMessage(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as any;
      return (
        body?.error?.message ??
        body?.message ??
        (typeof body?.error === 'string' ? body.error : undefined) ??
        `MediaLocker request failed (HTTP ${res.status})`
      );
    } catch {
      return `MediaLocker request failed (HTTP ${res.status})`;
    }
  }

  // Media objects are addressed by objectId (UUID) for download/delete while
  // StorageCapability speaks in keys: search by key substring, then exact-match
  // `item.key === key`.
  private async resolveObjectId(key: string): Promise<string> {
    const params = new URLSearchParams({
      bucketId: this.bucketId,
      search: key,
      limit: '50',
    });
    const res = await this.api<{ data?: any[] }>(`/api/media?${params}`);
    const hit = (res.data || []).find((item) => item?.key === key);
    const id = hit?.id ?? hit?.objectId;
    if (!id) {
      throw new Error(`MediaLocker object not found for key "${key}"`);
    }
    return String(id);
  }

  private async presignDownloadUrl(key: string): Promise<string> {
    const objectId = await this.resolveObjectId(key);
    const res = await this.api<PresignDownloadResponse>('/api/presign/download', {
      method: 'POST',
      body: JSON.stringify({ objectId }),
    });
    return res.url;
  }

  // Single-shot presigned PUT only — the API's multipart flow for ≥100MB
  // objects is out of scope for this adapter.
  private async uploadWithPresign(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    const presign = await this.api<PresignUploadResponse>('/api/presign/upload', {
      method: 'POST',
      body: JSON.stringify({
        bucketId: this.bucketId,
        key,
        contentType,
        size: body.length,
      }),
    });

    // The signed `headers` returned by presign MUST be sent verbatim on the
    // PUT. Presigned URLs are provider-controlled; self-hosted SSRF blocks are
    // handled via SSRF_ALLOWED_PRIVATE_CIDRS — never bypass safeFetch.
    const put = await this._fetch(presign.url, {
      method: presign.method || 'PUT',
      headers: presign.headers,
      body,
    });
    if (!put.ok) {
      throw new Error(`MediaLocker presigned PUT failed (HTTP ${put.status})`);
    }

    // Any 2xx is a success — the confirm response body is undocumented.
    await this.api('/api/presign/confirm', {
      method: 'POST',
      body: JSON.stringify({ bucketId: this.bucketId, key: presign.key || key }),
    });
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      // /api/me is the cheap authenticated endpoint.
      await this.api('/api/me');
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message || 'Connection failed' };
    }
  }

  async listFiles(prefix?: string): Promise<StorageFileEntry[]> {
    const entries: StorageFileEntry[] = [];
    let offset = 0;

    while (entries.length < LIST_MAX_ENTRIES) {
      const params = new URLSearchParams({
        bucketId: this.bucketId,
        limit: String(LIST_PAGE_SIZE),
        offset: String(offset),
      });
      // `search` is a substring filter on key/filename.
      if (prefix) params.set('search', prefix);
      const page = await this.api<{ data?: any[]; hasMore?: boolean }>(
        `/api/media?${params}`,
      );
      const items = page.data || [];
      for (const item of items) {
        const entry = toFileEntry(item);
        if (entry) entries.push(entry);
      }
      if (!page.hasMore || items.length === 0) break;
      offset += items.length;
    }

    return entries.slice(0, LIST_MAX_ENTRIES);
  }

  // Stable, PERSISTABLE reference for an uploaded object — a public URL when a
  // CDN is configured, else the bare key. NEVER a presigned URL: those expire
  // (expiresIn ~900s), so storing one as a file path yields dead links later. A
  // stored bare key is resolved to a fresh presigned GET on demand by
  // getFileUrl (mirrors the local adapter, which stores relative paths).
  private stableRef(key: string): string {
    return this.publicUrl ? `${this.publicUrl}/${key}` : key;
  }

  // On-demand browser URL. StorageCapability declares this sync, but without a
  // publicUrl the only URL MediaLocker can produce is an async presigned GET —
  // hence `any` (string when publicUrl is set, Promise<string> otherwise; every
  // in-repo caller returns it from an async method, so the promise flattens).
  // NOTE: never persist this result — use stableRef() for stored paths.
  getFileUrl(key: string): any {
    if (this.publicUrl) {
      return `${this.publicUrl}/${key}`;
    }
    return this.presignDownloadUrl(key);
  }

  async deleteFile(key: string): Promise<void> {
    const objectId = await this.resolveObjectId(key);
    // Soft-delete on the API side; 200 with no body.
    await this.api(`/api/media/${encodeURIComponent(objectId)}`, {
      method: 'DELETE',
    });
  }

  async getUsageBytes(): Promise<bigint | null> {
    try {
      const usage = await this.api<{ usedStorage?: number | string }>('/api/usage');
      if (usage?.usedStorage === undefined || usage?.usedStorage === null) {
        return null;
      }
      return BigInt(usage.usedStorage);
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

    await this.uploadWithPresign(key, body, safeContentType);

    return this.stableRef(key);
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

      await this.uploadWithPresign(key, file.buffer, safeContentType);

      const ref = this.stableRef(key);
      return {
        filename: `${id}.${extension}`,
        mimetype: safeContentType,
        size: file.size,
        buffer: file.buffer,
        originalname: `${id}.${extension}`,
        fieldname: 'file',
        path: ref,
        destination: ref,
        encoding: '7bit',
        stream: file.buffer as any,
      };
    } catch (err) {
      this._logger.warn(`MediaLocker upload failed: ${(err as Error).message}`);
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
    // With a publicUrl the object can be fetched directly; the presign path
    // must always work either way.
    const url = this.publicUrl
      ? `${this.publicUrl}/${key}`
      : await this.presignDownloadUrl(key);
    const res = await this._fetch(url);
    if (!res.ok) {
      throw new Error(`MediaLocker download failed (HTTP ${res.status})`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async writeBuffer(buffer: Buffer, contentType?: string): Promise<string> {
    const detected = await fromBuffer(buffer);
    const ext = detected?.ext || 'bin';
    const mime = detected?.mime || contentType || 'application/octet-stream';
    const id = randomBytes(8).toString('hex');
    const key = `${id}.${ext}`;

    await this.uploadWithPresign(key, buffer, mime);

    return this.stableRef(key);
  }
}

class MediaLockerStorageCapability implements StorageCapability {
  readonly type = TYPE;
  private adapter?: MediaLockerStorage;

  constructor(private ctx: ProviderRuntimeContext) {}

  private get a(): MediaLockerStorage {
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
      const credentials = this.ctx.credentials || {};
      const extras = (this.ctx.extras || {}) as Record<string, any>;
      // AUD-2: apiKey/bucketId/baseUrl come from ctx.credentials ONLY — on the
      // backend ctx.extras is the fixed {bucket, region, endpoint, publicUrl}
      // map. publicUrl arrives via extras, with credentials as the fallback.
      this.adapter = new MediaLockerStorage(
        this.ctx.logger,
        this.ctx.fetch,
        credentials.apiKey,
        credentials.bucketId,
        (credentials.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ''),
        extras.publicUrl ?? credentials.publicUrl ?? undefined,
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

export const medialockerStorageModule: ProviderModule<
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
  create: (ctx) => new MediaLockerStorageCapability(ctx),
};
