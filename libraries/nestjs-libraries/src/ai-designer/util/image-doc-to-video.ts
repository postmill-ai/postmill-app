/**
 * Deterministic image-doc → video-doc mapper for AI Designer video sessions.
 *
 * A video session composes with the IMAGE pipeline unchanged (the critic/QC
 * loop renders and judges PNG pages); only at delivery is each composed
 * `DesignerOutput` converted here into a `VideoOutput` so the saved Design is
 * video-mode — "Edit in Designer" opens the timeline and export rides the
 * existing render-video path.
 *
 * Edit as Video uses the separate `preserveContent` branch below. It keeps
 * source dimensions and global z-order, flattens every page into a timed scene,
 * retains hidden/locked state on tracks, and rejects overflow instead of
 * truncating clips. `DesignVideoConversionService` replaces constructs without
 * an editable clip counterpart with internal raster assets before calling it;
 * the preservation mapper throws if anything was missed.
 *
 * AI-delivery mapping rules (all deterministic — no LLM involvement):
 * - Canvas dims and fps come from the output's `CHANNEL_PRESETS` entry
 *   (video presets carry `fps`/`maxDurationMs`), clamped to the same bounds
 *   `validateVideoComposition` enforces (dims 1..MAX_DIMENSION, fps 1..240,
 *   ≤MAX_TRACKS tracks, ≤MAX_CLIPS_PER_TRACK clips per track) and to the
 *   shared `MAX_VIDEO_DURATION_MS` ceiling. Duration defaults to
 *   DEFAULT_DURATION_MS with the preset's `maxDurationMs` acting only as a
 *   ceiling — it is a hard cap, so a 60 s cap must not become a 60 s default.
 * - An image background and every image element become full-duration `image`
 *   clips with a slow-zoom (Ken Burns) keyframe pair.
 * - A color/gradient background is carried onto the VideoOutput's `bg`,
 *   which the frame renderer and the editor canvas already paint.
 * - Text elements become `text` clips with a fade transition in; shape
 *   elements become `shape` clips carrying the same geometry fields. Text and
 *   shape clips ENTRANCE-STAGGER (each clip on a track starts
 *   `ENTRANCE_STAGGER_MS` after the previous one, fading in) so the draft has
 *   real motion even before/around a generated scene video.
 * - Raster elements (baked bitmap layers) become `raster` clips on their own
 *   track, kept static — they are precisely-composited overlays, not imagery
 *   to zoom.
 * - `symbol` instances (the composer's CTA lockups are one) are expanded via
 *   `expandSymbols` first — the caller threads `doc.symbols` through — so the
 *   plate/label land as ordinary shape/text clips in definition order.
 *   Groups are flat `parentId` links (layer-tree.ts), so their members are
 *   already in `output.children`; what a group changes is visibility — a
 *   member of a hidden group is dropped with it.
 * - Types with no clip counterpart (icon/path/fill/adjustment and the group
 *   containers themselves) are skipped — the delivered timeline is a starting
 *   point, not a pixel-exact port; the static PNG previews remain the
 *   delivery artifact. The skip is NOT silent: `onDropped` reports the
 *   dropped types per output so the conductor can disclose them.
 */

