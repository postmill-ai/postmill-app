import {
  computeCoverCrop,
  computeMediaDraw,
  type MediaRect,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/media-geometry';
import type { DesignerElement } from '../designer.store';

export interface PreviewPoint {
  x: number;
  y: number;
}

export interface PreviewSize {
  width: number;
  height: number;
}

export interface PreviewView {
  zoom: number;
  pan: PreviewPoint;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const containPreviewRect = (
  viewport: PreviewSize,
  source: PreviewSize
): MediaRect => {
  if (!(viewport.width > 0) || !(viewport.height > 0) || !(source.width > 0) || !(source.height > 0)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const scale = Math.min(viewport.width / source.width, viewport.height / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  return {
    x: (viewport.width - width) / 2,
    y: (viewport.height - height) / 2,
    width,
    height,
  };
};

export const focalPointForSourcePoint = (
  point: PreviewPoint,
  source: PreviewSize,
  target: PreviewSize
): PreviewPoint => {
  const crop = computeCoverCrop(source.width, source.height, target.width, target.height);
  const axis = (value: number, sourceSize: number, cropSize: number) => {
    const slack = sourceSize - cropSize;
    if (slack <= 0) return 0.5;
    return clamp01((clamp01(value) * sourceSize - cropSize / 2) / slack);
  };
  return {
    x: axis(point.x, source.width, crop.width),
    y: axis(point.y, source.height, crop.height),
  };
};

export const sourcePointForFocalPoint = (
  focalPoint: PreviewPoint,
  source: PreviewSize,
  target: PreviewSize
): PreviewPoint => {
  const crop = computeCoverCrop(
    source.width,
    source.height,
    target.width,
    target.height,
    focalPoint
  );
  return {
    x: (crop.x + crop.width / 2) / source.width,
    y: (crop.y + crop.height / 2) / source.height,
  };
};

export const sourcePointForPreviewPointer = (
  pointer: PreviewPoint,
  imageRect: MediaRect,
  view: PreviewView
): PreviewPoint => {
  if (!(imageRect.width > 0) || !(imageRect.height > 0)) return { x: 0.5, y: 0.5 };
  const unzoomed = {
    x: (pointer.x - view.pan.x) / view.zoom,
    y: (pointer.y - view.pan.y) / view.zoom,
  };
  return {
    x: clamp01((unzoomed.x - imageRect.x) / imageRect.width),
    y: clamp01((unzoomed.y - imageRect.y) / imageRect.height),
  };
};

export const zoomFocalPreview = (
  view: PreviewView,
  pointer: PreviewPoint,
  requestedZoom: number
): PreviewView => {
  const zoom = Math.min(4, Math.max(1, requestedZoom));
  const sourcePoint = {
    x: (pointer.x - view.pan.x) / view.zoom,
    y: (pointer.y - view.pan.y) / view.zoom,
  };
  return {
    zoom,
    pan: zoom === 1
      ? { x: 0, y: 0 }
      : {
          x: pointer.x - sourcePoint.x * zoom,
          y: pointer.y - sourcePoint.y * zoom,
        },
  };
};

export const focalThumbnailImageStyle = (
  element: DesignerElement,
  source: PreviewSize
): { left: number; top: number; width: number; height: number } => {
  const geometry = computeMediaDraw({
    sourceWidth: source.width,
    sourceHeight: source.height,
    targetWidth: element.width,
    targetHeight: element.height,
    crop: element.crop,
    fitMode: element.fitMode,
    focalPoint: element.focalPoint,
  });
  const scaleX = geometry.destination.width / geometry.source.width;
  const scaleY = geometry.destination.height / geometry.source.height;
  return {
    left: ((geometry.destination.x - geometry.source.x * scaleX) / element.width) * 100,
    top: ((geometry.destination.y - geometry.source.y * scaleY) / element.height) * 100,
    width: (source.width * scaleX / element.width) * 100,
    height: (source.height * scaleY / element.height) * 100,
  };
};
