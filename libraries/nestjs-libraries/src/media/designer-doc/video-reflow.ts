import type {
  DesignerElement,
  VideoClip,
  VideoOutput,
  VideoTrack,
} from './designer-doc.schema';
import {
  smartReflow,
  computeTextStackBoxes,
  computeGroupBoxes,
  estimateFocalPoint,
  type GroupBox,
  type TypeBasisCanvas,
} from './reflow';
import { genId } from './designer-doc.migrate';

/**
 * Smart reflow for VIDEO outputs (the add-format/resize path for video-mode
 * documents). Reuses the image-mode machinery (`smartReflow`,
 * `computeTextStackBoxes`, focal-point estimation) by mapping each clip onto
 * the equivalent pseudo-element and projecting the result back.
 *
 * Where video semantics differ from image elements:
 *
 * - TIMING IS INVARIANT. startMs/endMs/trim/speed/speedCurve/keyframe tMs/
 *   beats/words timings never change — a variant is the same edit on a
 *   different canvas. fps and durationMs copy unchanged.
 * - A clip with no explicit box renders FULLSCREEN, so it follows the canvas
 *   for free — only its cover-crop focal estimate is recomputed.
 * - `fill` (the clip default) STRETCHES with the canvas, so those boxes scale
 *   per-axis with no anchor snap — there is no "design intent" to preserve in
 *   a stretch.
 * - cover/contain media clips behave exactly like image elements; text and
 *   caption clips like text elements (type-basis font scaling, title-safe
 *   clamp, copy-stack frames); shape clips like shape elements.
 * - Keyframe geometry props (x/y/width/height, fontSize) scale by the SAME
 *   factor the clip's own base box/font took, so an animation keeps its
 *   proportions relative to the clip it animates.
 */

type TrackType = VideoTrack['type'];

/** Track types whose clips carry visual geometry worth reflowing. */
const isVisualTrack = (type: TrackType): boolean => type !== 'audio';

const pseudoTypeOf = (
  clip: VideoClip,
  trackType: TrackType
): DesignerElement['type'] | null => {
  if (trackType === 'text' || trackType === 'caption') return 'text';
  if (trackType === 'shape') return 'shape';
  // video / image / sticker / raster
  const fit = clip.fitMode || 'fill';
  if (fit === 'fill') return null; // stretch path — see below
  return 'image';
};

/** Geometry keys a clip can carry back from a smartReflow patch. */
const CLIP_PATCH_KEYS = [
  'x',
  'y',
  'width',
  'height',
  'fontSize',
  'fitMode',
  'focalPoint',
  'strokeWidth',
  'borderRadius',
] as const;

const hasExplicitBox = (clip: VideoClip): boolean =>
  typeof clip.x === 'number' &&
  typeof clip.y === 'number' &&
  typeof clip.width === 'number' &&
  typeof clip.height === 'number';

/**
 * Scale the numeric keyframe props that express GEOMETRY by the factors the
 * clip's own base box took. `tMs` (timing) is never touched.
 */
const scaleClipKeyframes = (
  clip: VideoClip,
  fx: number,
  fy: number,
  fFont: number
): VideoClip['keyframes'] => {
  if (!clip.keyframes?.length) return clip.keyframes;
  return clip.keyframes.map((kf) => {
    const props: Record<string, number> = { ...kf.props };
    for (const key of Object.keys(props)) {
      const v = props[key];
      if (!Number.isFinite(v)) continue;
      if (key === 'x' || key === 'width') props[key] = Math.round(v * fx);
      else if (key === 'y' || key === 'height') props[key] = Math.round(v * fy);
      else if (key === 'fontSize') props[key] = Math.max(1, Math.round(v * fFont));
    }
    return { ...kf, props };
  });
};

/**
 * Re-fit one clip from the source canvas onto the target canvas. Pure —
 * returns a NEW clip; ids and originId are the caller's concern.
 */
