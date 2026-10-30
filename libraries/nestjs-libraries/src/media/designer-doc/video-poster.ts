/**
 * Poster-frame projection: a VIDEO output's t=0 state as a synthetic IMAGE
 * output, so the existing server-side image renderer (`renderPage`) can
 * produce preview PNGs, contact-sheet cells and the vision critic's re-check
 * input for video-mode documents WITHOUT the video render container.
 *
 * Rules (deterministic, no LLM, no ffmpeg):
 * - A clip appears when it is ACTIVE at t=0 (`startMs <= 0 < endMs`) on a
 *   non-hidden, non-audio track. Track order is the z-order (bottom first),
 *   matching how `imageDocToVideoDoc` and the frame renderer stack tracks.
 * - Geometry comes from the clip's base box; a keyframe pinned at tMs=0 wins
 *   for the props it sets (x/y/width/height/fontSize/opacity) — that is the
 *   frame a renderer would draw. Clips with no explicit box render FULLSCREEN
 *   (the renderer's own rule).
 * - Intro transitions (transitionIn fades) are NOT applied: at a literal t=0
 *   a fading-in clip is invisible, which would blank exactly the content the
 *   preview/QC exists to judge. The poster is the composed opening state.
 * - `video` clips map to image elements from their POSTER frame (the owning
 *   File row's stored thumbnail), passed in via the `videoPosters` map —
 *   this module stays pure/sync; resolving and extracting posters is the
 *   caller's job (`DesignPreviewService`). A video clip with NO poster is
 *   omitted by this pure projection; preview callers reject that incomplete
 *   document instead of uploading a black fallback. Image/sticker/raster clips map to image
 *   elements (a sticker falls back to its first frame); text/caption clips
 *   to text elements; shape clips to shape elements — the inverse of the
 *   `imageDocToVideoDoc` mapping.
 */

import type {
  DesignerDoc,
  DesignerElement,
  DesignerOutput,
  VideoClip,
  VideoOutput,
  VideoTrack,
} from './designer-doc.schema';

type TrackType = VideoTrack['type'];

/**
 * Poster-frame sources for `video` clips, keyed by clip id OR by the clip's
 * `fileId` (both are tried, clip id first). Resolved by the caller — see
 * `DesignPreviewService` — from the File rows' stored thumbnails.
 */
export type VideoPosterMap = ReadonlyMap<string, string>;

const isActiveAtZero = (clip: VideoClip): boolean =>
  clip.startMs <= 0 && clip.endMs > 0;

/** Geometry props a tMs=0 keyframe pins for the poster frame. Opacity is
 * deliberately excluded — a fade-in keyframe would blank the clip at t=0,
 * the same reason intro transitions are not applied (see the module doc). */
const KEYFRAME_PROPS = ['x', 'y', 'width', 'height', 'fontSize'] as const;

