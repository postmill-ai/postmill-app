export type BackgroundRemovalFit = 'frame' | 'canvas' | 'manual';

export interface BackgroundRemovalAsset {
  url: string;
  fileId?: string;
  naturalWidth?: number;
  naturalHeight?: number;
}

export interface BackgroundRemovalPatch {
  src: string;
  fileId?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fitMode?: 'contain';
  crop: undefined;
  focalPoint: undefined;
  originalSrc?: string;
  originalFileId?: string;
  smartFilters: undefined;
  maskSrc: string;
  maskFileId?: string;
  maskEnabled: true;
}

export const centeredMediaFrame = (
  before: { width: number; height: number },
  output: { width: number; height: number }
) => ({
  x: Math.round((output.width - before.width) / 2),
  y: Math.round((output.height - before.height) / 2),
});

export const fitMediaToCanvas = (
  naturalWidth: number,
  naturalHeight: number,
  output: { width: number; height: number }
) => {
  const scale = Math.min(output.width / naturalWidth, output.height / naturalHeight);
  const size = {
    width: Math.round(naturalWidth * scale),
    height: Math.round(naturalHeight * scale),
  };
  return { ...size, ...centeredMediaFrame(size, output) };
};

export const backgroundMaskDimensions = (
  source: BackgroundRemovalAsset,
  cutout: BackgroundRemovalAsset
): { width: number; height: number } => {
  const width = source.naturalWidth;
  const height = source.naturalHeight;
  const cutoutWidth = cutout.naturalWidth;
  const cutoutHeight = cutout.naturalHeight;
  if (!width || !height || !cutoutWidth || !cutoutHeight ||
    width < 1 || height < 1 || cutoutWidth < 1 || cutoutHeight < 1) {
    throw new Error('Could not determine the original and cutout image dimensions.');
  }
  const sourceRatio = width / height;
  const cutoutRatio = cutoutWidth / cutoutHeight;
  if (Math.abs(sourceRatio - cutoutRatio) / sourceRatio > 0.01) {
    throw new Error('The cutout has different framing from the original, so a reliable Restore mask cannot be created.');
  }
  return { width: Math.round(width), height: Math.round(height) };
};

export const backgroundRemovalPatch = ({
  source,
  mask,
  output,
  fit,
}: {
  source: BackgroundRemovalAsset;
  mask: BackgroundRemovalAsset;
  output: { width: number; height: number };
  fit: BackgroundRemovalFit;
}): BackgroundRemovalPatch => {
  const patch: BackgroundRemovalPatch = {
    src: source.url,
    fileId: source.fileId,
    naturalWidth: source.naturalWidth,
    naturalHeight: source.naturalHeight,
    crop: undefined,
    focalPoint: undefined,
    originalSrc: source.url,
    originalFileId: source.fileId,
    smartFilters: undefined,
    maskSrc: mask.url,
    maskFileId: mask.fileId,
    maskEnabled: true,
  };
  if (fit === 'manual') return patch;
  patch.fitMode = 'contain';
  if (fit === 'frame' || !source.naturalWidth || !source.naturalHeight) return patch;
  return { ...patch, ...fitMediaToCanvas(source.naturalWidth, source.naturalHeight, output) };
};
