import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, ReadStream } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { LoggerPort } from '@postmill-ai/provider-kernel';

const mockSend = vi.fn();
const logger: LoggerPort = {
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function () {
    return { send: mockSend };
  }),
  PutObjectCommand: vi.fn(function (this: any, i: any) { Object.assign(this, i); }),
  DeleteObjectCommand: vi.fn(function (this: any, i: any) { Object.assign(this, i); }),
  ListObjectsV2Command: vi.fn(function (this: any, i: any) { Object.assign(this, i); }),
  HeadBucketCommand: vi.fn(function (this: any, i: any) { Object.assign(this, i); }),
  CreateMultipartUploadCommand: vi.fn(function (this: any, i: any) { Object.assign(this, i); }),
  CompleteMultipartUploadCommand: vi.fn(function (this: any, i: any) { Object.assign(this, i); }),
  AbortMultipartUploadCommand: vi.fn(function (this: any, i: any) { Object.assign(this, i); }),
  UploadPartCommand: vi.fn(function (this: any, i: any) { Object.assign(this, i); }),
  ListPartsCommand: vi.fn(function (this: any, i: any) { Object.assign(this, i); }),
  GetObjectCommand: vi.fn(function (this: any, i: any) { Object.assign(this, i); }),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed'),
}));

import { R2Storage } from '../storage.adapter';

describe('R2Storage.createMultipartUpload — MIME allowlist (5.8)', () => {
  let adapter: R2Storage;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({ UploadId: 'up-1', Key: 'k.png' });
    adapter = new R2Storage(
      logger,
      vi.fn() as any,
      { accessKeyId: 'a', secretAccessKey: 's' },
      'bucket',
      'https://acc.r2.cloudflarestorage.com',
    );
  });

  it('rejects a disallowed extension at create', async () => {
    await expect(
      adapter.createMultipartUpload('malware.exe'),
    ).rejects.toThrow('Unsupported file type.');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('rejects an extension-less filename at create', async () => {
    await expect(
      adapter.createMultipartUpload('README'),
    ).rejects.toThrow('Unsupported file type.');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('accepts an allowed extension and sets the mapped ContentType', async () => {
    const result = await adapter.createMultipartUpload('photo.png');
    expect(result).toEqual({ uploadId: 'up-1', key: 'k.png' });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ ContentType: 'image/png' }),
    );
  });
});

describe('R2Storage.uploadFile — buffer vs disk path', () => {
  // `/files/upload-simple` uses multer memoryStorage (file.buffer);
  // `/files/upload-server` uses diskStorage (file.path, no buffer). Sniffing
  // only from the buffer made every upload-server request fail with
  // "Unsupported file type." on R2-backed orgs.
  const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64),
  ]);

  let adapter: R2Storage;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({});
    adapter = new R2Storage(
      logger,
      vi.fn() as any,
      { accessKeyId: 'a', secretAccessKey: 's' },
      'bucket',
      'https://acc.r2.cloudflarestorage.com',
    );
  });

  it('uploads from a memory buffer', async () => {
    const result = await adapter.uploadFile({ buffer: PNG, size: PNG.length });

    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.ContentType).toBe('image/png');
    expect(cmd.Body).toBe(PNG);
    expect(result.path).toContain('.png');
  });

  it('uploads from a disk path when there is no buffer (upload-server)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'r2-upload-'));
    const filePath = join(dir, 'upload.tmp');
    writeFileSync(filePath, PNG);

    try {
      const result = await adapter.uploadFile({
        path: filePath,
        size: PNG.length,
      });

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.ContentType).toBe('image/png');
      expect(cmd.ContentLength).toBe(PNG.length);
      expect(cmd.Body).toBeInstanceOf(ReadStream);
      expect(result.path).toContain('.png');

      // `send` is mocked, so nothing consumed the stream. Drain it here — both
      // to prove the right bytes would be uploaded and so the temp dir isn't
      // removed while the lazily-opened fd is still pending.
      const chunks: Buffer[] = [];
      for await (const chunk of cmd.Body) chunks.push(chunk as Buffer);
      expect(Buffer.concat(chunks).equals(PNG)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a file with neither a buffer nor a path', async () => {
    await expect(adapter.uploadFile({ size: 10 })).rejects.toThrow(
      'Invalid file upload.'
    );
    expect(mockSend).not.toHaveBeenCalled();
  });
});
