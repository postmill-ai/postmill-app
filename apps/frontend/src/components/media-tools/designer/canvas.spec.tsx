import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act } from 'react';
import { fireEvent } from '@testing-library/react';
import { createRoot, type Root } from 'react-dom/client';
import Konva from 'konva';
import { DesignerCanvas } from './canvas';
import { createDesignerStore } from './designer.store';
import { writeStockMediaDrag } from './stock-media-drag';
import type { InsertDesignerMedia } from './use-designer-media-insertion';

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
}));

vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: vi.fn() }),
}));

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

vi.mock('./use-paint-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./use-paint-tools')>();
  return {
    ...actual,
    usePaintTools: () => ({
      selection: null,
      lassoPoints: null,
      paintNonce: 0,
      beginPaint: vi.fn(),
      movePaint: vi.fn(),
      endPaint: vi.fn(),
      beginSelection: vi.fn(),
      moveSelection: vi.fn(),
      endSelection: vi.fn(),
      closePolygonalLasso: vi.fn(),
      runObjectSelection: vi.fn(),
      clearSelection: vi.fn(),
    }),
  };
});

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let frames: Map<number, FrameRequestCallback>;

beforeEach(() => {
  frames = new Map();
  let nextFrame = 1;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id);
  });
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(400);
  vi.spyOn(Konva.Container.prototype, 'draw').mockImplementation(function (this: Konva.Container) {
    return this;
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const shapeStore = () => {
  const store = createDesignerStore(500, 400);
  store.getState().addElement({
    id: 'moving',
    type: 'shape',
    shape: 'rect',
    x: 20,
    y: 30,
    width: 100,
    height: 80,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
  });
  return store;
};

const groupedStore = () => {
  const store = shapeStore();
  store.getState().addElement({
    id: 'sibling',
    type: 'shape',
    shape: 'rect',
    x: 300,
    y: 40,
    width: 100,
    height: 80,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
  });
  store.getState().groupSelection(['moving', 'sibling']);
  return store;
};

const renderCanvas = async (store: ReturnType<typeof createDesignerStore>, onInsertMedia?: InsertDesignerMedia) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<DesignerCanvas store={store} showRulers={false} onInsertMedia={onInsertMedia} />);
  });
  return Konva.stages[Konva.stages.length - 1];
};

