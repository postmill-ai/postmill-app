import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Konva from 'konva';
import { DesignerCanvas } from './canvas';
import { createDesignerStore } from './designer.store';

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

const renderCanvas = async (store: ReturnType<typeof createDesignerStore>) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<DesignerCanvas store={store} showRulers={false} />);
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
});
