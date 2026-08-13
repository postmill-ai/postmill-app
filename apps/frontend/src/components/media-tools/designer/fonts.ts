/**
 * Fonts for the Designer.
 *
 * `DESIGNER_FONTS` is now the RECOMMENDED shortlist, not the whole world: every
 * family Google serves is reachable through `GOOGLE_FONTS`
 * (`designer-doc/font-catalog`), and stylesheets are injected per family the
 * first time one is used.
 *
 * That replaced a single 2,000-character `@import` in `global.scss` which
 * carried every family on every page load, Designer or not, and which had run
 * out of room to grow.
 *
 * Leaf utility — no React, no side effects on import. `ensureFontLoaded` is the
 * runtime hook the FontPicker / canvas renderer call before drawing text.
 */

import {
  catalogWeights,
  googleFontsUrl,
  isCatalogFamily,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/font-catalog';

export interface DesignerFont {
  family: string;
  label: string;
  weights: number[];
  category: 'sans-serif' | 'serif' | 'display' | 'monospace';
}

export const DESIGNER_FONTS: DesignerFont[] = [
  { family: 'Arial', label: 'Arial (system)', weights: [400, 700], category: 'sans-serif' },

  // Sans-serif
  { family: 'Inter', label: 'Inter', weights: [300, 400, 500, 600, 700], category: 'sans-serif' },
  { family: 'Roboto', label: 'Roboto', weights: [300, 400, 500, 700], category: 'sans-serif' },
  { family: 'Open Sans', label: 'Open Sans', weights: [300, 400, 500, 600, 700, 800], category: 'sans-serif' },
  { family: 'Montserrat', label: 'Montserrat', weights: [300, 400, 500, 600, 700, 800, 900], category: 'sans-serif' },
  { family: 'Poppins', label: 'Poppins', weights: [300, 400, 500, 600, 700], category: 'sans-serif' },
  { family: 'Lato', label: 'Lato', weights: [300, 400, 700, 900], category: 'sans-serif' },
  { family: 'Raleway', label: 'Raleway', weights: [300, 400, 500, 600, 700, 800], category: 'sans-serif' },
  { family: 'Nunito', label: 'Nunito', weights: [300, 400, 500, 600, 700, 800, 900], category: 'sans-serif' },
  { family: 'Nunito Sans', label: 'Nunito Sans', weights: [300, 400, 500, 600, 700, 800, 900], category: 'sans-serif' },
  { family: 'Source Sans 3', label: 'Source Sans 3', weights: [300, 400, 500, 600, 700], category: 'sans-serif' },
  { family: 'Figtree', label: 'Figtree', weights: [300, 400, 500, 600, 700, 800], category: 'sans-serif' },
  { family: 'Plus Jakarta Sans', label: 'Plus Jakarta Sans', weights: [300, 400, 500, 600, 700, 800], category: 'sans-serif' },
  { family: 'DM Sans', label: 'DM Sans', weights: [400, 500, 700], category: 'sans-serif' },
  { family: 'Manrope', label: 'Manrope', weights: [300, 400, 500, 600, 700, 800], category: 'sans-serif' },
  { family: 'Be Vietnam Pro', label: 'Be Vietnam Pro', weights: [300, 400, 500, 600, 700, 800], category: 'sans-serif' },
  { family: 'Lexend', label: 'Lexend', weights: [300, 400, 500, 600, 700], category: 'sans-serif' },

  // Condensed — the catalog had none, so a poster lockup that wanted narrow
  // type could only be faked with negative tracking. See `textScaleX` for the
  // cases these still don't cover.
  { family: 'Roboto Condensed', label: 'Roboto Condensed', weights: [200, 300, 400, 500, 600, 700], category: 'sans-serif' },
  { family: 'Archivo Narrow', label: 'Archivo Narrow', weights: [400, 500, 600, 700], category: 'sans-serif' },
  { family: 'Barlow Condensed', label: 'Barlow Condensed', weights: [100, 200, 300, 400, 500, 600, 700], category: 'sans-serif' },

  // Serif
  { family: 'Merriweather', label: 'Merriweather', weights: [300, 400, 700, 900], category: 'serif' },
  { family: 'Playfair Display', label: 'Playfair Display', weights: [400, 500, 600, 700, 800, 900], category: 'serif' },
  { family: 'Lora', label: 'Lora', weights: [400, 500, 600, 700], category: 'serif' },
  { family: 'Source Serif 4', label: 'Source Serif 4', weights: [300, 400, 500, 600, 700], category: 'serif' },
  { family: 'Libre Baskerville', label: 'Libre Baskerville', weights: [400, 700], category: 'serif' },
  { family: 'Crimson Text', label: 'Crimson Text', weights: [400, 600, 700], category: 'serif' },
  { family: 'Cormorant Garamond', label: 'Cormorant Garamond', weights: [300, 400, 500, 600, 700], category: 'serif' },
  { family: 'Noto Serif', label: 'Noto Serif', weights: [400, 700], category: 'serif' },
  { family: 'Zilla Slab', label: 'Zilla Slab', weights: [300, 400, 500, 600, 700], category: 'serif' },
  // High-contrast Didones — the narrow end of the serif range.
  { family: 'Bodoni Moda', label: 'Bodoni Moda', weights: [400, 500, 600, 700, 800, 900], category: 'serif' },
  { family: 'Prata', label: 'Prata', weights: [400], category: 'serif' },

  // Display
  { family: 'Bebas Neue', label: 'Bebas Neue', weights: [400], category: 'display' },
  { family: 'Oswald', label: 'Oswald', weights: [300, 400, 500, 600, 700], category: 'display' },
  { family: 'Anton', label: 'Anton', weights: [400], category: 'display' },
  { family: 'Abril Fatface', label: 'Abril Fatface', weights: [400], category: 'display' },
  { family: 'Lobster', label: 'Lobster', weights: [400], category: 'display' },
  { family: 'Pacifico', label: 'Pacifico', weights: [400], category: 'display' },
  { family: 'Righteous', label: 'Righteous', weights: [400], category: 'display' },
  { family: 'Permanent Marker', label: 'Permanent Marker', weights: [400], category: 'display' },
  { family: 'Caveat', label: 'Caveat', weights: [400, 500, 600, 700], category: 'display' },
  { family: 'Shadows Into Light', label: 'Shadows Into Light', weights: [400], category: 'display' },
  { family: 'Dancing Script', label: 'Dancing Script', weights: [400, 500, 600, 700], category: 'display' },
  { family: 'Great Vibes', label: 'Great Vibes', weights: [400], category: 'display' },
  { family: 'Fjalla One', label: 'Fjalla One', weights: [400], category: 'display' },
  { family: 'Rozha One', label: 'Rozha One', weights: [400], category: 'display' },

  // Monospace
  { family: 'JetBrains Mono', label: 'JetBrains Mono', weights: [300, 400, 500, 600, 700, 800], category: 'monospace' },
  { family: 'Fira Code', label: 'Fira Code', weights: [300, 400, 500, 600, 700], category: 'monospace' },
  { family: 'Source Code Pro', label: 'Source Code Pro', weights: [300, 400, 500, 600, 700], category: 'monospace' },
  { family: 'IBM Plex Mono', label: 'IBM Plex Mono', weights: [300, 400, 500, 600, 700], category: 'monospace' },
  { family: 'Space Mono', label: 'Space Mono', weights: [400, 700], category: 'monospace' },
  { family: 'Courier Prime', label: 'Courier Prime', weights: [400, 700], category: 'monospace' },
];

export const SYSTEM_FONT_FAMILY = 'Arial';

export const FONT_FAMILIES: string[] = DESIGNER_FONTS.map((f) => f.family);

const SYSTEM_FAMILIES = new Set<string>([SYSTEM_FONT_FAMILY, 'Helvetica', 'Helvetica Neue']);

/**
 * Which weights of each family already have a stylesheet.
 *
 * Per WEIGHT, not per family: the picker previews a face at one weight, and a
 * family-only guard would then block the heavier cut the document actually
 * uses from ever loading.
 */
const injected = new Map<string, Set<number>>();

/**
 * Weights Konva itself can paint.
 *
 * The canvas has no numeric weight — `fontStyle` is `normal` or `bold` — so
 * whatever a text element is authored at, what gets drawn resolves to 400 or
 * 700. Requesting only the authored weights left the family without the cut it
 * would actually be rendered in, and the canvas quietly fell back.
 */
const RENDERED_WEIGHTS = [400, 700];

/**
 * Add the stylesheet for one family, once per weight.
 *
 * A `<link>` per family rather than one giant `@import`: the old single request
 * blocked render on every page and could not grow past its URL length, and a
 * user picking one display face had no reason to download forty others.
 */
const injectStylesheet = (family: string, weights: number[]): void => {
  if (typeof document === 'undefined') return;
  if (!isCatalogFamily(family)) return;

  const have = injected.get(family) ?? new Set<number>();
  const missing = weights.filter((w) => !have.has(w));
  if (!missing.length) return;
  missing.forEach((w) => have.add(w));
  injected.set(family, have);

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = googleFontsUrl(family, missing);
  link.dataset.designerFont = family;
  document.head.appendChild(link);
};

export async function ensureFontLoaded(
  family: string,
  weights?: number[]
): Promise<void> {
  if (!family || SYSTEM_FAMILIES.has(family)) {
    return;
  }
  if (typeof document === 'undefined' || !('fonts' in document)) {
    return;
  }
  // Authored weights matter to the server renderer, which registers them
  // individually; 400/700 matter to the canvas, which is what actually paints.
  // Both, narrowed to what the family really has.
  const wanted = catalogWeights(family, [
    ...(weights?.length ? weights : []),
    ...RENDERED_WEIGHTS,
  ]);
  injectStylesheet(family, wanted);
  try {
    // `document.fonts` resolves per face, so loading one weight would leave a
    // 700 headline measuring against the 400 cut.
    await Promise.all(
      wanted.map((weight) => document.fonts.load(`${weight} 16px "${family}"`))
    );
    await document.fonts.ready;
  } catch {
  }
}

/**
 * Warm a whole document's fonts, weights included.
 *
 * Callers pass `family` alone or `family@weight` pairs; the weights matter
 * because a face is loaded per weight and a 700 headline measured against the
 * 400 cut wraps differently.
 */
export async function ensureFontsUsed(
  used: Map<string, Set<number>>
): Promise<void> {
  await Promise.all(
    [...used.entries()].map(([family, weights]) =>
      ensureFontLoaded(family, [...weights])
    )
  );
}

export async function ensureFontsLoaded(families: string[]): Promise<void> {
  await Promise.all(families.map((family) => ensureFontLoaded(family)));
}
