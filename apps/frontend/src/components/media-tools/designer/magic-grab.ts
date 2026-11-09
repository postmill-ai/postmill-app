'use client';

import type { DesignerElement, VideoClip } from './designer.store';
import type { BackgroundRemovalAsset } from './background-removal';
import type { StaticBackgroundRemovalCandidate } from './ai-image-actions';
import type { ClipBackgroundRemovalCandidate, ClipMediaTarget } from './clip-media';
import {
  aiRemoveBackground,
  readErrorMessage,
  staticMediaMatches,
} from './ai-image-actions';
import {
  clipMediaOperationIsCurrent,
  clipMediaSourceMatches,
  removeClipImageBackground,
} from './clip-media';
import {
  discardBackgroundRemovalMask,
  loadMaskImage,
  uploadBackgroundRemovalMask,
} from './background-removal-mask';
import { backgroundMaskDimensions } from './background-removal';
import { pageChildren } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.pages';
import { commitCanvas, type CommitResult } from './raster-layers';
import { originalSubjectWithAlpha } from './image-edit-pixels';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type Store = ReturnType<typeof import('./designer.store').createDesignerStore>;

export interface MagicGrabAsset {
  url: string;
  fileId: string;
}

export type StaticMagicGrabCandidate = StaticBackgroundRemovalCandidate & {
  background: MagicGrabAsset;
  sourceMask: CommitResult;
};

export type ClipMagicGrabCandidate = ClipBackgroundRemovalCandidate & {
  background: MagicGrabAsset;
  sourceMask: CommitResult;
};

export const uploadMagicGrabSourceMask = async ({
  fetch,
  source,
  cutout,
  id,
}: {
  fetch: FetchLike;
  source: BackgroundRemovalAsset;
  cutout: BackgroundRemovalAsset;
  id: string;
}): Promise<CommitResult> => {
  const image = await loadMaskImage(cutout.url);
  const dimensions = backgroundMaskDimensions(source, {
    ...cutout,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
  });
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the Magic Grab mask.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = 'destination-over';
  context.fillStyle = '#000000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = 'source-over';
  const uploaded = await commitCanvas(canvas, `${id}:magic-grab-mask`, fetch);
  if (!uploaded) throw new Error('Could not save the Magic Grab mask.');
  return uploaded;
};

const completeMagicGrab = async <T extends {
  source: BackgroundRemovalAsset;
  asset: BackgroundRemovalAsset;
  before: { id: string };
}>(
  fetch: FetchLike,
  candidate: T
): Promise<T & { background: MagicGrabAsset; sourceMask: CommitResult }> => {
  const sourceMask = await uploadMagicGrabSourceMask({
    fetch,
    source: candidate.source,
    cutout: candidate.asset,
    id: candidate.before.id,
  });
  try {
    const response = await fetch('/media/magic-grab', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageUrl: candidate.source.url,
        cutoutUrl: candidate.asset.url,
        maskUrl: sourceMask.src,
      }),
    });
    if (!response.ok) throw new Error(await readErrorMessage(response, 'Magic Grab failed'));
    const data = await response.json() as { subject?: MagicGrabAsset; background?: MagicGrabAsset };
    if (!data.background?.url || !data.background.fileId) {
      throw new Error('Magic Grab did not return a reconstructed background.');
    }
    const subject = data.subject || candidate.asset;
    return {
      ...candidate,
      asset: {
        ...subject,
        url: await originalSubjectWithAlpha(candidate.source.url, subject.url),
      },
      background: data.background,
      sourceMask,
    };
  } catch (error) {
    await discardBackgroundRemovalMask(fetch, sourceMask);
    throw error;
  }
};

export const prepareStaticMagicGrab = async ({
  fetch,
  store,
  elementId,
}: {
  fetch: FetchLike;
  store: Store;
  elementId: string;
}): Promise<StaticMagicGrabCandidate | null> => {
  const candidate = await aiRemoveBackground({ fetch, store, elementId });
  if (!candidate) return null;
  return completeMagicGrab(fetch, candidate);
};

export const prepareClipMagicGrab = async ({
  fetch,
  store,
  target,
}: {
  fetch: FetchLike;
  store: Store;
  target: ClipMediaTarget;
}): Promise<ClipMagicGrabCandidate | null> => {
  const candidate = await removeClipImageBackground({ fetch, store, target });
  if (!candidate) return null;
  return completeMagicGrab(fetch, candidate);
};

export const cleanupMagicGrabCandidate = async (
  fetch: FetchLike,
  candidate: { background: MagicGrabAsset }
): Promise<void> => {
  try {
    await fetch('/media/magic-grab/cleanup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: candidate.background.fileId }),
    });
  } catch {
    // The server also expires provider artifacts; an unreachable cleanup is non-fatal.
  }
};

