/**
 * Client-side image downscale for the media picker's upload path.
 *
 * The /files page uploader runs every image through Uppy's CompressionWrapper
 * (cap 1000×1000), but the standardized picker uploads RAW files — a 24 MP
 * phone photo then got stored, re-downloaded by the designer's size probe, and
 * decoded again by Konva. This util restores the "shrink before upload" step
 * for the picker, with the same conventions as CompressionWrapper:
 *
 * - GIFs and non-raster types are never touched (animation / vector data).
 * - The MIME type is preserved — a PNG keeps its alpha channel instead of
 *   being flattened to JPEG.
 * - Anything already under the edge cap is returned untouched.
 *
 * It is an optimization, never a gate: any failure hands back the original
 * file so the upload proceeds exactly as before.
 */

// Same vocabulary as CompressionWrapper's convertTypes.
const RESIZABLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Longest-edge cap for picker uploads. */
export const MAX_UPLOAD_IMAGE_EDGE = 2048;

export const isResizableImage = (type: string): boolean => RESIZABLE_TYPES.has(type);

/**
 * Scaled-down dimensions, or null when the image already fits — null is the
 * "leave the original bytes alone" signal.
 */
export const downscaleDimensions = (
  width: number,
  height: number,
  maxEdge: number = MAX_UPLOAD_IMAGE_EDGE
): { width: number; height: number } | null => {
  const longest = Math.max(width, height);
  if (!width || !height || longest <= maxEdge) return null;
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

/**
 * Returns a resized copy of `file` when it is a raster image larger than
 * `maxEdge` on its longest edge; otherwise (or on any decode/encode failure)
 * returns `file` unchanged.
 */
export const downscaleImageForUpload = async (
  file: File,
  maxEdge: number = MAX_UPLOAD_IMAGE_EDGE
): Promise<File> => {
  if (!isResizableImage(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const target = downscaleDimensions(bitmap.width, bitmap.height, maxEdge);
      if (!target) return file;
      const canvas = document.createElement('canvas');
      canvas.width = target.width;
      canvas.height = target.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, target.width, target.height);
      // Same type in, same type out — alpha survives (PNG/WebP stay lossless-ish,
      // JPEG stays JPEG), matching CompressionWrapper's convertTypes behavior.
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, file.type)
      );
      if (!blob) return file;
      return new File([blob], file.name, {
        type: file.type,
        lastModified: file.lastModified,
      });
    } finally {
      bitmap.close();
    }
  } catch {
    // Decode/encode failures (exotic codec, jsdom, OOM) must not block the
    // upload of the original file.
    return file;
  }
};
