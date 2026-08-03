import type {
  DesignerAdjustment,
  DesignerSmartFilter,
} from '../../media/designer-doc/designer-doc.schema';
import { MAX_SMART_FILTERS } from '../../media/designer-doc/designer-doc.limits';

/**
 * Named image treatments — how a photograph is made to belong to the design
 * rather than merely sit inside it.
 *
 * This is the single biggest reason AI-composed layouts read as templated: the
 * type is on-palette, the shapes are on-palette, and then a stock photograph
 * arrives with its own colour temperature and fights everything around it. A
 * treatment is what a designer does next.
 *
 * Each recipe expands to two independent things:
 *
 *  - `adjustments` — CLIPPED adjustment layers stacked above the image, which
 *    stay live and editable in the manual Designer, cost nothing to re-render,
 *    and are what a person would have reached for.
 *  - `smartFilters` — a non-destructive filter recipe on the image itself, for
 *    the grain/halftone/blur effects an adjustment cannot express.
 *
 * Prefer an adjustment where both could do the job. Both now render on the
 * server as well as the client, so the choice is about cost and editability
 * rather than about what will survive.
 */

export interface TreatmentContext {
  /** `[surface, text, accent, ...extra]` — the plan's palette convention. */
  palette: string[];
  /** Intensity dial, 0..1. Recipes interpolate toward their full strength. */
  strength?: number;
}

export interface TreatmentResult {
  /** Clipped adjustment layers, bottom-most first. */
  adjustments: DesignerAdjustment[];
  /** Non-destructive filter stack for the image element. */
  smartFilters: DesignerSmartFilter[];
}

export interface ImageTreatment {
  id: string;
  label: string;
  /** One line, shown to the planning model. Say what it LOOKS like. */
  description: string;
  expand(ctx: TreatmentContext): TreatmentResult;
}

const surfaceOf = (p: string[]) => p[0] || '#ffffff';
const inkOf = (p: string[]) => p[1] || '#111111';
const accentOf = (p: string[]) => p[2] || p[1] || '#111111';

/** Scale a full-strength value by the context's dial. */
const at = (ctx: TreatmentContext, full: number) => full * (ctx.strength ?? 1);

const none = (): TreatmentResult => ({ adjustments: [], smartFilters: [] });

