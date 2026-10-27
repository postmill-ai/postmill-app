import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';

const mockSafeFetch = vi.fn();
vi.mock('@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetch: (url: string, init?: RequestInit) => mockSafeFetch(url, init),
}));

const mockEncode = vi.fn();
vi.mock('@postmill-ai/nestjs-libraries/media/slide/image-sequence-encoder', () => ({
  encodeImageSequenceToMp4: (...args: unknown[]) => mockEncode(...args),
}));

import {
  reelFarmSlideshowOptions,
  transformReelFarmSlideshow,
} from './reelfarm-slideshow-completion';

function imageResponse(bytes = Buffer.from('jpeg'), contentLength = bytes.length) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'image/jpeg', 'content-length': String(contentLength) }),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

describe('reelFarmSlideshowOptions', () => {
  it('uses Reel.Farm-compatible defaults and reads local conversion settings from job input', () => {
    expect(reelFarmSlideshowOptions(null)).toEqual({
      aspectRatio: '4:5',
      durationSeconds: 4,
      fitMode: 'cover',
    });
    expect(reelFarmSlideshowOptions(JSON.stringify({
      input: { aspect_ratio: '16:9', keep_original_aspect_ratio: true, duration: 7.5 },
    }))).toEqual({ aspectRatio: '16:9', durationSeconds: 7.5, fitMode: 'contain' });
  });

  it.each([
    [{ aspect_ratio: '2:3' }, 'aspect ratio'],
    [{ duration: 0 }, 'between 1 and 30'],
    [{ duration: 31 }, 'between 1 and 30'],
    [{ duration: '4' }, 'between 1 and 30'],
    [{ keep_original_aspect_ratio: 'yes' }, 'fit setting'],
  ])('rejects invalid local settings %#', (input, message) => {
    expect(() => reelFarmSlideshowOptions(JSON.stringify({ input }))).toThrow(message);
  });
});

describe('transformReelFarmSlideshow', () => {
  beforeEach(() => {
    mockSafeFetch.mockReset();
    mockEncode.mockReset();
    mockEncode.mockImplementation(async (_assets, outputPath: string) => {
      fs.writeFileSync(outputPath, Buffer.from('encoded-mp4'));
    });
    mockSafeFetch.mockImplementation(async () => imageResponse());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('SafeFetches every slide in order and encodes one normalized silent MP4', async () => {
    const result = await transformReelFarmSlideshow([
      'https://slides.reel.farm/0.jpg',
      'https://slides.reel.farm/1.jpg',
    ], { aspectRatio: '9:16', durationSeconds: 6, fitMode: 'contain' });

    expect(mockSafeFetch.mock.calls.map((call) => call[0])).toEqual([
      'https://slides.reel.farm/0.jpg',
      'https://slides.reel.farm/1.jpg',
    ]);
    expect(mockSafeFetch).toHaveBeenCalledWith(expect.any(String), { timeoutMs: 30_000 });
    expect(mockEncode).toHaveBeenCalledWith([
      { imagePath: expect.stringContaining('slide-0.img'), durationSeconds: 6 },
      { imagePath: expect.stringContaining('slide-1.img'), durationSeconds: 6 },
    ], expect.stringContaining('output.mp4'), {
      targetWidth: 1080,
      targetHeight: 1920,
      fitMode: 'contain',
      timeoutMs: 120_000,
    });
    expect(result).toEqual({
      buffer: Buffer.from('encoded-mp4'),
      mime: 'video/mp4',
      metadata: { durationSeconds: 12 },
    });
  });

  it('rejects an excessive slide count before any network or encoding work', async () => {
    await expect(transformReelFarmSlideshow(
      Array.from({ length: 21 }, (_, i) => `https://slides.reel.farm/${i}.jpg`),
      { aspectRatio: '4:5', durationSeconds: 4, fitMode: 'cover' },
    )).rejects.toThrow('between 1 and 20 slides');
    expect(mockSafeFetch).not.toHaveBeenCalled();
    expect(mockEncode).not.toHaveBeenCalled();
  });

  it('rejects malformed slide URLs and non-OK downloads without echoing signed URLs', async () => {
    await expect(transformReelFarmSlideshow([''], {
      aspectRatio: '4:5', durationSeconds: 4, fitMode: 'cover',
    })).rejects.toThrow('invalid slide URL');

    mockSafeFetch.mockResolvedValueOnce({ ok: false, status: 404, headers: new Headers() });
    await expect(transformReelFarmSlideshow(['https://slides.reel.farm/a.jpg?token=secret'], {
      aspectRatio: '4:5', durationSeconds: 4, fitMode: 'cover',
    })).rejects.toThrow('Reel.Farm slide download failed (404)');
    expect(mockEncode).not.toHaveBeenCalled();
  });

  it('enforces per-slide and aggregate size limits', async () => {
    mockSafeFetch.mockResolvedValueOnce(imageResponse(Buffer.from('x'), 26 * 1024 * 1024));
    await expect(transformReelFarmSlideshow(['https://slides.reel.farm/large.jpg'], {
      aspectRatio: '4:5', durationSeconds: 4, fitMode: 'cover',
    })).rejects.toThrow('image size limit');

    mockSafeFetch.mockImplementation(async () => imageResponse(Buffer.alloc(25 * 1024 * 1024)));
    await expect(transformReelFarmSlideshow(
      Array.from({ length: 5 }, (_, i) => `https://slides.reel.farm/${i}.jpg`),
      { aspectRatio: '4:5', durationSeconds: 4, fitMode: 'cover' },
    )).rejects.toThrow('image size limit');
    expect(mockSafeFetch).toHaveBeenCalledTimes(6);
    expect(mockEncode).not.toHaveBeenCalled();
  });

  it('enforces the aggregate download deadline', async () => {
    vi.useFakeTimers();
    mockSafeFetch.mockImplementation(async () => {
      vi.advanceTimersByTime(30_000);
      return imageResponse();
    });

    await expect(transformReelFarmSlideshow(
      Array.from({ length: 5 }, (_, i) => `https://slides.reel.farm/${i}.jpg`),
      { aspectRatio: '4:5', durationSeconds: 4, fitMode: 'cover' },
    )).rejects.toThrow('downloads timed out');
    expect(mockSafeFetch).toHaveBeenCalledTimes(4);
    expect(mockEncode).not.toHaveBeenCalled();
  });
});
