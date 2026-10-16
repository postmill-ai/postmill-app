import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import Konva from 'konva';
import { Stage, Layer } from 'react-konva';
import { CanvasElements } from './elements';
import type { DesignerElement } from './designer.store';

/**
 * Regression: dragging a styled / adjusted image moved the Transformer frame
 * and the hit region but left the BITMAP frozen at the pre-drag position.
 *
 * The cached wrappers (StyledLayer, AdjustmentScope) Konva-`cache()` an
 * ancestor of the draggable node and deliberately exclude geometry from their
 * cache keys, so Konva — which never repaints a cached node when a descendant
 * moves — kept drawing the stale buffer forever; nothing invalidated on
 * dragEnd. The fix folds a commit-only `geometryNonce` into the cache keys:
 * per drag frame the key is stable (the perf design the keys exist for), and
 * on commit each wrapper's own effect re-caches once.
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

/** The nearest cached ancestor of the dragged node — the frozen bitmap. */
const cachedAncestor = (id: string): Konva.Node => {
  const node = stageRef!.findOne('#' + id);
  expect(node, `node #${id} should exist`).toBeTruthy();
  const ancestor = node!
    .getAncestors()
    .find((a) => (a as unknown as { isCached(): boolean }).isCached?.());
  expect(ancestor, `#${id} should sit under a cached wrapper`).toBeTruthy();
  return ancestor!;
};

describe('gesture-commit cache refresh', () => {
  it('StyledLayer keeps its buffer per drag frame and re-caches once on commit', async () => {
    const cacheSpy = vi.spyOn(Konva.Group.prototype, 'cache');
    const callsOn = (node: Konva.Node) =>
      cacheSpy.mock.contexts.filter((ctx) => ctx === node).length;

    await renderTree([styledImage], 0);
    const styled = cachedAncestor('img-1');
    const before = cacheCanvas(styled);
    expect(before).not.toBeNull();
    const mountCalls = callsOn(styled);
    expect(mountCalls).toBeGreaterThan(0);

    // Drag frames: the element moves in the store on every rAF tick, but the
    // cache key excludes geometry, so the wrapper must NOT re-rasterise.
    await renderTree([{ ...styledImage, x: 40, y: 12 } as DesignerElement], 0);
    await renderTree([{ ...styledImage, x: 96, y: 30 } as DesignerElement], 0);
    expect(callsOn(styled)).toBe(mountCalls);
    expect(cacheCanvas(styled)).toBe(before);

    // Commit (dragEnd): the nonce bump turns the key over exactly once and the
    // buffer rebuilds at the committed position.
    await renderTree([{ ...styledImage, x: 96, y: 30 } as DesignerElement], 1);
    expect(callsOn(styled)).toBe(mountCalls + 1);
    expect(cacheCanvas(styled)).not.toBe(before);
  });

  it('AdjustmentScope re-caches on commit, not per drag frame', async () => {
    const cacheSpy = vi.spyOn(Konva.Group.prototype, 'cache');
    const callsOn = (node: Konva.Node) =>
      cacheSpy.mock.contexts.filter((ctx) => ctx === node).length;

    await renderTree([plainImage, brightnessAdj], 0);
    const scope = cachedAncestor('img-1');
    expect((scope as unknown as Konva.Group).filters().length).toBeGreaterThan(0);
    const before = cacheCanvas(scope);
    expect(before).not.toBeNull();
    const mountCalls = callsOn(scope);

    await renderTree([{ ...plainImage, x: 64, y: 48 } as DesignerElement, brightnessAdj], 0);
    expect(callsOn(scope)).toBe(mountCalls);
    expect(cacheCanvas(scope)).toBe(before);

    await renderTree([{ ...plainImage, x: 64, y: 48 } as DesignerElement, brightnessAdj], 1);
    expect(callsOn(scope)).toBe(mountCalls + 1);
    expect(cacheCanvas(scope)).not.toBe(before);
  });
});