export const reflowVideoClip = (
  clip: VideoClip,
  trackType: TrackType,
  source: TypeBasisCanvas,
  target: TypeBasisCanvas & { formatId?: string },
  stackBox?: GroupBox
): VideoClip => {
  const next: VideoClip = JSON.parse(JSON.stringify(clip));
  if (!isVisualTrack(trackType)) return next;

  const scaleX = target.width / source.width;
  const scaleY = target.height / source.height;

  if (!hasExplicitBox(clip)) {
    // Fullscreen clip: the box IS the canvas, so it follows the resize for
    // free. The only canvas-dependent state is the cover-crop focal estimate.
    const fit = clip.fitMode || 'fill';
    if (
      fit === 'cover' &&
      !clip.focalPoint &&
      clip.naturalWidth &&
      clip.naturalHeight
    ) {
      next.focalPoint = estimateFocalPoint(clip.naturalWidth, clip.naturalHeight);
    }
    return next;
  }

  const pseudoType = pseudoTypeOf(clip, trackType);

  if (pseudoType === null && !stackBox) {
    // fill-stretch: per-axis scale, no anchor — a stretch has no alignment to
    // preserve, and stretching is the point of fill.
    next.x = Math.round(clip.x! * scaleX);
    next.y = Math.round(clip.y! * scaleY);
    next.width = Math.max(1, Math.round(clip.width! * scaleX));
    next.height = Math.max(1, Math.round(clip.height! * scaleY));
    next.keyframes = scaleClipKeyframes(clip, scaleX, scaleY, 1);
    return next;
  }

  const pseudo: DesignerElement = {
    id: clip.id,
    originId: clip.originId,
    groupId: clip.groupId,
    type: pseudoType ?? 'image',
    x: clip.x!,
    y: clip.y!,
    width: clip.width!,
    height: clip.height!,
    rotation: clip.rotation ?? 0,
    opacity: clip.opacity ?? 1,
    locked: false,
    hidden: false,
    ...(pseudoType === 'image' || pseudoType === null
      ? {
          fitMode: clip.fitMode ?? (pseudoType === null ? 'fill' : undefined),
          focalPoint: clip.focalPoint,
          naturalWidth: clip.naturalWidth,
          naturalHeight: clip.naturalHeight,
        }
      : {}),
    ...(pseudoType === 'text' ? { fontSize: clip.fontSize } : {}),
    ...(pseudoType === 'shape'
      ? { strokeWidth: clip.strokeWidth, borderRadius: clip.borderRadius }
      : {}),
  } as DesignerElement;

  const patch = smartReflow(pseudo, source, target, stackBox);

  for (const key of CLIP_PATCH_KEYS) {
    if ((patch as any)[key] !== undefined) {
      (next as any)[key] = (patch as any)[key];
    }
  }
  // smartReflow leaves focalPoint unset when there is nothing better than the
  // stored value; a cover clip with NO focal point gets the aspect estimate,
  // mirroring seedCopy's image behavior.
  if (
    pseudoType === 'image' &&
    (next.fitMode || 'cover') === 'cover' &&
    !next.focalPoint &&
    next.naturalWidth &&
    next.naturalHeight
  ) {
    next.focalPoint = estimateFocalPoint(next.naturalWidth, next.naturalHeight);
  }

  const fx = clip.width ? (next.width ?? clip.width) / clip.width : scaleX;
  const fy = clip.height ? (next.height ?? clip.height) / clip.height : scaleY;
  const ff =
    clip.fontSize && next.fontSize ? next.fontSize / clip.fontSize : 1;
  next.keyframes = scaleClipKeyframes(clip, fx, fy, ff);
  return next;
};

/**
 * Copy-stack frames over ALL text+caption clips of an output (any track),
 * keyed by clip id. Stacks are spatial — a caption that sits in the same
 * column rhythm as a headline must ride the same anchor frame on aspect
 * change, exactly like image-mode copy stacks.
 */
const videoTextStackBoxes = (
  output: VideoOutput
): Map<string, GroupBox> => {
  const proxies: DesignerElement[] = [];
  const byProxy = new Map<DesignerElement, string>();
  for (const track of output.tracks) {
    if (track.type !== 'text' && track.type !== 'caption') continue;
    if (track.hidden) continue;
    for (const clip of track.clips) {
      if (!hasExplicitBox(clip)) continue;
      const proxy = {
        id: clip.id,
        originId: clip.originId,
        type: 'text',
        x: clip.x!,
        y: clip.y!,
        width: clip.width!,
        height: clip.height!,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        fontSize: clip.fontSize,
      } as DesignerElement;
      proxies.push(proxy);
      byProxy.set(proxy, clip.id);
    }
  }
  const stacks = computeTextStackBoxes(proxies, output);
  const result = new Map<string, GroupBox>();
  for (const [proxy, box] of stacks) {
    const clipId = byProxy.get(proxy);
    if (clipId) result.set(clipId, box);
  }
  return result;
};

