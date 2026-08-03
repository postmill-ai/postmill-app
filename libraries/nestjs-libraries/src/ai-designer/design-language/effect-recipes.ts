import type { DesignerLayerStyle } from '../../media/designer-doc/designer-doc.schema';
import { MAX_LAYER_STYLES } from '../../media/designer-doc/designer-doc.limits';

/**
 * Named layer-style recipes the AI Designer can ask for by name.
 *
 * The plan says `effects: ['soft-lift']`, never `{ distance: 12, size: 28 }`.
 * A model asked for raw numbers produces plausible-looking values that are
 * wrong at any canvas size but the one it imagined, and there is no way to
 * spec-check "is 47 a good blur". A model asked for a name can only pick a
 * name, and the numbers come from here — one implementation, tested once,
 * correct at every size.
 *
 * Everything scales from `basis` rather than from absolute pixels. A drop
 * shadow tuned on a 1080px square is invisible on a 4096px banner and a smear
 * on a 400px thumbnail; scaling is the difference between a recipe and a magic
 * number.
 */

export interface EffectContext {
  /**
   * The reference length, in canvas px, that geometry scales from.
   *
   * For TEXT this is the font size — a headline's shadow belongs to the
   * letterforms, not to the width of the box they were laid out in. For
   * everything else it is the box's short side. Deliberately NOT
   * `Math.min(width, height)` computed in here: a 1200x200 text banner would
   * derive 200 and shadow its 96px type as if it were 200px tall.
   */
  basis: number;
  /** `[surface, text, accent, ...extra]` — the plan's palette convention. */
  palette: string[];
  /**
   * What the layer sits on. Picks shadow-vs-glow colour: a dark halo on a dark
   * backdrop is invisible, which is how "add a shadow for legibility" fixes
   * turn into no-ops.
   */
  backdrop?: 'light' | 'dark';
}

export interface EffectRecipe {
  id: string;
  label: string;
  /** One line, shown to the planning model. Say what it LOOKS like. */
  description: string;
  expand(ctx: EffectContext): DesignerLayerStyle[];
}

// ---------------------------------------------------------------------------
// Colour helpers. Palette entries are hex; a recipe must never assume more
// than [0] exists, because a plan may supply a two-colour palette.
// ---------------------------------------------------------------------------

const surfaceOf = (p: string[]) => p[0] || '#ffffff';
const inkOf = (p: string[]) => p[1] || '#111111';
const accentOf = (p: string[]) => p[2] || p[1] || '#111111';

/** `#rgb` and `#rrggbb` to `rgba(...)`, so recipes can carry real opacity. */
const rgba = (hex: string, alpha: number): string => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6) || '000000', 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
};

/** The colour a shadow should be: never pure black, which reads as dirt. */
const shadowInk = (ctx: EffectContext, alpha: number) =>
  rgba(ctx.backdrop === 'dark' ? '#000000' : inkOf(ctx.palette), alpha);

const glowInk = (ctx: EffectContext, alpha: number) =>
  rgba(ctx.backdrop === 'dark' ? accentOf(ctx.palette) : surfaceOf(ctx.palette), alpha);

// ---------------------------------------------------------------------------

/**
 * Photoshop's own defaults, expressed as fractions of `basis`, so the recipes
 * read as art direction rather than as arithmetic.
 */
const DEPTH = {
  hairline: 0.02,
  tight: 0.05,
  soft: 0.12,
  wide: 0.28,
} as const;

