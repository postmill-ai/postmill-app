import { describe, it, expect } from 'vitest';
import { applySlotRecipes, treatmentAdjustmentLayers } from '../../design-language';
import { wrapMoveUnitsInGroups } from '../../util/layer-groups';
import { DesignerDocStrictSchema } from '../../../media/designer-doc/designer-doc.schema';
import { buildLayerTree } from '../../../media/designer-doc/layer-tree';
import type { DesignerElement } from '../../../media/designer-doc/designer-doc.schema';

/**
 * The design language reaching a real document.
 *
 * The unit specs prove each recipe expands correctly; this proves the result is
 * something the renderers will accept and draw. A recipe that produces a
 * document the strict schema rejects takes the WHOLE compose down to the
 * fallback layout, so this is the boundary worth guarding.
 */

const PALETTE = ['#0b1020', '#f5f5f0', '#ff5a36'];

const image = (): DesignerElement =>
  ({
    id: 'img',
    type: 'image',
    originId: 'hero',
    groupId: 'hero-unit',
    x: 0,
    y: 0,
    width: 1080,
    height: 700,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    src: 'https://example.test/a.jpg',
    fitMode: 'cover',
  }) as DesignerElement;

const headline = (): DesignerElement =>
  ({
    id: 'h',
    type: 'text',
    originId: 'headline',
    groupId: 'hero-unit',
    x: 60,
    y: 760,
    width: 960,
    height: 220,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    text: 'Half price this week',
    fontSize: 96,
  }) as DesignerElement;

const docOf = (children: DesignerElement[]) => ({
  version: 6,
  mode: 'image' as const,
  outputs: [
    {
      id: 'o',
      formatId: 'square',
      name: 'S',
      width: 1080,
      height: 1080,
      background: '#ffffff',
      children,
    },
  ],
});

const compose = (
  slots: Record<string, Parameters<typeof applySlotRecipes>[0]>
): DesignerElement[] => {
  const built: DesignerElement[] = [];
  for (const el of [image(), headline()]) {
    const slot = slots[el.originId!] || {};
    const kind = el.type === 'image' ? 'image' : 'text';
    const basis = kind === 'text' ? el.fontSize! : Math.min(el.width, el.height);
    const next = {
      ...el,
      ...applySlotRecipes(slot, el, { basis, palette: PALETTE, kind }, el.text),
    } as DesignerElement;
    built.push(next);
    if (kind === 'image') {
      built.push(...treatmentAdjustmentLayers(slot, next, { palette: PALETTE }));
    }
  }
  return wrapMoveUnitsInGroups(built, { genId: () => 'grp-1' });
};

describe('a plan carrying the design language composes a valid document', () => {
  it('validates with effects, a treatment and a mask all applied', () => {
    const children = compose({
      hero: { treatment: 'duotone-brand', mask: 'arch' },
      headline: { effects: ['soft-lift', 'sticker-outline'] },
    });
    const parsed = DesignerDocStrictSchema.safeParse(docOf(children));
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.[0])).toBe(true);
  });

  it('puts the adjustment layers directly above the image they grade', () => {
    // Order is the effect: an adjustment grades whatever is beneath it, so one
    // that drifted below its image would grade the background instead.
    const children = compose({ hero: { treatment: 'duotone-brand' } });
    const ids = children.map((c) => `${c.type}:${c.adjustment?.type ?? ''}`);
    const imageIndex = ids.findIndex((s) => s.startsWith('image'));
    const firstAdj = ids.findIndex((s) => s.startsWith('adjustment'));
    expect(firstAdj).toBe(imageIndex + 1);
  });

  it('clips the adjustments so they cannot grade the copy', () => {
    const children = compose({ hero: { treatment: 'mono-tint' } });
    const adjustments = children.filter((c) => c.type === 'adjustment');
    expect(adjustments.length).toBeGreaterThan(0);
    expect(adjustments.every((a) => a.clipped)).toBe(true);
  });

  it('keeps the adjustments inside the image′s folder', () => {
    // Otherwise a re-fit moves the image and leaves its grade behind.
    const children = compose({ hero: { treatment: 'mono' } });
    const tree = buildLayerTree(children);
    const group = tree.find((n) => n.element.type === 'group');
    expect(group).toBeDefined();
    const inside = group!.children.map((c) => c.element.type);
    expect(inside).toContain('adjustment');
    expect(inside).toContain('image');
  });

  it('leaves a plan with no design language exactly as it was', () => {
    // Every existing plan is one of these; the new vocabulary must be inert
    // when unused.
    const plain = compose({});
    expect(plain.filter((c) => c.type === 'adjustment')).toHaveLength(0);
    expect(plain.every((c) => c.styles === undefined)).toBe(true);
    expect(plain.every((c) => c.smartFilters === undefined)).toBe(true);
  });

  it('validates when every image recipe is stacked at once', () => {
    const children = compose({
      hero: { treatment: 'halftone-print', mask: 'squircle', effects: ['framed-plate'], blend: 'multiply' },
      headline: { effects: ['neon-glow'], rotation: -4 },
    });
    const parsed = DesignerDocStrictSchema.safeParse(docOf(children));
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.[0])).toBe(true);
  });

  it('writes a filter recipe the server renderer can evaluate on its own', () => {
    // Smart filters are a recipe plus the pixels it starts from. The composer
    // has baked nothing, so `src` IS the original — and the server resolves
    // `originalSrc || src`, so this renders correctly either way.
    const children = compose({ hero: { treatment: 'film-grain' } });
    const img = children.find((c) => c.type === 'image')!;
    expect(img.smartFilters?.length).toBeGreaterThan(0);
    expect(img.src).toBeTruthy();
  });
});
