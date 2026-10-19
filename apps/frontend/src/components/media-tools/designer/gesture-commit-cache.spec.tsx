import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import Konva from 'konva';
import { Stage, Layer } from 'react-konva';
import { CanvasElements } from './elements';
import {
  createDesignerStore,
  type DesignerElement,
  type DesignerOutput,
} from './designer.store';
import {
  GEOMETRY_CACHE_DEBOUNCE_MS,
  geometrySignature,
  useGeometryNonce,
} from './use-geometry-nonce';

/**
 * Drag-tracking of cached wrappers (the "bitmap stays behind" defect).
 *
 * The cached wrappers (StyledLayer, AdjustmentScope, MaskedLayer, LayerGroup)
 * Konva-`cache()` an ancestor of the draggable node, and Konva never repaints
 * a cached node when a descendant moves. Their keys used to exclude geometry
 * entirely, so a styled/masked/adjusted image's bitmap stayed at the pre-drag
 * position for the WHOLE drag and only snapped into place on drop.
 *
 * The fix folds each layer's OWN geometry into the key of every wrapper that
 * buffers it. Mid-gesture the ephemeral store writes re-render per rAF frame,
 * so the dragged element's wrappers re-rasterise with it — while every other
 * layer's key (and buffer) is untouched. The gesture-commit `geometryNonce`
 * bump still turns all keys over once on dragEnd/transformEnd.
 *
 * These run a real Konva render (jsdom ships node-canvas via vitest) and watch
 * the cache canvas's identity: a re-cache produces a NEW canvas, a stable key
 * keeps the same one.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const styledImage = {
  id: 'img-1',
  type: 'image',
  src: 'https://cdn.example.com/hero.png',
  x: 0,
  y: 0,
  width: 200,
  height: 200,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  styles: [
    {
      type: 'drop-shadow',
      color: '#000000',
      opacity: 1,
      distance: 4,
      angle: 45,
      size: 8,
      spread: 0,
    },
  ],
} as unknown as DesignerElement;

const otherStyledImage = {
  ...styledImage,
  id: 'img-2',
  src: 'https://cdn.example.com/other.png',
  x: 300,
  y: 300,
  width: 80,
  height: 80,
} as unknown as DesignerElement;

const plainImage = {
  ...styledImage,
  styles: undefined,
} as unknown as DesignerElement;

const brightnessAdj = {
  id: 'adj-1',
  type: 'adjustment',
  clipped: true,
  adjustment: { type: 'brightness-contrast', values: { brightness: 12, contrast: 0 } },
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
} as unknown as DesignerElement;

let root: Root | null = null;
let stageRef: Konva.Stage | null = null;

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  stageRef = null;
  hookApi = null;
  vi.restoreAllMocks();
});

const renderTree = async (elements: DesignerElement[], geometryNonce: number) => {
  if (!root) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  await act(async () => {
    root!.render(
      <Stage width={400} height={400} ref={(s) => (stageRef = s)}>
        <Layer>
          <CanvasElements
            elements={elements}
            onSelect={() => {}}
            geometryNonce={geometryNonce}
          />
        </Layer>
      </Stage>
    );
  });
};

/** The cache canvas a cached node currently draws from (null when uncached). */
const cacheCanvas = (node: Konva.Node): unknown =>
  (
    node as unknown as {
      _cache?: Map<string, { scene?: { _canvas?: HTMLCanvasElement } }>;
    }
  )._cache?.get('canvas')?.scene?._canvas ?? null;

/** The nearest cached ancestor of the dragged node — the buffered bitmap. */
const cachedAncestor = (id: string): Konva.Node => {
  const node = stageRef!.findOne('#' + id);
  expect(node, `node #${id} should exist`).toBeTruthy();
  const ancestor = node!
    .getAncestors()
    .find((a) => (a as unknown as { isCached(): boolean }).isCached?.());
  expect(ancestor, `#${id} should sit under a cached wrapper`).toBeTruthy();
  return ancestor!;
};

