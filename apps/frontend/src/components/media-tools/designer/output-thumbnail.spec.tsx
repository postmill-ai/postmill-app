import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignerOutput } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';

const mocks = vi.hoisted(() => ({
  roots: [] as { render: ReturnType<typeof vi.fn>; unmount: ReturnType<typeof vi.fn> }[],
  stages: [] as Record<string, unknown>[],
  elements: [] as Record<string, unknown>[],
  capture: vi.fn(() => 'data:image/jpeg;base64,preview'),
  texture: vi.fn(() => ({ fill: 'texture' })),
}));

vi.mock('react-dom/client', async () => {
  const { render } = await import('@testing-library/react');
  return {
    createRoot: () => {
      const root = {
        render: vi.fn((element: React.ReactNode) => render(element as React.ReactElement)),
        unmount: vi.fn(),
      };
      mocks.roots.push(root);
      return root;
    },
  };
});

vi.mock('react-konva', async () => {
  const React = await import('react');
  const Stage = React.forwardRef((props: { children?: React.ReactNode }, ref) => {
    React.useImperativeHandle(ref, () => ({
      draw: vi.fn(),
      toCanvas: () => ({}),
    }));
    mocks.stages.push(props as Record<string, unknown>);
    return props.children ?? null;
  });
  Stage.displayName = 'Stage';
  return {
    Stage,
    Layer: ({ children }: { children: React.ReactNode }) => children,
    Rect: () => null,
  };
});

vi.mock('./elements', () => ({
  CanvasElements: (props: Record<string, unknown>) => {
    mocks.elements.push(props);
    return null;
  },
  gradientFillProps: () => ({}),
}));
vi.mock('./export-background', () => ({ ExportBackgroundImage: () => null }));
vi.mock('./stage-thumbnail', () => ({ getThumbnailDataUrl: mocks.capture }));
vi.mock('./textures', () => ({ textureFillProps: mocks.texture }));

import { renderLibraryPreview, renderOutputThumbnail } from './output-thumbnail';

const output = (): DesignerOutput => ({
  id: 'out', formatId: 'custom', name: 'Preview', width: 1600, height: 900,
  background: '#ffffff',
  bg: {
    type: 'color', color: '#ffffff',
    texture: { type: 'grain', scale: 1, intensity: 0.2 },
  },
  children: [{
    id: 'image', type: 'image', src: '', x: 0, y: 0, width: 400, height: 400,
    rotation: 0, opacity: 1, locked: false, hidden: false,
    filters: ['blur:2'],
    styles: [{ type: 'drop-shadow', enabled: true, opacity: 0.5 }],
  }],
});

const flush = async () => {
  await vi.runAllTimersAsync();
  await Promise.resolve();
};

describe('output thumbnail render lifecycles', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.roots.length = 0;
    mocks.stages.length = 0;
    mocks.elements.length = 0;
    mocks.capture.mockClear();
    mocks.texture.mockClear();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serializes scaled thumbnails through one shared root and stage lifecycle', async () => {
    const first = renderOutputThumbnail(output(), undefined, 72);
    const second = renderOutputThumbnail(output(), undefined, 96);
    await flush();

    await expect(first).resolves.toBe('data:image/jpeg;base64,preview');
    await expect(second).resolves.toBe('data:image/jpeg;base64,preview');
    expect(mocks.roots).toHaveLength(1);
    expect(mocks.roots[0].unmount).not.toHaveBeenCalled();
    expect(mocks.stages).toHaveLength(2);
    expect(mocks.stages[0]).toMatchObject({ width: 72, height: 41 });
    expect(mocks.stages[1]).toMatchObject({ width: 96, height: 54 });
    expect(mocks.capture.mock.calls.map((call) => call[1])).toEqual([72, 96]);
  });

  it('keeps saved library previews on the original full-size effects path', async () => {
    const doc = output();
    const preview = renderLibraryPreview(doc);
    await flush();

    await expect(preview).resolves.toBe('data:image/jpeg;base64,preview');
    expect(mocks.roots).toHaveLength(1);
    expect(mocks.stages[0]).toMatchObject({
      width: 1600,
      height: 900,
      scaleX: 1,
      scaleY: 1,
      pixelRatio: 1,
    });
    expect(mocks.elements[0].elements).toBe(doc.children);
    expect((mocks.elements[0].elements as DesignerOutput['children'])[0]).toMatchObject({
      filters: ['blur:2'],
      styles: [{ type: 'drop-shadow', enabled: true, opacity: 0.5 }],
    });
    expect(mocks.texture).toHaveBeenCalledWith(doc.bg?.texture);
    expect(mocks.capture.mock.calls[0][1]).toBe(300);
    expect(mocks.roots[0].unmount).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('div[style*="-100000px"]')).toBeNull();
  });
});
