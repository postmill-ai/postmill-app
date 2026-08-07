import { isCatalogFamily } from '../../../media/designer-doc/font-catalog';

/**
 * A plan's `fontFamily` as a REAL font family.
 *
 * The planning model reliably answers "what kind of face does this line want?"
 * with the KIND rather than a name — observed live in every reference run:
 * `fontFamily: "script"` on the accent line, `"condensed"` on a badge,
 * `"serif"` on a subhead. Those strings went into the document verbatim, no
 * renderer has a family by those names, and the line silently painted in the
 * fallback sans — the single most visible way a design misses its reference
 * (the script accent that made the reference feel Italian rendered as plain
 * Helvetica).
 *
 * Nothing upstream can prevent it: the plan schema cannot enumerate 1,900
 * families, and a prompt cannot stop a model from being descriptive. So the
 * composer resolves: a real catalog family passes through untouched, a
 * recognised KIND maps to a face that is actually loadable, and anything else
 * falls back to the preset the style already chose.
 *
 * The mapping deliberately prefers the preset's own faces where the kind
 * matches what the preset is already doing, so a resolution never fights the
 * chosen style.
 */

/** Kind words the planner actually emits, mapped to loadable families. */
const KIND_FAMILIES: Record<string, string[]> = {
  // Formal copperplate first — the wedding/restaurant register the reference
  // work reaches for; the casual brush faces follow.
  script: ['Great Vibes', 'Dancing Script', 'Pacifico'],
  cursive: ['Great Vibes', 'Dancing Script'],
  handwriting: ['Caveat', 'Shadows Into Light'],
  handwritten: ['Caveat', 'Shadows Into Light'],
  brush: ['Pacifico', 'Lobster'],
  condensed: ['Barlow Condensed', 'Archivo Narrow', 'Oswald'],
  'condensed-sans': ['Barlow Condensed', 'Archivo Narrow', 'Oswald'],
  'condensed-serif': ['Bodoni Moda', 'Prata'],
  slab: ['Rozha One', 'Bodoni Moda'],
  display: ['Anton', 'Fjalla One'],
  mono: ['Courier Prime', 'JetBrains Mono'],
  monospace: ['Courier Prime', 'JetBrains Mono'],
};

/** Kinds that mean "whatever the preset uses for this", not a specific face. */
const PRESET_KINDS = new Set(['serif', 'sans', 'sans-serif', 'body', 'text', 'default']);

const normalise = (value: string): string =>
  value.trim().toLowerCase().replace(/[\s_]+/g, '-');

export const resolveFontFamily = (
  requested: string | undefined,
  /** The face to fall back to — the preset's display/body, or the element's own. */
  fallback: string | undefined
): string | undefined => {
  if (!requested || !requested.trim()) return fallback;

  // A real family always wins — the planner naming "Playfair Display" means it.
  if (isCatalogFamily(requested)) return requested;

  const kind = normalise(requested);
  if (PRESET_KINDS.has(kind)) return fallback;

  const candidates = KIND_FAMILIES[kind];
  if (candidates) {
    const usable = candidates.find((family) => isCatalogFamily(family));
    if (usable) return usable;
  }

  // An unknown, non-catalog name (a hallucinated foundry face, a typo) would
  // paint in the fallback sans and look like a bug in the design rather than
  // in the plan. The caller's own face is always right enough.
  return fallback;
};

/**
 * Faces whose letterforms are joined or hand-drawn — the ones an all-caps
 * transform destroys.
 *
 * A script face set in capitals stops being a script: the joins that make it
 * read as handwriting only exist between lowercase letters, so "FRESH & TASTY"
 * in Great Vibes is a row of disconnected swashes. Observed live on the poster
 * run — the planner asked for a script accent AND uppercase, and got neither.
 */
const SCRIPT_FAMILIES = new Set(
  [
    ...KIND_FAMILIES.script,
    ...KIND_FAMILIES.cursive,
    ...KIND_FAMILIES.handwriting,
    ...KIND_FAMILIES.brush,
    'Caveat Brush',
  ].map((f) => f.toLowerCase())
);

export const isScriptFamily = (family: string | undefined): boolean =>
  !!family && SCRIPT_FAMILIES.has(family.trim().toLowerCase());
