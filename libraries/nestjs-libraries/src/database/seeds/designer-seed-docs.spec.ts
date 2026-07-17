import { describe, it, expect } from 'vitest';
import { DesignerDocService } from '@gitroom/nestjs-libraries/media/designer-doc/designer-doc.service';
import {
  SYSTEM_DESIGN_TEMPLATES,
  DEMO_DESIGNS,
  DEMO_DESIGN_PREFIX,
} from './designer-seed-docs';

// DesignerDocService has a no-arg constructor — its validate/validateStrict are
// pure schema checks, so we can exercise the real validator directly.
const svc = new DesignerDocService();

const allDocs = [
  ...SYSTEM_DESIGN_TEMPLATES.map((t) => ({ label: `template "${t.name}"`, doc: t.doc })),
  ...DEMO_DESIGNS.map((d) => ({ label: `demo design "${d.name}"`, doc: d.doc })),
];

describe('designer seed docs', () => {
  it.each(allDocs)('$label passes strict validation and renders in-bounds', ({ doc }) => {
    // validateStrict is the strongest guarantee: no unknown keys, every
    // required element field present, all numerics in range. Passing strict
    // implies passing the lenient create/apply path the app actually uses.
    expect(() => svc.validateStrict(doc)).not.toThrow();

    const out = svc.validate(doc).outputs[0] as { width: number; height: number };
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
  });

  it('system template names are unique (idempotent upsert key)', () => {
    const names = SYSTEM_DESIGN_TEMPLATES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every demo design name carries the reset prefix', () => {
    for (const d of DEMO_DESIGNS) {
      expect(d.name.startsWith(DEMO_DESIGN_PREFIX)).toBe(true);
    }
  });
});
