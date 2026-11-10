import { describe, expect, it } from 'vitest';
import {
  hasExplicitMediaReplacementRequest,
  revisionMediaChanged,
  shouldPreserveRevisionMedia,
} from './revision-preservation';

describe('revision media preservation', () => {
  it('preserves media for Joanna’s small-text-only request', () => {
    expect(shouldPreserveRevisionMedia('Only improve the small text and keep everything else')).toBe(true);
  });

  it('preserves media for an explicit photo-preservation request', () => {
    expect(shouldPreserveRevisionMedia('Improve the caption but do not change the photo')).toBe(true);
  });

  it('allows an explicit photo replacement even when other things stay unchanged', () => {
    expect(shouldPreserveRevisionMedia('Replace the photo and keep everything else')).toBe(false);
    expect(hasExplicitMediaReplacementRequest('Replace the photo and keep everything else')).toBe(true);
  });

  it('does not mistake a recolor or unrelated edit for replacement', () => {
    expect(shouldPreserveRevisionMedia('Only make the background blue')).toBe(true);
    expect(hasExplicitMediaReplacementRequest('Change the background color')).toBe(false);
  });

  it('allows an image background to become a requested solid color', () => {
    const original = {
      outputs: [{
        bg: { type: 'image', src: '/uploads/org/background.png' },
        children: [{ type: 'image', fileId: 'photo-1', src: '/uploads/org/photo.png' }],
      }],
    };
    const recolored = {
      outputs: [{
        bg: { type: 'color', color: '#0000ff' },
        children: original.outputs[0].children,
      }],
    };
    expect(revisionMediaChanged(original, recolored, 'Make the background blue')).toBe(false);

    const replacedElement = structuredClone(recolored);
    replacedElement.outputs[0].children[0].fileId = 'photo-2';
    expect(revisionMediaChanged(original, replacedElement, 'Make the background blue')).toBe(true);
  });
});
