import { describe, it, expect } from 'vitest';
import {
  computeGroupBoxes,
  computeTextStackBoxes,
  getSafeZoneInset,
  roleFontFloorPx,
  smartReflow,
} from './reflow';
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

describe('smartReflow cover images', () => {
  const squareSource = { width: 1080, height: 1080 };
  const xPostTarget = { width: 1200, height: 675, formatId: 'x-post' };

  const coverEl = (box: { x: number; y: number; width: number; height: number }): DesignerElement => ({
    id: 'i1',
    type: 'image',
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    fitMode: 'cover',
    ...box,
  });

  it('keeps a full-canvas cover image full-canvas on the target', () => {
    const result = smartReflow(
      coverEl({ x: 0, y: 0, width: 1080, height: 1080 }),
      squareSource,
      xPostTarget
    );
    expect(result).toMatchObject({ x: 0, y: 0, width: 1200, height: 675 });
  });

  it('preserves a partial-area cover box per-axis instead of forcing full-canvas', () => {
    // Split-panel column: right 54% of a square source.
    const result = smartReflow(
      coverEl({ x: 497, y: 0, width: 583, height: 1080 }),
      squareSource,
      xPostTarget
    );
    // Per-axis scale: w = 583·(1200/1080) ≈ 648, h = 675 — never stretched
    // into a full-canvas background.
    expect(result.width).toBe(648);
    expect(result.height).toBe(675);
    expect(result.y).toBe(0);
  });
});

describe('smartReflow grouped pairs', () => {
  const squareSource = { width: 1080, height: 1080 };
  const storyTarget = { width: 1080, height: 1920, formatId: 'ig-story' };

  // Underline CTA: the bar's box differs from the label's, so independently
  // derived anchors split the pair on seeding (the 40–280px drift bug).
  const bar: DesignerElement = {
    id: 'b1',
    type: 'shape',
    shape: 'rect',
    x: 400,
    y: 900,
    width: 280,
    height: 6,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    groupId: 'cta',
    originId: 'cta-underline',
  };
  const label: DesignerElement = {
    id: 't1',
    type: 'text',
    x: 400,
    y: 850,
    width: 280,
    height: 60,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    text: 'Shop now',
    fontSize: 40,
    groupId: 'cta',
    originId: 'cta',
  };

  it('keeps a grouped pair relative offsets after seeding to a different aspect', () => {
    const boxes = computeGroupBoxes([bar, label]);
    const barOut = smartReflow(bar, squareSource, storyTarget, boxes.get('cta'));
    const labelOut = smartReflow(
      label,
      squareSource,
      storyTarget,
      boxes.get('cta')
    );

    // Same anchor transform for both members: the source offsets survive.
    expect((labelOut.x as number) - (barOut.x as number)).toBe(
      label.x - bar.x
    );
    expect((barOut.y as number) - (labelOut.y as number)).toBe(bar.y - label.y);
  });

  it('re-derives the group anchor even when a member carries its own anchor', () => {
    const boxes = computeGroupBoxes([bar, label]);
    const anchoredBar = { ...bar, anchor: 'top-left' as const };
    const plain = smartReflow(bar, squareSource, storyTarget, boxes.get('cta'));
    const anchored = smartReflow(
      anchoredBar,
      squareSource,
      storyTarget,
      boxes.get('cta')
    );

    // A member-level anchor must not re-split the pair.
    expect(anchored.x).toBe(plain.x);
    expect(anchored.y).toBe(plain.y);
  });
});

