import type { DesignerElement } from './designer.store';

/**
 * Client-side pixel buffers for `raster` elements.
 *
 * A raster element is a bitmap in the document, referenced by `src`/`fileId`
 * exactly like an image — which is why the server renderer needs no changes to
 * composite painted work into PDF and video output. This module owns the
 * editable buffer that lives in front of that bitmap while you paint.
 *
 * The lifecycle is deliberately explicit:
 *   paint  → mutate the offscreen canvas, mark dirty
 *   commit → toBlob → /files/upload-simple → {src, fileId} on the element
 *
 * `SrcSchema` caps `src` at 2048 characters, so an inline data URL is not an
 * option — the upload is mandatory, not an optimisation.
 */

/** Live buffers keyed by element id. */
const buffers = new Map<string, HTMLCanvasElement>();
/** Undo snapshots per element, most recent last. */
const undoStacks = new Map<string, ImageData[]>();

/** How many pixel-level undo steps to keep per layer. */
export const MAX_RASTER_UNDO = 20;

export const getBuffer = (id: string): HTMLCanvasElement | undefined =>
  buffers.get(id);

/**
 * Ensure a buffer exists for an element, sized to its box. Existing content is
 * preserved (and rescaled) when the box changes so resizing a painted layer
 * doesn't wipe it.
 */
export const ensureBuffer = (
  el: Pick<DesignerElement, 'id' | 'width' | 'height'>
): HTMLCanvasElement => {
  const w = Math.max(1, Math.round(el.width));
  const h = Math.max(1, Math.round(el.height));
  const existing = buffers.get(el.id);

  if (existing && existing.width === w && existing.height === h) return existing;

  const next = document.createElement('canvas');
  next.width = w;
  next.height = h;
  if (existing) {
    const ctx = next.getContext('2d');
    ctx?.drawImage(existing, 0, 0, existing.width, existing.height, 0, 0, w, h);
  }
  buffers.set(el.id, next);
  return next;
};

/** Seed a buffer from an already-uploaded bitmap (reopening a saved design). */
export const seedBufferFromImage = (
  id: string,
  image: HTMLImageElement,
  width: number,
  height: number
): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
  buffers.set(id, canvas);
  return canvas;
};

export const disposeBuffer = (id: string): void => {
  buffers.delete(id);
  undoStacks.delete(id);
};

/**
 * Snapshot a region before a stroke mutates it.
 *
 * Deliberately a dirty RECT rather than the whole canvas: a full 4096² snapshot
 * is 64 MB per undo step, which a 20-deep stack turns into gigabytes.
 */
export const pushUndoRegion = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number
): void => {
  const canvas = buffers.get(id);
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;

  const sx = Math.max(0, Math.floor(x));
  const sy = Math.max(0, Math.floor(y));
  const sw = Math.min(canvas.width - sx, Math.ceil(width));
  const sh = Math.min(canvas.height - sy, Math.ceil(height));
  if (sw <= 0 || sh <= 0) return;

  const stack = undoStacks.get(id) || [];
  const data = ctx.getImageData(sx, sy, sw, sh);
  // Stash the origin on the ImageData so undo knows where to put it back.
  (data as ImageData & { _x?: number; _y?: number })._x = sx;
  (data as ImageData & { _x?: number; _y?: number })._y = sy;
  stack.push(data);
  while (stack.length > MAX_RASTER_UNDO) stack.shift();
  undoStacks.set(id, stack);
};

/** Restore the most recent snapshot. Returns false when the stack is empty. */
export const popUndoRegion = (id: string): boolean => {
  const stack = undoStacks.get(id);
  const canvas = buffers.get(id);
  const ctx = canvas?.getContext('2d');
  if (!stack?.length || !ctx) return false;
  const data = stack.pop() as ImageData & { _x?: number; _y?: number };
  ctx.putImageData(data, data._x ?? 0, data._y ?? 0);
  return true;
};

export const hasUndo = (id: string): boolean => !!undoStacks.get(id)?.length;

/** Upload endpoint switch — mirrors export-dialog's uploadBlob. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface CommitResult {
  src: string;
  fileId?: string;
}

/**
 * Flatten a buffer to a PNG and upload it, returning the `src`/`fileId` to
 * store on the element. Uses the same endpoints as the inpaint-mask upload and
 * the exporter, so painted layers travel the proven path.
 */
export const commitBuffer = async (
  id: string,
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>
): Promise<CommitResult | null> => {
  const canvas = buffers.get(id);
  if (!canvas) return null;

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png')
  );
  if (!blob) return null;

  const formData = new FormData();
  formData.append('file', blob, `paint-${id}.png`);
  const endpoint =
    blob.size > MAX_UPLOAD_BYTES ? '/files/upload-server' : '/files/upload-simple';

  const res = await fetchFn(endpoint, { method: 'POST', body: formData });
  if (!res.ok) return null;
  const data = await res.json();
  const src = data.path || data.url;
  if (!src) return null;
  return { src, fileId: data.id };
};

/** A blank raster element sized to the current output. */
export const buildRasterElement = (
  width: number,
  height: number,
  name = 'Paint layer'
): DesignerElement => ({
  id: '',
  type: 'raster',
  x: 0,
  y: 0,
  width: Math.max(1, Math.round(width)),
  height: Math.max(1, Math.round(height)),
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  name,
  naturalWidth: Math.max(1, Math.round(width)),
  naturalHeight: Math.max(1, Math.round(height)),
});
