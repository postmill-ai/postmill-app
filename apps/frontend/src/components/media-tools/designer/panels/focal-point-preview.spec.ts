import { describe, expect, it } from 'vitest';
import type { DesignerElement } from '../designer.store';
import {
  containPreviewRect,
  focalPointForSourcePoint,
  focalThumbnailImageStyle,
  sourcePointForFocalPoint,
  sourcePointForPreviewPointer,
  zoomFocalPreview,
} from './focal-point-preview';

const source = { width: 400, height: 200 };
const target = { width: 100, height: 200 };
const image = {
  id: 'image',
  type: 'image',
  src: '/image.png',
  x: 0,
  y: 0,
  ...target,
  fitMode: 'cover',
} as DesignerElement;

describe('focal point preview geometry', () => {
  it('contains the full source with centered letterboxing', () => {
    expect(containPreviewRect({ width: 300, height: 180 }, source)).toEqual({
      x: 0,
      y: 15,
      width: 300,
      height: 150,
    });
  });

  it('centers the crop on the clicked source point where the slack allows it', () => {
    const focal = focalPointForSourcePoint({ x: 0.75, y: 0.25 }, source, target);
    expect(focal.x).toBeCloseTo(5 / 6);
    expect(focal.y).toBe(0.5);
    const roundTrip = sourcePointForFocalPoint(focal, source, target);
    expect(roundTrip.x).toBeCloseTo(0.75);
    expect(roundTrip.y).toBeCloseTo(0.5);
  });

  it.each([
    [{ x: 0, y: 0 }, { x: 0, y: 0.5 }],
    [{ x: 1, y: 1 }, { x: 1, y: 0.5 }],
  ])('clamps a source click to the available crop slack', (point, expected) => {
    expect(focalPointForSourcePoint(point, source, target)).toEqual(expected);
  });

  it('inverts pointer coordinates through preview zoom and pan', () => {
    const initial = { zoom: 1, pan: { x: 0, y: 0 } };
    const pointer = { x: 210, y: 80 };
    const zoomed = zoomFocalPreview(initial, pointer, 2);
    const rect = containPreviewRect({ width: 300, height: 180 }, source);
    const before = sourcePointForPreviewPointer(pointer, rect, initial);
    const after = sourcePointForPreviewPointer(pointer, rect, zoomed);
    expect(after).toEqual(before);
    expect(zoomed).toEqual({ zoom: 2, pan: { x: -210, y: -80 } });
  });

  it('bounds zoom and removes pan at the resting scale', () => {
    expect(zoomFocalPreview({ zoom: 2, pan: { x: -20, y: -10 } }, { x: 10, y: 10 }, 99).zoom).toBe(4);
    expect(zoomFocalPreview({ zoom: 2, pan: { x: -20, y: -10 } }, { x: 10, y: 10 }, 0)).toEqual({
      zoom: 1,
      pan: { x: 0, y: 0 },
    });
  });

  it('uses focal position for Cover thumbnails', () => {
    expect(focalThumbnailImageStyle(image, source)).toEqual({ left: -150, top: 0, width: 400, height: 100 });
    expect(focalThumbnailImageStyle({ ...image, focalPoint: { x: 1, y: 0.5 } }, source)).toEqual({
      left: -300,
      top: 0,
      width: 400,
      height: 100,
    });
  });

  it('matches Fit, Fill, and explicit-crop renderer geometry', () => {
    expect(focalThumbnailImageStyle({ ...image, fitMode: 'contain' }, source)).toEqual({
      left: 0,
      top: 37.5,
      width: 100,
      height: 25,
    });
    expect(focalThumbnailImageStyle({ ...image, fitMode: 'fill' }, source)).toEqual({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });
    expect(focalThumbnailImageStyle({
      ...image,
      crop: { x: 50, y: 0, width: 100, height: 200 },
      focalPoint: { x: 1, y: 1 },
    }, source)).toEqual({ left: -50, top: 0, width: 400, height: 100 });
  });
});
