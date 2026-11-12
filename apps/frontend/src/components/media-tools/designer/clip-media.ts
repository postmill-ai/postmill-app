import type { VideoClip } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { probeImageNaturalSize } from './elements';
import { readErrorMessage } from './read-error-message';
import { replacementCrop } from './image-replacement';
import {
  backgroundRemovalPatch,
  flattenedBackgroundRemovalPatch,
  type BackgroundRemovalAsset,
  type BackgroundRemovalFit,
} from './background-removal';
import {
  discardBackgroundRemovalMask,
  uploadBackgroundRemovalMask,
} from './background-removal-mask';

type Store = ReturnType<typeof import('./designer.store').createDesignerStore>;
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface ClipMediaTarget {
  outputIndex: number;
  trackId: string;
  clipId: string;
}

const clipAt = (store: Store, target: ClipMediaTarget): VideoClip | undefined => {
  const output = store.getState().doc.outputs[target.outputIndex];
  if (!output || !('tracks' in output)) return undefined;
  return output.tracks
    .find((track) => track.id === target.trackId)
    ?.clips.find((clip) => clip.id === target.clipId);
};

interface ClipMediaOperation {
  id: number;
  history: unknown;
}

const mediaOperations = new WeakMap<Store, Map<string, number>>();
const operationKey = (target: ClipMediaTarget) =>
  `${target.outputIndex}:${target.trackId}:${target.clipId}`;

const beginClipMediaOperation = (store: Store, target: ClipMediaTarget): ClipMediaOperation => {
  let operations = mediaOperations.get(store);
  if (!operations) {
    operations = new Map<string, number>();
    mediaOperations.set(store, operations);
  }
  const key = operationKey(target);
  const id = (operations.get(key) || 0) + 1;
  operations.set(key, id);
  return { id, history: store.getState().history };
};

export const clipMediaOperationIsCurrent = (
  store: Store,
  target: ClipMediaTarget,
  operation: ClipMediaOperation
): boolean =>
  mediaOperations.get(store)?.get(operationKey(target)) === operation.id &&
  store.getState().history === operation.history;

export const imageReplacementPatch = (item: {
  url: string;
  fileId?: string;
  width?: number | null;
  height?: number | null;
}, before?: Pick<VideoClip, 'naturalWidth' | 'naturalHeight' | 'crop' | 'fitMode' | 'focalPoint'>): Partial<VideoClip> => ({
  src: item.url,
  fileId: item.fileId,
  qr: undefined,
  mediaType: 'image',
  naturalWidth: item.width || undefined,
  naturalHeight: item.height || undefined,
  crop: replacementCrop(before, item),
  fitMode: before?.fitMode,
  focalPoint: before?.focalPoint,
  originalSrc: undefined,
  originalFileId: undefined,
  smartFilters: undefined,
  maskSrc: undefined,
  maskFileId: undefined,
  maskEnabled: undefined,
});

export const replaceClipImage = async ({
  store,
  target,
  item,
  probe = probeImageNaturalSize,
}: {
  store: Store;
  target: ClipMediaTarget;
  item: { url: string; fileId?: string; width?: number | null; height?: number | null };
  probe?: (src: string) => Promise<{ width: number; height: number } | null>;
}): Promise<boolean> => {
  const before = clipAt(store, target);
  const operation = beginClipMediaOperation(store, target);
  if (!before?.src) return false;
  const natural = item.width && item.height
    ? { width: item.width, height: item.height }
    : await probe(item.url);
  if (!clipMediaOperationIsCurrent(store, target, operation) ||
    !clipMediaSourceMatches(before, clipAt(store, target))) return false;
  const updated = store.getState().updateClipSilent(
    target.outputIndex,
    target.trackId,
    target.clipId,
    imageReplacementPatch({ ...item, width: natural?.width, height: natural?.height }, before)
  );
  if (updated) store.getState().pushHistory();
  return updated;
};

export const clipMediaSourceMatches = (
  before: Pick<VideoClip, 'src' | 'originalSrc' | 'originalFileId' | 'smartFilters'>,
  current: Pick<VideoClip, 'src' | 'originalSrc' | 'originalFileId' | 'smartFilters'> | undefined
): boolean => !!current &&
  current.src === before.src &&
  current.originalSrc === before.originalSrc &&
  current.originalFileId === before.originalFileId &&
  JSON.stringify(current.smartFilters || []) === JSON.stringify(before.smartFilters || []);

