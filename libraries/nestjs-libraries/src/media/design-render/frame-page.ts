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

  walkFontUsage(output, note);
  return used;
};

/** Every family named anywhere in the composition, catalog or not. */
export const fontFamiliesUsedInOutput = (output: unknown): Set<string> => {
  const families = new Set<string>();
  walkFontUsage(output, (family) => {
    if (typeof family === 'string' && family) families.add(family);
  });
  return families;
};

const walkFontUsage = (
  output: unknown,
  note: (family?: unknown, weight?: unknown) => void,
): void => {
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
};

/** An org-uploaded font the frame page can load straight from its storage URL. */
export interface FrameCustomFont {
  family: string;
  path: string;
  weights?: number[];
  italic?: boolean;
}

/**
 * Neutralize a value before it lands inside a CSS string in a `<style>` block:
 * quotes, backslashes, angle brackets and newlines are how a family name or
 * storage path would break out of the rule (or the block) into markup.
 */
const cssStringSafe = (value: string): string =>
  value.replace(/["'\\<>\n\r]/g, '');

/**
 * `<link>` tags for the catalog families a composition uses, plus `@font-face`
 * rules for the org's custom uploads it uses (or '' when it uses neither).
 *
 * The frame page runs in Chromium, which loads WOFF2 as happily as TTF/OTF —
 * the server-side WOFF2 limitation (node-canvas, outline extraction) does not
 * apply here, so custom fonts are injected whatever their format. The faces
 * load lazily on first use, so `buildFramePage` also emits explicit
 * `document.fonts.load()` calls (`fontPreloadsForOutput`) and awaits them
 * before announcing the frame API — no frame paints in a fallback face.
 */
export const fontLinksForOutput = (
  output: unknown,
  customFonts: FrameCustomFont[] = [],
): string => {
  const links = [...fontsUsedInOutput(output).entries()]
    .map(([family, weights]) => {
      const resolved = catalogWeights(family, [...weights]);
      if (!resolved.length) return '';
      const href = googleFontsUrl(family, resolved);
      return `<link rel="stylesheet" href="${href.replace(/"/g, '&quot;')}">`;
    })
    .filter(Boolean)
    .join('');

  const usedFamilies = fontFamiliesUsedInOutput(output);
  const faces = customFonts
    .filter((f) => f && typeof f.family === 'string' && typeof f.path === 'string' && usedFamilies.has(f.family))
    .flatMap((f) => {
      const family = cssStringSafe(f.family);
      const src = cssStringSafe(f.path);
      if (!family || !src) return [];
      const weights = f.weights?.length ? f.weights : [400];
      const style = f.italic ? 'italic' : 'normal';
      return weights.map(
        (weight) =>
          `@font-face{font-family:"${family}";src:url("${src}");font-weight:${weight};font-style:${style};font-display:swap;}`,
      );
    });

  return faces.length ? `${links}<style>${faces.join('')}</style>` : links;
};

/**
 * `document.fonts.load()` spec strings for every face the composition paints
 * with. `document.fonts.ready` alone is NOT enough to keep the first frame
 * honest: @font-face rules load lazily on first USE, and the frame renderer's
 * first use is a canvas `fillText` during frame 1 — so without an explicit
 * load the opening frame(s) paint in the fallback face and the real font pops
 * in mid-video (seen in prod as a serif first frame under an Anton title).
 */
export const fontPreloadsForOutput = (
  output: unknown,
  customFonts: FrameCustomFont[] = [],
): string[] => {
  const specs: string[] = [];
  const push = (family: string, weight: unknown, italic = false): void => {
    const safeFamily = cssStringSafe(family);
    const w = typeof weight === 'number' && Number.isFinite(weight) ? Math.round(weight) : 400;
    if (!safeFamily) return;
    specs.push(`${italic ? 'italic ' : ''}${w} 16px "${safeFamily}"`);
  };
  for (const [family, weights] of fontsUsedInOutput(output)) {
    for (const weight of catalogWeights(family, [...weights])) {
      push(family, weight);
    }
  }
  const usedFamilies = fontFamiliesUsedInOutput(output);
  for (const f of customFonts) {
    if (!f || typeof f.family !== 'string' || !usedFamilies.has(f.family)) continue;
    for (const weight of f.weights?.length ? f.weights : [400]) {
      push(f.family, weight, f.italic);
    }
  }
  return specs;
};

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
  /** Font `<link>`/`<style>` tags — pass `fontLinksForOutput(output, customFonts)`. */
  fontLinks: string;
  /** `document.fonts.load()` specs — pass `fontPreloadsForOutput(output, customFonts)`. */
  fontPreloads?: string[];
}

/**
 * Build the page.
 *
 * Every used face is explicitly `document.fonts.load()`ed and
 * `document.fonts.ready` is awaited before `__FRAME_API` is announced, which
 * is what the capture loop waits on — so no frame can be drawn in a fallback
 * face that the next frame draws correctly, which would have been visible as
 * a font POP mid-video.
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
      // Explicit loads FIRST: the <link>/@font-face faces load lazily on first
      // use, and document.fonts.ready resolves while they are still unloaded —
      // the first canvas fillText would otherwise paint a fallback face and
      // the real font would pop in a few frames later.
      var fontSpecs = ${JSON.stringify(options.fontPreloads ?? [])};
      var loads = (document.fonts && document.fonts.load)
        ? fontSpecs.map(function (spec) { return document.fonts.load(spec).catch(function () {}); })
        : [];
      var ready = (document.fonts && document.fonts.ready) || Promise.resolve();
      Promise.all(loads).catch(function () {}).then(function () { return ready; }).catch(function () {}).then(function () {
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
