import { describe, it, expect } from 'vitest';
import {
  applyTransitionAdjustment,
  transitionAdjustment,
  transitionsSource,
  TRANSITION_MAX_BLUR_PX,
} from './transitions';

describe('transitionAdjustment', () => {
  it('cut hides the outgoing clip and leaves the incoming alone', () => {
    expect(transitionAdjustment('cut', undefined, 0.5, false, 100, 100).opacityFactor).toBe(0);
    expect(transitionAdjustment('cut', undefined, 0.5, true, 100, 100).opacityFactor).toBe(1);
  });

  it('fade is a fade-THROUGH-BLACK — each clip owns half the window', () => {
    // Outgoing: fully visible at p=0, gone by p=0.5.
    expect(transitionAdjustment('fade', undefined, 0, false, 100, 100).opacityFactor).toBe(1);
    expect(transitionAdjustment('fade', undefined, 0.25, false, 100, 100).opacityFactor).toBe(0.5);
    expect(transitionAdjustment('fade', undefined, 0.5, false, 100, 100).opacityFactor).toBe(0);
    // Incoming: nothing before the midpoint, fully in at p=1.
    expect(transitionAdjustment('fade', undefined, 0.25, true, 100, 100).opacityFactor).toBe(0);
    expect(transitionAdjustment('fade', undefined, 0.75, true, 100, 100).opacityFactor).toBe(0.5);
    expect(transitionAdjustment('fade', undefined, 1, true, 100, 100).opacityFactor).toBe(1);
  });

  it('dissolve is the plain cross-fade — NOT the same ramp as fade', () => {
    expect(transitionAdjustment('dissolve', undefined, 0.25, true, 100, 100).opacityFactor).toBe(0.25);
    expect(transitionAdjustment('dissolve', undefined, 0.25, false, 100, 100).opacityFactor).toBe(0.75);
    // At the midpoint a dissolve mixes both clips; a fade is fully black.
    expect(transitionAdjustment('dissolve', undefined, 0.5, true, 100, 100).opacityFactor).toBe(0.5);
    expect(transitionAdjustment('fade', undefined, 0.5, true, 100, 100).opacityFactor).toBe(0);
  });

  it('slide offsets BOTH clips along the direction with a cross-fade', () => {
    const incoming = transitionAdjustment('slide', 'left', 0.25, true, 200, 100);
    expect(incoming.dx).toBeCloseTo(-150);
    expect(incoming.opacityFactor).toBeCloseTo(0.25);
    const outgoing = transitionAdjustment('slide', 'left', 0.25, false, 200, 100);
    expect(outgoing.dx).toBeCloseTo(-50);
    expect(outgoing.opacityFactor).toBeCloseTo(0.75);
  });

  it('wipe slides the incoming clip over a STATIC outgoing one (no fade)', () => {
    const outgoing = transitionAdjustment('wipe', 'left', 0.25, false, 200, 100);
    expect(outgoing).toEqual({ opacityFactor: 1, dx: 0, dy: 0, scale: 1, blurPx: 0 });
    const incoming = transitionAdjustment('wipe', 'left', 0.25, true, 200, 100);
    expect(incoming.dx).toBeCloseTo(-150);
    expect(incoming.opacityFactor).toBe(1);
    // Direction is honoured on the vertical axis too.
    expect(transitionAdjustment('wipe', 'down', 0.5, true, 200, 100).dy).toBeCloseTo(50);
  });

  it('zoom grows the incoming clip into place and the outgoing past the frame', () => {
    expect(transitionAdjustment('zoom', undefined, 0, true, 100, 100).scale).toBeCloseTo(0.6);
    expect(transitionAdjustment('zoom', undefined, 1, true, 100, 100).scale).toBeCloseTo(1);
    expect(transitionAdjustment('zoom', undefined, 0, false, 100, 100).scale).toBeCloseTo(1);
    expect(transitionAdjustment('zoom', undefined, 1, false, 100, 100).scale).toBeCloseTo(1.4);
  });

  it('blur ramps the gaussian inversely to each clip\'s opacity', () => {
    expect(transitionAdjustment('blur', undefined, 0, true, 100, 100).blurPx).toBeCloseTo(TRANSITION_MAX_BLUR_PX);
    expect(transitionAdjustment('blur', undefined, 1, true, 100, 100).blurPx).toBeCloseTo(0);
    expect(transitionAdjustment('blur', undefined, 1, false, 100, 100).blurPx).toBeCloseTo(TRANSITION_MAX_BLUR_PX);
    expect(transitionAdjustment('blur', undefined, 0, false, 100, 100).blurPx).toBeCloseTo(0);
  });
});

describe('applyTransitionAdjustment', () => {
  const props = { x: 10, y: 20, width: 200, height: 100, opacity: 0.8, rotation: 0, volume: 1 };

  it('scales about the clip centre, applies offsets, and clamps opacity', () => {
    const out = applyTransitionAdjustment(props, {
      opacityFactor: 2, // clamps to 1
      dx: 5,
      dy: -5,
      scale: 0.5,
      blurPx: 3,
    });
    expect(out.width).toBe(100);
    expect(out.height).toBe(50);
    // Centre (110, 70) preserved, then offset.
    expect(out.x).toBeCloseTo(110 - 50 + 5);
    expect(out.y).toBeCloseTo(70 - 25 - 5);
    expect(out.opacity).toBe(1);
    expect(out.blurPx).toBe(3);
    // Untouched props carry over.
    expect(out.rotation).toBe(0);
    expect(out.volume).toBe(1);
  });

  it('never pushes opacity below zero', () => {
    const out = applyTransitionAdjustment(props, {
      opacityFactor: 0,
      dx: 0,
      dy: 0,
      scale: 1,
      blurPx: 0,
    });
    expect(out.opacity).toBe(0);
  });
});

describe('transitionsSource', () => {
  it('is a self-contained block with every function the frame renderer calls', () => {
    const src = transitionsSource();
    expect(src).toContain('transitionAdjustment');
    expect(src).toContain('applyTransitionAdjustment');
    expect(src).toContain(String(TRANSITION_MAX_BLUR_PX));
    // Dependency-free: nothing imported may leak into the injected page.
    expect(src).not.toContain('require(');
    expect(src).not.toContain('import ');
  });
});
