import { describe, expect, it } from 'vitest';
import Konva from 'konva';
import { fullBoxHitProps, layerListensForHits, projectElementPreview } from './elements';
import { disposeBuffer, ensureBuffer } from './raster-layers';
import type { DesignerElement } from './designer.store';

const expectFullBoxHit = (shape: Konva.Shape) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const stage = new Konva.Stage({ container: host, width: 300, height: 100 });
  const layer = new Konva.Layer();
  stage.add(layer);
  layer.add(shape);
  layer.draw();
  try {
    expect(layer.getIntersection({ x: 220, y: 75 })).toBe(shape);
    expect(layer.getIntersection({ x: 250, y: 90 })).toBeNull();
  } finally {
    stage.destroy();
    host.remove();
  }
};

describe('fullBoxHitProps', () => {
  it('uses the complete TextPath box as the selectable hit surface', () => {
    expectFullBoxHit(new Konva.TextPath({
      id: 'curved-text',
      text: 'Curved text',
      data: 'M 0 40 L 240 40',
      fontSize: 20,
      width: 240,
      height: 80,
      ...fullBoxHitProps(240, 80),
    }));
  });

  it('preserves the complete plain Text box as the selectable hit surface', () => {
    expectFullBoxHit(new Konva.Text({
      id: 'plain-text',
      text: 'Plain text',
      fontSize: 20,
      width: 240,
      height: 80,
      ...fullBoxHitProps(240, 80),
    }));
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
