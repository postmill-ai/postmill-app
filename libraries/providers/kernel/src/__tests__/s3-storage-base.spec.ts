import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, ReadStream } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const s3ClientMock = {
  send: vi.fn(),
};

// Records each S3Client constructor config so tests can assert client options
// (e.g. forcePathStyle) without a live S3 service.
const s3ClientConfigs: any[] = [];

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = s3ClientMock.send;
    constructor(public config: any) {
      s3ClientConfigs.push(config);
    }
  },
  PutObjectCommand: class {
    constructor(public config: any) {}
  },
  GetObjectCommand: class {
    constructor(public config: any) {}
  },
  DeleteObjectCommand: class {
    constructor(public config: any) {}
  },
  ListObjectsV2Command: class {
    constructor(public config: any) {}
  },
  HeadBucketCommand: class {
    constructor(public config: any) {}
  },
}));

import { S3StorageBase } from '../domains/storage-helpers';
import type { SafeFetchPort, LoggerPort } from '../ports';

const fetchStub: SafeFetchPort = async () => new Response();
const logger: LoggerPort = {
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe('S3StorageBase', () => {
  const creds = { accessKeyId: 'key', secretAccessKey: 'secret' };

  const make = (
    region = 'us-east-1',
    bucket = 'bucket',
    endpoint?: string,
    publicUrl?: string,
  ) =>
    new S3StorageBase(logger, fetchStub, 'S3', region, creds, bucket, endpoint, publicUrl);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('readFile', () => {
    it('fetches an object from S3 and returns the buffer', async () => {
      const buffer = Buffer.from('image data');
      s3ClientMock.send.mockResolvedValue({
        Body: {
          transformToByteArray: async () => buffer,
        },
      });

      const adapter = make('us-east-1', 'my-bucket');
      const result = await adapter.readFile('path/to/file.png');

      expect(s3ClientMock.send).toHaveBeenCalled();
      expect(result).toEqual(buffer);
    });

    it('extracts the object key from a full path', async () => {
      s3ClientMock.send.mockResolvedValue({
        Body: { transformToByteArray: async () => Buffer.from('') },
      });

      const adapter = make();
      await adapter.readFile('uploads/2026/01/15/abc.png');

      const cmd = s3ClientMock.send.mock.calls[0][0];
      expect(cmd.config.Key).toBe('abc.png');
    });

    it('throws on invalid key extraction', async () => {
      const adapter = make();
      await expect(adapter.readFile('/')).rejects.toThrow('Invalid object key');
    });
  });

  describe('type', () => {
    it('returns the provider type it was constructed with', () => {
      const adapter = make();
      expect(adapter.type).toBe('S3');
    });
  });

  describe('writeBuffer (§6.2 stored-artifact allowlist)', () => {
    it('rejects a disallowed content-type (text/html) so a provider cannot land executable HTML', async () => {
      const adapter = make();
      await expect(
        adapter.writeBuffer(Buffer.from('<html><script>alert(1)</script></html>'), 'text/html'),
      ).rejects.toThrow('Unsupported stored artifact type');
      expect(s3ClientMock.send).not.toHaveBeenCalled();
    });

    it('allows a text/plain transcript sidecar and stores it with a .txt key', async () => {
      s3ClientMock.send.mockResolvedValue({});
      const adapter = make('us-east-1', 'my-bucket', undefined, 'https://cdn.example.com');

      const url = await adapter.writeBuffer(Buffer.from('hello world transcript'), 'text/plain');

      const cmd = s3ClientMock.send.mock.calls[0][0];
      expect(cmd.config.ContentType).toBe('text/plain');
      expect(cmd.config.Key).toMatch(/\.txt$/);
      expect(url).toContain('https://cdn.example.com/');
    });
  });

  describe('client construction', () => {
    // A custom endpoint means self-hosted S3 (MinIO/Ceph/…) where the SDK's
    // virtual-hosted default would resolve <bucket>.<endpoint-host> — a host
    // that does not exist. Seen live: MinIO connection test ENOTFOUND.
    it('uses path-style addressing when a custom endpoint is set', () => {
      s3ClientConfigs.length = 0;
      make('us-east-1', 'bucket', 'http://minio.internal:9000');
      expect(s3ClientConfigs[0].forcePathStyle).toBe(true);
    });

    it('keeps the virtual-hosted default for native AWS S3 (no custom endpoint)', () => {
      s3ClientConfigs.length = 0;
      make('us-east-1', 'bucket');
      expect(s3ClientConfigs[0].forcePathStyle).toBe(false);
    });
  });

  describe('testConnection', () => {
    it('returns success on HeadBucket success', async () => {
      s3ClientMock.send.mockResolvedValue({});
      const adapter = make();

      const result = await adapter.testConnection();

      expect(result.ok).toBe(true);
    });

    it('returns error with message on HeadBucket failure', async () => {
      s3ClientMock.send.mockRejectedValue(new Error('Access Denied'));
      const adapter = make();

      const result = await adapter.testConnection();

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Access Denied');
    });
  });

  describe('getFileUrl', () => {
    it('returns a public URL when publicUrl is set', () => {
      const adapter = make('us-east-1', 'bucket', undefined, 'https://cdn.example.com');
      expect(adapter.getFileUrl('path/to/file.png')).toBe(
        'https://cdn.example.com/path/to/file.png',
      );
    });

    it('constructs AWS S3 URL when publicUrl is not set', () => {
      const adapter = make('us-west-2', 'my-bucket');
      expect(adapter.getFileUrl('file.png')).toBe(
        'https://my-bucket.s3.us-west-2.amazonaws.com/file.png',
      );
    });
  });

  describe('listFiles', () => {
    it('lists objects from S3', async () => {
      s3ClientMock.send.mockResolvedValue({
        Contents: [
          { Key: 'file1.png', Size: 100, LastModified: new Date() },
          { Key: 'folder/', Size: 0 },
        ],
        NextContinuationToken: undefined,
      });

      const adapter = make();
      const result = await adapter.listFiles();

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('file1.png');
      expect(result[0].size).toBe(100);
    });

    it('paginates through results', async () => {
      s3ClientMock.send
        .mockResolvedValueOnce({
          Contents: [{ Key: 'file1.png', Size: 100, LastModified: new Date() }],
          NextContinuationToken: 'token-1',
        })
        .mockResolvedValueOnce({
          Contents: [{ Key: 'file2.png', Size: 200, LastModified: new Date() }],
          NextContinuationToken: undefined,
        });

      const adapter = make();
      const result = await adapter.listFiles();

      expect(result).toHaveLength(2);
      expect(s3ClientMock.send).toHaveBeenCalledTimes(2);
    });
  });

  describe('getUsageBytes', () => {
    it('sums all object sizes', async () => {
      s3ClientMock.send.mockResolvedValue({
        Contents: [{ Size: 100 }, { Size: 200 }],
        NextContinuationToken: undefined,
      });

      const adapter = make();
      const result = await adapter.getUsageBytes();

      expect(result).toBe(BigInt(300));
    });

    it('handles null sizes gracefully', async () => {
      s3ClientMock.send.mockResolvedValue({
        Contents: [{ Size: null }, { Size: 100 }],
        NextContinuationToken: undefined,
      });

      const adapter = make();
      const result = await adapter.getUsageBytes();

      expect(result).toBe(BigInt(100));
    });

    it('returns null on error', async () => {
      s3ClientMock.send.mockRejectedValue(new Error('Error'));
      const adapter = make();
      const result = await adapter.getUsageBytes();
      expect(result).toBeNull();
    });
  });

  describe('deleteFile', () => {
    it('deletes an object by key', async () => {
      s3ClientMock.send.mockResolvedValue({});
      const adapter = make();

      await adapter.deleteFile('path/to/file.png');

      const cmd = s3ClientMock.send.mock.calls[0][0];
      expect(cmd.config.Key).toBe('path/to/file.png');
    });
  });

  describe('uploadFile', () => {
    // `/files/upload-simple` uses multer memoryStorage (file.buffer);
    // `/files/upload-server` uses diskStorage (file.path, no buffer). Sniffing
    // only from the buffer made every upload-server request fail with
    // "Unsupported file type." on S3-backed orgs.
    // The fixture must be a real minimal PNG — file-type v19+ validates the IHDR
    // chunk and rejects magic-bytes-only buffers.
    const PNG = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0x00, 0x00, 0x00, 0x0d]),
      Buffer.from('IHDR'),
      Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
      Buffer.from([0x1f, 0x15, 0xc4, 0x89]),
      Buffer.alloc(64),
    ]);

    it('uploads from a memory buffer', async () => {
      s3ClientMock.send.mockResolvedValue({});
      const adapter = make('us-east-1', 'my-bucket');

      const result = await adapter.uploadFile({ buffer: PNG, size: PNG.length });

      const cmd = s3ClientMock.send.mock.calls[0][0];
      expect(cmd.config.ContentType).toBe('image/png');
      expect(cmd.config.Body).toBe(PNG);
      expect(result.path).toContain('.png');
    });

    it('uploads from a disk path when there is no buffer (upload-server)', async () => {
      s3ClientMock.send.mockResolvedValue({});
      const dir = mkdtempSync(join(tmpdir(), 's3-upload-'));
      const filePath = join(dir, 'upload.tmp');
      writeFileSync(filePath, PNG);

      try {
        const adapter = make('us-east-1', 'my-bucket');
        const result = await adapter.uploadFile({
          path: filePath,
          size: PNG.length,
        });

        const cmd = s3ClientMock.send.mock.calls[0][0];
        expect(cmd.config.ContentType).toBe('image/png');
        expect(cmd.config.ContentLength).toBe(PNG.length);
        expect(cmd.config.Body).toBeInstanceOf(ReadStream);
        expect(result.path).toContain('.png');

        // `send` is mocked, so nothing consumed the stream. Drain it here — both
        // to prove the right bytes would be uploaded and so the temp dir isn't
        // removed while the lazily-opened fd is still pending.
        const chunks: Buffer[] = [];
        for await (const chunk of cmd.config.Body) chunks.push(chunk as Buffer);
        expect(Buffer.concat(chunks).equals(PNG)).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('rejects a file with neither a buffer nor a path', async () => {
      const adapter = make();
      await expect(adapter.uploadFile({ size: 10 })).rejects.toThrow(
        'Invalid file upload.'
      );
      expect(s3ClientMock.send).not.toHaveBeenCalled();
    });
  });

  describe('removeFile', () => {
    it('extracts the key and deletes the file', async () => {
      s3ClientMock.send.mockResolvedValue({});
      const adapter = make();

      await adapter.removeFile('https://cdn.example.com/path/to/file.png');

      const cmd = s3ClientMock.send.mock.calls[0][0];
      expect(cmd.config.Key).toBe('file.png');
    });
  });
});
