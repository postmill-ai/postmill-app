/**
 * Video-vs-image sniff for a clip src. The query-string tolerance is
 * load-bearing: signed and uploaded URLs routinely carry one, and
 * `/uploads/clip.mp4?x=1` mis-sniffed as an IMAGE never plays (the overlay
 * draws it through an <img>, which can't decode video).
 */
export const isVideoSrc = (src?: string): boolean =>
  /\.(mp4|webm|mov|mkv|avi|m4v)(\?.*)?$/i.test(src || '');

/**
 * Video-vs-image for a CLIP: the explicit `mediaType` hint wins when present
 * (AI-generated videos live at extensionless `/uploads/…/<hash>` URLs, which
 * the sniff mis-reads as images — the canvas then draws one static frame that
 * never plays); the extension sniff remains the fallback for clips that carry
 * no hint (older docs, extensioned uploads, stock media).
 */
export const clipIsVideo = (clip: {
  src?: string;
  mediaType?: 'video' | 'image';
}): boolean => (clip.mediaType ? clip.mediaType === 'video' : isVideoSrc(clip.src));

/**
 * Clips whose hidden <video> element fired `error` (404, CORS, bad codec).
 * Keyed by `${clip.id}:${clip.src}` — not the id alone — so a regenerate that
 * swaps the clip's src clears the error automatically (the membership check
 * reads the CURRENT src) instead of hiding the new video behind a stale
 * failure.
 */
const erroredVideoClips = new Set<string>();

export const markVideoSrcErrored = (clipId: string, src: string): void => {
  erroredVideoClips.add(`${clipId}:${src}`);
};

export const videoSrcErrored = (clip: { id: string; src?: string }): boolean =>
  erroredVideoClips.has(`${clip.id}:${clip.src || ''}`);

/** Drop every error recorded for a clip (any src) — e.g. the clip is gone. */
export const clearVideoSrcErrors = (clipId: string): void => {
  const prefix = `${clipId}:`;
  erroredVideoClips.forEach((key) => {
    if (key.startsWith(prefix)) erroredVideoClips.delete(key);
  });
};

/** Full teardown — the overlay unmounts (mode switch / designer close). */
export const resetVideoSrcErrors = (): void => {
  erroredVideoClips.clear();
};
