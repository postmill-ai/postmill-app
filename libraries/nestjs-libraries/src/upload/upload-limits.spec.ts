import { describe, it, expect } from 'vitest';
import { checkUploadLimit, UPLOAD_ALLOWED_MIME_TYPES } from './upload-limits';

const MB = 1024 * 1024;
const GB = 1024 * MB;

const limits = {
  image: { maxBytes: 10 * MB },
  video: { maxBytes: 1 * GB },
  audio: { maxBytes: 50 * MB },
  maxBytes: 1 * GB,
} as const;

describe('checkUploadLimit', () => {
  it('accepts supported image, video, and audio categories', () => {
    expect(
      checkUploadLimit({ size: 5 * MB, mimetype: 'image/png' }, limits).ok,
    ).toBe(true);
    expect(
      checkUploadLimit({ size: 100 * MB, mimetype: 'video/mp4' }, limits).ok,
    ).toBe(true);
    expect(
      checkUploadLimit({ size: 40 * MB, mimetype: 'audio/mpeg' }, limits).ok,
    ).toBe(true);
  });

  it('rejects unsupported document/archive MIME types', () => {
    for (const mimetype of [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/zip',
    ]) {
      const result = checkUploadLimit({ size: 1 * MB, mimetype }, limits);
      expect(result.ok, mimetype).toBe(false);
      expect(result.reason).toContain('Unsupported');
    }
  });

  it('rejects a 25 MB image from both client and server paths', () => {
    const result = checkUploadLimit(
      { size: 25 * MB, mimetype: 'image/jpeg' },
      limits,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('exceeds');
    expect(result.reason).toContain(String(10 * MB));
  });
});

describe('UPLOAD_ALLOWED_MIME_TYPES', () => {
  it('contains only image, video, and audio MIMEs', () => {
    for (const mimetype of UPLOAD_ALLOWED_MIME_TYPES) {
      expect(
        mimetype.startsWith('image/') ||
          mimetype.startsWith('video/') ||
          mimetype.startsWith('audio/'),
      ).toBe(true);
    }
  });
});
