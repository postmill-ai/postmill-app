import { describe, expect, it, vi } from 'vitest';
import type Konva from 'konva';
import { fullBoxHitProps, layerListensForHits, projectElementPreview } from './elements';
import { disposeBuffer, ensureBuffer } from './raster-layers';
import type { DesignerElement } from './designer.store';

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

  it('lets a Paint layer with live pixels but no committed src receive hits', () => {
    const raster = {
      id: 'paint-buffer', type: 'raster', x: 0, y: 0, width: 100, height: 100,
      rotation: 0, opacity: 1, locked: false, hidden: false,
    } as DesignerElement;
    ensureBuffer(raster);
    try {
      expect(layerListensForHits(raster)).toBe(true);
    } finally {
      disposeBuffer(raster.id);
    }
  });

  it('projects preview patches without mutating the base elements', () => {
    const base = [{
      id: 'photo', type: 'image', src: '/photo.png', x: 0, y: 0,
      width: 100, height: 100, rotation: 0, opacity: 1, locked: false, hidden: false,
    }] as DesignerElement[];
    const projected = projectElementPreview(base, {
      photo: { mask: { type: 'shape', shape: 'ellipse' } },
    });

    expect(projected[0].mask).toMatchObject({ shape: 'ellipse' });
    expect(base[0].mask).toBeUndefined();
    expect(projectElementPreview(base, null)).toBe(base);
  });
});
