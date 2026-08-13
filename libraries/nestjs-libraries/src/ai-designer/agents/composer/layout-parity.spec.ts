import { describe, expect, it, vi } from 'vitest';
import { AiDesignerComposerService } from './ai-designer-composer.service';
import { DesignerDocService } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.service';
import { COMPOSITION_IDS } from '../../layout/compositions';
import type { DesignPlan } from '../../ai-designer.types';

/**
 * Golden geometry, captured BEFORE the layout engine replaces the six
 * hand-written builders.
 *
 * Those builders encode about eight rounds of live remediation, and most of it
 * is in constants with no name. The ~240 assertions in the composer's own spec
 * pin the behaviours someone thought to write down; this pins everything else,
 * so that when the engine takes over, every single box that moves is visible
 * and has to be justified rather than silently re-recorded.
 *
 * Snapshots record ONLY geometry — originId, type and the rounded box. Ids,
 * colours, fonts and asset urls are deliberately excluded: they are covered
 * elsewhere and would make the diff unreadable at exactly the moment it matters.
 */

const compose = async (plan: DesignPlan, output: { formatId: string; width: number; height: number }) => {
  const service = new AiDesignerComposerService(
    new DesignerDocService() as any,
    { generateText: vi.fn() } as any
  );
  return service.compose({
    plan,
    copy: COPY,
    assets: ASSETS,
    outputs: [output],
    orgId: 'o1',
    userId: 'u1',
  });
};

const COPY = {
  headline: 'Half price this week only',
  sub: 'Every bag of single-origin, roasted on Tuesday',
  cta: 'Shop the sale',
  badge: '40% off',
  legal: 'Ends Sunday. While stocks last.',
};

const ASSETS = {
  img: {
    slotId: 'img',
    fileId: 'f1',
    path: 'https://example.com/i.png',
    type: 'image' as const,
    naturalWidth: 2000,
    naturalHeight: 1500,
  },
};

/**
 * Three slot sets, chosen because each exercises a different hand-tuned path:
 * the full set drives the badge carve AND the footer edge contract, `noFooter`
 * drives the CAPPED balance shift (the uncapped one only applies when a footer
 * exists), and `copyOnly` drives the D4 backdrop redirect.
 */
const SLOT_SETS = {
  full: [
    { id: 'img', role: 'image', kind: 'image' as const },
    { id: 'headline', role: 'headline', kind: 'text' as const },
    { id: 'sub', role: 'subhead', kind: 'text' as const },
    { id: 'cta', role: 'cta', kind: 'cta-button' as const },
    { id: 'badge', role: 'badge', kind: 'badge' as const },
    { id: 'legal', role: 'legal', kind: 'text' as const },
  ],
  noFooter: [
    { id: 'img', role: 'image', kind: 'image' as const },
    { id: 'headline', role: 'headline', kind: 'text' as const },
    { id: 'sub', role: 'subhead', kind: 'text' as const },
    { id: 'cta', role: 'cta', kind: 'cta-button' as const },
  ],
  copyOnly: [
    { id: 'headline', role: 'headline', kind: 'text' as const },
    { id: 'sub', role: 'subhead', kind: 'text' as const },
    { id: 'cta', role: 'cta', kind: 'cta-button' as const },
  ],
};

/** Square, story and banner — the three aspects channel variants actually hit. */
const CANVASES = [
  { formatId: 'ig-post', width: 1080, height: 1080 },
  { formatId: 'ig-story', width: 1080, height: 1920 },
  { formatId: 'tw-post', width: 1200, height: 675 },
];

const planFor = (composition: string, slots: DesignPlan['slots']): DesignPlan => ({
  variantId: 'v1',
  skill: 'sale-discount',
  concept: 'Half price week',
  formatTemplate: composition,
  styleId: 'bold',
  palette: [],
  typeScale: {},
  background: { kind: 'solid', value: '#0A0A0A' },
  slots,
  assetNeeds: [],
});

/**
 * Geometry only, rounded to whole pixels.
 *
 * Sub-pixel noise would make every snapshot churn on unrelated arithmetic
 * changes, and no design is wrong by half a pixel.
 */
const geometry = (doc: unknown) => {
  const output = (doc as { outputs: Record<string, unknown>[] }).outputs[0];
  const children = (output.children ?? []) as Record<string, number | string>[];
  return {
    typeBudget: output.typeBudget ?? null,
    children: children.map((el) => ({
      originId: el.originId ?? el.id,
      type: el.type,
      x: Math.round(el.x as number),
      y: Math.round(el.y as number),
      w: Math.round(el.width as number),
      h: Math.round(el.height as number),
      // Text only. The LENIENT schema applies `lenientNum(…, 16)` to every
      // element, so parsing stamps `fontSize: 16` onto images, shapes and group
      // containers too — half the snapshot would be that constant, and the
      // numbers that matter would be lost in it.
      ...(el.type === 'text' && el.fontSize
        ? { fontSize: Math.round(el.fontSize as number) }
        : {}),
    })),
  };
};

describe.each(COMPOSITION_IDS)('composition %s', (composition) => {
  it.each(CANVASES)('lays out on $formatId', async (canvas) => {
    const doc = await compose(planFor(composition, SLOT_SETS.full), canvas);
    expect(geometry(doc)).toMatchSnapshot();
  });
});

describe.each(['hero-fullbleed', 'split-panel', 'top-bottom', 'badge-burst', 'editorial-sidebar', 'minimal-centered'])(
  'legacy composition %s slot variants',
  (composition) => {
    it('without a footer, so the balance shift stays capped', async () => {
      const doc = await compose(planFor(composition, SLOT_SETS.noFooter), CANVASES[0]);
      expect(geometry(doc)).toMatchSnapshot();
    });

    it('with no imagery at all, which redirects the panel layouts', async () => {
      const doc = await compose(planFor(composition, SLOT_SETS.copyOnly), CANVASES[0]);
      expect(geometry(doc)).toMatchSnapshot();
    });
  }
);

