'use client';

import { detectFocalPoint } from './reflow';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type StoreApi = ReturnType<typeof import('./designer.store').createDesignerStore>;

interface AiActionArgs {
  fetch: FetchLike;
  store: StoreApi;
  elementId: string;
}

const getSrc = (store: StoreApi, elementId: string): string | undefined => {
  const st = store.getState();
  const out = st.doc.outputs[st.currentOutput] as any;
  const el = out?.children?.find((c: any) => c.id === elementId);
  return el?.src;
};

// Shared by the inspector AI Tools and the Tools menu so the implementation
// lives in exactly one place (D-10).
export const aiRemoveBackground = async ({ fetch, store, elementId }: AiActionArgs): Promise<void> => {
  const src = getSrc(store, elementId);
  if (!src) throw new Error('No image');
  const res = await fetch('/media/remove-background', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl: src }),
  });
  if (!res.ok) throw new Error('Failed');
  const data = await res.json();
  store.getState().updateElement(elementId, { src: data.url, fileId: undefined });
};

export const aiUpscale = async ({ fetch, store, elementId }: AiActionArgs, scale: number): Promise<void> => {
  const src = getSrc(store, elementId);
  if (!src) throw new Error('No image');
  const res = await fetch('/media/upscale', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl: src, scale }),
  });
  if (!res.ok) throw new Error('Failed');
  const data = await res.json();
  store.getState().updateElement(elementId, { src: data.url, fileId: undefined });
};

export const aiDetectSubject = async ({ fetch, store, elementId }: AiActionArgs): Promise<void> => {
  const src = getSrc(store, elementId);
  if (!src) throw new Error('No image');
  const fp = await detectFocalPoint(src, fetch);
  store.getState().updateElement(elementId, { focalPoint: fp });
};
