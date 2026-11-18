import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Konva from 'konva';
import { Layer, Stage } from 'react-konva';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SafeZoneOverlay } from './safe-zones';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const renderOverlay = async (
  presetId: string,
  width = 1080,
  height = 1920,
  zoom = 0.5
) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <Stage width={width} height={height}>
        <Layer>
          <SafeZoneOverlay
            presetId={presetId}
            width={width}
            height={height}
            visible={true}
            zoom={zoom}
          />
        </Layer>
      </Stage>
    );
  });
  const stage = Konva.stages[Konva.stages.length - 1];
  return stage.getLayers()[0];
};

describe('SafeZoneOverlay', () => {
  it('shades scaled obstructions and keeps labels readable at the current zoom', async () => {
    const layer = await renderOverlay('ig-story');
    const zones = layer.find('.safe-zone-obstruction');
    const top = zones.find((zone) => zone.y() === 0)!;
    const bottom = zones.find((zone) => zone.y() > 0)!;

    expect(top.width()).toBe(1080);
    expect(top.height()).toBe(80);
    expect(bottom.y() + bottom.height()).toBe(1920);
    expect(top.fill()).toBe('rgba(255, 0, 0, 0.10)');
    expect(top.strokeWidth()).toBe(2);
    expect(top.dash()).toEqual([8, 8]);
    expect(top.listening()).toBe(false);

    const labels = layer.find('.safe-zone-label');
    expect(labels.length).toBeGreaterThan(0);
    const text = labels[0].findOne('Text') as Konva.Text;
    expect(text.fontSize()).toBe(24);
    expect(text.padding()).toBe(8);
    expect(text.width()).toBe(320);
    expect(text.listening()).toBe(false);
    expect(layer.findOne('.safe-zone-legend')).toBeTruthy();
  });

  it('still draws feed guides on a guide-only format', async () => {
    const layer = await renderOverlay('ig-post', 1080, 1080, 1);
    const zones = layer.find('.safe-zone-obstruction');

    expect(zones.map((zone) => zone.height())).toEqual([120, 160]);
    expect(layer.findOne('.safe-zone-title-safe')).toBeFalsy();
    expect(layer.findOne('.safe-zone-legend')).toBeTruthy();
  });

  it('keeps the generic title-safe guide unshaded', async () => {
    const layer = await renderOverlay('custom', 400, 300, 2);
    const guide = layer.findOne('.safe-zone-title-safe') as Konva.Rect;
    const label = layer.findOne('.safe-zone-label') as Konva.Label;

    expect(guide.fill()).toBeUndefined();
    expect(guide.strokeWidth()).toBe(0.5);
    expect(guide.x()).toBe(20);
    expect(guide.y()).toBe(15);
    expect(guide.width()).toBe(360);
    expect(guide.height()).toBe(270);
    expect((label.findOne('Text') as Konva.Text).text()).toBe('Title Safe (5%)');
    expect(layer.findOne('.safe-zone-legend')).toBeFalsy();
  });

  it('renders the platform approximation legend as non-listening text', async () => {
    const layer = await renderOverlay('ig-reel');
    const legend = layer.findOne('.safe-zone-legend') as Konva.Group;
    const texts = legend.find('Text');

    expect(legend.listening()).toBe(false);
    expect(texts.map((text) => (text as Konva.Text).text())).toContain(
      'Shaded = may be covered · Platform UI is approximate'
    );

    const legendBox = legend.getClientRect();
    const overlapping = layer.find('.safe-zone-label').filter((label) => {
      const box = label.getClientRect();
      return legendBox.x < box.x + box.width && legendBox.x + legendBox.width > box.x &&
        legendBox.y < box.y + box.height && legendBox.y + legendBox.height > box.y;
    });
    expect(overlapping).toEqual([]);
  });

});
