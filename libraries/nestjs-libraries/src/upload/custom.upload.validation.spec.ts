import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('file-type', () => ({
  fromBuffer: vi.fn(),
  fromFile: vi.fn(),
}));

const mockUnlink = vi.hoisted(() => vi.fn());

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      unlink: mockUnlink,
    },
  };
});

import { CustomFileValidationPipe } from './custom.upload.validation';
import { fromBuffer, fromFile } from 'file-type';

describe('CustomFileValidationPipe', () => {
  let pipe: CustomFileValidationPipe;

  beforeEach(() => {
    vi.clearAllMocks();
    pipe = new CustomFileValidationPipe();
  });

  it('rejects non-file values', async () => {
    await expect(pipe.transform({ some: 'object' })).rejects.toThrow(BadRequestException);
  });

  it('rejects null/undefined values', async () => {
    await expect(pipe.transform(null)).rejects.toThrow(BadRequestException);
    await expect(pipe.transform(undefined)).rejects.toThrow(BadRequestException);
  });

  it('validates a valid file buffer', async () => {
    vi.mocked(fromBuffer).mockResolvedValue({ ext: 'png', mime: 'image/png' });

    const value = {
      buffer: Buffer.from('fake-png-data'),
      mimetype: 'image/png',
      fieldname: 'file',
      originalname: 'test.png',
      size: 1024,
    };

    const result = await pipe.transform(value);

    expect(result.mimetype).toBe('image/png');
    expect(result.originalname).toMatch(/\.png$/);
  });

  it('validates a valid file from path', async () => {
    vi.mocked(fromFile).mockResolvedValue({ ext: 'jpg', mime: 'image/jpeg' });

    const value = {
      path: '/tmp/test.jpg',
      fieldname: 'file',
      originalname: 'test.jpg',
      size: 2048,
    };

    const result = await pipe.transform(value);

    expect(result.mimetype).toBe('image/jpeg');
  });

  it('throws BadRequestException for unsupported mime type', async () => {
    vi.mocked(fromBuffer).mockResolvedValue({ ext: 'exe', mime: 'application/x-msdownload' });

    const value = {
      buffer: Buffer.from('fake-exe'),
      mimetype: 'application/x-msdownload',
      fieldname: 'file',
      originalname: 'virus.exe',
      size: 100,
    };

    await expect(pipe.transform(value)).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException when detected is null', async () => {
    vi.mocked(fromBuffer).mockResolvedValue(null);

    const value = {
      buffer: Buffer.from('garbage'),
      mimetype: 'image/png',
      fieldname: 'file',
      originalname: 'test.png',
      size: 100,
    };

    await expect(pipe.transform(value)).rejects.toThrow('Invalid file upload.');
  });

  it('cleans up temp file on validation error', async () => {
    vi.mocked(fromFile).mockRejectedValue(new Error('Corrupt file'));

    const tempPath = join(tmpdir(), 'uploads', 'badfile.jpg');
    const value = {
      path: tempPath,
      fieldname: 'file',
      originalname: 'badfile.jpg',
    };

    await expect(pipe.transform(value)).rejects.toThrow('Corrupt file');
    expect(mockUnlink).toHaveBeenCalledWith(tempPath);
  });

  it('does not unlink when value has no path on error', async () => {
    vi.mocked(fromBuffer).mockRejectedValue(new Error('Buffer error'));

    const value = {
      buffer: Buffer.from('data'),
      fieldname: 'file',
      originalname: 'test.png',
    };

    await expect(pipe.transform(value)).rejects.toThrow('Buffer error');
    expect(mockUnlink).not.toHaveBeenCalled();
  });
});
