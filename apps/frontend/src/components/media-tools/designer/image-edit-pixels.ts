'use client';

import { computeMediaDraw } from '@postmill-ai/nestjs-libraries/media/designer-doc/media-geometry';
import { MAX_DIMENSION } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import type { DesignerCrop } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { loadMaskImage } from './background-removal-mask';

export interface MediaFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  crop?: DesignerCrop;
  fitMode?: 'contain' | 'cover' | 'fill';
  focalPoint?: { x: number; y: number };
}

export const originalSubjectWithAlpha = async (sourceUrl: string, cutoutUrl: string): Promise<string> => {
  const [source, cutout] = await Promise.all([loadMaskImage(sourceUrl), loadMaskImage(cutoutUrl)]);
  const canvas = document.createElement('canvas');
  canvas.width = cutout.naturalWidth;
  canvas.height = cutout.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the subject preview.');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(cutout, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
};

export const rasterizeMediaFrame = async ({
  sourceUrl,
  sourceNatural,
  frame,
}: {
  sourceUrl: string;
  sourceNatural: { width: number; height: number };
  frame: MediaFrame;
}): Promise<{ canvas: HTMLCanvasElement; natural: { width: number; height: number } }> => {
  const source = await loadMaskImage(sourceUrl);
  const displayed = computeMediaDraw({
    sourceWidth: sourceNatural.width,
    sourceHeight: sourceNatural.height,
    targetWidth: frame.width,
    targetHeight: frame.height,
    crop: frame.crop,
    fitMode: frame.fitMode,
    focalPoint: frame.focalPoint,
  });
  const nativeScale = Math.min(
    displayed.source.width / displayed.destination.width,
    displayed.source.height / displayed.destination.height
  );
  const scale = Math.max(0.01, Math.min(
    nativeScale,
    MAX_DIMENSION / frame.width,
    MAX_DIMENSION / frame.height
  ));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(frame.width * scale));
  canvas.height = Math.max(1, Math.round(frame.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the expansion source.');
  context.drawImage(
    source,
    displayed.source.x,
    displayed.source.y,
    displayed.source.width,
    displayed.source.height,
    displayed.destination.x * scale,
    displayed.destination.y * scale,
    displayed.destination.width * scale,
    displayed.destination.height * scale
  );
  return { canvas, natural: { width: canvas.width, height: canvas.height } };
};

export const createPageOutpaintExtension = async ({
  generatedUrl,
  targetNatural,
  originalPage,
}: {
  generatedUrl: string;
  targetNatural: { width: number; height: number };
  originalPage: { x: number; y: number; width: number; height: number };
}): Promise<HTMLCanvasElement> => {
  const generated = await loadMaskImage(generatedUrl);
  const canvas = document.createElement('canvas');
  canvas.width = targetNatural.width;
  canvas.height = targetNatural.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the expanded page.');
  context.drawImage(generated, 0, 0, canvas.width, canvas.height);
  context.clearRect(originalPage.x, originalPage.y, originalPage.width, originalPage.height);
  return canvas;
};

export const preserveOutpaintSource = async ({
  sourceUrl,
  generatedUrl,
  sourceNatural,
  resultNatural,
  frame,
}: {
  sourceUrl: string;
  generatedUrl: string;
  sourceNatural: { width: number; height: number };
  resultNatural: { width: number; height: number };
  frame: {
    x: number;
    y: number;
    width: number;
    height: number;
    crop?: DesignerCrop;
    fitMode?: 'contain' | 'cover' | 'fill';
    focalPoint?: { x: number; y: number };
  };
}): Promise<HTMLCanvasElement> => {
  const [source, generated] = await Promise.all([loadMaskImage(sourceUrl), loadMaskImage(generatedUrl)]);
  const canvas = document.createElement('canvas');
  canvas.width = resultNatural.width;
  canvas.height = resultNatural.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the expanded image.');
  context.drawImage(generated, 0, 0, canvas.width, canvas.height);
  const geometry = computeMediaDraw({
    sourceWidth: sourceNatural.width,
    sourceHeight: sourceNatural.height,
    targetWidth: frame.width,
    targetHeight: frame.height,
    crop: frame.crop,
    fitMode: frame.fitMode,
    focalPoint: frame.focalPoint,
  });
  context.drawImage(
    source,
    geometry.source.x,
    geometry.source.y,
    geometry.source.width,
    geometry.source.height,
    frame.x + geometry.destination.x,
    frame.y + geometry.destination.y,
    geometry.destination.width,
    geometry.destination.height,
  );
  return canvas;
};
