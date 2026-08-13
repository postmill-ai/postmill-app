/**
 * The Chromium page that renders video frames.
 *
 * It existed twice, hand-copied — once in `chromium-frame-capture.service` for
 * headless capture and once in `design.controller` for the live preview route —
 * so a fix to one silently skipped the other. This is the single builder.
 *
 * The load-bearing bit it was missing: **the page loaded no fonts at all.**
 * Nothing injected a stylesheet and nothing waited for one, so every caption in
 * every rendered video came out in Chromium's default sans however carefully the
 * font was chosen — and the family was interpolated into the canvas font
 * shorthand unquoted, so a multi-word family ("Bebas Neue") would have failed
 * even once fonts were available.
 */

import {
  catalogWeights,
  googleFontsUrl,
  isCatalogFamily,
} from '../designer-doc/font-catalog';

/** Every `family -> weights` pair a composition actually paints with. */
export const fontsUsedInOutput = (output: unknown): Map<string, Set<number>> => {
  const used = new Map<string, Set<number>>();

  const note = (family?: unknown, weight?: unknown): void => {
    if (typeof family !== 'string' || !family) return;
    // The family goes into a stylesheet URL; the catalog is the allowlist.
    if (!isCatalogFamily(family)) return;
    if (!used.has(family)) used.set(family, new Set());
    used.get(family)!.add(typeof weight === 'number' ? weight : 400);
  };

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const rec = node as Record<string, unknown>;
    note(rec.fontFamily, rec.fontWeight);
    for (const value of Object.values(rec)) {
      if (value && typeof value === 'object') walk(value);
    }
  };

  walk(output);
  return used;
};

/** `<link>` tags for the families a composition uses, or '' when it uses none. */
export const fontLinksForOutput = (output: unknown): string =>
  [...fontsUsedInOutput(output).entries()]
    .map(([family, weights]) => {
      const resolved = catalogWeights(family, [...weights]);
      if (!resolved.length) return '';
      const href = googleFontsUrl(family, resolved);
      return `<link rel="stylesheet" href="${href.replace(/"/g, '&quot;')}">`;
    })
    .filter(Boolean)
    .join('');

export interface FramePageOptions {
  /** The composition, already escaped for a script tag. */
  outputLiteral: string;
  /** The base URL, already escaped for a script tag. */
  baseUrlLiteral: string;
  /** Raw base URL for the document's `<base href>`. */
  baseUrl: string;
  /** The frame renderer source. */
  script: string;
  /** Preload and draw this frame as soon as the page is ready (preview route). */
  initialFrame?: number;
  /** Font `<link>` tags — pass `fontLinksForOutput(output)`. */
  fontLinks: string;
}

/**
 * Build the page.
 *
 * `document.fonts.ready` is awaited before `__FRAME_API` is announced, which is
 * what the capture loop waits on — so no frame can be drawn in a fallback face
 * that the next frame draws correctly, which would have been visible as a font
 * POP mid-video.
 */
export const buildFramePage = (options: FramePageOptions): string => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <base href="${options.baseUrl.replace(/"/g, '&quot;')}">
  ${options.fontLinks}
  <style>body{margin:0;background:#000}</style>
</head>
<body>
  <canvas id="frame-canvas"></canvas>
  <script>
    window.__DATA = {
      output: ${options.outputLiteral},
      baseUrl: ${options.baseUrlLiteral}
    };
    ${options.script}
    (function () {
      var api = window.__FRAME_API;
      // Announce the API only once the faces are in, so the capture loop can
      // never start on a frame rendered in a fallback font.
      window.__FRAME_API = undefined;
      var ready = (document.fonts && document.fonts.ready) || Promise.resolve();
      ready.catch(function () {}).then(function () {
        window.__FRAME_API = api;
        ${
          options.initialFrame != null
            ? `api.preload().then(function () { api.renderFrame(${options.initialFrame}); });`
            : ''
        }
      });
    })();
  </script>
</body>
</html>`;