describe('drag-tracking cache refresh', () => {
  it('the dragged element’s StyledLayer re-rasterises per frame; other layers stay cached', async () => {
    const cacheSpy = vi.spyOn(Konva.Group.prototype, 'cache');
    const callsOn = (node: Konva.Node) =>
      cacheSpy.mock.contexts.filter((ctx) => ctx === node).length;

    await renderTree([styledImage, otherStyledImage], 0);
    const dragged = cachedAncestor('img-1');
    const bystander = cachedAncestor('img-2');
    expect(dragged).not.toBe(bystander);
    const draggedBefore = cacheCanvas(dragged);
    const bystanderBefore = cacheCanvas(bystander);
    expect(draggedBefore).not.toBeNull();
    const draggedMount = callsOn(dragged);
    const bystanderMount = callsOn(bystander);

    // Two drag frames: the dragged element moves in the store per rAF tick.
    // Its own wrapper must track (new buffer each frame) — the bitmap follows
    // the frame — while the unmoved layer's wrapper keeps its buffer.
    await renderTree(
      [{ ...styledImage, x: 40, y: 12 } as DesignerElement, otherStyledImage],
      0
    );
    expect(callsOn(dragged)).toBe(draggedMount + 1);
    expect(cacheCanvas(dragged)).not.toBe(draggedBefore);

    const midDrag = cacheCanvas(dragged);
    await renderTree(
      [{ ...styledImage, x: 96, y: 30 } as DesignerElement, otherStyledImage],
      0
    );
    expect(callsOn(dragged)).toBe(draggedMount + 2);
    expect(cacheCanvas(dragged)).not.toBe(midDrag);

    expect(callsOn(bystander)).toBe(bystanderMount);
    expect(cacheCanvas(bystander)).toBe(bystanderBefore);

    // Commit (dragEnd): the nonce bump turns the key over once more.
    await renderTree(
      [{ ...styledImage, x: 96, y: 30 } as DesignerElement, otherStyledImage],
      1
    );
    expect(callsOn(dragged)).toBe(draggedMount + 3);
  });

  it('AdjustmentScope re-caches as its folded layer moves, not just on commit', async () => {
    const cacheSpy = vi.spyOn(Konva.Group.prototype, 'cache');
    const callsOn = (node: Konva.Node) =>
      cacheSpy.mock.contexts.filter((ctx) => ctx === node).length;

    await renderTree([plainImage, brightnessAdj], 0);
    const scope = cachedAncestor('img-1');
    expect((scope as unknown as Konva.Group).filters().length).toBeGreaterThan(0);
    const before = cacheCanvas(scope);
    expect(before).not.toBeNull();
    const mountCalls = callsOn(scope);

    // A drag frame under an adjustment layer: the scope's bitmap must track
    // the layer it buffers, or the image visibly lags its frame until drop.
    await renderTree([{ ...plainImage, x: 64, y: 48 } as DesignerElement, brightnessAdj], 0);
    expect(callsOn(scope)).toBe(mountCalls + 1);
    expect(cacheCanvas(scope)).not.toBe(before);

    await renderTree([{ ...plainImage, x: 64, y: 48 } as DesignerElement, brightnessAdj], 1);
    expect(callsOn(scope)).toBe(mountCalls + 2);
  });

  it('a wrapper whose contents did NOT move keeps its buffer across the commit bump only', async () => {
    // Sanity on the other direction: with no geometry change and no nonce
    // bump, a plain re-render must not re-rasterise anything.
    const cacheSpy = vi.spyOn(Konva.Group.prototype, 'cache');
    const callsOn = (node: Konva.Node) =>
      cacheSpy.mock.contexts.filter((ctx) => ctx === node).length;

    await renderTree([styledImage], 0);
    const styled = cachedAncestor('img-1');
    const before = cacheCanvas(styled);
    const mountCalls = callsOn(styled);

    await renderTree([styledImage], 0);
    expect(callsOn(styled)).toBe(mountCalls);
    expect(cacheCanvas(styled)).toBe(before);
  });
});

