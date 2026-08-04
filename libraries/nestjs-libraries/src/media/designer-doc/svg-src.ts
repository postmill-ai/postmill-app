/**
 * Icon `src` contract.
 *
 * The Designer's icons panel stores the raw SVG *body* (inner markup on a
 * 24×24 viewBox) in `src`, and the client `IconNode` wraps it in an `<svg>`
 * element with the element's `fill` baked in before rasterising. That made a
 * hand-added icon fail strict validation (`SrcSchema` required a data: or
 * http(s) URL) and fail the server render outright (`loadImageSafe` can only
 * load URLs) — which is why the AI composer could not emit `icon` elements at
 * all.
 *
 * The contract is now: an `icon` element's `src` may be a data:/http(s) URL
 * OR raw SVG markup. These two helpers are the single place that knows the
 * difference and how a raw body becomes a loadable URL.
 */

/** True when `src` is raw SVG markup rather than a URL. */
export const isSvgMarkupSrc = (src: string): boolean =>
  src.trimStart().startsWith('<');

/**
 * Wrap a raw SVG body as a loadable data URL. Mirrors the client `IconNode`
 * (elements.tsx) exactly: 24×24 viewBox, `fill` baked in, URL-encoded rather
 * than base64 because btoa throws on non-Latin-1 glyphs.
 */
export const wrapIconSvgDataUrl = (
  body: string,
  width: number,
  height: number,
  fill?: string
): string => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ` +
    `width="${width}" height="${height}" fill="${fill || '#000000'}">${body}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

/**
 * The `src` a renderer should load for an element: icon elements carrying a
 * raw SVG body are wrapped; everything else passes through unchanged.
 */
export const renderableSrc = (el: {
  type: string;
  src?: string;
  width: number;
  height: number;
  fill?: string;
}): string | undefined =>
  el.src && el.type === 'icon' && isSvgMarkupSrc(el.src)
    ? wrapIconSvgDataUrl(el.src, el.width, el.height, el.fill)
    : el.src;
