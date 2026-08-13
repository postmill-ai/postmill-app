import { describe, it, expect } from 'vitest';
import {
  EFFECT_RECIPES,
  EFFECT_RECIPE_IDS,
  expandEffects,
  type EffectContext,
} from './effect-recipes';
import {
  IMAGE_TREATMENTS,
  IMAGE_TREATMENT_IDS,
  expandTreatment,
} from './image-treatments';
import { MASK_RECIPES, MASK_RECIPE_IDS, expandMask } from './mask-recipes';
import {
  DECOR_RECIPES,
  DECOR_RECIPE_IDS,
  MAX_LOUD_DECOR,
  expandDecor,
} from './decor-recipes';
import { designLanguagePrompt, DESIGN_LANGUAGE_IDS } from './recipe-catalog';
import { MAX_LAYER_STYLES, MAX_SMART_FILTERS } from '../../media/designer-doc/designer-doc.limits';
import { STYLE_ORDER } from '../../media/designer-doc/layer-styles';
import { ADJUSTMENT_DESCRIPTOR_BY_TYPE } from '../../media/designer-doc/adjustment-descriptors';
import { filterById } from '../../media/designer-doc/filter-descriptors';
import { DesignerDocStrictSchema } from '../../media/designer-doc/designer-doc.schema';

const PALETTE = ['#0b1020', '#f5f5f0', '#ff5a36', '#2ec4b6'];
const ctx = (over: Partial<EffectContext> = {}): EffectContext => ({
  basis: 96,
  palette: PALETTE,
  ...over,
});

/**
 * Drift guards.
 *
 * These tables are the AI's whole design vocabulary, and every one of them is
 * offered to a model that will use whatever it is told exists. A recipe naming
 * a style type, adjustment or filter this build does not implement is not a
 * crash — it is a silently plainer design, which is the expensive kind of bug.
 */