const cleanupCandidate = cleanupMagicGrabCandidate;

export const applyStaticMagicGrab = async ({
  fetch,
  store,
  candidate,
  subjectName,
}: {
  fetch: FetchLike;
  store: Store;
  candidate: StaticMagicGrabCandidate;
  subjectName?: string;
}): Promise<boolean> => {
  const before = candidate.before;
  const state = store.getState();
  const output = state.doc.outputs[state.currentOutput];
  const current = output && 'children' in output
    ? pageChildren(output, state.currentPage).find((element) => element.id === before.id)
    : undefined;
  if (store.getState().history !== candidate.history || !staticMediaMatches(before, current)) {
    await cleanupCandidate(fetch, candidate);
    return false;
  }
  const mask = await uploadBackgroundRemovalMask({
    fetch,
    source: candidate.source,
    cutout: candidate.asset,
    frame: before,
    id: before.id,
  });
  if (store.getState().history !== candidate.history || !staticMediaMatches(before, current)) {
    await Promise.all([
      discardBackgroundRemovalMask(fetch, mask),
      cleanupCandidate(fetch, candidate),
    ]);
    return false;
  }
  const background: DesignerElement = {
    ...before,
    src: candidate.background.url,
    fileId: candidate.background.fileId,
    originalSrc: undefined,
    originalFileId: undefined,
    smartFilters: undefined,
    maskSrc: undefined,
    maskFileId: undefined,
    maskEnabled: undefined,
  };
  const subject: DesignerElement = {
    ...before,
    id: '',
    originId: undefined,
    name: before.name ? `${before.name} ${subjectName || 'Subject'}` : (subjectName || 'Subject'),
    src: candidate.source.url,
    fileId: candidate.source.fileId,
    originalSrc: candidate.source.url,
    originalFileId: candidate.source.fileId,
    smartFilters: undefined,
    maskSrc: mask.src,
    maskFileId: mask.fileId,
    maskEnabled: true,
  };
  const applied = store.getState().applyMagicGrab(before.id, background, subject);
  if (!applied) {
    await cleanupCandidate(fetch, candidate);
  }
  return applied;
};

export const applyClipMagicGrab = async ({
  fetch,
  store,
  target,
  candidate,
}: {
  fetch: FetchLike;
  store: Store;
  target: ClipMediaTarget;
  candidate: ClipMagicGrabCandidate;
}): Promise<boolean> => {
  if (!clipMediaOperationIsCurrent(store, target, candidate.operation)) {
    await cleanupCandidate(fetch, candidate);
    return false;
  }
  const before = candidate.before;
  const output = store.getState().doc.outputs[target.outputIndex];
  const current = output && 'tracks' in output
    ? output.tracks.find((track) => track.id === target.trackId)?.clips
      .find((clip) => clip.id === target.clipId)
    : undefined;
  if (!clipMediaSourceMatches(before, current)) {
    await cleanupCandidate(fetch, candidate);
    return false;
  }
  const mask = await uploadBackgroundRemovalMask({
    fetch,
    source: candidate.source,
    cutout: candidate.asset,
    frame: {
      width: before.width ?? output!.width,
      height: before.height ?? output!.height,
      crop: before.crop,
      fitMode: before.fitMode ?? 'cover',
      focalPoint: before.focalPoint,
    },
    id: before.id,
  });
  if (!clipMediaOperationIsCurrent(store, target, candidate.operation) ||
    !clipMediaSourceMatches(before, current)) {
    await Promise.all([
      discardBackgroundRemovalMask(fetch, mask),
      cleanupCandidate(fetch, candidate),
    ]);
    return false;
  }
  const background: VideoClip = {
    ...before,
    src: candidate.background.url,
    fileId: candidate.background.fileId,
    mediaType: 'image',
    originalSrc: undefined,
    originalFileId: undefined,
    smartFilters: undefined,
    maskSrc: undefined,
    maskFileId: undefined,
    maskEnabled: undefined,
  };
  const subject: VideoClip = {
    ...before,
    id: '',
    originId: undefined,
    src: candidate.source.url,
    fileId: candidate.source.fileId,
    mediaType: 'image',
    originalSrc: candidate.source.url,
    originalFileId: candidate.source.fileId,
    smartFilters: undefined,
    maskSrc: mask.src,
    maskFileId: mask.fileId,
    maskEnabled: true,
  };
  const applied = store.getState().applyMagicGrabClip(target, background, subject);
  if (!applied) {
    await cleanupCandidate(fetch, candidate);
  }
  return applied;
};
