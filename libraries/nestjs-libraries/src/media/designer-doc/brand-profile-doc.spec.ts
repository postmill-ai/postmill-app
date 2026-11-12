import { describe, expect, it } from 'vitest';
import { createBlankDoc, migrateDoc } from './designer-doc.migrate';
import { DesignerDocLenientSchema, DesignerDocStrictSchema } from './designer-doc.schema';

describe('DesignerDoc Brand Kit selection', () => {
  it('preserves an explicit Brand Kit id through migration and both validators', () => {
    const doc = { ...createBlankDoc(), brandProfileId: 'brand-2' };
    expect(migrateDoc(doc).brandProfileId).toBe('brand-2');
    expect(DesignerDocStrictSchema.parse(doc).brandProfileId).toBe('brand-2');
    expect(DesignerDocLenientSchema.parse(doc).brandProfileId).toBe('brand-2');
  });

  it('distinguishes General Mode from legacy default resolution', () => {
    const general = migrateDoc({ ...createBlankDoc(), brandProfileId: null });
    const legacy = migrateDoc(createBlankDoc());
    expect(general.brandProfileId).toBeNull();
    expect(legacy).not.toHaveProperty('brandProfileId');
    expect(DesignerDocStrictSchema.parse(general).brandProfileId).toBeNull();
    expect(DesignerDocLenientSchema.parse(legacy)).not.toHaveProperty('brandProfileId');
  });
});