describe('recipe tables are well-formed', () => {
  const tables = [
    ['effects', EFFECT_RECIPES, EFFECT_RECIPE_IDS],
    ['treatments', IMAGE_TREATMENTS, IMAGE_TREATMENT_IDS],
    ['masks', MASK_RECIPES, MASK_RECIPE_IDS],
    ['decor', DECOR_RECIPES, DECOR_RECIPE_IDS],
  ] as const;

  it.each(tables)('%s have unique ids', (_name, recipes) => {
    const ids = recipes.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(tables)('%s expose their ids in the same order', (_name, recipes, ids) => {
    expect(ids).toEqual(recipes.map((r) => r.id));
  });

  it.each(tables)('%s all carry a description for the model', (_name, recipes) => {
    for (const r of recipes) {
      expect(r.description.length, `${r.id} has no description`).toBeGreaterThan(20);
    }
  });

  it.each(tables)('%s use kebab-case ids', (_name, recipes) => {
    for (const r of recipes) expect(r.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe('effect recipes', () => {
  it('only name layer-style types the renderers actually paint', () => {
    // STYLE_ORDER is the renderers' contract. A type outside it is dropped
    // silently by `orderedStyles`, so the effect would simply never appear.
    for (const recipe of EFFECT_RECIPES) {
      for (const style of recipe.expand(ctx())) {
        expect(STYLE_ORDER, `${recipe.id} names ${style.type}`).toContain(style.type);
      }
    }
  });

  it('produce documents the strict schema accepts', () => {
    // The composer's output is schema-validated; a recipe emitting an
    // out-of-range opacity would fail the whole compose, not just itself.
    for (const recipe of EFFECT_RECIPES) {
      const doc = {
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
            children: [
              {
                id: 'e',
                type: 'text' as const,
                x: 0,
                y: 0,
                width: 500,
                height: 200,
                rotation: 0,
                opacity: 1,
                locked: false,
                hidden: false,
                text: 'Hello',
                styles: recipe.expand(ctx()),
              },
            ],
          },
        ],
      };
      const parsed = DesignerDocStrictSchema.safeParse(doc);
      expect(parsed.success, `${recipe.id}: ${JSON.stringify(parsed.error?.issues?.[0])}`).toBe(true);
    }
  });

  it('scale geometry with the basis rather than baking in pixels', () => {
    // The whole reason recipes exist. A shadow tuned at one size and emitted
    // verbatim at another is the magic number this replaces.
    const small = expandEffects(['drop-depth'], ctx({ basis: 40 }));
    const large = expandEffects(['drop-depth'], ctx({ basis: 400 }));
    expect(small[0].size).toBeGreaterThan(0);
    expect(large[0].size).toBeCloseTo((small[0].size as number) * 10, 5);
  });

  it('picks a shadow colour that is visible on the backdrop it is given', () => {
    // A dark halo on a dark backdrop is invisible, which is how "add a shadow
    // for legibility" turns into a no-op the critic then re-requests forever.
    const onLight = expandEffects(['soft-lift'], ctx({ backdrop: 'light' }))[0];
    const onDark = expandEffects(['soft-lift'], ctx({ backdrop: 'dark' }))[0];
    expect(onLight.color).not.toBe(onDark.color);
  });

  it('drops an unknown name instead of throwing', () => {
    expect(expandEffects(['no-such-effect'], ctx())).toEqual([]);
    expect(expandEffects(['no-such-effect', 'soft-lift'], ctx())).toHaveLength(1);
  });

  it('never exceeds the schema cap however many recipes are combined', () => {
    const everything = EFFECT_RECIPE_IDS.concat(EFFECT_RECIPE_IDS);
    expect(expandEffects(everything, ctx()).length).toBeLessThanOrEqual(MAX_LAYER_STYLES);
  });

  it('survives a one-colour palette', () => {
    // Plans are model-authored; a two- or one-entry palette is not exotic.
    for (const recipe of EFFECT_RECIPES) {
      expect(() => recipe.expand({ basis: 96, palette: ['#123456'] })).not.toThrow();
    }
  });
});

describe('image treatments', () => {
  it('only name adjustment types this build implements', () => {
    for (const t of IMAGE_TREATMENTS) {
      for (const adj of t.expand({ palette: PALETTE }).adjustments) {
        expect(ADJUSTMENT_DESCRIPTOR_BY_TYPE[adj.type], `${t.id} names ${adj.type}`).toBeDefined();
      }
    }
  });

  it('only name filter ids this build implements', () => {
    // `applyFilter` no-ops on an unknown id, so a typo here is a treatment that
    // quietly does nothing rather than an error anyone would notice.
    for (const t of IMAGE_TREATMENTS) {
      for (const f of t.expand({ palette: PALETTE }).smartFilters) {
        expect(filterById(f.id), `${t.id} names ${f.id}`).toBeDefined();
      }
    }
  });

  it('only set adjustment values the descriptor declares, within its range', () => {
    for (const t of IMAGE_TREATMENTS) {
      for (const adj of t.expand({ palette: PALETTE }).adjustments) {
        const descriptor = ADJUSTMENT_DESCRIPTOR_BY_TYPE[adj.type];
        for (const [key, value] of Object.entries(adj.values || {})) {
          const param = descriptor.params.find((p) => p.key === key);
          expect(param, `${t.id}: ${adj.type} has no param "${key}"`).toBeDefined();
          expect(value, `${t.id}: ${adj.type}.${key}`).toBeGreaterThanOrEqual(param!.min);
          expect(value, `${t.id}: ${adj.type}.${key}`).toBeLessThanOrEqual(param!.max);
        }
      }
    }
  });

  it('honours the strength dial', () => {
    const full = expandTreatment('contrast-punch', { palette: PALETTE, strength: 1 });
    const half = expandTreatment('contrast-punch', { palette: PALETTE, strength: 0.5 });
    expect(half.adjustments[0].values!.contrast).toBeCloseTo(
      full.adjustments[0].values!.contrast / 2,
      5
    );
  });

  it('builds duotone ramps from the palette, not from fixed colours', () => {
    // The point of the treatment: imagery that belongs to this design, not to
    // whichever stock library it came from.
    const a = expandTreatment('duotone-brand', { palette: ['#000000', '#111111', '#ff0000'] });
    const b = expandTreatment('duotone-brand', { palette: ['#000000', '#111111', '#00ff00'] });
    const ramp = (r: typeof a) => r.adjustments.find((x) => x.type === 'gradient-map')?.gradient;
    expect(ramp(a)).not.toEqual(ramp(b));
  });

  it('treats an unknown or absent name as untreated', () => {
    expect(expandTreatment('no-such-treatment', { palette: PALETTE })).toEqual({
      adjustments: [],
      smartFilters: [],
    });
    expect(expandTreatment(undefined, { palette: PALETTE }).adjustments).toEqual([]);
  });

  it('offers an explicit way to leave a photograph alone', () => {
    // Without one, a model asked for a treatment will always invent one.
    expect(IMAGE_TREATMENT_IDS).toContain('none');
    expect(expandTreatment('none', { palette: PALETTE }).adjustments).toEqual([]);
  });

  it('never exceeds the smart-filter cap', () => {
    for (const t of IMAGE_TREATMENTS) {
      expect(t.expand({ palette: PALETTE }).smartFilters.length).toBeLessThanOrEqual(
        MAX_SMART_FILTERS
      );
    }
  });
});

describe('mask recipes', () => {
  const box = { width: 400, height: 800 };

  it('only name silhouettes the schema allows', () => {
    const allowed = ['ellipse', 'rounded-rect', 'triangle', 'star', 'hexagon', 'heart'];
    for (const m of MASK_RECIPES) {
      if (m.mask?.type === 'shape' && m.mask.shape) {
        expect(allowed, `${m.id} names ${m.mask.shape}`).toContain(m.mask.shape);
      }
    }
  });

  it('converts a corner-radius ratio against the SHORT side', () => {
    // Against the long side, a "soft corner" on a tall portrait crop becomes a
    // pill; against the short side it stays a soft corner at any aspect.
    expect(expandMask('soft-corners', box).borderRadius).toBeCloseTo(400 * 0.04, 5);
  });

  it('scales an arch with the box rather than emitting a unit ratio', () => {
    const arch = expandMask('arch', box).mask;
    expect(arch?.cornerRadius).toBeCloseTo(200, 5);
  });

  it('needs a word before it will knock text out of an image', () => {
    // A text mask with no text is an invisible layer — strictly worse than no
    // mask, because the image disappears entirely.
    expect(expandMask('text-knockout', box)).toEqual({});
    expect(expandMask('text-knockout', box, 'SALE').mask?.text).toBe('SALE');
  });

  it('flags a subject knockout rather than pretending it is declarative', () => {
    // It costs a background-removal call, so the composer has to decide.
    expect(expandMask('subject-knockout', box).knockout).toBe(true);
  });

  it('gives every expensive recipe a fallback', () => {
    for (const m of MASK_RECIPES) {
      if (m.knockout) expect(m.fallbackId, `${m.id} has no fallback`).toBeTruthy();
    }
  });

  it('treats an unknown name as no mask', () => {
    expect(expandMask('no-such-mask', box)).toEqual({});
  });
});

describe('decor recipes', () => {
  const box = { x: 100, y: 50, width: 400, height: 200 };

  it('emit unit-box geometry', () => {
    // Anything outside 0..1 would land off-canvas once scaled.
    for (const d of DECOR_RECIPES) {
      for (const n of d.nodes()) {
        expect(n.x, `${d.id}`).toBeGreaterThanOrEqual(-0.01);
        expect(n.x, `${d.id}`).toBeLessThanOrEqual(1.01);
        expect(n.y, `${d.id}`).toBeGreaterThanOrEqual(-0.01);
        expect(n.y, `${d.id}`).toBeLessThanOrEqual(1.01);
      }
    }
  });

  it('scale anchors AND bezier handles into the target box', () => {
    // A handle left in unit space while its anchor moves whips the path across
    // the canvas — the obvious way to get this wrong.
    const nodes = expandDecor('underline-swash', box);
    for (const n of nodes) {
      expect(n.x).toBeGreaterThanOrEqual(box.x - 1);
      expect(n.x).toBeLessThanOrEqual(box.x + box.width + 1);
      if (n.outX !== undefined) {
        expect(n.outX).toBeGreaterThanOrEqual(box.x - 1);
        expect(n.outX).toBeLessThanOrEqual(box.x + box.width + 1);
      }
      if (n.outY !== undefined) {
        expect(n.outY).toBeGreaterThanOrEqual(box.y - 1);
        expect(n.outY).toBeLessThanOrEqual(box.y + box.height + 1);
      }
    }
  });

  it('places geometry at the box origin, not at the canvas origin', () => {
    const nodes = expandDecor('rule', box);
    expect(nodes[0].x).toBeCloseTo(100, 5);
    expect(nodes[0].y).toBeCloseTo(150, 5);
  });

  it('offers an explicit way to add nothing', () => {
    expect(DECOR_RECIPE_IDS).toContain('none');
    expect(expandDecor('none', box)).toEqual([]);
  });

  it('keeps loud marks rare', () => {
    // Restraint has to be structural. A model told "use decoration tastefully"
    // will not comply reliably; a cap will.
    expect(MAX_LOUD_DECOR).toBe(1);
    const loud = DECOR_RECIPES.filter((d) => d.restraint === 'loud');
    expect(loud.length).toBeLessThan(DECOR_RECIPES.length / 3);
  });

  it('gives every stroked recipe a weight', () => {
    for (const d of DECOR_RECIPES) {
      if (!d.filled && d.nodes().length) {
        expect(d.strokeRatio, `${d.id} is stroked but has no weight`).toBeGreaterThan(0);
      }
    }
  });

  it('treats an unknown name as no decoration', () => {
    expect(expandDecor('no-such-decor', box)).toEqual([]);
  });
});

describe('the generated catalog', () => {
  it('names every recipe from every table', () => {
    // The guard against the silent failure this whole pattern exists to
    // prevent: a model offered a vocabulary the composer does not implement,
    // or implementing one the model is never told about.
    const prompt = designLanguagePrompt();
    for (const ids of Object.values(DESIGN_LANGUAGE_IDS)) {
      for (const id of ids) expect(prompt, `catalog omits ${id}`).toContain(id);
    }
  });

  it('exposes exactly the ids the tables define', () => {
    expect(DESIGN_LANGUAGE_IDS.effects).toEqual(EFFECT_RECIPE_IDS);
    expect(DESIGN_LANGUAGE_IDS.treatments).toEqual(IMAGE_TREATMENT_IDS);
    expect(DESIGN_LANGUAGE_IDS.masks).toEqual(MASK_RECIPE_IDS);
    expect(DESIGN_LANGUAGE_IDS.decor).toEqual(DECOR_RECIPE_IDS);
  });

  it('stays small enough to sit in a system prompt', () => {
    // It rides in every planning call; runaway growth here is a per-request
    // cost on every design anyone ever generates.
    expect(designLanguagePrompt().length).toBeLessThan(8000);
  });
});