const propsAtZero = (clip: VideoClip): Partial<VideoClip> => {
  const kf = clip.keyframes?.find((k) => k.tMs <= 0);
  if (!kf) return {};
  const out: Record<string, number> = {};
  for (const key of KEYFRAME_PROPS) {
    const v = kf.props[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
  }
  return out as Partial<VideoClip>;
};

const baseElement = (
  clip: VideoClip,
  type: DesignerElement['type'],
  output: VideoOutput
): DesignerElement => {
  const atZero = propsAtZero(clip);
  return {
    id: clip.id,
    originId: clip.originId,
    type,
    x: Math.round(atZero.x ?? clip.x ?? 0),
    y: Math.round(atZero.y ?? clip.y ?? 0),
    // A box-less clip renders fullscreen — the frame renderer's own default.
    width: Math.round(atZero.width ?? clip.width ?? output.width),
    height: Math.round(atZero.height ?? clip.height ?? output.height),
    rotation: clip.rotation ?? 0,
    opacity: atZero.opacity ?? clip.opacity ?? 1,
    locked: false,
    hidden: false,
  } as DesignerElement;
};

const clipToElement = (
  clip: VideoClip,
  trackType: TrackType,
  output: VideoOutput,
  videoPosters?: VideoPosterMap
): DesignerElement | null => {
  switch (trackType) {
    case 'image':
    case 'sticker':
    case 'raster': {
      const src = clip.src ?? clip.frames?.[0]?.url;
      if (!src && !clip.fileId) return null;
      return {
        ...baseElement(clip, 'image', output),
        src,
        fileId: clip.fileId,
        ...(clip.fitMode ? { fitMode: clip.fitMode } : {}),
        ...(clip.crop ? { crop: clip.crop } : {}),
        ...(clip.focalPoint ? { focalPoint: clip.focalPoint } : {}),
        ...(clip.naturalWidth ? { naturalWidth: clip.naturalWidth } : {}),
        ...(clip.naturalHeight ? { naturalHeight: clip.naturalHeight } : {}),
      } as DesignerElement;
    }
    case 'text':
    case 'caption': {
      const text =
        clip.text ?? clip.words?.map((w) => w.word).join(' ');
      if (!text || !text.trim()) return null;
      const atZero = propsAtZero(clip);
      const fontSize = atZero.fontSize ?? clip.fontSize;
      return {
        ...baseElement(clip, 'text', output),
        text,
        ...(clip.fontFamily ? { fontFamily: clip.fontFamily } : {}),
        ...(fontSize ? { fontSize } : {}),
        ...(clip.fontWeight ? { fontWeight: clip.fontWeight } : {}),
        ...(clip.fontStyle ? { fontStyle: clip.fontStyle } : {}),
        ...(clip.fill ? { fill: clip.fill } : {}),
        ...(clip.align ? { align: clip.align } : {}),
      } as DesignerElement;
    }
    case 'shape': {
      if (!clip.shape) return null;
      return {
        ...baseElement(clip, 'shape', output),
        shape: clip.shape,
        ...(clip.sides ? { sides: clip.sides } : {}),
        ...(clip.innerRatio ? { innerRatio: clip.innerRatio } : {}),
        ...(clip.fill ? { fill: clip.fill } : {}),
        ...(clip.fillGradient ? { fillGradient: clip.fillGradient } : {}),
        ...(clip.stroke ? { stroke: clip.stroke } : {}),
        ...(clip.strokeWidth ? { strokeWidth: clip.strokeWidth } : {}),
        ...(clip.borderRadius !== undefined
          ? { borderRadius: clip.borderRadius }
          : {}),
      } as DesignerElement;
    }
    case 'video': {
      // The poster frame paints as a plain image element — `renderPage`
      // already draws image elements by src, so no renderer changes. Without
      // a resolved poster the clip is skipped (see the module doc).
      const poster =
        videoPosters?.get(clip.id) ??
        (clip.fileId ? videoPosters?.get(clip.fileId) : undefined);
      if (!poster) return null;
      return {
        ...baseElement(clip, 'image', output),
        src: poster,
        fileId: clip.fileId,
        fitMode: clip.fitMode ?? 'cover',
        ...(clip.crop ? { crop: clip.crop } : {}),
        ...(clip.focalPoint ? { focalPoint: clip.focalPoint } : {}),
        ...(clip.naturalWidth ? { naturalWidth: clip.naturalWidth } : {}),
        ...(clip.naturalHeight ? { naturalHeight: clip.naturalHeight } : {}),
      } as DesignerElement;
    }
    default:
      // audio: nothing to paint.
      return null;
  }
};

/**
 * Project one video output to the synthetic image output the image renderer
 * can paint. The result is RENDER-ONLY — it is never persisted as a doc (the
 * video output remains the source of truth).
 */
export const videoOutputToPosterOutput = (
  output: VideoOutput,
  videoPosters?: VideoPosterMap
): DesignerOutput => {
  const children: DesignerElement[] = [];
  for (const track of output.tracks) {
    if (track.hidden) continue;
    for (const clip of track.clips) {
      if (!isActiveAtZero(clip)) continue;
      const el = clipToElement(clip, track.type, output, videoPosters);
      if (el) children.push(el);
    }
  }

  const bg = output.bg;
  return {
    id: output.id,
    formatId: output.formatId,
    name: output.name,
    width: output.width,
    height: output.height,
    // The legacy flat `background` string mirrors the structured bg (the
    // frame renderer's base is black when no bg is set).
    background: bg?.type === 'color' && bg.color ? bg.color : '#000000',
    ...(bg ? { bg } : {}),
    children,
  };
};

/**
 * Map every VIDEO output of `doc` to its poster projection, leaving image
 * outputs untouched. Returns the SAME doc object when nothing changed, so
 * callers can cheaply short-circuit. `videoPosters` is optional — omitted
 * means "no video posters available", today's skip-the-clip behavior.
 */
export const docWithVideoPosters = (
  doc: DesignerDoc,
  videoPosters?: VideoPosterMap
): DesignerDoc => {
  if (!(doc.outputs ?? []).some((out) => 'tracks' in out)) return doc;
  return {
    ...doc,
    outputs: doc.outputs.map((out) =>
      'tracks' in out ? videoOutputToPosterOutput(out, videoPosters) : out
    ),
  };
};
