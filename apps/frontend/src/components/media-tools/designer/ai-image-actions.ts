'use client';

import { detectFocalPoint } from './reflow';
import { probeImageNaturalSize } from './elements';
import type { DesignerElement } from './designer.store';
import { pageChildren } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.pages';
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

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type StoreApi = ReturnType<typeof import('./designer.store').createDesignerStore>;

export { aiOutpaint, OUTPAINT_MODES } from './outpaint';

interface AiActionArgs {
  fetch: FetchLike;
  store: StoreApi;
  elementId: string;
  probe?: (src: string) => Promise<{ width: number; height: number } | null>;
}

const getElement = (store: StoreApi, elementId: string): DesignerElement | undefined => {
  const st = store.getState();
  const out = st.doc.outputs[st.currentOutput] as any;
  return pageChildren(out, st.currentPage)?.find((c: any) => c.id === elementId);
};

const getSrc = (store: StoreApi, elementId: string): string | undefined =>
  getElement(store, elementId)?.src;

// Shared by the inspector AI Tools and the Tools menu so the implementation
// lives in exactly one place (D-10).

// Failure envelopes carry the reason under `message` (502 provider-upstream)
// or `error` (409 capability) — surface it in the toast instead of a bare "Failed".
export const readErrorMessage = async (res: Response, fallback: string): Promise<string> => {
  try {
    const body = await res.json();
    return body?.message || body?.error || fallback;
  } catch {
    return fallback;
  }
};

export interface StaticBackgroundRemovalCandidate {
  before: DesignerElement;
  source: BackgroundRemovalAsset;
  asset: BackgroundRemovalAsset;
  history: unknown;
}

export const staticMediaMatches = (before: DesignerElement, current?: DesignerElement) => !!current &&
  current.src === before.src &&
  current.originalSrc === before.originalSrc &&
  current.originalFileId === before.originalFileId &&
  JSON.stringify(current.smartFilters || []) === JSON.stringify(before.smartFilters || []);

export const aiRemoveBackground = async ({
  fetch,
  store,
  elementId,
  probe = probeImageNaturalSize,
}: AiActionArgs): Promise<StaticBackgroundRemovalCandidate | null> => {
  const before = getElement(store, elementId);
  if (!before?.src) throw new Error('No image');
  const history = store.getState().history;
  const res = await fetch('/media/remove-background', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl: before.src }),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, 'Background removal failed'));
  const data = await res.json() as { url?: string; fileId?: string };
  if (!data.url) throw new Error('Background removal failed');
  const sourceSize = before.naturalWidth && before.naturalHeight
    ? { width: before.naturalWidth, height: before.naturalHeight }
    : null;
  const [natural, originalNatural] = await Promise.all([
    probe(data.url),
    sourceSize ? Promise.resolve(sourceSize) : probe(before.src),
  ]);
  const candidate = {
    before,
    history,
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
  return store.getState().history === history && staticMediaMatches(before, getElement(store, elementId))
    ? candidate
    : null;
};

export const applyAiRemoveBackground = async ({
  store,
  candidate,
  output,
  fit = 'manual',
  fetch,
  createMask = uploadBackgroundRemovalMask,
}: {
  store: StoreApi;
  candidate: StaticBackgroundRemovalCandidate;
  output: { width: number; height: number };
  fit?: BackgroundRemovalFit;
  fetch: FetchLike;
  createMask?: typeof uploadBackgroundRemovalMask;
}): Promise<boolean> => {
  if (store.getState().history !== candidate.history ||
    !staticMediaMatches(candidate.before, getElement(store, candidate.before.id))) return false;
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
        fitMode: reviewedPatch.fitMode ?? candidate.before.fitMode,
        focalPoint: 'focalPoint' in reviewedPatch ? reviewedPatch.focalPoint : candidate.before.focalPoint,
      },
      id: candidate.before.id,
    });
  } catch {
    // A mask that cannot be read or saved must not discard the provider result.
  }
  if (store.getState().history !== candidate.history ||
    !staticMediaMatches(candidate.before, getElement(store, candidate.before.id))) {
    if (mask) await discardBackgroundRemovalMask(fetch, mask);
    return false;
  }
  store.getState().updateElement(
    candidate.before.id,
    mask
      ? { ...reviewedPatch, maskSrc: mask.src, maskFileId: mask.fileId, maskEnabled: true }
      : flattenedBackgroundRemovalPatch({ asset: candidate.asset, output, fit })
  );
  store.getState().pushHistory('Remove background');
  return true;
};

const directSequences = new WeakMap<StoreApi, Map<string, number>>();

const runDirectImageEdit = async ({
  args,
  path,
  body,
  fallback,
  label,
  patch,
}: {
  args: AiActionArgs;
  path: string;
  body: Record<string, unknown>;
  fallback: string;
  label: string;
  patch: (url: string) => Partial<DesignerElement>;
}): Promise<boolean> => {
  const { fetch, store, elementId } = args;
  const before = getElement(store, elementId);
  if (!before?.src) throw new Error('No image');
  const history = store.getState().history;
  let sequences = directSequences.get(store);
  if (!sequences) {
    sequences = new Map();
    directSequences.set(store, sequences);
  }
  const sequence = (sequences.get(elementId) || 0) + 1;
  sequences.set(elementId, sequence);

  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl: before.src, ...body }),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, fallback));
  const data = await res.json() as { url?: string };
  if (!data.url) throw new Error(fallback);
  if (sequences.get(elementId) !== sequence || store.getState().history !== history ||
    !staticMediaMatches(before, getElement(store, elementId))) return false;

  if (!store.getState().updateElement(elementId, patch(data.url))) return false;
  store.getState().pushHistory(label);
  return true;
};

export const aiUpscale = async (args: AiActionArgs, scale: number): Promise<boolean> =>
  runDirectImageEdit({
    args,
    path: '/media/upscale',
    body: { scale },
    fallback: 'Upscale failed',
    label: 'Upscale image',
    patch: (url) => ({
      src: url,
      fileId: undefined,
      maskSrc: undefined,
      maskFileId: undefined,
      maskEnabled: undefined,
    }),
  });

export const aiInpaint = async (
  args: AiActionArgs,
  { maskUrl, prompt }: { maskUrl: string; prompt: string }
): Promise<boolean> =>
  runDirectImageEdit({
    args,
    path: '/media/inpaint',
    body: { maskUrl, prompt },
    fallback: 'Inpaint failed',
    label: 'Inpaint image',
    patch: (url) => ({ src: url, fileId: undefined }),
  });

export const aiImageToImage = async (args: AiActionArgs, prompt: string): Promise<boolean> =>
  runDirectImageEdit({
    args,
    path: '/media/image-to-image',
    body: { prompt },
    fallback: 'Image-to-image failed',
    label: 'Image to image',
    patch: (url) => ({ src: url, fileId: undefined }),
  });

export const aiDetectSubject = async ({ fetch, store, elementId }: AiActionArgs): Promise<void> => {
  const src = getSrc(store, elementId);
  if (!src) throw new Error('No image');
  const fp = await detectFocalPoint(src, fetch);
  store.getState().updateElement(elementId, { focalPoint: fp });
};
