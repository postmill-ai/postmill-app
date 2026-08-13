import type { DesignerElement, DesignerOutput } from '../designer.store';
import { sharedStageRef } from '../stage-ref';

/**
 * Small preview images for the layers panel.
 *
 * Rendered by cropping the live Konva stage to the layer's bounds, which is far
 * cheaper than re-rendering each layer standalone and always matches what is on
 * screen. Results are cached and only recomputed when the layer's geometry or
 * content actually changes.
 */

const THUMB_MAX = 40;

const cache = new Map<string, { key: string; url: string }>();

/**
 * Cap on cached thumbnails. The map is module-level and keyed by element id, so
 * without a bound it accumulates every layer of every design opened in the tab.
 * Oldest-first eviction, which is insertion order for a Map.
 */
const MAX_CACHED_THUMBS = 400;

const remember = (id: string, entry: { key: string; url: string }): void => {
  cache.set(id, entry);
  while (cache.size > MAX_CACHED_THUMBS) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
};

/**
 * Cache key — everything that would visibly change the thumbnail. Deliberately
 * NOT the whole element: `selected`/`collapsed` churn would blow the cache on
 * every click.
 */
const thumbKey = (el: DesignerElement): string =>
  JSON.stringify([
    el.x, el.y, el.width, el.height, el.rotation, el.opacity, el.hidden,
    el.src, el.fill, el.text, el.fontSize, el.shape, el.blendMode,
    el.fillStyle, el.adjustment, el.styles?.length, el.nodes?.length,
  ]);

/**
 * A data-URL thumbnail for a layer, or null when one can't be produced (no
 * stage yet, a zero-size layer, or a tainted canvas).
 */
export const layerThumbnail = (
  el: DesignerElement,
  output: DesignerOutput | undefined
): string | null => {
  // Groups and adjustments have no standalone pixels of their own.
  if (el.type === 'group' || el.type === 'adjustment') return null;

  const key = thumbKey(el);
  const hit = cache.get(el.id);
  if (hit && hit.key === key) return hit.url;

  const stage = sharedStageRef.current;
  if (!stage || !output) return null;
  if (!(el.width > 0) || !(el.height > 0)) return null;

  try {
    // Inside the try: element ids come from stored documents, and a selector
    // Konva can't parse throws rather than simply missing.
    const node = stage.findOne('#' + el.id);
    if (!node) return null;

    const scale = Math.min(THUMB_MAX / el.width, THUMB_MAX / el.height, 1);
    const url = node.toDataURL({
      pixelRatio: scale,
      // Konva measures in stage space; the node already carries its transform.
      mimeType: 'image/png',
    } as never);
    remember(el.id, { key, url });
    return url;
  } catch {
    // Tainted canvas (a cross-origin image without CORS) — fall back to the
    // type glyph rather than throwing inside a render.
    return null;
  }
};

/** Drop a layer's cached thumbnail, e.g. when it is deleted. */
export const forgetThumbnail = (id: string): void => {
  cache.delete(id);
};
