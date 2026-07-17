import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LoggerPort } from '@gitroom/provider-kernel';

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
