import { describe, expect, it } from 'vitest';
import { assertSupportedDesignerDocVersion } from './designer-doc.version';
import { DESIGNER_DOC_VERSION } from './designer-doc.limits';

describe('organization import DesignerDoc compatibility', () => {
  it('accepts supported document versions in object and serialized archive rows', () => {
    expect(() => assertSupportedDesignerDocVersion({ version: 13 })).not.toThrow();
    expect(() => assertSupportedDesignerDocVersion(JSON.stringify({ version: 14 }))).not.toThrow();
  });

  it('rejects newer archive documents with an actionable upgrade error', () => {
    for (const doc of [
      { version: DESIGNER_DOC_VERSION + 1 },
      JSON.stringify({ version: DESIGNER_DOC_VERSION + 1 }),
    ]) {
      expect(() => assertSupportedDesignerDocVersion(doc)).toThrow(
        `DesignerDoc v${DESIGNER_DOC_VERSION + 1} is newer than this deployment supports (v${DESIGNER_DOC_VERSION}). Upgrade Postmill before importing this archive.`
      );
    }
  });
});
