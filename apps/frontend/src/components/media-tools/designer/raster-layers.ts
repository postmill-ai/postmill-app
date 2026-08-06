import type {
  DesignerDoc,
  DesignerElement,
  DesignerOutput,
  VideoOutput,
} from './designer.store';

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
 *
 * Undo/redo is the DOCUMENT's job, not this module's: every stroke commits and
 * lands in doc history, so a history jump restores the matching `src` and
 * `reconcileBuffersWithDoc` re-seeds any buffer whose pixels no longer match.
 * A separate pixel-level undo stack used to live here, but nothing could
 * replay it in step with doc history — it was dead code holding up to 20
 * ImageData per layer hostage.
 */

/** Live buffers keyed by element id. */
const buffers = new Map<string, HTMLCanvasElement>();
/** The `src` each buffer was last uploaded as — history restore's staleness check. */
const committedSrcs = new Map<string, string>();
/**
 * Monotonic token per buffer key, bumped whenever the buffer is invalidated,
 * so a late image load from a re-seed can't overwrite newer pixels.
 */
const reseedTokens = new Map<string, number>();

const bumpReseedToken = (key: string): number => {
  const next = (reseedTokens.get(key) ?? 0) + 1;
  reseedTokens.set(key, next);
  return next;
};

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
  // A fresh canvas means new ownership of the key — a re-seed still in flight
  // from a history restore must not overwrite what is about to be painted.
  bumpReseedToken(el.id);
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
  bumpReseedToken(id);
  // Seeded pixels have not been uploaded under any `src` yet.
  committedSrcs.delete(id);
  buffers.set(id, canvas);
  return canvas;
};

export const disposeBuffer = (id: string): void => {
  bumpReseedToken(id);
  buffers.delete(id);
  committedSrcs.delete(id);
};

/** Drop an element's own buffer and its mask's, e.g. when it is deleted. */
export const disposeElementBuffers = (id: string): void => {
  disposeBuffer(id);
  disposeBuffer(`${id}:mask`);
};

/** Drop every buffer — a design reset or load makes them all stale. */
export const disposeAllBuffers = (): void => {
  // Bump first so re-seeds still in flight are discarded when they land.
  for (const key of new Set([...buffers.keys(), ...reseedTokens.keys()])) {
    bumpReseedToken(key);
  }
  buffers.clear();
  committedSrcs.clear();
};

/** A surface the document says should have a live buffer, keyed as buffers are. */
interface PaintSurface {
  key: string;
  src?: string;
  width: number;
  height: number;
}

const collectSurfaces = (doc: DesignerDoc): PaintSurface[] => {
  const surfaces: PaintSurface[] = [];
  for (const out of doc.outputs) {
    for (const el of (out as DesignerOutput).children || []) {
      if (el.type === 'raster') {
        surfaces.push({ key: el.id, src: el.src, width: el.width, height: el.height });
      }
      if (el.maskSrc) {
        surfaces.push({
          key: `${el.id}:mask`,
          src: el.maskSrc,
          width: el.width,
          height: el.height,
        });
      }
    }
    for (const track of (out as VideoOutput).tracks || []) {
      if (track.type !== 'raster') continue;
      for (const clip of track.clips) {
        surfaces.push({
          key: clip.id,
          src: clip.src,
          width: clip.width ?? out.width,
          height: clip.height ?? out.height,
        });
      }
    }
  }
  return surfaces;
};

/**
 * Re-seed a buffer from the `src` history restored. The old buffer comes down
 * synchronously — the renderer falls back to drawing `src` directly while the
 * image loads, so undo is visually immediate.
 */
const reseedFromSrc = (surface: PaintSurface): void => {
  const { key, src, width, height } = surface;
  buffers.delete(key);
  const token = bumpReseedToken(key);
  if (!src) {
    committedSrcs.delete(key);
    return;
  }
  // Claim the target `src` NOW, not when the image lands. The claim is what a
  // second history jump compares against — without it, redo arriving while
  // undo's re-seed was still loading found no buffer, skipped the key, and
  // the stale pre-stroke bitmap then seeded itself over the redone document.
  // Since the canvas prefers the live buffer to `src`, the stroke silently
  // vanished from view on every quick undo-then-redo.
  committedSrcs.set(key, src);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    // A stroke or a newer restore since means this load is stale.
    if (reseedTokens.get(key) !== token) return;
    seedBufferFromImage(key, img, width, height);
    // `seedBufferFromImage` clears the committed src (seeded pixels normally
    // predate any upload); these pixels ARE `src`, so restate the claim.
    committedSrcs.set(key, src);
  };
  img.onerror = () => {
    // Leave the buffer disposed — the element still renders from `src`. The
    // claim comes back off so a later jump to this same src retries the load.
    if (reseedTokens.get(key) === token) committedSrcs.delete(key);
  };
  img.src = src;
};

/**
 * Bring the live buffers back in line with a document restored by history
 * (undo/redo/jumpToHistory).
 *
 * Buffers whose layer no longer exists are disposed, and buffers whose `src`
 * changed under them are re-seeded from the restored `src`. A buffer whose
 * committed `src` still matches the document's is left alone — most history
 * jumps never touched pixels, and reloading a 1080² bitmap per jump would be
 * waste.
 */
export const reconcileBuffersWithDoc = (doc: DesignerDoc): void => {
  const surfaces = collectSurfaces(doc);
  const live = new Set(surfaces.map((s) => s.key));
  for (const key of [...buffers.keys()]) {
    // `${id}:smart` belongs to a bake that may be mid-flight; smart-filters
    // disposes it itself once the upload completes.
    if (!live.has(key) && !key.endsWith(':smart')) disposeBuffer(key);
  }
  for (const surface of surfaces) {
    // Tracked = a live buffer, or a re-seed in flight (claimed but not yet
    // landed). A layer that was never painted this session is neither, and
    // renders straight from `src` — no buffer needed.
    if (!buffers.has(surface.key) && !committedSrcs.has(surface.key)) continue;
    if (committedSrcs.get(surface.key) === surface.src) continue;
    reseedFromSrc(surface);
  }
};

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
  // From here the buffer and the document agree — until the next stroke.
  committedSrcs.set(id, src);
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
