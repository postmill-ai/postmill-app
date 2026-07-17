/**
 * Curated set of open-licensed (SIL OFL) font families for the Designer.
 *
 * The corresponding @font-face / @import declarations live in
 * `apps/frontend/src/app/global.scss` (see the "Designer fonts" block).
 *
 * Leaf utility — no React, no side effects on import. `ensureFontLoaded` is the
 * runtime hook the FontPicker / canvas renderer call before drawing text.
 */

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

  // Serif
  { family: 'Merriweather', label: 'Merriweather', weights: [300, 400, 700, 900], category: 'serif' },
  { family: 'Playfair Display', label: 'Playfair Display', weights: [400, 500, 600, 700, 800, 900], category: 'serif' },
  { family: 'Lora', label: 'Lora', weights: [400, 500, 600, 700], category: 'serif' },
  { family: 'Source Serif 4', label: 'Source Serif 4', weights: [300, 400, 500, 600, 700], category: 'serif' },
  { family: 'Libre Baskerville', label: 'Libre Baskerville', weights: [400, 700], category: 'serif' },
  { family: 'Crimson Text', label: 'Crimson Text', weights: [400, 600, 700], category: 'serif' },
  { family: 'Cormorant Garamond', label: 'Cormorant Garamond', weights: [300, 400, 500, 600, 700], category: 'serif' },
  { family: 'Noto Serif', label: 'Noto Serif', weights: [400, 700], category: 'serif' },

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

export async function ensureFontLoaded(family: string): Promise<void> {
  if (!family || SYSTEM_FAMILIES.has(family)) {
    return;
  }
  if (typeof document === 'undefined' || !('fonts' in document)) {
    return;
  }
  try {
    await document.fonts.load(`16px "${family}"`);
    await document.fonts.ready;
  } catch {
  }
}

export async function ensureFontsLoaded(families: string[]): Promise<void> {
  await Promise.all(families.map((family) => ensureFontLoaded(family)));
}
