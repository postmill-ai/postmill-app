import { describe, it, expect } from 'vitest';
import { canvasColor } from './canvas-color';

/**
 * 8-digit hex is CSS Color 4: browsers parse it, but it is not part of the
 * colour grammar every canvas implementation accepts. These pin the
 * normalisation to `rgba()` both renderers apply at the context boundary, and
 * the byte-identical passthrough every other colour keeps.
 */
describe('canvasColor', () => {
  it('converts an 8-digit hex to rgba()', () => {
    expect(canvasColor('#FF000080')).toBe('rgba(255, 0, 0, 0.5019607843137255)');
    expect(canvasColor('#2B5CD340')).toBe('rgba(43, 92, 211, 0.25098039215686274)');
  });

  it('collapses an opaque 8-digit hex to the 6-digit form', () => {
    expect(canvasColor('#FF0000FF')).toBe('#FF0000');
  });

  it('leaves a 6-digit hex byte-identical', () => {
    expect(canvasColor('#2B5CD3')).toBe('#2B5CD3');
  });

  it('leaves other colour strings alone', () => {
    expect(canvasColor('#FFF')).toBe('#FFF');
    expect(canvasColor('rgba(0, 0, 0, 0.5)')).toBe('rgba(0, 0, 0, 0.5)');
    expect(canvasColor('red')).toBe('red');
  });

  it('tolerates surrounding whitespace and lowercase', () => {
    expect(canvasColor('  #ff000080 ')).toBe('rgba(255, 0, 0, 0.5019607843137255)');
  });

  it('passes nullish through as undefined', () => {
    expect(canvasColor(undefined)).toBeUndefined();
    expect(canvasColor(null)).toBeUndefined();
    expect(canvasColor('')).toBeUndefined();
  });
});
