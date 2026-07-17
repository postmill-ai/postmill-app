import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runDomainConformance,
  LoggerPort,
  ProviderRuntimeContext,
  SafeFetchPort,
} from '@gitroom/provider-kernel';
import defaultModules from '../..';
import { medialockerStorageModule } from '../storage.adapter';

const API = 'https://api.medialocker.io';
const BUCKET_ID = 'bucket-uuid-1';
const CREDS = { apiKey: 'secret-key', bucketId: BUCKET_ID };

const logger: LoggerPort = {
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const makeCtx = (
  fetchMock: SafeFetchPort,
  credentials: Record<string, string> = CREDS,
  extras?: Record<string, unknown>,
): ProviderRuntimeContext => ({
  credentials,
  encryption: {
    encrypt: (v) => v,
    decrypt: (v) => v,
  },
  fetch: fetchMock,
  logger,
  telemetry: { recordCall: vi.fn() },
  extras,
});

// Minimal PNG (magic bytes + IHDR start) so file-type sniffs image/png.
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00,
]);

describe('medialocker provider conformance', () => {
  it('storage module conforms (create() never throws, even with empty creds)', () => {
    const storage = defaultModules.find((m) => m.manifest.domain === 'storage');
    expect(storage).toBeDefined();
    runDomainConformance('storage', storage!, {
      requiredMethods: [
        'uploadSimple',
        'uploadFile',
        'removeFile',
        'testConnection',
        'listFiles',
        'getFileUrl',
        'deleteFile',
        'getUsageBytes',
        'writeBuffer',
        'readFile',
      ],
    });
  });

  it('throws a clear error on first use without credentials', () => {
    const cap = medialockerStorageModule.create(makeCtx(vi.fn() as any, {}));
    expect(() => cap.listFiles()).toThrow(
      'Missing or invalid credential "Secret Access Key" (apiKey) for MEDIALOCKER',
    );
  });

  it('requires bucketId as well', () => {
    const cap = medialockerStorageModule.create(
      makeCtx(vi.fn() as any, { apiKey: 'k' }),
    );
    expect(() => cap.listFiles()).toThrow(
      'Missing or invalid credential "Bucket ID" (bucketId) for MEDIALOCKER',
    );
  });
});

