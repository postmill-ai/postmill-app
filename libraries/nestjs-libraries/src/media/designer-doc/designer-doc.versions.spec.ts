import { describe, it, expect } from 'vitest';
import {
  DESIGNER_DOC_VERSION,
  createBlankDoc,
  migrateDoc,
} from './designer-doc.migrate';
import {
  BLEND_MODES,
  DesignerDocLenientSchema,
  DesignerDocStrictSchema,
} from './designer-doc.schema';

/**
 * Schema version contract.
 *
 * v3 added `path`/`raster` element types and the `triangle`/`polygon` shapes.
 * v4 added `group`/`fill`/`adjustment`, `parentId`, blend modes and layer
 * styles. Every version so far has been ADDITIVE, so the contract is: older
 * documents keep loading unchanged and stay valid, and the new types pass BOTH
 * the lenient parser used by the render endpoint and the strict one used by the
 * agent-ops path.
 *
 * `migrateDoc` deliberately preserves an existing document's `version` rather
 * than restamping it — nothing branches on the field, and an older document is
 * a valid newer one, so there is nothing to rewrite.
 */

const blank = () => createBlankDoc(1080, 1080) as never as Record<string, any>;

const element = (over: Record<string, unknown>) => ({
  id: 'el-x',
  x: 0, y: 0, width: 100, height: 100,
  rotation: 0, opacity: 1, locked: false, hidden: false,
  ...over,
});

const docWith = (el: Record<string, unknown>) => {
  const doc = blank();
  doc.outputs[0].children = [el];
  return doc;
};

describe('DesignerDoc schema versions', () => {
  it('stamps new documents with the current version', () => {
    // Asserting the constant rather than a literal keeps this from going stale
    // on every bump — only the blank-doc wiring is under test here.
    expect(blank().version).toBe(DESIGNER_DOC_VERSION);
  });

  it('loads a v2 document intact, without rewriting it', () => {
    const doc = blank();
    doc.version = 2;
    doc.outputs[0].children = [
      element({ type: 'text', text: 'Hello', fontSize: 32 }),
    ];
    const migrated = migrateDoc(structuredClone(doc));
    expect(migrated.version).toBe(2);
    expect(migrated.outputs[0].children).toHaveLength(1);
    expect(migrated.outputs[0].children[0]).toMatchObject({
      type: 'text', text: 'Hello',
    });
  });

  it('validates a v2 document against the v3 schema', () => {
    const doc = blank();
    doc.version = 2;
    doc.outputs[0].children = [element({ type: 'text', text: 'Hi', fontSize: 16 })];
    expect(DesignerDocStrictSchema.safeParse(doc).success).toBe(true);
  });

  it('accepts a path element through both parsers', () => {
    const doc = docWith(
      element({
        type: 'path',
        nodes: [
          { x: 0, y: 0, outX: 10, outY: 0 },
          { x: 100, y: 100, inX: 90, inY: 100 },
        ],
        closed: true,
        stroke: '#000000',
        strokeWidth: 2,
      })
    );
    expect(DesignerDocStrictSchema.safeParse(doc).success).toBe(true);
    expect(DesignerDocLenientSchema.safeParse(doc).success).toBe(true);
  });

  it('accepts a raster element through both parsers', () => {
    const doc = docWith(
      element({
        type: 'raster',
        src: 'https://example.com/paint.png',
        fileId: 'file-1',
        naturalWidth: 100,
        naturalHeight: 100,
      })
    );
    expect(DesignerDocLenientSchema.safeParse(doc).success).toBe(true);
    expect(DesignerDocStrictSchema.safeParse(doc).success).toBe(true);
  });

  it('accepts the new polygon shapes', () => {
    for (const shape of ['triangle', 'polygon']) {
      const doc = docWith(element({ type: 'shape', shape, sides: 7 }));
      expect(DesignerDocStrictSchema.safeParse(doc).success).toBe(true);
    }
  });

  it('still rejects an unknown element type', () => {
    expect(
      DesignerDocStrictSchema.safeParse(docWith(element({ type: 'hologram' }))).success
    ).toBe(false);
  });

  it('accepts group / fill / adjustment elements with layer fields (v4)', () => {
    const doc = blank();
    doc.outputs[0].children = [
      element({ id: 'grp-1', type: 'group', name: 'Folder', blendMode: 'multiply', opacity: 0.8 }),
      element({
        id: 'el-1', type: 'shape', shape: 'rect', parentId: 'grp-1',
        blendMode: 'soft-light', clipped: true,
        styles: [
          { type: 'drop-shadow', enabled: true, color: '#000000', distance: 4, size: 8, angle: 120, useGlobalLight: true },
          { type: 'stroke', color: '#ffffff', size: 2, position: 'outside' },
        ],
      }),
      element({ id: 'fill-1', type: 'fill', fillStyle: { type: 'pattern', pattern: { preset: 'dots', scale: 2 } } }),
      element({
        id: 'adj-1', type: 'adjustment',
        adjustment: { type: 'levels', values: { black: 12, white: 240, gamma: 1.1 } },
      }),
    ];
    expect(DesignerDocStrictSchema.safeParse(doc).success).toBe(true);
    expect(DesignerDocLenientSchema.safeParse(doc).success).toBe(true);
  });

  it('accepts every declared blend mode', () => {
    for (const mode of BLEND_MODES) {
      const doc = docWith(element({ type: 'shape', shape: 'rect', blendMode: mode }));
      expect(DesignerDocStrictSchema.safeParse(doc).success).toBe(true);
    }
  });

  it('rejects an unknown blend mode', () => {
    const doc = docWith(element({ type: 'shape', blendMode: 'teleport' }));
    expect(DesignerDocStrictSchema.safeParse(doc).success).toBe(false);
  });

  it('keeps groupId and parentId as separate, coexisting concepts', () => {
    // groupId is the cross-format reflow move-unit; parentId is the layer
    // folder. A layer group sets BOTH, so the folder also reflows as a unit.
    const doc = docWith(
      element({ type: 'shape', shape: 'rect', groupId: 'cta-pair', parentId: 'grp-1' })
    );
    expect(DesignerDocStrictSchema.safeParse(doc).success).toBe(true);
  });

  it('does not rewrite groupId on load — reflow depends on it', () => {
    const doc = blank();
    doc.outputs[0].children = [element({ type: 'shape', shape: 'rect', groupId: 'pair-1' })];
    const migrated = migrateDoc(structuredClone(doc));
    expect(migrated.outputs[0].children[0].groupId).toBe('pair-1');
    expect(migrated.outputs[0].children[0].parentId).toBeUndefined();
  });

  it('bounds layer styles per element', () => {
    const doc = docWith(
      element({
        type: 'shape',
        styles: Array.from({ length: 100 }, () => ({ type: 'drop-shadow' as const })),
      })
    );
    expect(DesignerDocStrictSchema.safeParse(doc).success).toBe(false);
  });

  it('bounds path node count so one element cannot balloon the document', () => {
    const doc = docWith(
      element({
        type: 'path',
        nodes: Array.from({ length: 5000 }, (_, i) => ({ x: i, y: i })),
      })
    );
    expect(DesignerDocStrictSchema.safeParse(doc).success).toBe(false);
  });
});
