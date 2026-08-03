/**
 * Motion blur, derived from a clip's own animation.
 *
 * A real camera's shutter is open for part of each frame, so anything moving
 * smears across that window. Rather than inventing a blur, this samples the
 * clip's transform at sub-frame offsets inside the shutter window and the
 * renderer averages the draws — the same accumulation a renderer does, and it
 * falls out of the keyframes for free.
 */

/** Photoshop and After Effects both default to a 180° shutter. */
export const DEFAULT_SHUTTER_ANGLE = 180;
/** Enough to look continuous without multiplying render time by much more. */
export const DEFAULT_MOTION_BLUR_SAMPLES = 8;
export const MAX_MOTION_BLUR_SAMPLES = 32;

export interface MotionBlur {
  enabled?: boolean;
  /** Degrees. 360 = the shutter is open the whole frame; 0 = no blur. */
  shutterAngle?: number;
  samples?: number;
}

/** How long the shutter is open, in milliseconds. */
export const shutterDurationMs = (fps: number, shutterAngle: number): number => {
  const frameMs = 1000 / Math.max(1, fps);
  const angle = Math.max(0, Math.min(360, shutterAngle));
  return frameMs * (angle / 360);
};

/**
 * The sub-frame times to sample for one output frame.
 *
 * Centred on the frame time, because a shutter centred on the sample is what
 * keeps a blurred object's centre of mass where an unblurred one would be —
 * a trailing-only window drags everything backwards by half a frame.
 *
 * Returns a single time (no blur) when the window is zero or one sample is
 * asked for, so the caller never needs a special case.
 */
export const motionBlurSampleTimes = (
  timeMs: number,
  fps: number,
  blur?: MotionBlur
): number[] => {
  if (!blur?.enabled) return [timeMs];

  const angle = blur.shutterAngle == null ? DEFAULT_SHUTTER_ANGLE : blur.shutterAngle;
  const window = shutterDurationMs(fps, angle);
  const samples = Math.max(
    1,
    Math.min(
      MAX_MOTION_BLUR_SAMPLES,
      Math.round(blur.samples == null ? DEFAULT_MOTION_BLUR_SAMPLES : blur.samples)
    )
  );
  if (window <= 0 || samples <= 1) return [timeMs];

  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    // Sample at bin CENTRES: the endpoints of the window are shared with the
    // neighbouring frames, and sampling them double-counts the seam.
    const fraction = (i + 0.5) / samples - 0.5;
    times.push(timeMs + fraction * window);
  }
  return times;
};

/** These same functions as JavaScript source, for the injected frame renderer. */
export const motionBlurSource = (): string => {
  const decl = (name: string, value: unknown) => `const ${name} = ${String(value)};`;
  return [
    `const DEFAULT_SHUTTER_ANGLE = ${DEFAULT_SHUTTER_ANGLE};`,
    `const DEFAULT_MOTION_BLUR_SAMPLES = ${DEFAULT_MOTION_BLUR_SAMPLES};`,
    `const MAX_MOTION_BLUR_SAMPLES = ${MAX_MOTION_BLUR_SAMPLES};`,
    decl('shutterDurationMs', shutterDurationMs),
    decl('motionBlurSampleTimes', motionBlurSampleTimes),
  ].join('\n');
};
