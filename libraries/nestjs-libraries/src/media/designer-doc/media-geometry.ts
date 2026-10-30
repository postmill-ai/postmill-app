import type { DesignerCrop } from './designer-doc.schema';

export interface MediaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MediaDrawInput {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  crop?: DesignerCrop;
  fitMode?: 'contain' | 'cover' | 'fill';
  focalPoint?: { x: number; y: number };
}

export interface MediaDrawGeometry {
  source: MediaRect;
  destination: MediaRect;
}

/** Source pixels painted by a cover fit, positioned within the leftover slack. */
export const computeCoverCrop = (
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number,
  focalPoint?: { x: number; y: number }
): MediaRect => {
  const fp = focalPoint || { x: 0.5, y: 0.5 };
  const targetRatio = targetW / targetH;
  const srcRatio = srcW / srcH;
  let sw: number;
  let sh: number;
  if (srcRatio > targetRatio) {
    sh = srcH;
    sw = srcH * targetRatio;
  } else {
    sw = srcW;
    sh = srcW / targetRatio;
  }
  return {
    x: (srcW - sw) * Math.min(1, Math.max(0, fp.x)),
    y: (srcH - sh) * Math.min(1, Math.max(0, fp.y)),
    width: sw,
    height: sh,
  };
};

/**
 * Resolve the source window and destination rectangle for visual media.
 * Explicit crop wins over fit mode. An omitted fit retains the static-image
 * stretch default; video callers pass their aspect-preserving cover default.
 */
export const computeMediaDraw = (input: MediaDrawInput): MediaDrawGeometry => {
  const { sourceWidth, sourceHeight, targetWidth, targetHeight, crop, focalPoint } = input;
  const fitMode = input.fitMode || 'fill';
  const source = crop
    ? {
        x: Math.max(0, crop.x),
        y: Math.max(0, crop.y),
        width: Math.max(1, crop.width),
        height: Math.max(1, crop.height),
      }
    : fitMode === 'cover'
      ? computeCoverCrop(sourceWidth, sourceHeight, targetWidth, targetHeight, focalPoint)
      : { x: 0, y: 0, width: sourceWidth, height: sourceHeight };

  if (crop || fitMode === 'contain') {
    const scale = Math.min(targetWidth / source.width, targetHeight / source.height);
    const width = source.width * scale;
    const height = source.height * scale;
    return {
      source,
      destination: {
        x: (targetWidth - width) / 2,
        y: (targetHeight - height) / 2,
        width,
        height,
      },
    };
  }

  return {
    source,
    destination: { x: 0, y: 0, width: targetWidth, height: targetHeight },
  };
};

/** Source for the injected frame renderer; keep every closure local. */
export const mediaGeometrySource = (): string =>
  `const computeCoverCrop = ${String(computeCoverCrop)};\n` +
  `const computeMediaDraw = ${String(computeMediaDraw)};`;
