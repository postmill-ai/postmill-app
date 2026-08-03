import { describe, it, expect } from 'vitest';
import {
  COMPOSITIONS,
  COMPOSITION_IDS,
  compositionById,
  compositionCatalogPrompt,
  resolveComposition,
} from './compositions';
import { compositionFits, type CompositionContext, type SlotRole } from './composition';
import { arrange, measure, type MeasureContext } from './box-model';
import { buildGrid } from './grid';

const ctxWith = (roles: SlotRole[], aspect = 1): CompositionContext => ({
  aspect,
  has: (role) => roles.includes(role),
});

const ALL: SlotRole[] = [
  'image',
  'headline',
  'subhead',
  'cta',
  'badge',
  'legal',
  'logo',
  'decor',
];

const grid = buildGrid({ width: 1080, height: 1080, formatId: 'ig-post' });
const measureCtx: MeasureContext = { grid, measureLeaf: () => 60 };
const canvas = { x: grid.left, y: grid.top, width: grid.right - grid.left, height: grid.bottom - grid.top };

describe('the gallery is well-formed', () => {
  it('has unique ids', () => {
    expect(new Set(COMPOSITION_IDS).size).toBe(COMPOSITION_IDS.length);
  });

  it('keeps the six originals, which are the regression anchors', () => {
    // These exist so the engine can be proved to reproduce today's output
    // before any of the composer's hand-tuned constants are deleted.
    for (const id of [
      'hero-fullbleed',
      'split-panel',
      'top-bottom',
      'badge-burst',
      'editorial-sidebar',
      'minimal-centered',
    ]) {
      expect(COMPOSITION_IDS, `${id} is missing`).toContain(id);
    }
  });

  it('describes every composition for the planning model', () => {
    for (const c of COMPOSITIONS) expect(c.description.length).toBeGreaterThan(20);
  });

  it('only requires roles it also declares', () => {
    for (const c of COMPOSITIONS) {
      for (const role of c.requires) {
        expect(c.roles, `${c.id} requires ${role} but does not place it`).toContain(role);
      }
    }
  });

  it('names every composition in the generated catalog', () => {
    const prompt = compositionCatalogPrompt();
    for (const id of COMPOSITION_IDS) expect(prompt).toContain(id);
  });
});

describe('every composition builds a usable tree', () => {
  it.each(COMPOSITIONS.map((c) => [c.id, c] as const))(
    '%s lays out inside its canvas with every role present',
    (_id, composition) => {
      const node = composition.build(ctxWith(ALL, 1));
      expect(measure(node, canvas.width, measureCtx)).toBeGreaterThanOrEqual(0);
      const placements = arrange(node, canvas, measureCtx);
      expect(placements.length).toBeGreaterThan(0);
      for (const p of placements) {
        expect(Number.isFinite(p.box.x), `${p.slotId}.x`).toBe(true);
        expect(Number.isFinite(p.box.y), `${p.slotId}.y`).toBe(true);
        expect(p.box.width).toBeGreaterThan(0);
        expect(p.box.height).toBeGreaterThanOrEqual(0);
        expect(p.box.x).toBeGreaterThanOrEqual(canvas.x - 0.001);
        expect(p.box.x + p.box.width).toBeLessThanOrEqual(canvas.x + canvas.width + 0.001);
      }
    }
  );

  it.each(COMPOSITIONS.map((c) => [c.id, c] as const))(
    '%s survives a plan carrying only its required roles',
    (_id, composition) => {
      const node = composition.build(ctxWith(composition.requires, 1));
      expect(() => arrange(node, canvas, measureCtx)).not.toThrow();
    }
  );

  it.each(COMPOSITIONS.map((c) => [c.id, c] as const))(
    '%s never places a role it did not declare',
    (_id, composition) => {
      const placements = arrange(composition.build(ctxWith(ALL, 1)), canvas, measureCtx);
      for (const p of placements) {
        expect(composition.roles, `${composition.id} placed ${p.slotId}`).toContain(
          p.slotId as SlotRole
        );
      }
    }
  );

  it.each(COMPOSITIONS.map((c) => [c.id, c] as const))(
    '%s drops a role the plan does not supply',
    (_id, composition) => {
      const placements = arrange(composition.build(ctxWith(['image'], 1)), canvas, measureCtx);
      for (const p of placements) expect(p.slotId).toBe('image');
    }
  );
});

