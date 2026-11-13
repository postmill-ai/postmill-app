import { describe, expect, it, vi } from 'vitest';
import type Konva from 'konva';
import { fullBoxHitProps, layerListensForHits } from './elements';
import type { DesignerElement } from '../designer.store';

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

  it('does not let an empty full-size Paint layer intercept hits', () => {
    const raster = {
      id: 'paint', type: 'raster', x: 0, y: 0, width: 1080, height: 1080,
      rotation: 0, opacity: 1, locked: false, hidden: false,
    } as DesignerElement;

    expect(layerListensForHits(raster)).toBe(false);
    expect(layerListensForHits({ ...raster, src: 'data:image/png;base64,pixels' })).toBe(true);
    expect(layerListensForHits({ ...raster, type: 'text' })).toBe(true);
  });
});