export const EFFECT_RECIPES: EffectRecipe[] = [
  {
    id: 'soft-lift',
    label: 'Soft Lift',
    description: 'A quiet, diffuse shadow that lifts the layer off the background.',
    expand: (ctx) => [
      {
        type: 'drop-shadow',
        color: shadowInk(ctx, 0.28),
        angle: 90,
        distance: ctx.basis * DEPTH.tight,
        size: ctx.basis * DEPTH.soft,
        spread: 0,
        opacity: 1,
      },
    ],
  },
  {
    id: 'hard-shadow',
    label: 'Hard Shadow',
    description: 'A crisp offset shadow with no blur — poster-like, graphic, unapologetic.',
    expand: (ctx) => [
      {
        type: 'drop-shadow',
        color: shadowInk(ctx, 1),
        angle: 135,
        distance: ctx.basis * DEPTH.tight,
        size: 0,
        spread: 100,
        opacity: 1,
      },
    ],
  },
  {
    id: 'long-shadow',
    label: 'Long Shadow',
    description: 'An exaggerated flat shadow trailing to one side; retro, editorial.',
    expand: (ctx) => [
      {
        type: 'drop-shadow',
        color: shadowInk(ctx, 0.85),
        angle: 135,
        distance: ctx.basis * DEPTH.wide,
        size: 0,
        spread: 100,
        opacity: 1,
      },
    ],
  },
  {
    id: 'drop-depth',
    label: 'Drop Depth',
    description: 'A pronounced shadow for a card or panel sitting well above the page.',
    expand: (ctx) => [
      {
        type: 'drop-shadow',
        color: shadowInk(ctx, 0.35),
        angle: 90,
        distance: ctx.basis * DEPTH.soft,
        size: ctx.basis * DEPTH.wide,
        spread: 0,
        opacity: 1,
      },
    ],
  },
  {
    id: 'sticker-outline',
    label: 'Sticker Outline',
    description: 'A thick surface-coloured keyline all the way round, like a die-cut sticker.',
    expand: (ctx) => [
      {
        type: 'stroke',
        color: surfaceOf(ctx.palette),
        position: 'outside',
        size: ctx.basis * DEPTH.tight,
        opacity: 1,
      },
    ],
  },
  {
    id: 'sticker-pop',
    label: 'Sticker Pop',
    description: 'Die-cut keyline plus a hard shadow — the classic sticker look.',
    expand: (ctx) => [
      {
        type: 'stroke',
        color: surfaceOf(ctx.palette),
        position: 'outside',
        size: ctx.basis * DEPTH.tight,
        opacity: 1,
      },
      {
        type: 'drop-shadow',
        color: shadowInk(ctx, 0.9),
        angle: 135,
        distance: ctx.basis * DEPTH.tight,
        size: 0,
        spread: 100,
        opacity: 1,
      },
    ],
  },
  {
    id: 'keyline',
    label: 'Keyline',
    description: 'A thin accent rule around the layer; restrained and precise.',
    expand: (ctx) => [
      {
        type: 'stroke',
        color: accentOf(ctx.palette),
        position: 'outside',
        size: Math.max(1, ctx.basis * DEPTH.hairline),
        opacity: 1,
      },
    ],
  },
  {
    id: 'neon-glow',
    label: 'Neon Glow',
    description: 'A saturated accent halo, as if the layer were lit from within.',
    expand: (ctx) => [
      {
        type: 'outer-glow',
        color: rgba(accentOf(ctx.palette), 0.75),
        size: ctx.basis * DEPTH.wide,
        spread: 10,
        opacity: 1,
      },
      {
        type: 'inner-glow',
        color: rgba(surfaceOf(ctx.palette), 0.5),
        size: ctx.basis * DEPTH.tight,
        opacity: 1,
      },
    ],
  },
  {
    id: 'halo',
    label: 'Halo',
    description: 'A soft surface-coloured glow that separates the layer from busy imagery.',
    expand: (ctx) => [
      {
        type: 'outer-glow',
        color: glowInk(ctx, 0.6),
        size: ctx.basis * DEPTH.soft,
        spread: 20,
        opacity: 1,
      },
    ],
  },
  {
    id: 'legibility-halo',
    label: 'Legibility Halo',
    description: 'A tight dark halo purely to keep text readable over photography.',
    expand: (ctx) => [
      {
        type: 'outer-glow',
        color: rgba('#000000', 0.55),
        size: ctx.basis * DEPTH.tight,
        spread: 30,
        opacity: 1,
      },
    ],
  },
  {
    id: 'inner-depth',
    label: 'Inner Depth',
    description: 'An inner shadow that makes the layer read as recessed into the page.',
    expand: (ctx) => [
      {
        type: 'inner-shadow',
        color: shadowInk(ctx, 0.45),
        angle: 90,
        distance: ctx.basis * DEPTH.hairline,
        size: ctx.basis * DEPTH.tight,
        opacity: 1,
      },
    ],
  },
  {
    id: 'letterpress',
    label: 'Letterpress',
    description: 'A one-pixel light edge below and dark above; type pressed into the surface.',
    expand: (ctx) => [
      {
        type: 'inner-shadow',
        color: rgba('#000000', 0.5),
        angle: 90,
        distance: Math.max(1, ctx.basis * DEPTH.hairline),
        size: 0,
        opacity: 1,
      },
      {
        type: 'drop-shadow',
        color: rgba('#ffffff', 0.5),
        angle: 270,
        distance: Math.max(1, ctx.basis * DEPTH.hairline),
        size: 0,
        spread: 100,
        opacity: 1,
      },
    ],
  },
  {
    id: 'embossed',
    label: 'Embossed',
    description: 'A raised bevel catching light from the top-left.',
    expand: (ctx) => [
      {
        type: 'bevel-emboss',
        style: 'inner-bevel',
        depth: 100,
        size: ctx.basis * DEPTH.tight,
        soften: ctx.basis * DEPTH.hairline,
        angle: 120,
        highlightColor: rgba('#ffffff', 0.75),
        shadowColor: rgba('#000000', 0.5),
        opacity: 1,
      },
    ],
  },
  {
    id: 'chisel',
    label: 'Chisel',
    description: 'A hard-edged bevel with no softening; metallic, award-badge.',
    expand: (ctx) => [
      {
        type: 'bevel-emboss',
        style: 'emboss',
        depth: 200,
        size: ctx.basis * DEPTH.tight,
        soften: 0,
        angle: 120,
        highlightColor: rgba('#ffffff', 0.9),
        shadowColor: rgba('#000000', 0.6),
        opacity: 1,
      },
    ],
  },
  {
    id: 'gradient-sheen',
    label: 'Gradient Sheen',
    description: 'A vertical accent-to-transparent wash over the layer.',
    expand: (ctx) => [
      {
        type: 'gradient-overlay',
        opacity: 0.55,
        gradient: {
          type: 'linear',
          angle: 90,
          stops: [
            { offset: 0, color: rgba(accentOf(ctx.palette), 0.9) },
            { offset: 1, color: rgba(accentOf(ctx.palette), 0) },
          ],
        },
      },
    ],
  },
  {
    id: 'duotone-overlay',
    label: 'Duotone Overlay',
    description: 'An accent-to-ink gradient across the layer; graphic, editorial.',
    expand: (ctx) => [
      {
        type: 'gradient-overlay',
        opacity: 0.85,
        blendMode: 'multiply',
        gradient: {
          type: 'linear',
          angle: 45,
          stops: [
            { offset: 0, color: accentOf(ctx.palette) },
            { offset: 1, color: inkOf(ctx.palette) },
          ],
        },
      },
    ],
  },
  {
    id: 'accent-tint',
    label: 'Accent Tint',
    description: 'A flat accent wash — recolours the layer without touching its shape.',
    expand: (ctx) => [
      {
        type: 'color-overlay',
        color: accentOf(ctx.palette),
        opacity: 0.9,
        blendMode: 'multiply',
      },
    ],
  },
  {
    id: 'scrim-veil',
    label: 'Scrim Veil',
    description: 'A dark bottom-up wash so copy can sit over imagery.',
    expand: () => [
      {
        type: 'gradient-overlay',
        opacity: 1,
        gradient: {
          type: 'linear',
          angle: 90,
          stops: [
            { offset: 0, color: 'rgba(0, 0, 0, 0)' },
            { offset: 0.55, color: 'rgba(0, 0, 0, 0.35)' },
            { offset: 1, color: 'rgba(0, 0, 0, 0.75)' },
          ],
        },
      },
    ],
  },
  {
    id: 'glass-edge',
    label: 'Glass Edge',
    description: 'A bright inner rim and faint outer glow; frosted-panel look.',
    expand: (ctx) => [
      {
        type: 'inner-glow',
        color: rgba('#ffffff', 0.45),
        size: ctx.basis * DEPTH.tight,
        opacity: 1,
      },
      {
        type: 'stroke',
        color: rgba('#ffffff', 0.35),
        position: 'inside',
        size: Math.max(1, ctx.basis * DEPTH.hairline),
        opacity: 1,
      },
    ],
  },
  {
    id: 'satin-sheen',
    label: 'Satin Sheen',
    description: 'A soft interior shading that gives flat colour a fabric-like fall.',
    expand: (ctx) => [
      {
        type: 'satin',
        color: rgba(inkOf(ctx.palette), 0.25),
        angle: 19,
        distance: ctx.basis * DEPTH.soft,
        size: ctx.basis * DEPTH.soft,
        opacity: 1,
      },
    ],
  },
  {
    id: 'paper-grain',
    label: 'Paper Grain',
    description: 'A faint noise pattern over the layer; print-like, tactile.',
    expand: () => [
      {
        type: 'pattern-overlay',
        opacity: 0.12,
        blendMode: 'multiply',
        pattern: { preset: 'noise', scale: 1 },
      },
    ],
  },
  {
    id: 'halftone-dots',
    label: 'Halftone Dots',
    description: 'A dot pattern over the layer; comic-book, risograph.',
    expand: (ctx) => [
      {
        type: 'pattern-overlay',
        opacity: 0.25,
        blendMode: 'multiply',
        pattern: { preset: 'dots', scale: Math.max(1, ctx.basis * 0.04), color: inkOf(ctx.palette) },
      },
    ],
  },
  {
    id: 'blueprint-grid',
    label: 'Blueprint Grid',
    description: 'A fine grid over the layer; technical, data-led.',
    expand: (ctx) => [
      {
        type: 'pattern-overlay',
        opacity: 0.18,
        pattern: { preset: 'grid', scale: Math.max(1, ctx.basis * 0.06), color: accentOf(ctx.palette) },
      },
    ],
  },
  {
    id: 'framed-plate',
    label: 'Framed Plate',
    description: 'An inset keyline with a soft shadow; a photograph mounted on card.',
    expand: (ctx) => [
      {
        type: 'stroke',
        color: rgba(surfaceOf(ctx.palette), 0.9),
        position: 'inside',
        size: ctx.basis * DEPTH.tight,
        opacity: 1,
      },
      {
        type: 'drop-shadow',
        color: shadowInk(ctx, 0.3),
        angle: 90,
        distance: ctx.basis * DEPTH.tight,
        size: ctx.basis * DEPTH.soft,
        opacity: 1,
      },
    ],
  },
];

