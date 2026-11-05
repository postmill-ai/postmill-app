'use client';

import { pageChildren } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.pages';
import { probeImageNaturalSize } from './elements';
import { primeBufferFromSrc } from './raster-layers';
import { uploadBackgroundRemovalMask } from './background-removal-mask';

export interface CutoutTarget {
  id: string;
  src?: string;
  fileId?: string;
  originalSrc?: string;
  originalFileId?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  width?: number;
  height?: number;
  maskSrc?: string;
  maskFileId?: string;
  maskEnabled?: boolean;
}

type Store = ReturnType<typeof import('./designer.store').createDesignerStore>;
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const findCutoutTarget = (store: Store, id: string): CutoutTarget | undefined => {
  const state = store.getState();
  const output = state.doc.outputs[state.currentOutput] as any;
  if (state.doc.mode === 'video') {
    return output?.tracks?.flatMap((track: any) => track.clips)
      .find((clip: CutoutTarget) => clip.id === id);
  }
  return pageChildren(output, state.currentPage)?.find((element: CutoutTarget) => element.id === id);
};

export const updateCutoutTarget = (
  store: Store,
  id: string,
  update: { maskSrc?: string; maskFileId?: string; maskEnabled?: boolean }
): void => {
  const state = store.getState();
  if (state.doc.mode === 'video') {
    const output = state.doc.outputs[state.currentOutput] as any;
    const track = output?.tracks?.find((candidate: any) =>
      candidate.clips.some((clip: CutoutTarget) => clip.id === id));
    if (track) state.updateClipSilent(state.currentOutput, track.id, id, update);
    return;
  }
  state.updateElement(id, update);
};

export const armCutoutRefinement = async (store: Store, id: string): Promise<boolean> => {
  const target = findCutoutTarget(store, id);
  if (!target?.src || !target.maskSrc) return false;
  await primeBufferFromSrc(
    `${id}:mask`,
    target.maskSrc,
    target.width ?? target.naturalWidth ?? 1,
    target.height ?? target.naturalHeight ?? 1
  );
  store.getState().setMaskTarget(id);
  store.getState().setActiveTool('brush');
  store.getState().setToolOption('brush', 'color', '#ffffff');
  return true;
};

export const createCutoutMask = async ({
  store,
  fetch,
  id,
}: {
  store: Store;
  fetch: FetchLike;
  id: string;
}): Promise<boolean> => {
  const target = findCutoutTarget(store, id);
  if (!target?.src) return false;
  const natural = target.naturalWidth && target.naturalHeight
    ? { width: target.naturalWidth, height: target.naturalHeight }
    : await probeImageNaturalSize(target.src);
  const source = {
    url: target.src,
    fileId: target.fileId,
    naturalWidth: natural?.width,
    naturalHeight: natural?.height,
  };
  const mask = await uploadBackgroundRemovalMask({ fetch, source, cutout: source, id });
  updateCutoutTarget(store, id, {
    maskSrc: mask.src,
    maskFileId: mask.fileId,
    maskEnabled: true,
  });
  store.getState().pushHistory('Create cutout mask');
  return armCutoutRefinement(store, id);
};

export const finishCutoutRefinement = (store: Store): void => {
  store.getState().setMaskTarget(null);
  store.getState().setActiveTool('move');
};
