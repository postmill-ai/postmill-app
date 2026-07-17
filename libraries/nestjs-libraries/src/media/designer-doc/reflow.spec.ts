import { describe, it, expect } from 'vitest';
import { getSafeZoneInset, smartReflow } from './reflow';
import type { DesignerElement } from './designer-doc.schema';

// channel-presets.ts `safeZones` are UNSAFE overlay rects (platform UI chrome);
// the inset box is the canvas minus the edge-hugging zones.
describe('getSafeZoneInset', () => {
  it('derives insets from the overlay strips on ig-story', () => {
    // Top Safe Zone y:0 h:80, CTA Bar y:1780 h:140 (both full-width).
    expect(getSafeZoneInset('ig-story', 1080, 1920)).toEqual({
      left: 0,
      top: 80,
      right: 1080,
      bottom: 1780,
    });
  });

  it('derives insets for ig-reel and tiktok', () => {
    expect(getSafeZoneInset('ig-reel', 1080, 1920)).toEqual({
      left: 0,
      top: 120,
      right: 1080,
      bottom: 1720,
    });
    expect(getSafeZoneInset('tiktok', 1080, 1920)).toEqual({
      left: 0,
      top: 100,
      right: 1080,
      bottom: 1700,
    });
  });

  it('leaves un-covered edges full-bleed (fb-story has no top overlay)', () => {
    expect(getSafeZoneInset('fb-story', 1080, 1920)).toEqual({
      left: 0,
      top: 0,
      right: 1080,
      bottom: 1780,
    });
  });

  it('uses the 5% fallback for formats without safe zones', () => {
    expect(getSafeZoneInset('unknown-format', 1000, 1000)).toEqual({
      left: 50,
      top: 50,
      right: 950,
      bottom: 950,
    });
  });
});

describe('smartReflow with preset safe zones', () => {
  const squareSource = { width: 1080, height: 1080 };
  const storyTarget = { width: 1080, height: 1920, formatId: 'ig-story' };

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

  it('pulls a top headline below the top overlay, not to (0,0)', () => {
    const result = smartReflow(headlineEl, squareSource, storyTarget);
    // top-center anchor, scale 1: centered, clamped to the 80px top inset.
    expect(result.x).toBe(240);
    expect(result.y).toBe(80);
  });

  it('keeps a bottom-anchored element above the bottom overlay', () => {
    const el: DesignerElement = { ...headlineEl, anchor: 'bottom-center' };
    const result = smartReflow(el, squareSource, storyTarget);
    // bottom inset is 1780 → y = 1780 - height.
    expect(result.y).toBe(1660);
    expect((result.y as number) + (result.height as number)).toBe(1780);
  });
});
