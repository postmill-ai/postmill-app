/**
 * Largest decoded image an edit endpoint accepts inline. Base64 inflates by
 * roughly 4/3, so callers can reject oversized encoded payloads before decoding.
 */
export const IMAGE_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
