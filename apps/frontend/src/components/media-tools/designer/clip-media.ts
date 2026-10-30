import type { VideoClip } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { probeImageNaturalSize } from './elements';
import { readErrorMessage } from './read-error-message';

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

const clipMediaOperationIsCurrent = (
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
}): Partial<VideoClip> => ({
  src: item.url,
  fileId: item.fileId,
  mediaType: 'image',
  naturalWidth: item.width || undefined,
  naturalHeight: item.height || undefined,
  crop: undefined,
  focalPoint: undefined,
  originalSrc: undefined,
  originalFileId: undefined,
  smartFilters: undefined,
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
    imageReplacementPatch({ ...item, width: natural?.width, height: natural?.height })
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
}): Promise<boolean> => {
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
  const natural = await probe(data.url);
  if (!clipMediaOperationIsCurrent(store, target, operation) ||
    !clipMediaSourceMatches(before, clipAt(store, target))) return false;
  const updated = store.getState().updateClipSilent(target.outputIndex, target.trackId, target.clipId, {
    src: data.url,
    fileId: data.fileId,
    mediaType: 'image',
    naturalWidth: natural?.width,
    naturalHeight: natural?.height,
    crop: undefined,
    focalPoint: undefined,
    originalSrc: undefined,
    originalFileId: undefined,
    smartFilters: undefined,
  });
  if (updated) store.getState().pushHistory();
  return updated;
};
