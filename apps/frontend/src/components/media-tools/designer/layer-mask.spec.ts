import { describe, expect, it } from 'vitest';
import { maskSceneRect } from './layer-render';

describe('maskSceneRect', () => {
  it('draws in shape-local coordinates so the element transform is applied once', () => {
    expect(maskSceneRect({ width: 300, height: 200 })).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    });
  });
});