describe('smartReflow full-bleed shapes', () => {
  it('keeps a full-height panel full-bleed (per-axis) on aspect change', () => {
    // split-panel-bg: 46% width, 100% height of a square source.
    const panel: DesignerElement = {
      id: 'p1',
      type: 'shape',
      shape: 'rect',
      x: 0,
      y: 0,
      width: 497,
      height: 1080,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      originId: 'split-panel-bg',
    };
    const result = smartReflow(
      panel,
      { width: 1080, height: 1080 },
      { width: 1080, height: 1920, formatId: 'ig-story' }
    );

    // Uniform scale would shrink this into a 497x1080 floating rect centered
    // on the tall canvas; per-axis scaling keeps it a full-height panel.
    expect(result.y).toBe(0);
    expect(result.height).toBe(1920);
    expect(result.width).toBe(497);
  });

  it('keeps a full-width band full-width when the target widens', () => {
    const band: DesignerElement = {
      id: 'p2',
      type: 'shape',
      shape: 'rect',
      x: 0,
      y: 400,
      width: 1080,
      height: 180,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      originId: 'band-bg',
    };
    const result = smartReflow(
      band,
      { width: 1080, height: 1080 },
      { width: 1200, height: 675, formatId: 'x-post' }
    );

    expect(result.x).toBe(0);
    expect(result.width).toBe(1200);
    // Fractional position kept per-axis: y = 400 * (675/1080) = 250.
    expect(result.y).toBe(250);
  });
});

describe('smartReflow safe-zone flush exemption', () => {
  const squareSource = { width: 1080, height: 1080 };
  // Unknown format → 5% fallback inset: safe area 50..950.
  const target = { width: 1000, height: 1000, formatId: 'unknown-format' };

  const chip = (overrides: Partial<DesignerElement> = {}): DesignerElement =>
    ({
      id: 'c1',
      type: 'shape',
      shape: 'rect',
      x: 0,
      y: 400,
      width: 300,
      height: 200,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      originId: 'accent',
      ...overrides,
    } as DesignerElement);

  it('leaves a non-full-bleed band flush with the canvas edge unclamped', () => {
    // Big enough (≥6% of the source canvas, no `-bg` origin) to read as a
    // deliberate band, left-anchored and flush at x = 0: pulling it to
    // safe.left (50) would leave a background-colored strip behind it.
    const band = chip({ width: 700, height: 300 });
    const result = smartReflow(band, squareSource, target);
    expect(result.x).toBe(0);
  });

  it('clamps an ungrouped small chip inward — chips are never flush-exempt', () => {
    // 300×200 on a 1080² source is ~5% — a badge chip flush with the edge is
    // a clipped badge, not an intentional bleed.
    const result = smartReflow(chip(), squareSource, target);
    expect(result.x).toBe(50);
  });

  it('clamps a `-bg` companion chip inward regardless of its size', () => {
    const result = smartReflow(
      chip({ width: 400, height: 300, originId: 'badge-bg' }),
      squareSource,
      target
    );
    expect(result.x).toBe(50);
  });

  it('clamps the identical grouped shape inward — grouped pairs are never flush-exempt', () => {
    const grouped = chip({ groupId: 'cta' });
    const boxes = computeGroupBoxes([grouped]);
    const result = smartReflow(
      grouped,
      squareSource,
      target,
      boxes.get('cta')
    );
    expect(result.x).toBe(50);
  });
});

describe('smartReflow role-aware grouped font floor', () => {
  // Scale 0.5: a 20px label would land at 10px.
  const source = { width: 2160, height: 2160 };
  const target = { width: 1080, height: 1920, formatId: 'ig-story' };

  const label: DesignerElement = {
    id: 't1',
    type: 'text',
    x: 800,
    y: 800,
    width: 400,
    height: 100,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    text: 'Shop now',
    fontSize: 20,
    groupId: 'cta',
    originId: 'cta',
  };

  it('floors a grouped label at round(12 × min(target) / 1080) instead of the flat 10', () => {
    const boxes = computeGroupBoxes([label]);
    const result = smartReflow(label, source, target, boxes.get('cta'));
    expect(result.fontSize).toBe(12);
  });

  it('keeps the flat 10px floor for ungrouped text', () => {
    const result = smartReflow({ ...label, groupId: undefined }, source, target);
    expect(result.fontSize).toBe(10);
  });
});

