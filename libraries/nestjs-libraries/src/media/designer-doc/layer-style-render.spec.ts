import { describe, it, expect } from 'vitest';
import { createCanvas } from 'canvas';
import { blurCanvas, buildStyleGradient } from './layer-style-render';

/**
 * `ctx.filter = 'blur(Npx)'` is accepted and silently ignored by node-canvas,
 * so every blur-based layer style rendered hard-edged in exports while looking
 * correct in the browser. These pin the pixel-space blur that replaced it.
 */

const px = (canvas: any, x: number, y: number): number[] => {
  const d = canvas.getContext('2d').getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
};

const opaqueSquare = (size: number, colour: string) => {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = colour;
  ctx.fillRect(size / 4, size / 4, size / 2, size / 2);
  return canvas;
};

describe('blurCanvas', () => {
  it('bleeds alpha past the edge of the shape', () => {
    const canvas = opaqueSquare(80, '#000000');
    // Just outside the square: empty before, softened into after.
    expect(px(canvas, 16, 40)[3]).toBe(0);
    blurCanvas(canvas, 6);
    expect(px(canvas, 16, 40)[3]).toBeGreaterThan(0);
  });

  it('softens the edge instead of leaving it hard', () => {
    const canvas = opaqueSquare(80, '#000000');
    blurCanvas(canvas, 6);
    const edge = px(canvas, 20, 40)[3];
    const middle = px(canvas, 40, 40)[3];
    expect(edge).toBeLessThan(middle);
    expect(edge).toBeGreaterThan(0);
  });

  it('does not drag black into a coloured glow', () => {
    // Premultiplication matters: blurring straight RGBA pulls the transparent
    // pixels' black into the result and every glow grows a dark halo.
    const canvas = opaqueSquare(80, '#ff0000');
    blurCanvas(canvas, 6);
    const [r, g, b, a] = px(canvas, 18, 40);
    expect(a).toBeGreaterThan(0);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(60);
  });

  it('leaves the canvas alone for a zero or negative radius', () => {
    const canvas = opaqueSquare(40, '#000000');
    const before = px(canvas, 10, 20);
    blurCanvas(canvas, 0);
    blurCanvas(canvas, -3);
    expect(px(canvas, 10, 20)).toEqual(before);
  });
});

describe('buildStyleGradient', () => {
  it('runs a linear ramp through the box at the requested angle', () => {
    const canvas = createCanvas(100, 100);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = buildStyleGradient(
      ctx,
      { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }] },
      100,
      100
    );
    ctx.fillRect(0, 0, 100, 100);
    // At angle 0 the ramp runs left to right.
    expect(px(canvas, 5, 50)[0]).toBeLessThan(px(canvas, 95, 50)[0]);
  });

  it('clamps a stop offset outside 0..1 rather than throwing', () => {
    const canvas = createCanvas(10, 10);
    const ctx = canvas.getContext('2d');
    expect(() =>
      buildStyleGradient(
        ctx,
        { type: 'radial', stops: [{ offset: -1, color: '#000000' }, { offset: 4, color: '#ffffff' }] },
        10,
        10
      )
    ).not.toThrow();
  });
});
