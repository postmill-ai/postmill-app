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
  originalSrc: undefined;
  originalFileId: undefined;
  smartFilters: undefined;
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

export const backgroundRemovalPatch = ({
  asset,
  output,
  fit,
}: {
  asset: BackgroundRemovalAsset;
  output: { width: number; height: number };
  fit: BackgroundRemovalFit;
}): BackgroundRemovalPatch => {
  const patch: BackgroundRemovalPatch = {
    src: asset.url,
    fileId: asset.fileId,
    naturalWidth: asset.naturalWidth,
    naturalHeight: asset.naturalHeight,
    crop: undefined,
    focalPoint: undefined,
    originalSrc: undefined,
    originalFileId: undefined,
    smartFilters: undefined,
  };
  if (fit === 'manual') return patch;
  patch.fitMode = 'contain';
  if (fit === 'frame' || !asset.naturalWidth || !asset.naturalHeight) return patch;
  return { ...patch, ...fitMediaToCanvas(asset.naturalWidth, asset.naturalHeight, output) };
};