describe('compositionFits', () => {
  it('rejects a two-column layout on a story canvas', () => {
    // It lays out perfectly well and is unreadable — the failure that never
    // raises an error and always reaches a user.
    const split = compositionById('split-panel')!;
    expect(compositionFits(split, ctxWith(ALL, 1080 / 1920))).toBe(false);
    expect(compositionFits(split, ctxWith(ALL, 1))).toBe(true);
  });

  it('rejects a landscape banner on a square', () => {
    expect(compositionFits(compositionById('banner-strip')!, ctxWith(ALL, 1))).toBe(false);
  });

  it('rejects a composition whose centrepiece is missing', () => {
    const burst = compositionById('badge-burst')!;
    expect(compositionFits(burst, ctxWith(['image', 'headline']))).toBe(false);
    expect(compositionFits(burst, ctxWith(['badge']))).toBe(true);
  });

  it('accepts a type-only composition with no imagery', () => {
    expect(compositionFits(compositionById('type-dominant')!, ctxWith(['headline']))).toBe(true);
  });
});

describe('resolveComposition', () => {
  it('honours a plan that names a composition that works', () => {
    expect(resolveComposition('minimal-centered', ctxWith(ALL, 1)).id).toBe('minimal-centered');
  });

  it('replaces a composition that does not fit the canvas', () => {
    const chosen = resolveComposition('split-panel', ctxWith(ALL, 1080 / 1920));
    expect(chosen.id).not.toBe('split-panel');
    expect(compositionFits(chosen, ctxWith(ALL, 1080 / 1920))).toBe(true);
  });

  it('replaces a composition whose required role is missing', () => {
    const chosen = resolveComposition('badge-burst', ctxWith(['headline'], 1));
    expect(chosen.id).not.toBe('badge-burst');
  });

  it('falls back for an unknown id rather than failing', () => {
    // Stored plans outlive the gallery; a removed composition must not sink a
    // design that was fine yesterday.
    expect(resolveComposition('no-such-composition', ctxWith(ALL, 1)).id).toBe('hero-fullbleed');
  });

  it('always returns something that fits, even on an extreme canvas', () => {
    const ctx = ctxWith(['headline'], 0.2);
    expect(compositionFits(resolveComposition(undefined, ctx), ctx)).toBe(true);
  });
});

describe('type budget', () => {
  it('gives every composition a copy band and a type scale', () => {
    // Both feed `typeBudget`, which is stamped on the output and consumed by
    // reflow to re-fit type onto every other format. A missing one silently
    // typesets the channel variants for the wrong canvas.
    for (const c of COMPOSITIONS) {
      expect(c.copyBandRatio, `${c.id} copyBandRatio`).toBeGreaterThan(0);
      expect(c.copyBandRatio, `${c.id} copyBandRatio`).toBeLessThanOrEqual(1);
      expect(c.typeScale, `${c.id} typeScale`).toBeGreaterThan(0);
    }
  });

  it('keeps the legacy six on their exact original numbers', () => {
    // Lifted verbatim from LAYOUT_COPY_BAND_RATIO and LAYOUT_TYPE_SCALE. These
    // are the type sizes eight rounds of remediation settled on; the port must
    // not quietly re-tune them under cover of a refactor.
    const legacy: Record<string, [number, number]> = {
      'hero-fullbleed': [0.49, 1],
      'badge-burst': [0.59, 0.95],
      'top-bottom': [0.55, 0.8],
      'split-panel': [0.9, 0.72],
      'editorial-sidebar': [0.9, 0.72],
      'minimal-centered': [0.52, 0.9],
    };
    for (const [id, [band, scale]] of Object.entries(legacy)) {
      const c = compositionById(id)!;
      expect([c.copyBandRatio, c.typeScale], id).toEqual([band, scale]);
    }
  });

  it('gives a two-column arrangement smaller type than a full-bleed one', () => {
    // Half the width has to say the same thing.
    expect(compositionById('split-panel')!.typeScale).toBeLessThan(
      compositionById('hero-fullbleed')!.typeScale
    );
  });

  it('gives the type-led arrangement the largest type and the deepest band', () => {
    const typeLed = compositionById('type-dominant')!;
    expect(typeLed.typeScale).toBeGreaterThanOrEqual(
      Math.max(...COMPOSITIONS.map((c) => c.typeScale))
    );
    expect(typeLed.copyBandRatio).toBeGreaterThan(compositionById('hero-fullbleed')!.copyBandRatio);
  });
});
