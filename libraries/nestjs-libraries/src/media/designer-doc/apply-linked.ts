import type {
  DesignerDoc,
  DesignerElement,
  DesignerOutput,
  SymbolOverrides,
  VideoClip,
  VideoOutput,
} from './designer-doc.schema';
import { typeScaleRatio } from './reflow';
import { scalePathNodes } from './path-geometry';

// Geometry is per-format and never propagates; everything else (style/content)
// syncs to same-originId copies in the other outputs.
export const GEOMETRY_KEYS = new Set([
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'fitMode',
  'focalPoint',
  'crop',
  'anchor',
]);

const sharedUpdates = (
  updates: Partial<DesignerElement>
): Partial<DesignerElement> => {
  const out: Partial<DesignerElement> = {};
  for (const k of Object.keys(updates) as Array<keyof DesignerElement>) {
    if (!GEOMETRY_KEYS.has(k)) {
      (out as any)[k] = (updates as any)[k];
    }
  }
  return out;
};

const isImageOutput = (
  out: DesignerOutput | VideoOutput
): out is DesignerOutput => 'children' in out;

/**
 * Apply one element patch, MERGING `symbolOverrides` per definition-child id
 * instead of replacing the map: overrides are keyed by the child INSIDE the
 * symbol (`plate`/`label`), so a linked text edit written from the primary
 * would otherwise clobber a fill override the sibling instance already
 * carried. Overrides carry no fontSize, so `scaledForOutput` passes them
 * through untouched.
 */
const applyPatch = (
  el: DesignerElement,
  updates: Partial<DesignerElement>
): DesignerElement => {
  const patched = resizePathNodes(el, updates);
  if (!updates.symbolOverrides || !el.symbolOverrides) {
    return { ...el, ...patched };
  }
  const merged: SymbolOverrides = { ...el.symbolOverrides };
  for (const [childId, content] of Object.entries(updates.symbolOverrides)) {
    merged[childId] = { ...merged[childId], ...content };
  }
  return { ...el, ...patched, symbolOverrides: merged };
};

/**
 * Keep a path's geometry with its box.
 *
 * A path stores bezier nodes in element-local coordinates, so resizing the
 * element only moved the selection box — the curve carried on at whatever size
 * it was drawn. It looked convincing on the canvas because Konva cannot compute
 * real bounds for a custom `sceneFunc` and reports the declared width/height
 * instead, so only the export showed the truth.
 */
const resizePathNodes = (
  el: DesignerElement,
  updates: Partial<DesignerElement>
): Partial<DesignerElement> => {
  if (el.type !== 'path' || !el.nodes?.length) return updates;
  const nextW = updates.width ?? el.width;
  const nextH = updates.height ?? el.height;
  if (nextW === el.width && nextH === el.height) return updates;
  if (!(el.width > 0) || !(el.height > 0) || !(nextW > 0) || !(nextH > 0)) return updates;
  if (updates.nodes) return updates;
  return {
    ...updates,
    nodes: scalePathNodes(el.nodes, nextW / el.width, nextH / el.height),
  };
};

/**
 * Non-geometry updates propagate raw — except `fontSize`: a px value authored
 * against one canvas is wrong on another, so linked copies get it re-fit
 * through the shared aspect-aware basis (`typeScaleRatio`, the same rule as
 * smartReflow and the conductor's variant re-fit), floored at 10px. The old
 * `min(scaleX, scaleY)` here silently re-imposed short-edge typography on
 * every linked edit — undoing the per-format type of every wider output.
 */
const scaledForOutput = (
  shared: Partial<DesignerElement>,
  source: { width: number; height: number },
  target: { width: number; height: number }
): Partial<DesignerElement> => {
  if (typeof shared.fontSize !== 'number' || !Number.isFinite(shared.fontSize)) {
    return shared;
  }
  return {
    ...shared,
    fontSize: Math.max(
      10,
      Math.round(shared.fontSize * typeScaleRatio(source, target))
    ),
  };
};

/**
 * Apply `updates` to the elements matched by `ids` on the current output, then
 * propagate any non-geometry updates to linked copies (same `originId`) on the
 * other image outputs. When `editFormatOnly` is true the propagation step is
 * skipped, matching the front-end "Edit format only" toggle.
 */