describe('roleFontFloorPx', () => {
  it('floors grouped labels at 12px scaled by the canvas short side', () => {
    expect(roleFontFloorPx({ groupId: 'cta' } as DesignerElement, 1080, 1920)).toBe(12);
    expect(roleFontFloorPx({ groupId: 'cta' } as DesignerElement, 2160, 2160)).toBe(24);
    // Never below the flat minimum on tiny canvases.
    expect(roleFontFloorPx({ groupId: 'cta' } as DesignerElement, 500, 500)).toBe(10);
  });

  it('keeps the flat 10px floor for ungrouped text at any canvas size', () => {
    expect(roleFontFloorPx({} as DesignerElement, 2160, 2160)).toBe(10);
    expect(roleFontFloorPx({} as DesignerElement, 500, 500)).toBe(10);
  });
});

describe('smartReflow copy stacks', () => {
  const source = { width: 1080, height: 1080 };
  const wideTarget = { width: 1200, height: 675, formatId: 'unknown-format' };

  const headline: DesignerElement = {
    id: 'h1',
    type: 'text',
    x: 54,
    y: 270,
    width: 972,
    height: 160,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    text: 'Headline',
    fontSize: 72,
    originId: 'headline',
  };
  // Straddles the 0.33 thirds boundary (cy 476 vs the headline's 350):
  // independent anchor derivation buckets them top vs center and tears the
  // stack apart on aspect change.
  const subhead: DesignerElement = {
    ...headline,
    id: 's1',
    y: 436,
    height: 80,
    text: 'Subhead',
    fontSize: 36,
    originId: 'sub',
  };

  it('reflows a same-column ungrouped stack as one unit (no thirds split)', () => {
    const stacks = computeTextStackBoxes([headline, subhead], source);
    expect(stacks.get(headline)).toBeDefined();
    expect(stacks.get(headline)).toBe(stacks.get(subhead));

    const headOut = smartReflow(headline, source, wideTarget, stacks.get(headline));
    const subOut = smartReflow(subhead, source, wideTarget, stacks.get(subhead));

    // One shared anchor for both members: the 6px source gap survives scaled
    // (~4px) instead of the subhead dropping to an independent center anchor
    // hundreds of px below its headline.
    expect(headOut.anchor).toBe(subOut.anchor);
    const gap =
      (subOut.y as number) -
      ((headOut.y as number) + (headOut.height as number));
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(8);
  });

  it('does not group texts separated by a deliberate top/bottom band gap', () => {
    const bottom: DesignerElement = {
      ...headline,
      id: 'b1',
      y: 950,
      height: 80,
      text: 'Bottom caption',
      originId: 'bottom',
    };
    const stacks = computeTextStackBoxes([headline, subhead, bottom], source);

    expect(stacks.get(headline)).toBeDefined();
    expect(stacks.get(bottom)).toBeUndefined();
  });

  it('does not group grouped (CTA) members — they keep their own frame', () => {
    const cta: DesignerElement = {
      ...subhead,
      id: 'c1',
      y: 530,
      height: 60,
      text: 'Shop now',
      groupId: 'cta',
      originId: 'cta',
    };
    const stacks = computeTextStackBoxes([headline, subhead, cta], source);

    expect(stacks.get(cta)).toBeUndefined();
    expect(stacks.get(headline)).toBe(stacks.get(subhead));
  });
});

describe('smartReflow text width clamp', () => {
  it('shrinks a text box wider than the title-safe area', () => {
    const el: DesignerElement = {
      id: 't1',
      type: 'text',
      x: 0,
      y: 100,
      width: 1080,
      height: 100,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      text: 'A very wide headline box',
      fontSize: 40,
    };
    // Unknown format → 5% fallback inset: safe area 50..950 (900 wide).
    const result = smartReflow(
      el,
      { width: 1080, height: 1080 },
      { width: 1000, height: 1000, formatId: 'unknown-format' }
    );

    expect(result.width).toBe(900);
    expect(result.x).toBeGreaterThanOrEqual(50);
    expect((result.x as number) + (result.width as number)).toBeLessThanOrEqual(
      950
    );
  });
});
