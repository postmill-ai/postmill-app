import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const FORBIDDEN_CONTRACT_INTERFACES = [
  'DesignerDoc',
  'DesignerElement',
  'DesignerOutput',
  'VideoOutput',
  'VideoTrack',
  'VideoClip',
  'DesignerBackground',
  'DesignerPageBackground',
];

const read = (relativePath: string) =>
  readFileSync(resolve(__dirname, relativePath), 'utf-8');

describe('DesignerDoc drift guard', () => {
  it('design-render.types.ts does not re-declare contract interfaces locally', () => {
    const src = read('../design-render/design-render.types.ts');
    for (const name of FORBIDDEN_CONTRACT_INTERFACES) {
      expect(src).not.toMatch(new RegExp(`\\binterface\\s+${name}\\b`));
    }
    // Sanity check: the file still exports something Designer-related.
    expect(src).toContain('DesignerDoc');
  });

  it('designer.store.ts does not re-declare contract interfaces locally', () => {
    const src = read('../../../../../apps/frontend/src/components/media-tools/designer/designer.store.ts');
    for (const name of FORBIDDEN_CONTRACT_INTERFACES) {
      expect(src).not.toMatch(new RegExp(`\\binterface\\s+${name}\\b`));
    }
    // Local state/actions remain.
    expect(src).toContain('interface DesignerState');
    expect(src).toContain('interface DesignerActions');
  });
});