import type {
  DesignerDoc,
  DesignerElement,
  DesignerOutput,
  VideoClip,
  VideoOutput,
  VideoTrack,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { CLIP_BLEND_MODES } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import {
  MAX_CLIPS_PER_TRACK,
  MAX_DIMENSION,
  MAX_TRACKS,
  MAX_VIDEO_DURATION_MS,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import { genId } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.migrate';
import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';
import {
  expandSymbols,
  type SymbolDefinition,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/symbols';
import {
  isEffectivelyHidden,
  isEffectivelyLocked,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/layer-tree';

/** Mirrors MAX_FPS in media/design-render/video-render.service.ts. */
const MAX_FPS = 240;
const DEFAULT_FPS = 30;
/**
 * Default session duration. Matches the lenient schema default
 * (designer-doc.schema.ts) and the render fallback (video-render.service.ts);
 * a preset's `maxDurationMs` only ever LOWERS this (it is a hard cap).
 */
const DEFAULT_DURATION_MS = 10_000;
/** Text clips fade in over this window. */
const TEXT_TRANSITION_IN_MS = 400;
/** Shape clips fade in over this window. */
const SHAPE_TRANSITION_IN_MS = 300;
/**
 * Entrance stagger between successive text/shape clips on a track: clip i
 * starts `i * ENTRANCE_STAGGER_MS` into the timeline (capped so a clip always
 * keeps MIN_CLIP_WINDOW_MS of on-screen time). Without it every overlay runs
 * 0→durationMs and the draft reads as a static slide.
 */
const ENTRANCE_STAGGER_MS = 350;
const MIN_CLIP_WINDOW_MS = 500;
/** Ken Burns end scale for full-duration image clips. 1.08 read as "no motion"
 *  at social-video glance speed — 1.15 is clearly perceptible without feeling
 *  like a zoom effect. */
const KEN_BURNS_ZOOM = 1.15;

/**
 * Element types with no clip counterpart. `raster` IS ported (its own track);
 * these four are reported through `onDropped` so the loss is disclosed instead
 * of silent. Group containers are not listed — their members survive.
 */
const DROPPED_ELEMENT_TYPES = new Set(['icon', 'path', 'fill', 'adjustment']);

export interface ImageToVideoOptions {
  /** Set false to emit static image clips without the slow-zoom keyframes. */
  kenBurns?: boolean;
  /**
   * The document's symbol definitions. Without them a `symbol` instance (the
   * composer's CTA lockup is one) has no expansion source and is skipped, as
   * before; with them its plate/label land as ordinary clips.
   */
  symbols?: SymbolDefinition[];
  /**
   * Reports the element types that had no clip counterpart, per output
   * (`imageDocToVideoDoc` passes the output's formatId), so the caller can
   * disclose the loss. Called only when something was actually dropped.
   */
  onDropped?: (formatId: string, types: string[]) => void;
  /** Faithful static-scene conversion used by Edit as Video. */
  preserveContent?: boolean;
  /** Required with preserveContent: duration of each source page in milliseconds. */
  pageDurationMs?: number;
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

const isVisible =
  (all: DesignerElement[]) =>
  (el: DesignerElement) =>
    !isEffectivelyHidden(all, el);

/**
 * Entrance-stagger a clip: the first clip on a track runs the full timeline;
 * each later clip fades in `ENTRANCE_STAGGER_MS` after the previous one,
 * capped so it keeps at least MIN_CLIP_WINDOW_MS on screen.
 */
const withEntrance = (
  clip: VideoClip,
  index: number,
  durationMs: number
): VideoClip => {
  if (index === 0) return clip;
  const startMs = Math.min(
    index * ENTRANCE_STAGGER_MS,
    Math.max(0, durationMs - MIN_CLIP_WINDOW_MS)
  );
  if (startMs <= 0) return clip;
  return { ...clip, startMs };
};

/**
 * Convert one composed image output into a video output. Elements are grouped
 * onto per-type tracks painted bottom-to-top: background, imagery, shapes,
 * then text on top — matching the composer's z-order within each type.
 */
export function imageOutputToVideo(
  output: DesignerOutput,
  options: ImageToVideoOptions = {}
): VideoOutput {
  if (options.preserveContent) {
    return preservedImageOutputToVideo(output, options);
  }
  const preset = presetFor(output);
  const width = clamp(Math.round(preset?.width ?? output.width), 1, MAX_DIMENSION);
  const height = clamp(
    Math.round(preset?.height ?? output.height),
    1,
    MAX_DIMENSION
  );
  const fps = clamp(Math.round(preset?.fps ?? DEFAULT_FPS), 1, MAX_FPS);
  const durationMs = clamp(
    Math.min(preset?.maxDurationMs ?? DEFAULT_DURATION_MS, DEFAULT_DURATION_MS),
    100,
    MAX_VIDEO_DURATION_MS
  );
  const kenBurns = options.kenBurns !== false;

  const tracks: VideoTrack[] = [];
  // Expand symbol instances (CTA lockups) into their ordinary elements first,
  // then drop the effectively hidden — own flag OR a hidden ancestor group.
  // Expansion preserves list position, so the plate stays under its label.
  const expanded = expandSymbols(output.children ?? [], options.symbols);
  const children = expanded.filter(isVisible(expanded));

  // Background: an image background becomes the bottom-most full-canvas image
  // clip (the Ken Burns zoom supplies the motion); a color/gradient background
  // rides on the output's `bg`, painted by every renderer, so a gradient keeps
  // its stops instead of degrading to the first stop's flat-color rect.
  const bg = output.bg;
  let videoBg: VideoOutput['bg'];
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
  } else if (bg?.type === 'gradient' && bg.gradient) {
    videoBg = { type: 'gradient', gradient: bg.gradient };
  } else {
    const color = bg?.type === 'color' ? bg.color : output.background;
    if (color) videoBg = { type: 'color', color };
  }

  const imageClips: VideoClip[] = [];
  const rasterClips: VideoClip[] = [];
  const shapeClips: VideoClip[] = [];
  const textClips: VideoClip[] = [];
  const dropped = new Set<string>();

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
    } else if (el.type === 'raster' && (el.src || el.fileId)) {
      // Baked bitmap layer: ported verbatim (no Ken Burns — a raster is a
      // precisely-composited overlay, not imagery to zoom).
      rasterClips.push({
        ...baseClip(el, durationMs),
        src: el.src,
        fileId: el.fileId,
        ...(el.fitMode ? { fitMode: el.fitMode } : {}),
      });
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
        transitionIn: { type: 'fade', durationMs: SHAPE_TRANSITION_IN_MS },
      };
      shapeClips.push(clip);
    } else if (el.type === 'text' && el.text) {
      const clip: VideoClip = {
        ...baseClip(el, durationMs),
        text: el.text,
        ...(el.fontFamily ? { fontFamily: el.fontFamily } : {}),
        ...(el.fontSize ? { fontSize: el.fontSize } : {}),
        ...(el.fontWeight ? { fontWeight: el.fontWeight } : {}),
        ...(el.fontStyle ? { fontStyle: el.fontStyle } : {}),
        ...(el.fill ? { fill: el.fill } : {}),
        transitionIn: { type: 'fade', durationMs: TEXT_TRANSITION_IN_MS },
      };
      textClips.push(clip);
    } else if (DROPPED_ELEMENT_TYPES.has(el.type)) {
      dropped.add(el.type);
    }
    // icon/path/fill/adjustment and the group containers themselves have no
    // clip counterpart — groups are structural (their members land on their
    // own); the rest are reported through onDropped (see the module doc).
  }

  // Stagger the overlay entrances so the draft moves even before/around a
  // generated scene video (clips previously all ran 0→durationMs).
  const staggeredShapes = shapeClips.map((clip, i) =>
    withEntrance(clip, i, durationMs)
  );
  const staggeredTexts = textClips.map((clip, i) =>
    withEntrance(clip, i, durationMs)
  );

  if (dropped.size > 0) {
    options.onDropped?.(output.formatId, [...dropped]);
  }

  if (imageClips.length > 0) {
    tracks.push({
      id: genId(),
      type: 'image',
      clips: imageClips.slice(0, MAX_CLIPS_PER_TRACK),
    });
  }
  if (rasterClips.length > 0) {
    tracks.push({
      id: genId(),
      type: 'raster',
      clips: rasterClips.slice(0, MAX_CLIPS_PER_TRACK),
    });
  }
  if (staggeredShapes.length > 0) {
    tracks.push({
      id: genId(),
      type: 'shape',
      clips: staggeredShapes.slice(0, MAX_CLIPS_PER_TRACK),
    });
  }
  if (staggeredTexts.length > 0) {
    tracks.push({
      id: genId(),
      type: 'text',
      clips: staggeredTexts.slice(0, MAX_CLIPS_PER_TRACK),
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
    ...(videoBg ? { bg: videoBg } : {}),
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
      // The doc owns the symbol definitions — without them a CTA lockup
      // instance would be skipped instead of landing as plate + label clips.
      imageOutputToVideo(out as DesignerOutput, { ...options, symbols: doc.symbols })
    ),
  };
}


type PreservedTrackType = 'image' | 'raster' | 'shape' | 'text';
type PendingPreservedClip = {
  clip: VideoClip;
  type: PreservedTrackType;
  hidden: boolean;
  locked: boolean;
};

/**
 * Returns the visual feature that prevents a source element from becoming an
 * editable video clip. The Edit as Video service uses this to select raster
 * fallbacks before calling the synchronous mapper.
 */
export function preservedVideoElementUnsupportedReason(
  el: DesignerElement
): string | null {
  if (el.type === 'group') return null;
  if (el.type === 'symbol') return 'unexpanded symbol';
  if (el.type === 'icon' || el.type === 'path' || el.type === 'adjustment') {
    return `${el.type} layers have no editable clip counterpart`;
  }
  if (el.styles?.length) return 'layer styles';
  if (el.clipped) return 'clipped compositing';
  if (el.backdropFilter) return 'backdrop filtering';
  if (
    el.blendMode &&
    el.blendMode !== 'normal' &&
    !CLIP_BLEND_MODES.includes(el.blendMode as (typeof CLIP_BLEND_MODES)[number])
  ) {
    return `blend mode ${el.blendMode}`;
  }
  if (el.mask) return 'preset layer masks';
  if (el.flipX || el.flipY) return 'flipped geometry';
  if (el.warp) return 'warped geometry';
  if (el.boxShadow) return 'box shadow';

  if (el.type === 'fill') {
    if (el.fillStyle?.type === 'solid' && el.fillStyle.color) return null;
    if (el.fillStyle?.type === 'gradient' && el.fillStyle.gradient) return null;
    return 'pattern or incomplete fill layers';
  }
  if (el.type === 'image' || el.type === 'raster') {
    return el.src || el.fileId ? null : 'missing image source';
  }
  if (el.type === 'shape') {
    if (!el.shape) return 'missing shape geometry';
    if (el.nodes || el.subpaths) return 'custom shape paths';
    if (el.strokeStyle) return 'advanced stroke styling';
    return null;
  }
  if (el.type === 'text') {
    if (el.richText) return 'rich-text runs';
    if (el.verticalAlign) return 'vertical text alignment';
    if (el.lineHeight !== undefined) return 'custom line height';
    if (el.letterSpacing !== undefined) return 'letter spacing';
    if (el.textScaleX !== undefined) return 'horizontal text scaling';
    if (el.textShadow) return 'text shadow';
    if (el.curve !== undefined || el.textPath) return 'curved text';
    if (el.textTransform && el.textTransform !== 'none') return 'text transformation';
    if (el.paragraphSpacing !== undefined) return 'paragraph spacing';
    if (el.firstLineIndent !== undefined) return 'first-line indentation';
    return typeof el.text === 'string' ? null : 'missing text content';
  }
  return 'unsupported element type';
}

const preservedClipBase = (
  el: DesignerElement,
  pageIndex: number,
  pageDurationMs: number
): VideoClip => {
  const startMs = pageIndex * pageDurationMs;
  return {
    ...baseClip(el, pageDurationMs),
    startMs,
    endMs: startMs + pageDurationMs,
    ...(el.groupId || el.parentId
      ? { groupId: el.groupId || el.parentId }
      : {}),
    ...(pageIndex === 0 ? { originId: el.originId || el.id } : {}),
    ...(el.blendMode && el.blendMode !== 'normal'
      ? { blendMode: el.blendMode as VideoClip['blendMode'] }
      : {}),
    ...(el.filters ? { filters: el.filters } : {}),
    ...(el.smartFilters ? { smartFilters: el.smartFilters } : {}),
    ...(el.originalSrc ? { originalSrc: el.originalSrc } : {}),
    ...(el.originalFileId ? { originalFileId: el.originalFileId } : {}),
  };
};

const preservedClipForElement = (
  el: DesignerElement,
  pageIndex: number,
  pageDurationMs: number
): { clip: VideoClip; type: PreservedTrackType } => {
  const unsupported = preservedVideoElementUnsupportedReason(el);
  if (unsupported) {
    throw new Error(`Element ${el.id} requires raster fallback: ${unsupported}`);
  }
  const base = preservedClipBase(el, pageIndex, pageDurationMs);
  if (el.type === 'image' || el.type === 'raster') {
    return {
      type: el.type,
      clip: {
        ...base,
        src: el.src,
        fileId: el.fileId,
        ...(el.qr ? { qr: el.qr } : {}),
        ...(el.fitMode ? { fitMode: el.fitMode } : {}),
        ...(el.crop ? { crop: el.crop } : {}),
        ...(el.focalPoint ? { focalPoint: el.focalPoint } : {}),
        ...(el.naturalWidth ? { naturalWidth: el.naturalWidth } : {}),
        ...(el.naturalHeight ? { naturalHeight: el.naturalHeight } : {}),
        ...(el.maskSrc ? { maskSrc: el.maskSrc } : {}),
        ...(el.maskFileId ? { maskFileId: el.maskFileId } : {}),
        ...(el.maskEnabled !== undefined ? { maskEnabled: el.maskEnabled } : {}),
        ...(el.borderRadius ? { borderRadius: el.borderRadius } : {}),
      },
    };
  }
  if (el.type === 'shape') {
    return {
      type: 'shape',
      clip: {
        ...base,
        shape: el.shape,
        ...(el.sides ? { sides: el.sides } : {}),
        ...(el.innerRatio ? { innerRatio: el.innerRatio } : {}),
        ...(el.fill ? { fill: el.fill } : {}),
        ...(el.fillGradient ? { fillGradient: el.fillGradient } : {}),
        ...(el.stroke ? { stroke: el.stroke } : {}),
        ...(el.stroke || el.strokeWidth !== undefined
          ? { strokeWidth: el.strokeWidth ?? 0 }
          : {}),
        ...(el.borderRadius ? { borderRadius: el.borderRadius } : {}),
      },
    };
  }
  if (el.type === 'fill') {
    return {
      type: 'shape',
      clip: {
        ...base,
        shape: 'rect',
        ...(el.fillStyle?.color ? { fill: el.fillStyle.color } : {}),
        ...(el.fillStyle?.gradient ? { fillGradient: el.fillStyle.gradient } : {}),
      },
    };
  }
  return {
    type: 'text',
    clip: {
      ...base,
      text: el.text,
      ...(el.fontFamily ? { fontFamily: el.fontFamily } : {}),
      ...(el.fontSize ? { fontSize: el.fontSize } : {}),
      ...(el.fontWeight ? { fontWeight: el.fontWeight } : {}),
      ...(el.fontStyle ? { fontStyle: el.fontStyle } : {}),
      ...(el.fill ? { fill: el.fill } : {}),
      ...(el.fillGradient ? { fillGradient: el.fillGradient } : {}),
      ...(el.align ? { align: el.align } : {}),
      ...(el.textStroke ? { textStroke: el.textStroke } : {}),
    },
  };
};

const preservedBackgroundClip = (
  background: NonNullable<DesignerOutput['bg']>,
  pageId: string,
  pageIndex: number,
  pageDurationMs: number,
  width: number,
  height: number
): { clip: VideoClip; type: PreservedTrackType } => {
  if (background.texture) {
    throw new Error(`Background on page ${pageIndex + 1} requires raster fallback`);
  }
  const element: DesignerElement = {
    id: pageId,
    type: background.type === 'image' ? 'image' : 'shape',
    x: 0,
    y: 0,
    width,
    height,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    ...(background.type === 'image'
      ? {
          src: background.src,
          fileId: background.fileId,
          ...(background.focalPoint ? { focalPoint: background.focalPoint } : {}),
          ...(background.naturalWidth ? { naturalWidth: background.naturalWidth } : {}),
          ...(background.naturalHeight ? { naturalHeight: background.naturalHeight } : {}),
        }
      : background.type === 'gradient' && background.gradient
        ? { shape: 'rect' as const, fillGradient: background.gradient }
        : { shape: 'rect' as const, fill: background.color || '#000000' }),
  };
  return preservedClipForElement(element, pageIndex, pageDurationMs);
};

const preservedImageOutputToVideo = (
  output: DesignerOutput,
  options: ImageToVideoOptions
): VideoOutput => {
  const pageDurationMs = options.pageDurationMs;
  const pageCount = 1 + (output.pages?.length ?? 0);
  if (
    !Number.isInteger(pageDurationMs) ||
    (pageDurationMs as number) < 100 ||
    (pageDurationMs as number) > MAX_VIDEO_DURATION_MS
  ) {
    throw new Error('Page duration must be a whole number between 100 and 180000 milliseconds');
  }
  const durationMs = pageCount * (pageDurationMs as number);
  if (durationMs > MAX_VIDEO_DURATION_MS) {
    throw new Error(
      `${pageCount} pages at ${pageDurationMs}ms exceed the ${MAX_VIDEO_DURATION_MS}ms video limit`
    );
  }

  const preset = presetFor(output);
  const width = clamp(Math.round(output.width), 1, MAX_DIMENSION);
  const height = clamp(Math.round(output.height), 1, MAX_DIMENSION);
  const fps = clamp(Math.round(preset?.fps ?? DEFAULT_FPS), 1, MAX_FPS);
  const tracks: VideoTrack[] = [];
  const layouts = new Map<string, VideoTrack[]>();
  const markers: NonNullable<VideoOutput['markers']> = [];
  const pages = [
    {
      id: `${output.id}-page-1`,
      name: 'Page 1',
      children: output.children ?? [],
      background: undefined,
    },
    ...(output.pages ?? []),
  ];

  for (const [pageIndex, page] of pages.entries()) {
    const expanded = expandSymbols(page.children, options.symbols);
    const pending: PendingPreservedClip[] = [];
    if (pageIndex > 0 && page.background) {
      const background = preservedBackgroundClip(
        page.background,
        page.id,
        pageIndex,
        pageDurationMs as number,
        width,
        height
      );
      pending.push({ ...background, hidden: false, locked: false });
    }
    for (const el of expanded) {
      if (el.type === 'group') continue;
      const mapped = preservedClipForElement(el, pageIndex, pageDurationMs as number);
      pending.push({
        ...mapped,
        hidden: isEffectivelyHidden(expanded, el),
        locked: isEffectivelyLocked(expanded, el),
      });
    }

    const runs: PendingPreservedClip[][] = [];
    for (const item of pending) {
      const previous = runs.at(-1)?.[0];
      if (
        previous &&
        previous.type === item.type &&
        previous.hidden === item.hidden &&
        previous.locked === item.locked
      ) {
        runs.at(-1)!.push(item);
      } else {
        runs.push([item]);
      }
    }
    const layoutKey = runs
      .map((run) => `${run[0].type}:${run[0].hidden}:${run[0].locked}`)
      .join('|');
    let layout = layouts.get(layoutKey);
    if (!layout) {
      if (tracks.length + runs.length > MAX_TRACKS) {
        throw new Error(
          `Output ${output.formatId} needs more than ${MAX_TRACKS} tracks to preserve source order`
        );
      }
      layout = runs.map((run) => ({
        id: genId(),
        type: run[0].type,
        clips: [],
        ...(run[0].hidden ? { hidden: true } : {}),
        ...(run[0].locked ? { locked: true } : {}),
      }));
      layouts.set(layoutKey, layout);
      tracks.push(...layout);
    }
    for (const [index, run] of runs.entries()) {
      const track = layout[index];
      if (track.clips.length + run.length > MAX_CLIPS_PER_TRACK) {
        throw new Error(
          `Output ${output.formatId} exceeds ${MAX_CLIPS_PER_TRACK} clips on one track`
        );
      }
      track.clips.push(...run.map((item) => item.clip));
    }
    markers.push({
      id: genId(),
      tMs: pageIndex * (pageDurationMs as number),
      name: page.name || `Page ${pageIndex + 1}`,
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
    markers,
    ...(output.frozen ? { frozen: true } : {}),
    ...(output.bg
      ? { bg: output.bg }
      : output.background
        ? { bg: { type: 'color' as const, color: output.background } }
        : {}),
  };
};
