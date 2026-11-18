import { describe, expect, it } from 'vitest';
import { getContextMenuPlacement, getSubmenuPlacement } from './context-menu-position';

const viewport = { width: 1000, height: 800 };

describe('getContextMenuPlacement', () => {
  it('opens down and right when the menu fits', () => {
    expect(getContextMenuPlacement({ x: 100, y: 100 }, { width: 200, height: 300 }, viewport))
      .toMatchObject({
        left: 100,
        top: 100,
        maxWidth: 200,
        maxHeight: 300,
        opensLeft: false,
        opensUp: false,
        scrollable: false,
      });
  });

  it('flips left at the right edge', () => {
    expect(getContextMenuPlacement({ x: 950, y: 100 }, { width: 200, height: 300 }, viewport))
      .toMatchObject({ left: 750, opensLeft: true, maxWidth: 200 });
  });

  it('opens upward and scrolls within the available space at the bottom', () => {
    expect(getContextMenuPlacement(
      { x: 900, y: 550 },
      { width: 200, height: 650 },
      { width: 1000, height: 600 }
    )).toMatchObject({
      left: 700,
      top: 8,
      maxHeight: 542,
      opensLeft: true,
      opensUp: true,
      scrollable: true,
    });
  });

  it('uses the larger side when neither direction fits naturally', () => {
    expect(getContextMenuPlacement(
      { x: 400, y: 260 },
      { width: 200, height: 400 },
      { width: 800, height: 500 }
    )).toMatchObject({ top: 8, maxHeight: 252, opensUp: true, scrollable: true });
  });

  it('clamps an out-of-bounds invoking point to the viewport margin', () => {
    expect(getContextMenuPlacement({ x: -20, y: -20 }, { width: 200, height: 300 }, viewport))
      .toMatchObject({ left: 8, top: 8, maxWidth: 200, maxHeight: 300 });
  });

  it('bounds both dimensions when the menu is larger than the viewport', () => {
    expect(getContextMenuPlacement(
      { x: 400, y: 300 },
      { width: 1000, height: 1000 },
      { width: 800, height: 600 }
    )).toMatchObject({
      left: 400,
      top: 300,
      maxWidth: 392,
      maxHeight: 292,
      scrollable: true,
    });
  });

  it('caps available space to the viewport for an out-of-bounds point', () => {
    expect(getContextMenuPlacement(
      { x: -20, y: -20 },
      { width: 1000, height: 1000 },
      { width: 800, height: 600 }
    )).toMatchObject({ left: 8, top: 8, maxWidth: 784, maxHeight: 584, scrollable: true });
  });
});

describe('getSubmenuPlacement', () => {
  it('aligns to the trigger top and opens right by default', () => {
    expect(getSubmenuPlacement(
      { left: 100, top: 100, right: 300, bottom: 130 },
      { width: 160, height: 180 },
      viewport
    )).toMatchObject({
      left: 300,
      top: 96,
      maxWidth: 160,
      maxHeight: 180,
      opensLeft: false,
      opensUp: false,
      scrollable: false,
    });
  });

  it('flips left at the right edge', () => {
    expect(getSubmenuPlacement(
      { left: 700, top: 100, right: 900, bottom: 130 },
      { width: 160, height: 180 },
      viewport
    )).toMatchObject({ left: 540, top: 96, opensLeft: true });
  });

  it('aligns upward with the trigger near the bottom', () => {
    expect(getSubmenuPlacement(
      { left: 100, top: 480, right: 300, bottom: 510 },
      { width: 160, height: 300 },
      { width: 1000, height: 600 }
    )).toMatchObject({ left: 300, top: 214, opensUp: true, maxHeight: 300 });
  });

  it('caps and scrolls an oversized flyout within the viewport', () => {
    expect(getSubmenuPlacement(
      { left: 100, top: 480, right: 300, bottom: 510 },
      { width: 160, height: 650 },
      { width: 1000, height: 600 }
    )).toMatchObject({ top: 8, maxHeight: 506, opensUp: true, scrollable: true });
  });

  it('bounds a flyout on a narrow, short viewport', () => {
    expect(getSubmenuPlacement(
      { left: 250, top: 120, right: 350, bottom: 150 },
      { width: 200, height: 400 },
      { width: 360, height: 300 }
    )).toMatchObject({
      left: 50,
      top: 116,
      maxWidth: 200,
      maxHeight: 176,
      opensLeft: true,
      opensUp: false,
      scrollable: true,
    });
  });
});