export interface ClipBackgroundRemovalCandidate {
  before: VideoClip;
  source: BackgroundRemovalAsset;
  asset: BackgroundRemovalAsset;
  operation: ClipMediaOperation;
}

export const removeClipImageBackground = async ({
  fetch,
  store,
  target,
  probe = probeImageNaturalSize,
}: {
  fetch: Fetch;
  store: Store;
  target: ClipMediaTarget;
  probe?: (src: string) => Promise<{ width: number; height: number } | null>;
}): Promise<ClipBackgroundRemovalCandidate | null> => {
  const before = clipAt(store, target);
  const operation = beginClipMediaOperation(store, target);
  if (!before?.src) throw new Error('No image');
  const response = await fetch('/media/remove-background', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl: before.src }),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Background removal failed'));
  }
  const data = await response.json() as { url?: string; fileId?: string };
  if (!data.url) throw new Error('Background removal failed');
  const sourceSize = before.naturalWidth && before.naturalHeight
    ? { width: before.naturalWidth, height: before.naturalHeight }
    : null;
  const [natural, originalNatural] = await Promise.all([
    probe(data.url),
    sourceSize ? Promise.resolve(sourceSize) : probe(before.src),
  ]);
  if (!clipMediaOperationIsCurrent(store, target, operation) ||
    !clipMediaSourceMatches(before, clipAt(store, target))) return null;
  return {
    before,
    operation,
    source: {
      url: before.src,
      fileId: before.fileId,
      naturalWidth: originalNatural?.width,
      naturalHeight: originalNatural?.height,
    },
    asset: {
      url: data.url,
      fileId: data.fileId,
      naturalWidth: natural?.width,
      naturalHeight: natural?.height,
    },
  };
};

export const applyClipImageBackground = async ({
  store,
  target,
  candidate,
  output,
  fit = 'manual',
  fetch,
  createMask = uploadBackgroundRemovalMask,
}: {
  store: Store;
  target: ClipMediaTarget;
  candidate: ClipBackgroundRemovalCandidate;
  output: { width: number; height: number };
  fit?: BackgroundRemovalFit;
  fetch: Fetch;
  createMask?: typeof uploadBackgroundRemovalMask;
}): Promise<boolean> => {
  if (!clipMediaOperationIsCurrent(store, target, candidate.operation) ||
    !clipMediaSourceMatches(candidate.before, clipAt(store, target))) return false;
  const reviewedPatch = backgroundRemovalPatch({
    source: candidate.source,
    mask: candidate.asset,
    output,
    fit,
  });
  let mask: Awaited<ReturnType<typeof uploadBackgroundRemovalMask>> | null = null;
  try {
    mask = await createMask({
      fetch,
      source: candidate.source,
      cutout: candidate.asset,
      frame: {
        width: reviewedPatch.width ?? candidate.before.width,
        height: reviewedPatch.height ?? candidate.before.height,
        crop: 'crop' in reviewedPatch ? reviewedPatch.crop : candidate.before.crop,
        fitMode: reviewedPatch.fitMode ?? candidate.before.fitMode ?? 'cover',
        focalPoint: 'focalPoint' in reviewedPatch ? reviewedPatch.focalPoint : candidate.before.focalPoint,
      },
      id: candidate.before.id,
    });
  } catch {
    // Preserve the pre-refinement behavior when only mask preparation fails.
  }
  if (!clipMediaOperationIsCurrent(store, target, candidate.operation) ||
    !clipMediaSourceMatches(candidate.before, clipAt(store, target))) {
    if (mask) await discardBackgroundRemovalMask(fetch, mask);
    return false;
  }
  const updated = store.getState().updateClipSilent(
    target.outputIndex,
    target.trackId,
    target.clipId,
    {
      ...(mask
        ? { ...reviewedPatch, maskSrc: mask.src, maskFileId: mask.fileId, maskEnabled: true }
        : flattenedBackgroundRemovalPatch({ asset: candidate.asset, output, fit })),
      mediaType: 'image',
    }
  );
  if (updated) store.getState().pushHistory();
  return updated;
};
