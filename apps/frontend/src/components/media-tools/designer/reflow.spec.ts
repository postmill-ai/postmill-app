import { describe, it, expect } from 'vitest';
import { smartReflow, deriveAnchor } from './reflow';
import type { DesignerElement, DesignerOutput } from './designer.store';

const squareSource: DesignerOutput = {
  id: 'sq',
  formatId: 'instagram-post',
  name: 'Square',
  width: 1080,
  height: 1080,
  background: '#ffffff',
  children: [],
};

const storyTarget: DesignerOutput = {
  id: 'st',
  formatId: 'instagram-story',
  name: 'Story',
  width: 1080,
  height: 1920,
  background: '#ffffff',
  children: [],
};

const photoEl: DesignerElement = {
  id: 'p1',
  type: 'image',
  x: 0,
  y: 0,
  width: 1080,
  height: 1080,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  src: 'https://example.com/photo.jpg',
  naturalWidth: 1200,
  naturalHeight: 1200,
  fitMode: 'cover',
};

const headlineEl: DesignerElement = {
  id: 't1',
  type: 'text',
  x: 240,
  y: 80,
  width: 600,
  height: 120,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  text: 'Headline',
  fontSize: 72,
};

describe('deriveAnchor', () => {
  it('derives top-center from position', () => {
    const el: DesignerElement = {
      ...headlineEl,
      x: squareSource.width / 2 - headlineEl.width / 2,
      y: 20,
    };
    expect(deriveAnchor(el, squareSource)).toBe('top-center');
  });

  it('respects an explicit anchor', () => {
    const el: DesignerElement = { ...headlineEl, anchor: 'bottom-right' };
    expect(deriveAnchor(el, squareSource)).toBe('bottom-right');
  });
});

describe('smartReflow', () => {
  it('fills a 9:16 frame with a square cover photo', () => {
    const result = smartReflow(photoEl, squareSource, storyTarget);
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1920);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.fitMode).toBe('cover');
  });

  it('keeps a top headline readable and inside the title-safe zone', () => {
    const result = smartReflow(headlineEl, squareSource, storyTarget);
    expect(result.fontSize).toBeGreaterThanOrEqual(10);
    const expectedW = Math.round(600 * (1080 / 1080)); // scale = min(1, 0.5625) = 0.5625
    expect(result.width).toBe(expectedW);
    // Anchor is top-center, so centered horizontally.
    expect(result.x).toBe((storyTarget.width - (result.width as number)) / 2);
    // Pulled down into the title-safe margin (5% fallback for story preset).
    expect(result.y).toBeGreaterThanOrEqual(storyTarget.height * 0.05);
  });

  it('keeps a bottom-right element inside the safe zone', () => {
    const el: DesignerElement = {
      ...headlineEl,
      x: 800,
      y: 900,
      width: 220,
      height: 80,
      anchor: 'bottom-right',
    };
    const result = smartReflow(el, squareSource, storyTarget);
    const rightEdge = (result.x as number) + (result.width as number);
    const bottomEdge = (result.y as number) + (result.height as number);
    expect(rightEdge).toBeLessThanOrEqual(storyTarget.width * 0.95);
    expect(bottomEdge).toBeLessThanOrEqual(storyTarget.height * 0.95);
  });

  it('uses the 5% fallback safe zone for unknown formats', () => {
    const customTarget: DesignerOutput = {
      id: 'custom',
      formatId: 'custom',
      name: 'Custom',
      width: 1000,
      height: 1000,
      background: '#ffffff',
      children: [],
    };
    const el: DesignerElement = {
      ...headlineEl,
      x: 10,
      y: 10,
      width: 300,
      height: 80,
    };
    const result = smartReflow(el, squareSource, customTarget);
    expect(result.x).toBeGreaterThanOrEqual(50);
    expect(result.y).toBeGreaterThanOrEqual(50);
  });
});
