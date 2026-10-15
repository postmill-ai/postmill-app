import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import Konva from 'konva';
import { Stage, Layer } from 'react-konva';
import { CanvasElements } from './elements';
import type { DesignerElement } from './designer.store';

/**
 * Regression (prod verification of #125): an inserted ellipse painted
 * correctly but its Konva hit region sat one radius off its visual box —
 * `getIntersection` at the visual centre returned the element underneath, and
 * only at (+radiusX, +radiusY) did it return the Ellipse. Click-to-select
 * missed. Cause: Konva's `Ellipse` is centre-origin, and the negative-offset
 * shim that pushed it into the top-left element box made hit and paint
 * disagree. The ellipse is now traced in the same top-left box space as every
 * other shape, so the hit graph traces the painted path by construction.
 *
 * These assertions run a real Konva draw (jsdom ships node-canvas via vitest)
 * because the bug lived exactly in the scene-vs-hit divergence.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const rect = {
  id: 'bg-rect',
  type: 'shape',
  shape: 'rect',
  x: 0,
  y: 0,
  width: 400,
  height: 400,
  fill: '#F4F1EA',
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
} as unknown as DesignerElement;

// Box (100,80)-(220,160): centre (160,120), radii (60,40).
const ellipse = {
  id: 'ellipse-1',
  type: 'shape',
  shape: 'ellipse',
  x: 100,
  y: 80,
  width: 120,
  height: 80,
  fill: '#2B5CD3',
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
} as unknown as DesignerElement;

let root: Root | null = null;
let stage: Konva.Stage | null = null;

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  stage = null;
});

const renderEllipse = async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <Stage width={400} height={400}>
        <Layer>
          <CanvasElements elements={[rect, ellipse]} onSelect={() => {}} />
        </Layer>
      </Stage>
    );
  });
  stage = Konva.stages[Konva.stages.length - 1];
  const layer = stage.getLayers()[0];
  await act(async () => {
    layer.draw();
  });
  return layer;
};

describe('ellipse hit geometry', () => {
  it('maps the node to the top-left element box (no centre-origin offset)', async () => {
    await renderEllipse();
    const node = stage!.findOne('#ellipse-1') as Konva.Shape;
    // The self rect must be the element box in box-local space — the old
    // centre-origin Ellipse reported (-width/2, -height/2) here.
    expect(node.getSelfRect()).toEqual({ x: 0, y: 0, width: 120, height: 80 });
    // And the client rect is the visual box, so the Transformer, snapping and
    // marquee all measure the same rectangle the paint occupies.
    const box = node.getClientRect();
    expect(box.x).toBeCloseTo(100, 1);
    expect(box.y).toBeCloseTo(80, 1);
    expect(box.width).toBeCloseTo(120, 1);
    expect(box.height).toBeCloseTo(80, 1);
  });

  it('hit region covers the visual centre', async () => {
    const layer = await renderEllipse();
    expect(layer.getIntersection({ x: 160, y: 120 })?.id()).toBe('ellipse-1');
  });

  it('hit region is the painted ellipse, not an offset copy or its bbox', async () => {
    const layer = await renderEllipse();
    // Just inside the left and top extremes of the painted ellipse.
    expect(layer.getIntersection({ x: 104, y: 120 })?.id()).toBe('ellipse-1');
    expect(layer.getIntersection({ x: 160, y: 84 })?.id()).toBe('ellipse-1');
    // The box corner is inside the element rect but OUTSIDE the painted
    // ellipse — the rect underneath must win there, proving the hit region is
    // the ellipse itself rather than a shifted bounding box.
    expect(layer.getIntersection({ x: 102, y: 82 })?.id()).toBe('bg-rect');
    // One radius off the visual centre — where the stale hit region used to
    // sit — is outside the element box entirely.
    expect(layer.getIntersection({ x: 160 + 60 + 30, y: 120 })?.id()).toBe('bg-rect');
  });
});
