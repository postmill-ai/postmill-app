/**
 * Client-safe upload limits. No process.env access — pure constants so the
 * frontend bundle never drags in server-side env parsing.
 *
 * Server code should import from `@gitroom/nestjs-libraries/upload/upload-limits`
 * which layers env overrides on top of these defaults.
 */

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const UPLOAD_LIMITS = {
  image: {
    maxBytes: 10 * MB,
  },
  video: {
    maxBytes: 1 * GB,
  },
  audio: {
    maxBytes: 50 * MB,
  },
  // Overall multipart cap used as a safe client default.
  maxBytes: 1 * GB,
} as const;

export const UPLOAD_ALLOWED_MIME_TYPES = new Set([
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
]);

export interface UploadLimitCheckFile {
  size: number;
  mimetype: string;
}

/**
 * Shared limit check used by the client-side Uppy pre-processor. Passes an
 * explicit `limits` object (fetched from `/files/limits`) or falls back to the
 * pure defaults above.
 */
export function checkUploadLimit(
  file: UploadLimitCheckFile,
  limits = UPLOAD_LIMITS
): { ok: boolean; reason?: string } {
  if (!UPLOAD_ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return { ok: false, reason: 'Unsupported file type.' };
  }

  const maxBytes = file.mimetype.startsWith('image/')
    ? limits.image.maxBytes
    : file.mimetype.startsWith('video/')
      ? limits.video.maxBytes
      : limits.audio.maxBytes;

  if (file.size > maxBytes) {
    return {
      ok: false,
      reason: `File size exceeds the maximum allowed size of ${maxBytes} bytes.`,
    };
  }

  return { ok: true };
}
