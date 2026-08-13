/**
 * Extensions treated as video across the stack — media-type computation in the
 * posts repository, VideoOrImage rendering, the calendar play badge. Keep the
 * single list here so those surfaces never drift apart.
 */
export const VIDEO_EXTENSIONS = [
  'mp4',
  'webm',
  'mov',
  'm4v',
  'avi',
  'mkv',
] as const;

const VIDEO_EXTENSION_REGEX = new RegExp(
  `\\.(${VIDEO_EXTENSIONS.join('|')})(\\?|#|$)`,
  'i'
);

/** True when the path points at a video file (query string / hash tolerated). */
export const isVideoPath = (path: string | undefined | null): boolean =>
  !!path && VIDEO_EXTENSION_REGEX.test(path);
