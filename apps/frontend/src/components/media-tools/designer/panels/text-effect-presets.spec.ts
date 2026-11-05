import { describe, expect, it } from 'vitest';
import { textEffectPatch } from './text-effect-presets';
import type { DesignerElement } from '../designer.store';

const element = {
  id: 'text-1',
  type: 'text',
  x: 0,
  y: 0,
  width: 400,
  height: 100,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  text: 'Effect',
  styles: [{ type: 'drop-shadow' as const }],
} as DesignerElement;

describe('text effect presets', () => {
  it('drives the existing curved and path text fields', () => {
    expect(textEffectPatch('arc', element)).toEqual({ curve: 45, textPath: undefined });
    expect(textEffectPatch('wave', element).textPath).toContain('Q 100');
    expect(textEffectPatch('circle', element).textPath).toContain('A 40,40');
  });

  it('drives gradient, outline, and shadow without a renderer fork', () => {
    expect(textEffectPatch('gradient', element).fillGradient?.stops).toHaveLength(2);
    expect(textEffectPatch('outline', element).textStroke).toEqual({ color: '#000000', width: 2 });
    expect(textEffectPatch('shadow', element).textShadow?.blur).toBe(8);
  });

  it('adds one bounded 3D extrusion style without removing existing effects', () => {
    const patch = textEffectPatch('extrusion', element);
    expect(patch.styles).toHaveLength(2);
    expect(patch.styles?.[0].type).toBe('drop-shadow');
    expect(patch.styles?.[1]).toMatchObject({ type: 'extrusion', depth: 24 });
    expect(textEffectPatch('extrusion', { ...element, styles: patch.styles }).styles).toHaveLength(2);
  });
});
