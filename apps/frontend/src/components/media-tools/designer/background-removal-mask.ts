'use client';

import { computeMediaDraw } from '@postmill-ai/nestjs-libraries/media/designer-doc/media-geometry';
import type { DesignerCrop } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { backgroundMaskDimensions, type BackgroundRemovalAsset } from './background-removal';
import { commitCanvas, seedBufferFromCanvas, type CommitResult } from './raster-layers';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface BackgroundRemovalMaskFrame {
  width: number;
  height: number;
  crop?: DesignerCrop;
  fitMode?: 'contain' | 'cover' | 'fill';
  focalPoint?: { x: number; y: number };
}

export const loadMaskImage = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
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
  frame,
  id,
}: {
  fetch: FetchLike;
  source: BackgroundRemovalAsset;
  cutout: BackgroundRemovalAsset;
  frame: BackgroundRemovalMaskFrame;
  id: string;
}): Promise<CommitResult> => {
  const image = await loadMaskImage(cutout.url);
  const dimensions = backgroundMaskDimensions(source, {
    ...cutout,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(frame.width));
  canvas.height = Math.max(1, Math.round(frame.height));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the Restore mask.');
  const geometry = computeMediaDraw({
    sourceWidth: dimensions.width,
    sourceHeight: dimensions.height,
    targetWidth: canvas.width,
    targetHeight: canvas.height,
    crop: frame.crop,
    fitMode: frame.fitMode,
    focalPoint: frame.focalPoint,
  });
  const { source: sourceRect, destination } = geometry;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(
    image,
    sourceRect.x,
    sourceRect.y,
    sourceRect.width,
    sourceRect.height,
    destination.x,
    destination.y,
    destination.width,
    destination.height
  );
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
