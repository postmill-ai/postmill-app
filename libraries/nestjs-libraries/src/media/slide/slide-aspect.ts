export type SlideAspect = 'square' | 'wide' | 'tall';
export type SlideFitMode = 'contain' | 'cover';

// The image providers only understand a coarse aspect, so a canvas is bucketed
// by its W/H ratio. The ~5% tolerance keeps near-square canvases from spilling
// into wide/tall on a couple of rounding pixels.
export function aspectBucketForDimensions(width: number, height: number): SlideAspect {
  if (!width || !height) return 'square';
  const ratio = width / height;
  if (ratio > 1.05) return 'wide';
  if (ratio < 1 / 1.05) return 'tall';
  return 'square';
}

// libx264 + yuv420p require even dimensions; round the target DOWN to even.
const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

// Per-slide ffmpeg filter that normalizes every frame to exactly WxH before
// the concat demuxer runs — left alone, the demuxer scales every slide to the
// FIRST frame's dimensions. `cover` fills the frame and crops the overflow;
// `contain` letterboxes on black.
export function buildSlideNormalizeFilter(
  width: number,
  height: number,
  fitMode: SlideFitMode,
): string {
  const w = even(width);
  const h = even(height);
  return fitMode === 'contain'
    ? `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`
    : `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;
}
