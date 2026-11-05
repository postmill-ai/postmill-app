'use client';

import { backgroundMaskDimensions, type BackgroundRemovalAsset } from './background-removal';
import { commitCanvas, seedBufferFromCanvas, type CommitResult } from './raster-layers';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const loadMaskImage = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Could not read the cutout pixels.'));
  image.src = src;
});

export const uploadBackgroundRemovalMask = async ({
  fetch,
  source,
  cutout,
  id,
}: {
  fetch: FetchLike;
  source: BackgroundRemovalAsset;
  cutout: BackgroundRemovalAsset;
  id: string;
}): Promise<CommitResult> => {
  const image = await loadMaskImage(cutout.url);
  const dimensions = backgroundMaskDimensions(source, {
    ...cutout,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
  });
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the Restore mask.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, dimensions.width, dimensions.height);
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(image, 0, 0, dimensions.width, dimensions.height);
  context.globalCompositeOperation = 'source-over';
  seedBufferFromCanvas(`${id}:mask`, canvas);
  const uploaded = await commitCanvas(canvas, `${id}:mask`, fetch);
  if (!uploaded) throw new Error('Could not save the Restore mask.');
  return uploaded;
};

export const discardBackgroundRemovalMask = async (
  fetch: FetchLike,
  mask: CommitResult
): Promise<void> => {
  if (!mask.fileId) return;
  try {
    await fetch(`/files/${mask.fileId}`, { method: 'DELETE' });
  } catch {
    // Best-effort cleanup of an unused upload after a stale Apply.
  }
};
