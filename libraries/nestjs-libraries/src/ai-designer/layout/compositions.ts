import {
  compositionFits,
  present,
  slot,
  type Composition,
  type CompositionContext,
} from './composition';
import type { LayoutNode } from './box-model';

/**
 * The composition gallery.
 *
 * The first six re-express the old hard-coded templates. They exist so the
 * engine can be proved to reproduce today's output before any of the composer's
 * hand-tuned constants are deleted — those constants encode about eight rounds
 * of live remediation, and the only safe way to remove them is to have
 * something that demonstrably does the same job first.
 *
 * Everything after them is new, and is the actual point: a gallery that grows
 * by adding a row rather than by writing another method with its own table of
 * magic numbers.
 */

const copyStack = (ctx: CompositionContext, over: Partial<LayoutNode> = {}): LayoutNode =>
  ({
    kind: 'stack',
    gap: 3,
    children: present(ctx, [
      slot('badge'),
      slot('headline'),
      slot('subhead'),
      slot('cta'),
    ]),
    ...over,
  }) as LayoutNode;

export const COMPOSITIONS: Composition[] = [
  // ── The original six ────────────────────────────────────────────────────
  {
    id: 'hero-fullbleed',
    copyBandRatio: 0.49,
    typeScale: 1,
    label: 'Hero Full-bleed',
    description: 'Photograph fills the canvas; copy sits over its lower third.',
    roles: ['image', 'headline', 'subhead', 'cta', 'badge', 'legal'],
    requires: [],
    build: (ctx) => ({
      kind: 'overlay',
      children: [
        slot('image', { fill: true }),
        {
          kind: 'stack',
          justify: 'end',
          gap: 3,
          children: present(ctx, [
            { kind: 'stack', fill: true, children: present(ctx, [slot('badge')]) },
            slot('headline'),
            slot('subhead'),
            slot('cta'),
            slot('legal', { rigid: true }),
          ]),
        },
      ],
    }),
  },
  {
    id: 'split-panel',
    copyBandRatio: 0.9,
    typeScale: 0.72,
    panel: { widthRatio: 0.46 },
    badgeAlign: 'left',
    label: 'Split Panel',
    description: 'Two columns: imagery on one side, a solid panel of copy on the other.',
    roles: ['image', 'headline', 'subhead', 'cta', 'badge', 'legal'],
    // No `requires: ['image']`: the slab IS the design, so a panel holds up on
    // a flat background — an explicit request must be honoured (two specs pin
    // the slab over a flat background). Fallback selection is unaffected: the
    // fallback is hero-fullbleed, which fits first.
    requires: [],
    // Two columns on a 9:16 story are each narrower than a word.
    aspect: { min: 0.7 },
    build: (ctx) => ({
      kind: 'row',
      align: 'stretch',
      gap: 2,
      children: [
        slot('image'),
        copyStack(ctx, { justify: 'center', padding: 2 }),
      ],
    }),
  },
  {
    id: 'top-bottom',
    copyBandRatio: 0.55,
    typeScale: 0.8,
    label: 'Top and Bottom',
    description: 'A caption band above and below the image. Meme grammar.',
    // `cta` is placed even though meme grammar rarely uses one: the legacy
    // builder allowed its bottom slot to be a CTA, and a composition that
    // declares fewer roles than the layout it replaces drops copy silently.
    roles: ['image', 'headline', 'subhead', 'cta', 'legal'],
    requires: [],
    build: (ctx) => ({
      kind: 'stack',
      gap: 2,
      children: present(ctx, [
        slot('headline'),
        slot('image', { fill: true, bleed: true }),
        slot('subhead'),
        slot('cta'),
        slot('legal', { rigid: true }),
      ]),
    }),
  },
  {
    id: 'badge-burst',
    copyBandRatio: 0.59,
    typeScale: 0.95,
    badgeAlign: 'center',
    badgeStyle: 'pill',
    badgeIgnoresPlanPosition: true,
    badgeTopRatio: 0.14,
    label: 'Badge Burst',
    description: 'A large badge is the centrepiece, with copy stacked beneath it.',
    roles: ['image', 'badge', 'headline', 'subhead', 'cta', 'legal'],
    requires: ['badge'],
    build: (ctx) => ({
      kind: 'overlay',
      children: [
        slot('image', { fill: true }),
        {
          kind: 'stack',
          justify: 'center',
          gap: 3,
          children: present(ctx, [
            slot('badge', { minBaselines: 30 }),
            slot('headline'),
            slot('subhead'),
            slot('cta'),
          ]),
        },
      ],
    }),
  },
  {
    id: 'poster-left',
    copyBandRatio: 0.75,
    typeScale: 0.95,
    label: 'Poster Left',
    description: 'Copy column at the top-left over a dark-scrimmed full-bleed photo. Moody food, drink, retail promos.',
    roles: ['image', 'headline', 'subhead', 'cta', 'badge', 'legal', 'decor', 'accent'],
    requires: [],
    scrim: { widthRatio: 0.62, strength: 0.72 },
    textAlign: 'left',
    badgeAlign: 'left',
    build: (ctx) => ({
      kind: 'overlay',
      children: [
        slot('image', { fill: true }),
        {
          kind: 'stack',
          justify: 'start',
          gap: 3,
          children: present(ctx, [
            slot('badge'),
            // The kicker/script line rides ABOVE the headline — poster
            // grammar ("Italian" over "PIZZA"), not a subhead variant.
            slot('accent'),
            slot('headline'),
            slot('subhead'),
            slot('cta'),
            slot('legal', { rigid: true }),
          ]),
        },
      ],
    }),
  },
  {
    id: 'editorial-sidebar',
    copyBandRatio: 0.9,
    typeScale: 0.72,
    panel: { widthRatio: 0.38 },
    badgeAlign: 'left',
    label: 'Editorial Sidebar',
    description: 'A narrow column of copy beside a dominant image; magazine-like.',
    roles: ['image', 'headline', 'subhead', 'cta', 'badge', 'legal'],
    // Same as split-panel: the sidebar holds up on a flat background, so an
    // explicit request must not be vetoed by a missing image role.
    requires: [],
    aspect: { min: 0.7 },
    build: (ctx) => ({
      kind: 'row',
      align: 'stretch',
      gap: 2,
      weights: [2, 1],
      children: [slot('image'), copyStack(ctx, { justify: 'center', padding: 2 })],
    }),
  },
  {
    id: 'minimal-centered',
    copyBandRatio: 0.52,
    typeScale: 0.9,
    textVerticalAlign: 'middle',
    badgeAlign: 'center',
    label: 'Minimal Centred',
    description: 'A small image above centred copy, with generous space around it.',
    roles: ['image', 'headline', 'subhead', 'cta', 'badge', 'legal'],
    requires: [],
    build: (ctx) => ({
      kind: 'stack',
      gap: 4,
      children: present(ctx, [
        // An edge-to-edge band, never an inset panel. `aspect` sizes it; `bleed`
        // takes it out to the canvas edges.
        slot('image', { aspect: 2.6, bleed: true }),
        {
          kind: 'stack',
          fill: true,
          justify: 'center',
          align: 'center',
          gap: 3,
          children: present(ctx, [
            slot('badge'),
            slot('headline'),
            slot('subhead'),
            slot('cta'),
          ]),
        },
        slot('legal', { rigid: true }),
      ]),
    }),
  },

  // ── New ─────────────────────────────────────────────────────────────────
  {
    id: 'type-dominant',
    copyBandRatio: 0.8,
    typeScale: 1.05,
    label: 'Type Dominant',
    description: 'No imagery at all — the typography is the design. Quotes, statements, statistics.',
    roles: ['headline', 'subhead', 'cta', 'badge', 'legal', 'decor'],
    requires: ['headline'],
    build: (ctx) => ({
      kind: 'stack',
      justify: 'center',
      gap: 4,
      padding: 2,
      children: present(ctx, [
        slot('badge'),
        slot('decor'),
        slot('headline'),
        slot('subhead'),
        slot('cta'),
        slot('legal', { rigid: true }),
      ]),
    }),
  },
  {
    id: 'overlap-card',
    copyBandRatio: 0.55,
    typeScale: 0.85,
    label: 'Overlap Card',
    description: 'A copy card floats over the lower part of a photograph, breaking its edge.',
    roles: ['image', 'headline', 'subhead', 'cta', 'badge', 'legal'],
    requires: ['image'],
    build: (ctx) => ({
      kind: 'overlay',
      children: [
        slot('image', { fill: true }),
        {
          kind: 'stack',
          justify: 'end',
          padding: 3,
          children: [copyStack(ctx, { padding: 3, gap: 2 })],
        },
      ],
    }),
  },
  {
    id: 'banner-strip',
    copyBandRatio: 0.45,
    typeScale: 0.8,
    label: 'Banner Strip',
    description: 'A wide horizontal band of copy across a full-bleed image. Built for landscape.',
    roles: ['image', 'headline', 'subhead', 'cta', 'badge'],
    requires: [],
    aspect: { min: 1.4 },
    build: (ctx) => ({
      kind: 'overlay',
      children: [
        slot('image', { fill: true }),
        {
          kind: 'row',
          align: 'center',
          gap: 3,
          children: present(ctx, [
            { kind: 'stack', gap: 2, children: present(ctx, [slot('headline'), slot('subhead')]) },
            slot('cta'),
          ]),
        },
      ],
    }),
  },
  {
    id: 'stacked-thirds',
    copyBandRatio: 0.6,
    typeScale: 0.8,
    label: 'Stacked Thirds',
    description: 'Three equal horizontal bands. Orderly, editorial, good for portrait canvases.',
    roles: ['image', 'headline', 'subhead', 'cta', 'badge', 'legal'],
    requires: [],
    aspect: { max: 1.2 },
    build: (ctx) => ({
      kind: 'stack',
      gap: 2,
      weights: [1, 1, 1],
      children: present(ctx, [
        { kind: 'stack', justify: 'start', children: present(ctx, [slot('badge'), slot('headline')]) },
        slot('image', { fill: true }),
        { kind: 'stack', justify: 'end', gap: 2, children: present(ctx, [slot('subhead'), slot('cta')]) },
      ]),
    }),
  },
  {
    id: 'centred-emblem',
    copyBandRatio: 0.5,
    typeScale: 0.9,
    label: 'Centred Emblem',
    description: 'A small mark or logo centred above a short line of copy. Quiet and formal.',
    roles: ['logo', 'headline', 'subhead', 'legal', 'decor'],
    requires: [],
    build: (ctx) => ({
      kind: 'stack',
      justify: 'center',
      align: 'center',
      gap: 4,
      children: present(ctx, [
        slot('logo', { aspect: 1 }),
        slot('decor'),
        slot('headline'),
        slot('subhead'),
        slot('legal', { rigid: true }),
      ]),
    }),
  },
  {
    id: 'poster-frame',
    copyBandRatio: 0.6,
    typeScale: 0.85,
    label: 'Poster Frame',
    description: 'An inset image with a generous border and copy below; gallery-print feel.',
    roles: ['image', 'headline', 'subhead', 'cta', 'legal'],
    requires: ['image'],
    build: (ctx) => ({
      kind: 'stack',
      padding: 4,
      gap: 3,
      children: present(ctx, [
        slot('image', { fill: true }),
        slot('headline'),
        slot('subhead'),
        slot('cta'),
        slot('legal', { rigid: true }),
      ]),
    }),
  },
];