export const applyLinked = (
  doc: DesignerDoc,
  currentOutputIndex: number,
  ids: Set<string> | string[],
  updates: Partial<DesignerElement>,
  editFormatOnly: boolean
): { outputs: (DesignerOutput | VideoOutput)[]; affected: number[] } => {
  const idSet = ids instanceof Set ? ids : new Set(ids);
  const current = doc.outputs[currentOutputIndex] as DesignerOutput;
  const origins = new Set(
    current.children
      .filter((el) => idSet.has(el.id) && el.originId)
      .map((el) => el.originId as string)
  );
  const shared = sharedUpdates(updates);
  const propagate =
    !editFormatOnly && origins.size > 0 && Object.keys(shared).length > 0;
  const affected: number[] = [];

  const outputs = doc.outputs.map((out, i) => {
    if (i === currentOutputIndex) {
      return {
        ...out,
        children: (out as DesignerOutput).children.map((el) =>
          idSet.has(el.id) ? applyPatch(el, updates) : el
        ),
      };
    }
    if (!propagate || !isImageOutput(out)) return out;

    let changed = false;
    const scaled = scaledForOutput(shared, current, out as DesignerOutput);
    const newChildren = (out as DesignerOutput).children.map((el) => {
      if (el.originId && origins.has(el.originId)) {
        changed = true;
        return applyPatch(el, scaled);
      }
      return el;
    });
    if (changed) affected.push(i);
    return { ...out, children: newChildren };
  });

  return { outputs, affected };
};

// The per-element half of applyLinked (path-node refit + symbolOverrides
// merge), for write paths that patch the current output directly.
export const applyElementPatch = applyPatch;

// ---------------------------------------------------------------------------
// Video variants — originId propagation across VIDEO outputs
// ---------------------------------------------------------------------------

/**
 * Clip keys that never propagate across video variants: per-canvas geometry,
 * and ALL timing — variants share an edit's timing by construction (seeding
 * copies it unchanged), so a later trim on one variant stays local to it.
 */
export const VIDEO_CLIP_LOCAL_KEYS = new Set([
  'id',
  'originId',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'crop',
  'focalPoint',
  'fitMode',
  'startMs',
  'endMs',
  'trimInMs',
  'trimOutMs',
  'speed',
  'speedCurve',
  'reverse',
  'freezeAtMs',
  'keyframes',
  // Same rule as keyframes: reveal state is timing-anchored animation, not
  // content — a variant keeps its own.
  'textReveal',
  'beats',
]);

const sharedClipUpdates = (
  updates: Partial<VideoClip>
): Partial<VideoClip> => {
  const out: Partial<VideoClip> = {};
  for (const k of Object.keys(updates) as Array<keyof VideoClip>) {
    if (!VIDEO_CLIP_LOCAL_KEYS.has(k)) (out as any)[k] = updates[k];
  }
  return out;
};

const isVideoOutput = (
  out: DesignerOutput | VideoOutput
): out is VideoOutput => 'tracks' in out;

/**
 * Patch one clip on the current output, then propagate the non-geometry,
 * non-timing updates to clips carrying the same `originId` on the OTHER video
 * outputs — the video-variant mirror of `applyLinked`. `fontSize` is re-fit
 * through the same aspect-aware type basis image text uses. With
 * `editFormatOnly` the propagation step is skipped (the "Edit format only"
 * toggle), exactly like the image path.
 */
export const applyLinkedVideoClip = (
  doc: DesignerDoc,
  currentOutputIndex: number,
  trackId: string,
  clipId: string,
  updates: Partial<VideoClip>,
  editFormatOnly: boolean
): { outputs: (DesignerOutput | VideoOutput)[]; affected: number[] } => {
  const current = doc.outputs[currentOutputIndex] as VideoOutput;
  const track = current.tracks.find((t) => t.id === trackId);
  const clip = track?.clips.find((c) => c.id === clipId);
  const originId = clip?.originId;

  const shared = sharedClipUpdates(updates);
  const mediaReplacement = updates.src !== undefined || updates.fileId !== undefined;
  const propagate =
    !editFormatOnly && !!originId && Object.keys(shared).length > 0;
  const affected: number[] = [];

  const outputs = doc.outputs.map((out, i) => {
    if (!isVideoOutput(out)) return out;
    if (i === currentOutputIndex) {
      return {
        ...out,
        tracks: out.tracks.map((t) =>
          t.id !== trackId
            ? t
            : {
                ...t,
                clips: t.clips.map((c) =>
                  c.id === clipId ? ({ ...c, ...updates } as VideoClip) : c
                ),
              }
        ),
      };
    }
    if (!propagate) return out;

    // A px fontSize authored against one canvas is wrong on another — re-fit
    // through the shared type basis, same rule as image-mode linked text.
    const scaled = scaledForOutput(
      shared as Partial<DesignerElement>,
      current,
      out
    ) as Partial<VideoClip>;

    let changed = false;
    const tracks = out.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => {
        if (c.originId && c.originId === originId) {
          changed = true;
          return {
            ...c,
            ...scaled,
            ...(mediaReplacement ? { crop: undefined, focalPoint: undefined } : {}),
          } as VideoClip;
        }
        return c;
      }),
    }));
    if (changed) affected.push(i);
    return { ...out, tracks };
  });

  return { outputs, affected };
};
