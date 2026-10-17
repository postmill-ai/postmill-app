import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { MAX_VIDEO_DURATION_MS } from './designer-doc.limits';

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

  it('the video duration cap stays in lockstep across backend, limits and the frontend store', () => {
    // Server render cap (design-render/video-render.service.ts) must equal the
    // DesignerDoc schema cap.
    const serviceSrc = read('../design-render/video-render.service.ts');
    const match = serviceSrc.match(/const MAX_DURATION_MS = ([\d_]+)/);
    expect(match, 'MAX_DURATION_MS not found in video-render.service.ts').toBeTruthy();
    expect(Number(match![1].replace(/_/g, ''))).toBe(MAX_VIDEO_DURATION_MS);

    // The frontend store clamps timeline edits against the shared constant,
    // never a local literal that could drift (e.g. a leftover 60000).
    const storeSrc = read('../../../../../apps/frontend/src/components/media-tools/designer/designer.store.ts');
    expect(storeSrc).toContain('MAX_VIDEO_DURATION_MS');
    expect(storeSrc).not.toMatch(/\b60000\b/);
  });
});