export const COMPOSITION_IDS: string[] = COMPOSITIONS.map((c) => c.id);

export const compositionById = (id: string): Composition | undefined =>
  COMPOSITIONS.find((c) => c.id === id);

/**
 * Pick a composition, honouring the plan's choice where it works.
 *
 * A named composition that does not fit the canvas is REPLACED rather than
 * forced: a split panel on a story lays out perfectly well and is unreadable,
 * which is the kind of failure that never raises an error and always reaches a
 * user.
 */
export const resolveComposition = (
  requestedId: string | undefined,
  ctx: CompositionContext,
  fallbackId = 'hero-fullbleed'
): Composition => {
  const requested = requestedId ? compositionById(requestedId) : undefined;
  if (requested && compositionFits(requested, ctx)) return requested;

  const fitting = COMPOSITIONS.filter((c) => compositionFits(c, ctx));
  const fallback = compositionById(fallbackId);
  if (fallback && compositionFits(fallback, ctx)) return fallback;
  return fitting[0] || COMPOSITIONS[0];
};

/** The gallery as the planning model sees it — generated, never hand-listed. */
export const compositionCatalogPrompt = (): string =>
  COMPOSITIONS.map(
    (c) =>
      `- ${c.id}: ${c.description} (imagery: ${c.roles.includes('image') ? 'placed' : 'none'})`
  ).join('\n');
