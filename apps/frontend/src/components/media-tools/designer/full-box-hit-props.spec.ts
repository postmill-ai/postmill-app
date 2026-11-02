import { describe, expect, it, vi } from 'vitest';
import type Konva from 'konva';
import { fullBoxHitProps } from './elements';

describe('fullBoxHitProps', () => {
  it('uses the complete text box as the selectable hit surface', () => {
    const context = {
      beginPath: vi.fn(),
      rect: vi.fn(),
      closePath: vi.fn(),
      fillStrokeShape: vi.fn(),
    };
    const shape = {} as Konva.Shape;

    fullBoxHitProps(240, 80).hitFunc(context as unknown as Konva.Context, shape);

    expect(context.rect).toHaveBeenCalledWith(0, 0, 240, 80);
    expect(context.fillStrokeShape).toHaveBeenCalledWith(shape);
  });
});
