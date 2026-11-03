'use client';

import { detectFocalPoint } from './reflow';
import { probeImageNaturalSize } from './elements';
import type { DesignerElement } from './designer.store';
import {
  backgroundRemovalPatch,
  type BackgroundRemovalAsset,
  type BackgroundRemovalFit,
} from './background-removal';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type StoreApi = ReturnType<typeof import('./designer.store').createDesignerStore>;

// Canonical outpainting modes — kept in sync with the kernel `OutpaintMode`
// union (the frontend has no dependency on the provider kernel package).
export type OutpaintMode =
  | 'zoom-1.5x'
  | 'zoom-2x'
  | 'make-square'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom';

export const OUTPAINT_MODES: OutpaintMode[] = [
  'zoom-1.5x',
  'zoom-2x',
  'make-square',
  'left',
  'right',
  'top',
  'bottom',
];

interface AiActionArgs {
  fetch: FetchLike;
  store: StoreApi;
  elementId: string;
  probe?: (src: string) => Promise<{ width: number; height: number } | null>;
}

const getElement = (store: StoreApi, elementId: string): DesignerElement | undefined => {
  const st = store.getState();
  const out = st.doc.outputs[st.currentOutput] as any;
  return out?.children?.find((c: any) => c.id === elementId);
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
  asset: BackgroundRemovalAsset;
  history: unknown;
}

const staticMediaMatches = (before: DesignerElement, current?: DesignerElement) => !!current &&
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
  const natural = await probe(data.url);
  const candidate = {
    before,
    history,
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

export const applyAiRemoveBackground = ({
  store,
  candidate,
  output,
  fit = 'frame',
}: {
  store: StoreApi;
  candidate: StaticBackgroundRemovalCandidate;
  output: { width: number; height: number };
  fit?: BackgroundRemovalFit;
}): boolean => {
  if (store.getState().history !== candidate.history ||
    !staticMediaMatches(candidate.before, getElement(store, candidate.before.id))) return false;
  store.getState().updateElement(
    candidate.before.id,
    backgroundRemovalPatch({ asset: candidate.asset, output, fit })
  );
  store.getState().pushHistory('Remove background');
  return true;
};

export const aiUpscale = async ({ fetch, store, elementId }: AiActionArgs, scale: number): Promise<void> => {
  const src = getSrc(store, elementId);
  if (!src) throw new Error('No image');
  const res = await fetch('/media/upscale', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl: src, scale }),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, 'Upscale failed'));
  const data = await res.json();
  store.getState().updateElement(elementId, { src: data.url, fileId: undefined });
};

export const aiDetectSubject = async ({ fetch, store, elementId }: AiActionArgs): Promise<void> => {
  const src = getSrc(store, elementId);
  if (!src) throw new Error('No image');
  const fp = await detectFocalPoint(src, fetch);
  store.getState().updateElement(elementId, { focalPoint: fp });
};

export const aiOutpaint = async (
  { fetch, store, elementId }: AiActionArgs,
  mode: OutpaintMode,
  prompt?: string,
): Promise<void> => {
  const src = getSrc(store, elementId);
  if (!src) throw new Error('No image');
  const res = await fetch('/media/outpaint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl: src, mode, ...(prompt?.trim() ? { prompt: prompt.trim() } : {}) }),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, 'Image expansion failed'));
  const data = await res.json();
  // The result is a NEW, larger image: a stale crop window would cut into the
  // expanded area and a stale originalSrc would let a smart-filter re-bake
  // silently revert the expansion — both must go (unlike the bg-remove/upscale
  // updates above, which keep that defect). The result lives at a provider /
  // job artifact URL, not in the Files library, so fileId clears too.
  const natural = await probeImageNaturalSize(data.url);
  store.getState().updateElement(elementId, {
    src: data.url,
    fileId: undefined,
    crop: undefined,
    originalSrc: undefined,
    naturalWidth: natural?.width,
    naturalHeight: natural?.height,
  });
};
