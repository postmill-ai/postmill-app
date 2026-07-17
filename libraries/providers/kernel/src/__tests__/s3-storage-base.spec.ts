import { describe, it, expect, vi, beforeEach } from 'vitest';

const s3ClientMock = {
  send: vi.fn(),
};

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = s3ClientMock.send;
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