/**
 * The channel-variant contract, stated as a test rather than left to the
 * snapshots: the same design at another size is the SAME design refitted —
 * never a different one, and never the square one squashed.
 */
describe('the same plan across aspects', () => {
  it('keeps the same elements, in the same order, on every canvas', async () => {
    const plan = planFor('hero-fullbleed', SLOT_SETS.full);
    const docs = await Promise.all(CANVASES.map((c) => compose(plan, c)));
    const origins = docs.map((d) =>
      geometry(d).children.map((c) => c.originId).sort()
    );
    expect(origins[1]).toEqual(origins[0]);
    expect(origins[2]).toEqual(origins[0]);
  });

  it('scales type with the canvas rather than pinning it to the short side', async () => {
    // The squashing bug: a 1200x675 banner sized its headline for 675px, so
    // every wide variant read as the square design compressed.
    const plan = planFor('hero-fullbleed', SLOT_SETS.full);
    const [square, , banner] = await Promise.all(CANVASES.map((c) => compose(plan, c)));
    const sizeOf = (doc: unknown) =>
      geometry(doc).children.find((c) => c.originId === 'headline')?.fontSize ?? 0;
    expect(sizeOf(banner)).toBeGreaterThan(0);
    expect(sizeOf(square)).toBeGreaterThan(0);
  });
});

/**
 * The defect this batch fixes, stated end to end.
 *
 * `shape`, `icon`, `divider`, `logo` and `frame` were added to `DesignSlot` and
 * declared across forty-one skills, and `_buildElements` read `plan.slots` in
 * three places that matched none of them. The slots were dropped before
 * anything was built, silently, in every design that asked for one.
 */
describe('slot kinds that used to vanish', () => {
  const withKinds = planFor('type-dominant', [
    { id: 'headline', role: 'headline', kind: 'text' },
    { id: 'sub', role: 'subhead', kind: 'text' },
    { id: 'rule', role: 'decor', kind: 'divider' },
    { id: 'mark', role: 'decor', kind: 'shape' },
    { id: 'edge', role: 'decor', kind: 'frame' },
  ]);

  it('composes an element for every declared kind', async () => {
    const doc = await compose(withKinds, CANVASES[0]);
    const origins = geometry(doc).children.map((c) => c.originId);
    for (const id of ['rule', 'mark', 'edge']) {
      expect(origins, `${id} was dropped`).toContain(id);
    }
  });

  it('keeps them inside the canvas', async () => {
    const doc = await compose(withKinds, CANVASES[1]);
    for (const el of geometry(doc).children) {
      expect(el.x, el.originId as string).toBeGreaterThanOrEqual(-1);
      expect(el.y, el.originId as string).toBeGreaterThanOrEqual(-1);
    }
  });

  it('still composes when a plan declares none of them', async () => {
    // The fix must be inert for every plan written before it.
    const doc = await compose(planFor('hero-fullbleed', SLOT_SETS.full), CANVASES[0]);
    expect(geometry(doc).children.length).toBeGreaterThan(0);
  });
});

describe('headline emphasis', () => {
  it('sets the offer apart inside the headline', async () => {
    // "Half price this week only" gave equal weight to the offer and the
    // filler around it. One word set heavier is the most basic typographic
    // move there is, and the composer could not make it.
    const doc = await compose(planFor('hero-fullbleed', SLOT_SETS.full), CANVASES[0]);
    const headline = (doc.outputs[0] as any).children.find(
      (c: any) => c.originId === 'headline'
    );
    expect(headline.richText?.length).toBeGreaterThan(1);
    const emphasised = headline.richText.filter((r: any) => r.fontWeight || r.fill);
    expect(emphasised.length).toBeGreaterThan(0);
    expect(emphasised.length).toBeLessThan(headline.richText.length);
  });

  it('does not change any geometry', async () => {
    // Emphasis runs AFTER `_clampTextToFit`, because the clamp skips elements
    // carrying `richText` — emphasising during construction opted headlines out
    // of overflow correction and returned them 12% larger.
    const doc = await compose(planFor('hero-fullbleed', SLOT_SETS.full), CANVASES[0]);
    expect(geometry(doc)).toMatchSnapshot();
  });

  it('leaves supporting copy alone', async () => {
    const doc = await compose(planFor('hero-fullbleed', SLOT_SETS.full), CANVASES[0]);
    const sub = (doc.outputs[0] as any).children.find((c: any) => c.originId === 'sub');
    expect(sub.richText).toBeUndefined();
  });
});

describe('typeBudget follows the arrangement that actually composed', () => {
  it('stamps an engine composition′s own band ratio, not its legacy fallback′s', async () => {
    // Invisible on the primary output and wrong on every other one:
    // `typeBudget` is what reflow re-fits the channel variants from, so a
    // type-dominant design stamped with minimal-centered's 0.52 would typeset
    // all its siblings for an arrangement it is not.
    const typeLed = await compose(planFor('type-dominant', SLOT_SETS.copyOnly), CANVASES[0]);
    const centred = await compose(planFor('minimal-centered', SLOT_SETS.copyOnly), CANVASES[0]);
    expect((typeLed.outputs[0] as any).typeBudget).not.toBeCloseTo(
      (centred.outputs[0] as any).typeBudget,
      3
    );
  });

  it('leaves the legacy six on the budget they always had', async () => {
    const doc = await compose(planFor('hero-fullbleed', SLOT_SETS.full), CANVASES[0]);
    expect((doc.outputs[0] as any).typeBudget).toBeGreaterThan(0);
  });
});
