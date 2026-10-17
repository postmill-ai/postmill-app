/**
 * Deterministic image-doc → video-doc mapper for AI Designer video sessions.
 *
 * A video session composes with the IMAGE pipeline unchanged (the critic/QC
 * loop renders and judges PNG pages); only at delivery is each composed
 * `DesignerOutput` converted here into a `VideoOutput` so the saved Design is
 * video-mode — "Edit in Designer" opens the timeline and export rides the
 * existing render-video path. No schema change: the result is a plain v7
 * video doc built from existing clip fields.
 *
 * Mapping rules (all deterministic — no LLM involvement):
 * - Canvas dims, fps and duration come from the output's `CHANNEL_PRESETS`
 *   entry (video presets carry `fps`/`maxDurationMs`), clamped to the same
 *   bounds `validateVideoComposition` enforces (dims 1..MAX_DIMENSION, fps
 *   1..240, ≤MAX_TRACKS tracks, ≤MAX_CLIPS_PER_TRACK clips per track) and to
 *   the shared `MAX_VIDEO_DURATION_MS` ceiling.
 * - An image background and every image element become full-duration `image`
 *   clips with a slow-zoom (Ken Burns) keyframe pair.
 * - A color/gradient background becomes a full-canvas `rect` shape clip
 *   (VideoOutput has no background field); a gradient degrades to its first
 *   stop's color.
 * - Text elements become `text` clips with a fade transition in.
 * - Shape elements become `shape` clips carrying the same geometry fields.
 * - Types with no clip counterpart (icon/path/raster/group/fill/adjustment/
 *   symbol) are skipped — the delivered timeline is a starting point, not a
 *   pixel-exact port; the static PNG previews remain the delivery artifact.
 */

