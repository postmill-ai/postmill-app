import { describe, it, expect } from 'vitest';
import {
  downscaleDimensions,
  downscaleImageForUpload,
  isResizableImage,
  MAX_UPLOAD_IMAGE_EDGE,
} from './downscale-image';

describe('isResizableImage', () => {
  it('matches CompressionWrapper’s convertTypes vocabulary', () => {
    expect(isResizableImage('image/jpeg')).toBe(true);
    expect(isResizableImage('image/png')).toBe(true);
    expect(isResizableImage('image/webp')).toBe(true);
  });

  it('never touches GIFs, SVGs, video, audio, or documents', () => {
    expect(isResizableImage('image/gif')).toBe(false);
    expect(isResizableImage('image/svg+xml')).toBe(false);
    expect(isResizableImage('image/avif')).toBe(false);
    expect(isResizableImage('video/mp4')).toBe(false);
    expect(isResizableImage('audio/mpeg')).toBe(false);
    expect(isResizableImage('application/pdf')).toBe(false);
  });
});

describe('downscaleDimensions', () => {
  it('returns null when both edges already fit (original untouched)', () => {
    expect(downscaleDimensions(2048, 1536)).toBeNull();
    expect(downscaleDimensions(1000, 800)).toBeNull();
    expect(downscaleDimensions(MAX_UPLOAD_IMAGE_EDGE, MAX_UPLOAD_IMAGE_EDGE)).toBeNull();
  });

  it('caps the longest edge and preserves aspect (landscape)', () => {
    expect(downscaleDimensions(4096, 2048)).toEqual({ width: 2048, height: 1024 });
  });

  it('caps the longest edge and preserves aspect (portrait)', () => {
    expect(downscaleDimensions(3000, 6000)).toEqual({ width: 1024, height: 2048 });
  });

  it('never rounds a side down to zero', () => {
    const result = downscaleDimensions(1, 10000);
    expect(result).toEqual({ width: 1, height: 2048 });
  });

  it('returns null for degenerate dimensions', () => {
    expect(downscaleDimensions(0, 5000)).toBeNull();
    expect(downscaleDimensions(5000, 0)).toBeNull();
  });

  it('honours a custom cap', () => {
    expect(downscaleDimensions(2000, 1000, 1000)).toEqual({ width: 1000, height: 500 });
  });
});

describe('downscaleImageForUpload', () => {
  it('passes non-resizable types through untouched without decoding', async () => {
    const gif = new File(['GIF89a…'], 'anim.gif', { type: 'image/gif' });
    expect(await downscaleImageForUpload(gif)).toBe(gif);

    const mp4 = new File(['…'], 'clip.mp4', { type: 'video/mp4' });
    expect(await downscaleImageForUpload(mp4)).toBe(mp4);
  });

  it('degrades to the original file when the platform cannot decode it', async () => {
    // jsdom has neither createImageBitmap nor canvas 2d — the util must treat
    // that as "skip the optimization", never as an upload failure.
    const png = new File(['not really a png'], 'photo.png', { type: 'image/png' });
    expect(await downscaleImageForUpload(png)).toBe(png);
  });
});