describe('MediaLockerStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('writeBuffer upload flow', () => {
    it('presigns, PUTs with the signed headers verbatim, confirms, and returns the key', async () => {
      const fetchMock = vi.fn(async (input: any, init?: RequestInit) => {
        const url = String(input);
        if (url === `${API}/api/presign/upload`) {
          const sent = JSON.parse(String(init?.body));
          return jsonResponse({
            url: 'https://uploads.medialocker.io/signed-put',
            method: 'PUT',
            key: sent.key,
            bucketId: BUCKET_ID,
            bucket: 'media-bucket',
            expiresIn: 900,
            headers: { 'x-amz-meta-sha': 'abc123', 'Content-Type': 'image/png' },
          });
        }
        if (url === 'https://uploads.medialocker.io/signed-put') {
          return new Response(null, { status: 200 });
        }
        if (url === `${API}/api/presign/confirm`) {
          return jsonResponse({});
        }
        throw new Error(`unexpected fetch: ${url}`);
      });

      const cap = medialockerStorageModule.create(makeCtx(fetchMock as any));
      const key = await cap.writeBuffer(PNG, 'image/png');

      expect(key).toMatch(/^[0-9a-f]{16}\.png$/);
      expect(fetchMock).toHaveBeenCalledTimes(3);

      const [presignUrl, presignInit] = fetchMock.mock.calls[0];
      expect(String(presignUrl)).toBe(`${API}/api/presign/upload`);
      expect(presignInit?.method).toBe('POST');
      expect((presignInit?.headers as any).Authorization).toBe(
        'Bearer secret-key',
      );
      expect(JSON.parse(String(presignInit?.body))).toEqual({
        bucketId: BUCKET_ID,
        key,
        contentType: 'image/png',
        size: PNG.length,
      });

      const [putUrl, putInit] = fetchMock.mock.calls[1];
      expect(String(putUrl)).toBe('https://uploads.medialocker.io/signed-put');
      expect(putInit?.method).toBe('PUT');
      expect(putInit?.headers).toEqual({
        'x-amz-meta-sha': 'abc123',
        'Content-Type': 'image/png',
      });
      expect(putInit?.body).toBe(PNG);

      const [confirmUrl, confirmInit] = fetchMock.mock.calls[2];
      expect(String(confirmUrl)).toBe(`${API}/api/presign/confirm`);
      expect(confirmInit?.method).toBe('POST');
      expect(JSON.parse(String(confirmInit?.body))).toEqual({
        bucketId: BUCKET_ID,
        key,
      });
    });
  });

  describe('readFile', () => {
    it('resolves key→objectId, presigns a download and GETs the signed url', async () => {
      const payload = Buffer.from('image-bytes');
      const fetchMock = vi.fn(async (input: any, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(`${API}/api/media?`)) {
          return jsonResponse({
            data: [
              { id: 'obj-1', key: 'abc.png' },
              { id: 'obj-2', key: 'abc.png.bak' },
            ],
            total: 2,
            hasMore: false,
          });
        }
        if (url === `${API}/api/presign/download`) {
          return jsonResponse({
            url: 'https://downloads.medialocker.io/signed-get',
            method: 'GET',
            objectId: 'obj-1',
            key: 'abc.png',
            expiresIn: 900,
          });
        }
        if (url === 'https://downloads.medialocker.io/signed-get') {
          return new Response(payload, { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      });

      const cap = medialockerStorageModule.create(makeCtx(fetchMock as any));
      const out = await cap.readFile('abc.png');

      expect(out.equals(payload)).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect((fetchMock.mock.calls[0][1]?.headers as any).Authorization).toBe(
        'Bearer secret-key',
      );
      // substring siblings must not match — exact key only
      expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
        objectId: 'obj-1',
      });
    });

    it('fetches the public URL directly when publicUrl is configured', async () => {
      const payload = Buffer.from('public-bytes');
      const fetchMock = vi.fn<SafeFetchPort>(
        async () => new Response(payload, { status: 200 }),
      );
      const cap = medialockerStorageModule.create(
        makeCtx(fetchMock as any, CREDS, { publicUrl: 'https://cdn.example.com' }),
      );

      const out = await cap.readFile('abc.png');

      expect(out.equals(payload)).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toBe(
        'https://cdn.example.com/abc.png',
      );
    });
  });

  describe('getFileUrl', () => {
    it('joins publicUrl when configured', () => {
      const cap = medialockerStorageModule.create(
        makeCtx(vi.fn() as any, CREDS, { publicUrl: 'https://cdn.example.com' }),
      );
      expect(cap.getFileUrl('k.png')).toBe('https://cdn.example.com/k.png');
    });

    it('presigns a download URL when no publicUrl is configured', async () => {
      const fetchMock = vi.fn(async (input: any) => {
        const url = String(input);
        if (url.startsWith(`${API}/api/media?`)) {
          return jsonResponse({
            data: [{ id: 'obj-1', key: 'k.png' }],
            total: 1,
            hasMore: false,
          });
        }
        if (url === `${API}/api/presign/download`) {
          return jsonResponse({
            url: 'https://downloads.medialocker.io/signed',
            method: 'GET',
            objectId: 'obj-1',
            key: 'k.png',
            expiresIn: 900,
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      });

      const cap = medialockerStorageModule.create(makeCtx(fetchMock as any));
      await expect(cap.getFileUrl('k.png')).resolves.toBe(
        'https://downloads.medialocker.io/signed',
      );
    });

    it('prefers ctx.extras.publicUrl over credentials publicUrl (AUD-2)', () => {
      const cap = medialockerStorageModule.create(
        makeCtx(
          vi.fn() as any,
          { ...CREDS, publicUrl: 'https://cred.example.com' },
          { publicUrl: 'https://extras.example.com' },
        ),
      );
      expect(cap.getFileUrl('k.png')).toBe('https://extras.example.com/k.png');
    });

    it('falls back to credentials publicUrl when extras has none (AUD-2)', () => {
      const cap = medialockerStorageModule.create(
        makeCtx(vi.fn() as any, { ...CREDS, publicUrl: 'https://cred.example.com' }),
      );
      expect(cap.getFileUrl('k.png')).toBe('https://cred.example.com/k.png');
    });
  });

  describe('listFiles', () => {
    it('maps defensive field variants and paginates via offset/hasMore', async () => {
      const fetchMock = vi.fn(async (input: any) => {
        const url = String(input);
        if (!url.startsWith(`${API}/api/media?`)) {
          throw new Error(`unexpected fetch: ${url}`);
        }
        const offset = new URL(url).searchParams.get('offset');
        if (offset === '0') {
          return jsonResponse({
            data: [
              {
                id: '1',
                objectId: 'o1',
                key: 'a.png',
                size: '123',
                created_at: '2026-01-01T00:00:00.000Z',
                contentType: 'image/png',
              },
              {
                objectId: 'o2',
                key: 'b.jpg',
                size: 456,
                createdAt: '2026-02-01T00:00:00.000Z',
                mimeType: 'image/jpeg',
              },
              { id: '3', key: 'c.gif', lastModified: '2026-03-01T00:00:00.000Z' },
              { id: '4', key: 'folder/' },
            ],
            total: 5,
            hasMore: true,
          });
        }
        return jsonResponse({
          data: [
            {
              id: '5',
              key: 'd.webp',
              size: 10,
              createdAt: '2026-04-01T00:00:00.000Z',
              contentType: 'image/webp',
            },
          ],
          total: 5,
          hasMore: false,
        });
      });

      const cap = medialockerStorageModule.create(makeCtx(fetchMock as any));
      const entries = await cap.listFiles('a');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const firstUrl = new URL(String(fetchMock.mock.calls[0][0]));
      expect(firstUrl.searchParams.get('bucketId')).toBe(BUCKET_ID);
      expect(firstUrl.searchParams.get('search')).toBe('a');
      expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('offset')).toBe('4');

      expect(entries).toHaveLength(4);
      expect(entries[0]).toEqual({
        key: 'a.png',
        name: 'a.png',
        size: 123,
        mimeType: 'image/png',
        lastModified: new Date('2026-01-01T00:00:00.000Z'),
      });
      expect(entries[1]).toEqual({
        key: 'b.jpg',
        name: 'b.jpg',
        size: 456,
        mimeType: 'image/jpeg',
        lastModified: new Date('2026-02-01T00:00:00.000Z'),
      });
      expect(entries[2].size).toBe(0);
      expect(entries[2].mimeType).toBe('');
      expect(entries[2].lastModified).toEqual(new Date('2026-03-01T00:00:00.000Z'));
      expect(entries[3].key).toBe('d.webp');
    });
  });

  describe('deleteFile / removeFile', () => {
    it('resolves the key to an objectId and DELETEs it', async () => {
      const fetchMock = vi.fn(async (input: any, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(`${API}/api/media?`)) {
          return jsonResponse({
            data: [{ objectId: 'o9', key: 'dead.png' }],
            total: 1,
            hasMore: false,
          });
        }
        if (url === `${API}/api/media/o9`) {
          expect(init?.method).toBe('DELETE');
          return new Response(null, { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      });

      const cap = medialockerStorageModule.create(makeCtx(fetchMock as any));
      await cap.deleteFile('dead.png');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(String(fetchMock.mock.calls[1][0])).toBe(`${API}/api/media/o9`);
    });

    it('removeFile extracts the key from a URL first', async () => {
      const fetchMock = vi.fn(async (input: any) => {
        const url = String(input);
        if (url.startsWith(`${API}/api/media?`)) {
          return jsonResponse({
            data: [{ id: 'o7', key: 'dead.png' }],
            total: 1,
            hasMore: false,
          });
        }
        return new Response(null, { status: 200 });
      });

      const cap = medialockerStorageModule.create(makeCtx(fetchMock as any));
      await cap.removeFile('https://cdn.example.com/dead.png?x=1');

      expect(String(fetchMock.mock.calls[1][0])).toBe(`${API}/api/media/o7`);
    });

    it('throws a clear error when the key does not exist', async () => {
      const fetchMock = vi.fn(async () =>
        jsonResponse({ data: [], total: 0, hasMore: false }),
      );

      const cap = medialockerStorageModule.create(makeCtx(fetchMock as any));
      await expect(cap.deleteFile('missing.png')).rejects.toThrow(
        'MediaLocker object not found for key "missing.png"',
      );
    });
  });

  describe('getUsageBytes', () => {
    it('returns usedStorage as a BigInt', async () => {
      const fetchMock = vi.fn<SafeFetchPort>(async () =>
        jsonResponse({
          usedStorage: 10737418240,
          allocatedStorage: 1099511627776,
          egressThisMonth: 0,
          apiCallsThisMonth: 3,
          objectCount: 9,
        }),
      );

      const cap = medialockerStorageModule.create(makeCtx(fetchMock as any));
      expect(await cap.getUsageBytes()).toBe(BigInt(10737418240));
      expect(String(fetchMock.mock.calls[0][0])).toBe(`${API}/api/usage`);
    });

    it('returns null on failure', async () => {
      const fetchMock = vi.fn(async () => {
        throw new Error('network down');
      });

      const cap = medialockerStorageModule.create(makeCtx(fetchMock as any));
      expect(await cap.getUsageBytes()).toBeNull();
    });
  });

  describe('testConnection', () => {
    it('returns ok:true when /api/me succeeds', async () => {
      const fetchMock = vi.fn<SafeFetchPort>(async () =>
        jsonResponse({ id: 'user-1' }),
      );

      const cap = medialockerStorageModule.create(makeCtx(fetchMock as any));
      await expect(cap.testConnection()).resolves.toEqual({ ok: true });
      expect(String(fetchMock.mock.calls[0][0])).toBe(`${API}/api/me`);
    });

    it('returns ok:false with the envelope message on 401', async () => {
      const fetchMock = vi.fn(async () =>
        jsonResponse(
          { error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } },
          401,
        ),
      );

      const cap = medialockerStorageModule.create(makeCtx(fetchMock as any));
      const res = await cap.testConnection();
      expect(res.ok).toBe(false);
      expect(res.error).toBe('Invalid API key');
    });

    it('tolerates the Fastify 429 envelope', async () => {
      const fetchMock = vi.fn(async () =>
        jsonResponse(
          {
            statusCode: 429,
            error: 'Too Many Requests',
            message: 'Rate limit exceeded',
          },
          429,
        ),
      );

      const cap = medialockerStorageModule.create(makeCtx(fetchMock as any));
      const res = await cap.testConnection();
      expect(res.ok).toBe(false);
      expect(res.error).toBe('Rate limit exceeded');
    });

    it('returns ok:false on network error', async () => {
      const fetchMock = vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      });

      const cap = medialockerStorageModule.create(makeCtx(fetchMock as any));
      const res = await cap.testConnection();
      expect(res.ok).toBe(false);
      expect(res.error).toContain('ECONNREFUSED');
    });
  });
});
