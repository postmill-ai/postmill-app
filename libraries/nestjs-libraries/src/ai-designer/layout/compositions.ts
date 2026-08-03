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
    label: 'Split Panel',
    description: 'Two columns: imagery on one side, a solid panel of copy on the other.',
    roles: ['image', 'headline', 'subhead', 'cta', 'badge', 'legal'],
    requires: ['image'],
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
    label: 'Top and Bottom',
    description: 'A caption band above and below the image. Meme grammar.',
    roles: ['image', 'headline', 'subhead', 'legal'],
    requires: [],
    build: (ctx) => ({
      kind: 'stack',
      gap: 2,
      children: present(ctx, [
        slot('headline'),
        slot('image', { fill: true }),
        slot('subhead'),
        slot('legal', { rigid: true }),
      ]),
    }),
  },
  {
    id: 'badge-burst',
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
    id: 'editorial-sidebar',
    label: 'Editorial Sidebar',
    description: 'A narrow column of copy beside a dominant image; magazine-like.',
    roles: ['image', 'headline', 'subhead', 'cta', 'badge', 'legal'],
    requires: ['image'],
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
    label: 'Minimal Centred',
    description: 'A small image above centred copy, with generous space around it.',
    roles: ['image', 'headline', 'subhead', 'cta', 'badge', 'legal'],
    requires: [],
    build: (ctx) => ({
      kind: 'stack',
      justify: 'center',
      align: 'center',
      gap: 4,
      children: present(ctx, [
        slot('image', { aspect: 1.6 }),
        slot('headline'),
        slot('subhead'),
        slot('cta'),
        slot('legal', { rigid: true }),
      ]),
    }),
  },

  // ── New ─────────────────────────────────────────────────────────────────
  {
    id: 'type-dominant',
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
  COMPOSITIONS.map((c) => `- ${c.id}: ${c.description}`).join('\n');
