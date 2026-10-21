import { describe, it, expect } from 'vitest';
import { aspectBucketForDimensions, buildSlideNormalizeFilter } from './slide-aspect';

describe('aspectBucketForDimensions', () => {
  it('buckets the standard social canvases', () => {
    expect(aspectBucketForDimensions(1080, 1080)).toBe('square'); // 1:1 feed
    expect(aspectBucketForDimensions(1920, 1080)).toBe('wide'); // 16:9
    expect(aspectBucketForDimensions(1080, 1920)).toBe('tall'); // 9:16 story
    expect(aspectBucketForDimensions(1080, 1350)).toBe('tall'); // 4:5 portrait feed
  });

  it('keeps near-square canvases square', () => {
    // Within the ~5% tolerance these must not spill into wide/tall.
    expect(aspectBucketForDimensions(1080, 1100)).toBe('square');
    expect(aspectBucketForDimensions(1100, 1080)).toBe('square');
  });

  it('falls back to square on degenerate input', () => {
    expect(aspectBucketForDimensions(0, 0)).toBe('square');
  });
});

describe('buildSlideNormalizeFilter', () => {
  it('builds the cover filter: scale-to-fill then crop', () => {
    expect(buildSlideNormalizeFilter(1920, 1080, 'cover')).toBe(
      'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1',
    );
  });

  it('builds the contain filter: scale-to-fit then black pad', () => {
    expect(buildSlideNormalizeFilter(1920, 1080, 'contain')).toBe(
      'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1',
    );
  });

  it('rounds odd dimensions down to even for yuv420p/libx264', () => {
    expect(buildSlideNormalizeFilter(1081, 1921, 'cover')).toBe(
      'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1',
    );
  });
});
