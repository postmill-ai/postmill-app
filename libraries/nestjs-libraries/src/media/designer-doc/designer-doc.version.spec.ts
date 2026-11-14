import { describe, expect, it } from 'vitest';
import { assertSupportedDesignerDocVersion } from './designer-doc.version';

describe('organization import DesignerDoc compatibility', () => {
  it('accepts supported document versions in object and serialized archive rows', () => {
    expect(() => assertSupportedDesignerDocVersion({ version: 13 })).not.toThrow();
    expect(() => assertSupportedDesignerDocVersion(JSON.stringify({ version: 14 }))).not.toThrow();
  });

  it('rejects newer archive documents with an actionable upgrade error', () => {
    for (const doc of [{ version: 15 }, JSON.stringify({ version: 15 })]) {
      expect(() => assertSupportedDesignerDocVersion(doc)).toThrow(
        'DesignerDoc v15 is newer than this deployment supports (v14). Upgrade Postmill before importing this archive.'
      );
    }
  });
});