export const IMAGE_TREATMENTS: ImageTreatment[] = [
  {
    id: 'duotone-brand',
    label: 'Duotone (brand)',
    description:
      'Maps the photo to a two-colour ramp built from the palette — the strongest way to make stock imagery look art-directed.',
    expand: (ctx) => ({
      adjustments: [
        { type: 'black-white', values: { red: 1, green: 1, blue: 1 } },
        {
          type: 'gradient-map',
          gradient: {
            type: 'linear',
            stops: [
              { offset: 0, color: inkOf(ctx.palette) },
              { offset: 1, color: accentOf(ctx.palette) },
            ],
          },
        },
      ],
      smartFilters: [],
    }),
  },
  {
    id: 'tritone-brand',
    label: 'Tritone (brand)',
    description: 'A three-stop ramp — ink through accent to surface; richer than a duotone.',
    expand: (ctx) => ({
      adjustments: [
        { type: 'black-white', values: { red: 1, green: 1, blue: 1 } },
        {
          type: 'gradient-map',
          gradient: {
            type: 'linear',
            stops: [
              { offset: 0, color: inkOf(ctx.palette) },
              { offset: 0.55, color: accentOf(ctx.palette) },
              { offset: 1, color: surfaceOf(ctx.palette) },
            ],
          },
        },
      ],
      smartFilters: [],
    }),
  },
  {
    id: 'mono',
    label: 'Monochrome',
    description: 'Straight black and white; lets type and colour accents carry the design.',
    expand: () => ({
      adjustments: [{ type: 'black-white', values: { red: 1, green: 1, blue: 1 } }],
      smartFilters: [],
    }),
  },
  {
    id: 'mono-tint',
    label: 'Tinted Monochrome',
    description: 'Black and white with an accent tint washed back over it; quiet and cohesive.',
    expand: (ctx) => ({
      adjustments: [
        { type: 'black-white', values: { red: 1, green: 1, blue: 1 } },
        {
          type: 'photo-filter',
          color: accentOf(ctx.palette),
          values: { density: at(ctx, 55), preserveLuminosity: 1 },
        },
      ],
      smartFilters: [],
    }),
  },
  {
    id: 'warm-tint',
    label: 'Warm Tint',
    description: 'A warming filter; sunlit, appetising, human.',
    expand: (ctx) => ({
      adjustments: [
        { type: 'photo-filter', color: '#ec8a00', values: { density: at(ctx, 35), preserveLuminosity: 1 } },
      ],
      smartFilters: [],
    }),
  },
  {
    id: 'cool-tint',
    label: 'Cool Tint',
    description: 'A cooling filter; clinical, technical, calm.',
    expand: (ctx) => ({
      adjustments: [
        { type: 'photo-filter', color: '#0a7cc4', values: { density: at(ctx, 35), preserveLuminosity: 1 } },
      ],
      smartFilters: [],
    }),
  },
  {
    id: 'contrast-punch',
    label: 'Contrast Punch',
    description: 'Deepens blacks and lifts highlights; makes a flat photo feel deliberate.',
    expand: (ctx) => ({
      adjustments: [
        { type: 'brightness-contrast', values: { brightness: 0, contrast: at(ctx, 28) } },
        { type: 'vibrance', values: { vibrance: at(ctx, 18), saturation: 0 } },
      ],
      smartFilters: [],
    }),
  },
  {
    id: 'faded-matte',
    label: 'Faded Matte',
    description: 'Lifted blacks and reduced contrast; the washed, filmic look.',
    expand: (ctx) => ({
      adjustments: [
        { type: 'levels', values: { black: 0, gamma: 1.08, white: 238 } },
        { type: 'brightness-contrast', values: { brightness: 6, contrast: -at(ctx, 18) } },
        { type: 'vibrance', values: { vibrance: -at(ctx, 12), saturation: -at(ctx, 8) } },
      ],
      smartFilters: [],
    }),
  },
  {
    id: 'bleach',
    label: 'Bleach Bypass',
    description: 'Desaturated with hard contrast; gritty, editorial, high-end.',
    expand: (ctx) => ({
      adjustments: [
        { type: 'vibrance', values: { vibrance: 0, saturation: -at(ctx, 55) } },
        { type: 'brightness-contrast', values: { brightness: 4, contrast: at(ctx, 40) } },
      ],
      smartFilters: [],
    }),
  },
  {
    id: 'cross-process',
    label: 'Cross Process',
    description: 'Shifted colour balance with crushed shadows; analogue, offbeat.',
    expand: (ctx) => ({
      adjustments: [
        {
          type: 'color-balance',
          values: { red: at(ctx, 18), green: -at(ctx, 8), blue: at(ctx, 22) },
        },
        { type: 'brightness-contrast', values: { brightness: -4, contrast: at(ctx, 25) } },
      ],
      smartFilters: [],
    }),
  },
  {
    id: 'sun-drenched',
    label: 'Sun Drenched',
    description: 'Raised exposure and warmth with soft shadows; bright, aspirational lifestyle.',
    expand: (ctx) => ({
      adjustments: [
        { type: 'exposure', values: { exposure: at(ctx, 0.35), offset: 0.02 } },
        { type: 'photo-filter', color: '#ffb347', values: { density: at(ctx, 25), preserveLuminosity: 1 } },
        { type: 'brightness-contrast', values: { brightness: 0, contrast: -at(ctx, 8) } },
      ],
      smartFilters: [],
    }),
  },
  {
    id: 'moody-dark',
    label: 'Moody Dark',
    description: 'Pulled exposure with deep shadow; premium, nocturnal, dramatic.',
    expand: (ctx) => ({
      adjustments: [
        { type: 'exposure', values: { exposure: -at(ctx, 0.4), offset: -0.02 } },
        { type: 'brightness-contrast', values: { brightness: -6, contrast: at(ctx, 22) } },
        { type: 'vibrance', values: { vibrance: -at(ctx, 10), saturation: -at(ctx, 12) } },
      ],
      smartFilters: [],
    }),
  },
  {
    id: 'high-key',
    label: 'High Key',
    description: 'Bright, low-contrast and airy; leaves plenty of room for dark type.',
    expand: (ctx) => ({
      adjustments: [
        { type: 'levels', values: { black: 0, gamma: 1.25, white: 255 } },
        { type: 'brightness-contrast', values: { brightness: at(ctx, 12), contrast: -at(ctx, 15) } },
      ],
      smartFilters: [],
    }),
  },
  {
    id: 'posterized',
    label: 'Posterized',
    description: 'Flattens the photo into bands of flat colour; screen-print, graphic.',
    expand: (ctx) => ({
      adjustments: [
        { type: 'brightness-contrast', values: { brightness: 0, contrast: at(ctx, 20) } },
        { type: 'posterize', values: { levels: Math.max(3, Math.round(10 - at(ctx, 5))) } },
      ],
      smartFilters: [],
    }),
  },
  {
    id: 'high-contrast-mono',
    label: 'Stark Mono',
    description: 'Pushed to near black-and-white extremes; brutal, poster-like.',
    expand: (ctx) => ({
      adjustments: [
        { type: 'black-white', values: { red: 1, green: 1, blue: 1 } },
        { type: 'brightness-contrast', values: { brightness: 0, contrast: at(ctx, 65) } },
      ],
      smartFilters: [],
    }),
  },
  {
    id: 'film-grain',
    label: 'Film Grain',
    description: 'Adds fine analogue grain; stops a clean render looking synthetic.',
    expand: (ctx) => ({
      adjustments: [],
      smartFilters: [
        { id: 'add-noise', params: { amount: Math.round(at(ctx, 9)), monochromatic: true } },
      ],
    }),
  },
  {
    id: 'halftone-print',
    label: 'Halftone Print',
    description: 'Breaks the photo into printed dots; risograph, comic, zine.',
    expand: (ctx) => ({
      adjustments: [{ type: 'brightness-contrast', values: { brightness: 0, contrast: at(ctx, 20) } }],
      smartFilters: [{ id: 'color-halftone', params: { radius: 4 } }],
    }),
  },
  {
    id: 'soft-backdrop',
    label: 'Soft Backdrop',
    description: 'Blurs and dims the image so it can sit behind copy without competing.',
    expand: (ctx) => ({
      adjustments: [
        { type: 'brightness-contrast', values: { brightness: -at(ctx, 14), contrast: -at(ctx, 10) } },
      ],
      smartFilters: [{ id: 'gaussian-blur', params: { radius: Math.max(2, Math.round(at(ctx, 12))) } }],
    }),
  },
  {
    id: 'painterly',
    label: 'Painterly',
    description: 'Softens detail into brush-like strokes; illustrative, hand-made.',
    expand: () => ({
      adjustments: [],
      smartFilters: [{ id: 'oil-paint', params: { radius: 4 } }],
    }),
  },
  {
    id: 'crisp',
    label: 'Crisp',
    description: 'Light sharpening and clarity; product photography that has to read at thumbnail size.',
    expand: (ctx) => ({
      adjustments: [{ type: 'clarity-dehaze', values: { clarity: at(ctx, 22), dehaze: at(ctx, 10) } }],
      smartFilters: [{ id: 'sharpen' }],
    }),
  },
  {
    id: 'none',
    label: 'Untreated',
    description: 'Leave the photograph exactly as supplied. Correct when the imagery is already on-brand.',
    expand: none,
  },
];

export const IMAGE_TREATMENT_IDS: string[] = IMAGE_TREATMENTS.map((t) => t.id);

export const imageTreatmentById = (id: string): ImageTreatment | undefined =>
  IMAGE_TREATMENTS.find((t) => t.id === id);

/**
 * Expand a treatment name.
 *
 * An unknown name yields an empty result rather than throwing: a stored plan
 * may name a treatment a later build dropped, and an untreated photo beats a
 * failed pipeline. The filter stack is capped at the schema's own limit.
 */
export const expandTreatment = (
  id: string | undefined,
  ctx: TreatmentContext
): TreatmentResult => {
  const recipe = id ? imageTreatmentById(id) : undefined;
  if (!recipe) return none();
  const result = recipe.expand(ctx);
  return {
    adjustments: result.adjustments,
    smartFilters: result.smartFilters.slice(0, MAX_SMART_FILTERS),
  };
};

/** The catalog as the planning model sees it — generated, never hand-listed. */
export const treatmentCatalogPrompt = (): string =>
  IMAGE_TREATMENTS.map((t) => `- ${t.id}: ${t.description}`).join('\n');
