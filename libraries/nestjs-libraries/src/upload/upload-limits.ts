/**
 * Server-side upload limits. Imports the client-safe defaults from
 * `@gitroom/helpers/upload-limits.client` and layers env overrides on top.
 *
 * Client code must import from `@gitroom/helpers/upload-limits.client` so it
 * never bundles server-side env parsing.
 */

import {
  UPLOAD_LIMITS as DEFAULT_UPLOAD_LIMITS,
  UPLOAD_ALLOWED_MIME_TYPES,
  UploadLimitCheckFile,
  checkUploadLimit as baseCheckUploadLimit,
} from '@gitroom/helpers/upload-limits.client';

const MB = 1024 * 1024;
const GB = 1024 * MB;

function envBytes(key: string, fallbackBytes: number): number {
  const raw = process.env[key];
  if (!raw) {
    return fallbackBytes;
  }
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallbackBytes : parsed;
}

export const UPLOAD_LIMITS = {
  image: {
    maxBytes: envBytes('UPLOAD_IMAGE_MAX_BYTES', DEFAULT_UPLOAD_LIMITS.image.maxBytes),
  },
  video: {
    maxBytes: envBytes('UPLOAD_VIDEO_MAX_BYTES', DEFAULT_UPLOAD_LIMITS.video.maxBytes),
  },
  audio: {
    maxBytes: envBytes('UPLOAD_AUDIO_MAX_BYTES', DEFAULT_UPLOAD_LIMITS.audio.maxBytes),
  },
  // Overall multipart cap used by FileInterceptor / raw upload endpoints.
  // Defaults to 1 GB; this is a backstop, not the per-category limit.
  maxBytes: envBytes('MEDIA_UPLOAD_MAX_BYTES', DEFAULT_UPLOAD_LIMITS.maxBytes),
} as const;

export { UPLOAD_ALLOWED_MIME_TYPES, UploadLimitCheckFile };

/**
 * Shared limit check used by the server `CustomFileValidationPipe`.
 * Defaults to the env-overridden limits; callers may pass explicit limits.
 */
export function checkUploadLimit(
  file: UploadLimitCheckFile,
  limits = UPLOAD_LIMITS
): { ok: boolean; reason?: string } {
  return baseCheckUploadLimit(file, limits);
}