export const EFFECT_RECIPE_IDS: string[] = EFFECT_RECIPES.map((r) => r.id);

export const effectRecipeById = (id: string): EffectRecipe | undefined =>
  EFFECT_RECIPES.find((r) => r.id === id);

/**
 * Expand a list of recipe names into the styles a layer should carry.
 *
 * Unknown names are DROPPED, not thrown on: the planning model works from a
 * generated catalog, but a stored plan may name a recipe a later build removed,
 * and a design missing one flourish beats a pipeline that fails.
 *
 * The result is capped at `MAX_LAYER_STYLES` because the schema is — combining
 * four recipes on one layer is already past the point of taste, and a rejected
 * document helps nobody.
 */
export const expandEffects = (
  ids: string[] | undefined,
  ctx: EffectContext
): DesignerLayerStyle[] => {
  const out: DesignerLayerStyle[] = [];
  for (const id of ids || []) {
    const recipe = effectRecipeById(id);
    if (!recipe) continue;
    out.push(...recipe.expand(ctx));
    if (out.length >= MAX_LAYER_STYLES) return out.slice(0, MAX_LAYER_STYLES);
  }
  return out;
};

/**
 * The catalog as the planning model sees it.
 *
 * Generated from the table rather than written alongside it, so the vocabulary
 * the model is offered cannot drift from the vocabulary the composer implements
 * — the failure mode where a model confidently asks for an effect that silently
 * does nothing.
 */
export const effectCatalogPrompt = (): string =>
  EFFECT_RECIPES.map((r) => `- ${r.id}: ${r.description}`).join('\n');