const videoGroupBoxes = (output: VideoOutput): Map<string, GroupBox> => {
  const proxies: DesignerElement[] = [];
  for (const track of output.tracks) {
    if (!isVisualTrack(track.type)) continue;
    for (const clip of track.clips) {
      if (!clip.groupId || !hasExplicitBox(clip)) continue;
      proxies.push({
        id: clip.id,
        originId: clip.originId,
        groupId: clip.groupId,
        type: pseudoTypeOf(clip, track.type) ?? 'image',
        x: clip.x!,
        y: clip.y!,
        width: clip.width!,
        height: clip.height!,
        rotation: clip.rotation ?? 0,
        opacity: clip.opacity ?? 1,
        locked: false,
        hidden: false,
        fontSize: clip.fontSize,
        fitMode: clip.fitMode,
      } as DesignerElement);
    }
  }
  return computeGroupBoxes(proxies, output);
};

/**
 * Reflow every clip of `output` onto a `width`×`height` canvas, IN PLACE
 * (ids preserved — this is the resize path). Timing, fps, durationMs and
 * track ids are untouched.
 */
export const reflowVideoOutputInPlace = (
  output: VideoOutput,
  width: number,
  height: number,
  formatId?: string,
  name?: string
): VideoOutput => {
  const source = { width: output.width, height: output.height };
  const target = { width, height, formatId: formatId ?? output.formatId };
  const stacks = videoTextStackBoxes(output);
  const groupBoxes = videoGroupBoxes(output);
  return {
    ...output,
    width,
    height,
    formatId: formatId ?? output.formatId,
    name: name ?? output.name,
    tracks: output.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) =>
        reflowVideoClip(
          clip,
          track.type,
          source,
          target,
          (clip.groupId ? groupBoxes.get(clip.groupId) : undefined) ?? stacks.get(clip.id)
        )
      ),
    })),
  };
};

/**
 * Clone `source` into a NEW output at the target canvas (the add-format
 * path): fresh output/track/clip ids, clips reflowed, `originId` shared with
 * the source clip so linked edits can find siblings (backfilled on the source
 * when missing — the returned `sourceTracks` carry the minted ids, mirroring
 * the image-mode addOutput originId backfill).
 *
 * Timing (startMs/endMs/trim/speed/keyframe tMs), fps and durationMs copy
 * unchanged — a variant is the same edit on a new canvas.
 */
export const seedVideoOutput = (
  source: VideoOutput,
  target: { width: number; height: number; formatId: string; name: string },
  idGen: () => string = genId
): { output: VideoOutput; sourceTracks: VideoTrack[] } => {
  const sourceTracks = source.tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) =>
      clip.originId ? clip : { ...clip, originId: `origin-${idGen()}` }
    ),
  }));
  const sourceWithIds: VideoOutput = { ...source, tracks: sourceTracks };
  const stacks = videoTextStackBoxes(sourceWithIds);
  const groupBoxes = videoGroupBoxes(sourceWithIds);
  const groupRemap = new Map<string, string>();

  const tracks = sourceTracks.map((track) => ({
    ...JSON.parse(JSON.stringify(track)),
    id: idGen(),
    clips: track.clips.map((clip) => {
      const reflowed = reflowVideoClip(
        clip,
        track.type,
        source,
        target,
        (clip.groupId ? groupBoxes.get(clip.groupId) : undefined) ?? stacks.get(clip.id)
      );
      if (clip.groupId && !groupRemap.has(clip.groupId)) {
        groupRemap.set(clip.groupId, idGen());
      }
      return {
        ...reflowed,
        id: idGen(),
        originId: clip.originId,
        groupId: clip.groupId ? groupRemap.get(clip.groupId) : undefined,
      };
    }),
  }));

  return {
    output: {
      id: idGen(),
      formatId: target.formatId,
      name: target.name,
      width: target.width,
      height: target.height,
      fps: source.fps,
      durationMs: source.durationMs,
      tracks,
      markers: source.markers?.map((m) => ({ ...m, id: idGen() })),
    },
    sourceTracks,
  };
};