describe('DesignerCanvas gesture wiring', () => {
  it('snaps the Konva node synchronously and commits it when release shares the frame', async () => {
    const store = shapeStore();
    const stage = await renderCanvas(store);
    const node = stage.findOne('#moving')!;
    const historyDepth = store.getState().history.length;

    await act(async () => {
      const layer = node.getLayer()!;
      layer.fire('dragstart', { target: node });
      node.position({ x: 4, y: 30 });
      layer.fire('dragmove', { target: node });
      expect(node.x()).toBe(0);
      expect(store.getState().doc.outputs[0].children[0].x).toBe(20);
      expect(frames.size).toBe(1);
      layer.fire('dragend', { target: node });
    });

    expect(store.getState().doc.outputs[0].children[0].x).toBe(0);
    expect(store.getState().history).toHaveLength(historyDepth + 1);
    expect(store.getState().gestureDepth).toBe(0);
    expect(frames.size).toBe(0);
  });

  it('selects an unselected element when its drag starts', async () => {
    const store = shapeStore();
    store.getState().setSelectedIds([]);
    const stage = await renderCanvas(store);
    const node = stage.findOne('#moving')!;
    const layer = node.getLayer()!;

    await act(async () => {
      layer.fire('dragstart', { target: node });
      expect(store.getState().selectedIds).toEqual(['moving']);
      expect(store.getState().gestureDepth).toBe(1);
      layer.fire('dragend', { target: node });
    });
    expect(store.getState().gestureDepth).toBe(0);
  });

  it('brackets Transformer work and commits baked geometry once', async () => {
    const store = shapeStore();
    const stage = await renderCanvas(store);
    const node = stage.findOne('#moving')!;
    const transformer = stage.findOne('Transformer') as Konva.Transformer;
    expect(transformer.nodes()).toContain(node);
    const historyDepth = store.getState().history.length;

    await act(async () => {
      transformer.fire('transformstart');
      expect(store.getState().gestureDepth).toBe(1);
      node.scale({ x: 2, y: 1.5 });
      transformer.fire('transform');
      transformer.fire('transformend');
      await Promise.resolve();
      await Promise.resolve();
    });

    const element = store.getState().doc.outputs[0].children[0];
    expect(element).toMatchObject({ width: 200, height: 120 });
    expect(node.scaleX()).toBe(1);
    expect(node.scaleY()).toBe(1);
    expect(store.getState().history).toHaveLength(historyDepth + 1);
    expect(store.getState().gestureDepth).toBe(0);
  });

  it('binds a selected group to its leaf Transformer nodes', async () => {
    const store = groupedStore();
    const stage = await renderCanvas(store);
    const transformer = stage.findOne('Transformer') as Konva.Transformer;
    const group = store.getState().doc.outputs[0].children.find((el) => el.type === 'group')!;

    expect(transformer.nodes().map((node) => node.id())).toEqual(['moving', 'sibling']);
    expect(transformer.nodes().some((node) => node.id() === group.id)).toBe(false);
  });

  it('does not snap a selected group to its own members or containers', async () => {
    const store = groupedStore();
    const stage = await renderCanvas(store);
    const node = stage.findOne('#moving')!;
    const transformer = stage.findOne('Transformer') as Konva.Transformer;

    await act(async () => {
      transformer.nodes([node]);
      node.position({ x: 295, y: 40 });
      node.getLayer()!.fire('dragmove', { target: node });
    });

    expect(node.x()).toBe(295);
    expect(store.getState().selectedIds).toEqual([
      store.getState().doc.outputs[0].children.find((el) => el.type === 'group')!.id,
    ]);
  });

  it('right-click keeps a multi-selection and selects an unselected element', async () => {
    const store = shapeStore();
    store.getState().addElement({
      id: 'other', type: 'shape', shape: 'rect', x: 300, y: 40, width: 100, height: 80,
      rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    store.getState().addElement({
      id: 'third', type: 'shape', shape: 'rect', x: 300, y: 200, width: 100, height: 80,
      rotation: 0, opacity: 1, locked: false, hidden: false,
    });
    const stage = await renderCanvas(store);
    const fire = async (id: string) => {
      const node = stage.findOne('#' + id)!;
      await act(async () => {
        node.fire('contextmenu', {
          evt: new MouseEvent('contextmenu', { button: 2, clientX: 10, clientY: 10, cancelable: true }),
        }, true);
      });
    };
    await act(async () => {
      store.getState().setSelectedIds(['moving', 'other']);
    });
    await fire('other');
    expect(store.getState().selectedIds).toEqual(['moving', 'other']);
    await fire('third');
    expect(store.getState().selectedIds).toEqual(['third']);
  });
});

describe('DesignerCanvas stock drops', () => {
  it('routes stock metadata to the shared inserter once before OS-file handling', async () => {
    const store = createDesignerStore(500, 400);
    const onInsertMedia = vi.fn().mockResolvedValue(undefined);
    await renderCanvas(store, onInsertMedia);
    const data = new Map<string, string>();
    writeStockMediaDrag({ setData: (mime, value) => data.set(mime, value) }, 'image', {
      url: 'https://cdn.example.test/photo.png', width: 800, height: 600, type: 'image', source: 'unsplash',
    });

    fireEvent.drop(document.querySelector('.designer-canvas-container')!, {
      clientX: 100,
      clientY: 100,
      dataTransfer: {
        getData: (mime: string) => data.get(mime) || '',
        files: [new File(['not an upload'], 'duplicate.png', { type: 'image/png' })],
      },
    });

    expect(onInsertMedia).toHaveBeenCalledTimes(1);
    expect(onInsertMedia).toHaveBeenCalledWith('image', expect.objectContaining({
      url: 'https://cdn.example.test/photo.png', source: 'stock',
    }), expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
  });

  it('ignores stock drops into a frozen output', async () => {
    const store = createDesignerStore(500, 400);
    const onInsertMedia = vi.fn().mockResolvedValue(undefined);
    store.getState().setOutputFrozen(0, true);
    await renderCanvas(store, onInsertMedia);
    const data = new Map<string, string>();
    writeStockMediaDrag({ setData: (mime, value) => data.set(mime, value) }, 'image', {
      url: 'https://cdn.example.test/photo.png', width: 800, height: 600, type: 'image', source: 'unsplash',
    });

    fireEvent.drop(document.querySelector('.designer-canvas-container')!, {
      clientX: 100,
      clientY: 100,
      dataTransfer: { getData: (mime: string) => data.get(mime) || '', files: [] },
    });

    expect(onInsertMedia).not.toHaveBeenCalled();
  });
});

describe('DesignerCanvas safe-zone overlays', () => {
  it('sizes safe-zone labels from the live canvas zoom', async () => {
    const store = shapeStore();
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <DesignerCanvas store={store} showRulers={false} showSafeZones safeZonePreset="ig-story" />
      );
    });
    const stage = Konva.stages[Konva.stages.length - 1];
    await act(async () => {
      store.getState().setZoom(0.5);
    });
    const label = stage.findOne('.safe-zone-label') as Konva.Label;
    expect((label.findOne('Text') as Konva.Text).fontSize()).toBe(24);
  });
});