import type {
  DesignerDoc,
  DesignerElement,
  DesignerOutput,
  VideoClip,
  VideoOutput,
  VideoTrack,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import {
  MAX_CLIPS_PER_TRACK,
  MAX_DIMENSION,
  MAX_VIDEO_DURATION_MS,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import { genId } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.migrate';
import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';

/** Mirrors MAX_FPS in media/design-render/video-render.service.ts. */
const MAX_FPS = 240;
const DEFAULT_FPS = 30;
/** Duration for outputs whose formatId has no preset (expanded/custom formats). */
const DEFAULT_DURATION_MS = 5000;
/** Text clips fade in over this window. */
const TEXT_TRANSITION_IN_MS = 400;
/** Ken Burns end scale for full-duration image clips. */
const KEN_BURNS_ZOOM = 1.08;

export interface ImageToVideoOptions {
  /** Set false to emit static image clips without the slow-zoom keyframes. */
  kenBurns?: boolean;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const presetFor = (output: DesignerOutput) =>
  CHANNEL_PRESETS.find((p) => p.id === output.formatId);

const baseClip = (
  el: Pick<DesignerElement, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'opacity'>,
  durationMs: number
): Pick<
  VideoClip,
  'id' | 'startMs' | 'endMs' | 'x' | 'y' | 'width' | 'height' | 'rotation' | 'opacity'
> => ({
  id: genId(),
  startMs: 0,
  endMs: durationMs,
  x: Math.round(clamp(el.x, -MAX_DIMENSION, MAX_DIMENSION)),
  y: Math.round(clamp(el.y, -MAX_DIMENSION, MAX_DIMENSION)),
  width: Math.round(clamp(el.width, 1, MAX_DIMENSION)),
  height: Math.round(clamp(el.height, 1, MAX_DIMENSION)),
  ...(el.rotation ? { rotation: el.rotation } : {}),
  ...(el.opacity !== undefined && el.opacity !== 1
    ? { opacity: clamp(el.opacity, 0, 1) }
    : {}),
});

/** Slow zoom around the clip's own center, over the full clip duration. */
const withKenBurns = (clip: VideoClip, enabled: boolean): VideoClip => {
  if (!enabled) return clip;
  const w = clip.width ?? 0;
  const h = clip.height ?? 0;
  if (w <= 0 || h <= 0) return clip;
  const endW = Math.round(w * KEN_BURNS_ZOOM);
  const endH = Math.round(h * KEN_BURNS_ZOOM);
  return {
    ...clip,
    keyframes: [
      { tMs: 0, props: { x: clip.x ?? 0, y: clip.y ?? 0, width: w, height: h } },
      {
        tMs: clip.endMs,
        props: {
          x: Math.round((clip.x ?? 0) - (endW - w) / 2),
          y: Math.round((clip.y ?? 0) - (endH - h) / 2),
          width: endW,
          height: endH,
        },
      },
    ],
  };
};

const isVisible = (el: DesignerElement) => !el.hidden;

/**
 * Convert one composed image output into a video output. Elements are grouped
 * onto per-type tracks painted bottom-to-top: background, imagery, shapes,
 * then text on top — matching the composer's z-order within each type.
 */
export function imageOutputToVideo(
  output: DesignerOutput,
  options: ImageToVideoOptions = {}
): VideoOutput {
  const preset = presetFor(output);
  const width = clamp(Math.round(preset?.width ?? output.width), 1, MAX_DIMENSION);
  const height = clamp(
    Math.round(preset?.height ?? output.height),
    1,
    MAX_DIMENSION
  );
  const fps = clamp(Math.round(preset?.fps ?? DEFAULT_FPS), 1, MAX_FPS);
  const durationMs = clamp(
    Math.round(preset?.maxDurationMs ?? DEFAULT_DURATION_MS),
    100,
    MAX_VIDEO_DURATION_MS
  );
  const kenBurns = options.kenBurns !== false;

  const tracks: VideoTrack[] = [];
  const children = (output.children ?? []).filter(isVisible);

  // Background: an image background becomes the bottom-most full-canvas image
  // clip; a color/gradient background becomes a full-canvas rect shape clip.
  const bg = output.bg;
  if (bg?.type === 'image' && (bg.src || bg.fileId)) {
    const clip: VideoClip = {
      ...baseClip({ x: 0, y: 0, width, height, rotation: 0, opacity: 1 }, durationMs),
      src: bg.src,
      fileId: bg.fileId,
      fitMode: 'cover',
      ...(bg.focalPoint ? { focalPoint: bg.focalPoint } : {}),
      ...(bg.naturalWidth ? { naturalWidth: bg.naturalWidth } : {}),
      ...(bg.naturalHeight ? { naturalHeight: bg.naturalHeight } : {}),
    };
    tracks.push({ id: genId(), type: 'image', clips: [withKenBurns(clip, kenBurns)] });
  } else {
    const color =
      bg?.type === 'gradient'
        ? bg.gradient?.stops?.[0]?.color
        : bg?.type === 'color'
          ? bg.color
          : output.background;
    if (color) {
      const clip: VideoClip = {
        ...baseClip({ x: 0, y: 0, width, height, rotation: 0, opacity: 1 }, durationMs),
        shape: 'rect',
        fill: color,
      };
      tracks.push({ id: genId(), type: 'shape', clips: [clip] });
    }
  }

  const imageClips: VideoClip[] = [];
  const shapeClips: VideoClip[] = [];
  const textClips: VideoClip[] = [];

  for (const el of children) {
    if (el.type === 'image' && (el.src || el.fileId)) {
      const clip: VideoClip = {
        ...baseClip(el, durationMs),
        src: el.src,
        fileId: el.fileId,
        ...(el.fitMode ? { fitMode: el.fitMode } : {}),
        ...(el.crop ? { crop: el.crop } : {}),
        ...(el.focalPoint ? { focalPoint: el.focalPoint } : {}),
        ...(el.naturalWidth ? { naturalWidth: el.naturalWidth } : {}),
        ...(el.naturalHeight ? { naturalHeight: el.naturalHeight } : {}),
      };
      imageClips.push(withKenBurns(clip, kenBurns));
    } else if (el.type === 'shape' && el.shape) {
      const clip: VideoClip = {
        ...baseClip(el, durationMs),
        shape: el.shape,
        ...(el.sides ? { sides: el.sides } : {}),
        ...(el.innerRatio ? { innerRatio: el.innerRatio } : {}),
        ...(el.fill ? { fill: el.fill } : {}),
        ...(el.stroke ? { stroke: el.stroke } : {}),
        ...(el.strokeWidth ? { strokeWidth: el.strokeWidth } : {}),
        ...(el.borderRadius ? { borderRadius: el.borderRadius } : {}),
      };
      shapeClips.push(clip);
    } else if (el.type === 'text' && el.text) {
      const clip: VideoClip = {
        ...baseClip(el, durationMs),
        text: el.text,
        ...(el.fontFamily ? { fontFamily: el.fontFamily } : {}),
        ...(el.fontSize ? { fontSize: el.fontSize } : {}),
        ...(el.fontWeight ? { fontWeight: el.fontWeight } : {}),
        ...(el.fill ? { fill: el.fill } : {}),
        transitionIn: { type: 'fade', durationMs: TEXT_TRANSITION_IN_MS },
      };
      textClips.push(clip);
    }
    // icon/path/raster/group/fill/adjustment/symbol have no clip counterpart —
    // skipped deliberately (see the module doc).
  }

  if (imageClips.length > 0) {
    tracks.push({
      id: genId(),
      type: 'image',
      clips: imageClips.slice(0, MAX_CLIPS_PER_TRACK),
    });
  }
  if (shapeClips.length > 0) {
    tracks.push({
      id: genId(),
      type: 'shape',
      clips: shapeClips.slice(0, MAX_CLIPS_PER_TRACK),
    });
  }
  if (textClips.length > 0) {
    tracks.push({
      id: genId(),
      type: 'text',
      clips: textClips.slice(0, MAX_CLIPS_PER_TRACK),
    });
  }

  return {
    id: output.id,
    formatId: output.formatId,
    name: output.name,
    width,
    height,
    fps,
    durationMs,
    tracks,
  };
}

/**
 * Convert every image output of a composed doc into a video output. The doc
 * version and metadata are carried over untouched — only `mode` and `outputs`
 * change, so the result validates as a plain v7 video document.
 */
export function imageDocToVideoDoc(
  doc: DesignerDoc,
  options: ImageToVideoOptions = {}
): DesignerDoc {
  return {
    ...doc,
    mode: 'video',
    outputs: doc.outputs.map((out) =>
      imageOutputToVideo(out as DesignerOutput, options)
    ),
  };
}