/**
 * Store-driven geometry commits (Inspector X/Y/W/H inputs, arrow-key nudges,
 * align/distribute, undo — no Konva drag/transform events). The wrappers'
 * keys carry their layers' geometry, so these refresh the moved element's
 * buffer on the very next render; the `useGeometryNonce` subscription remains
 * as the debounced backstop and the commit-bump path for gestures.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type GeometryApi = ReturnType<typeof useGeometryNonce>;
type Store = ReturnType<typeof createDesignerStore>;
let hookApi: GeometryApi | null = null;

const storeWithImage = (): Store => {
  const store = createDesignerStore(400, 400);
  store.getState().addElement({ ...styledImage } as DesignerElement);
  return store;
};

const renderWithStore = async (store: Store) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const Harness = () => {
    const api = useGeometryNonce(store);
    // Publishing to the module-level probe is a side effect, so it happens in
    // an effect rather than during render (react-hooks/globals).
    React.useEffect(() => {
      hookApi = api;
    });
    const children = store(
      (s) => (s.doc.outputs[s.currentOutput] as DesignerOutput).children
    );
    return (
      <Stage width={400} height={400} ref={(s) => (stageRef = s)}>
        <Layer>
          <CanvasElements
            elements={children}
            onSelect={() => {}}
            geometryNonce={api.geometryNonce}
          />
        </Layer>
      </Stage>
    );
  };
  await act(async () => {
    root!.render(<Harness />);
  });
};

describe('store-driven geometry commits (no Konva gesture)', () => {
  it('geometrySignature ignores non-geometry writes, turns over on geometry', () => {
    const store = storeWithImage();
    const before = geometrySignature(store.getState());
    store.getState().updateElement('img-1', { name: 'Hero' } as never);
    expect(geometrySignature(store.getState())).toBe(before);
    store.getState().updateElement('img-1', { x: 42 });
    expect(geometrySignature(store.getState())).not.toBe(before);
  });

  it('refreshes the moved element’s wrapper on the next render — no debounce wait', async () => {
    const store = storeWithImage();
    await renderWithStore(store);
    const styled = cachedAncestor('img-1');
    const before = cacheCanvas(styled);

    // The Inspector's X input: a plain store write, no drag events. The
    // element's own key carries its geometry, so the buffer rebuilds with
    // the render — the user sees the layer where they put it, immediately.
    await act(async () => {
      store.getState().updateElement('img-1', { x: 500 });
    });
    expect(cacheCanvas(styled)).not.toBe(before);
  });

  it('mid-gesture frames re-rasterise through the key while the nonce stays put; the commit bump turns it once', async () => {
    const store = storeWithImage();
    await renderWithStore(store);
    const styled = cachedAncestor('img-1');
    const before = cacheCanvas(styled);
    const nonceAtStart = hookApi!.geometryNonce;

    // Konva dragstart → noteGestureStart. A drag frame writes the store:
    // the dragged element's wrapper tracks through its key, but the debounced
    // nonce must NOT fire mid-gesture (it would re-rasterise EVERY wrapper).
    act(() => hookApi!.noteGestureStart());
    await act(async () => {
      store.getState().updateElement('img-1', { x: 220 });
    });
    expect(cacheCanvas(styled)).not.toBe(before);
    await act(async () => {
      await sleep(GEOMETRY_CACHE_DEBOUNCE_MS + 150);
    });
    expect(hookApi!.geometryNonce).toBe(nonceAtStart);

    // dragEnd: final store write + immediate bump, exactly as handleDragEnd
    // does — the write schedules a debounce the bump must absorb.
    act(() => {
      hookApi!.noteGestureEnd();
      store.getState().updateElement('img-1', { x: 240 });
      hookApi!.bumpGeometryNow();
    });
    expect(hookApi!.geometryNonce).toBe(nonceAtStart + 1);

    // No trailing second refresh from the absorbed debounce.
    await act(async () => {
      await sleep(GEOMETRY_CACHE_DEBOUNCE_MS + 150);
    });
    expect(hookApi!.geometryNonce).toBe(nonceAtStart + 1);
  });
});
