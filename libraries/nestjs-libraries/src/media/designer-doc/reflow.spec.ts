import { describe, it, expect } from 'vitest';
import {
  canvasMarginPx,
  computeContainerBoxes,
  computeGroupBoxes,
  computeTextStackBoxes,
  getSafeZoneInset,
  groupKeyOf,
  reflowBackground,
  roleFontFloorPx,
  smartReflow,
  typeBasisPx,
  typeScaleRatio,
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
    // Text is TYPE-SIZED, so it re-fits at the aspect basis (1440/1080 = 4/3
    // on a story), not the min-axis 1: the 600×120 box becomes 800×160.
    expect(result.width).toBe(800);
    expect(result.height).toBe(160);
    // top-center anchor: centered, clamped to the 80px top inset.
    expect(result.x).toBe(140);
    expect(result.y).toBe(80);
  });

  it('keeps a bottom-anchored element above the bottom overlay', () => {
    const el: DesignerElement = { ...headlineEl, anchor: 'bottom-center' };
    const result = smartReflow(el, squareSource, storyTarget);
    // bottom inset is 1780 → y = 1780 - height (160 at the aspect basis).
    expect(result.y).toBe(1620);
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

  // `focalPoint` is the crop WINDOW's position in the leftover slack, so it is
  // only valid for the box aspect it was computed against. The live docs
  // carried the identical 0.2283702213279678 on both a 583×1080 ig-post
  // element and this 648×675 x-post one, because it was simply inherited.
  it('re-derives the focal point for the new box aspect from the stored centroid', () => {
    const result = smartReflow(
      {
        ...coverEl({ x: 497, y: 0, width: 583, height: 1080 }),
        naturalWidth: 1024,
        naturalHeight: 1024,
        // What the ig-post box produced — carried over, it crops the wrong band.
        focalPoint: { x: 0.2283702213279678, y: 0.5 },
        // Where the subject actually is in the SOURCE image.
        subjectPoint: { x: 0.517, y: 0.5 },
      },
      squareSource,
      xPostTarget
    );

    // 1024² into 648×675: cropW = 1024·(648/675) = 983.04, slack = 40.96,
    // fp = (0.517·1024 − 491.52) / 40.96 = 0.925.
    expect(result.focalPoint!.x).toBeCloseTo(0.925, 6);
    expect(result.focalPoint!.x).not.toBeCloseTo(0.2283702213279678, 6);
    // Square source into a landscape box has zero vertical slack — y is inert.
    expect(result.focalPoint!.y).toBe(0.5);

    // The re-derived window centres the subject; the inherited one does not.
    const slack = 1024 - 983.04;
    const subjectX = 0.517 * 1024;
    const centreOf = (fpx: number) => slack * fpx + 983.04 / 2;
    expect(Math.abs(subjectX - centreOf(result.focalPoint!.x))).toBeLessThan(
      Math.abs(subjectX - centreOf(0.2283702213279678))
    );
  });

  it('keeps the stored focal point when the element carries no centroid', () => {
    const result = smartReflow(
      {
        ...coverEl({ x: 497, y: 0, width: 583, height: 1080 }),
        focalPoint: { x: 0.3, y: 0.7 },
      },
      squareSource,
      xPostTarget
    );
    expect(result.focalPoint).toEqual({ x: 0.3, y: 0.7 });
  });
});

describe('smartReflow grouped pairs', () => {
  const squareSource = { width: 1080, height: 1080 };
  const storyTarget = { width: 1080, height: 1920, formatId: 'ig-story' };

  // Underline CTA: the bar's box differs from the label's, so independently
  // derived anchors split the pair on seeding (the 40–280px drift bug). The
  // bar sits BELOW the label box (the composer's underline convention) and the
  // pair sits mid-canvas, clear of the title-safe edges — a pair overflowing a
  // safe edge is clamped member-by-member, which is a different behaviour.
  const bar: DesignerElement = {
    id: 'b1',
    type: 'shape',
    shape: 'rect',
    x: 400,
    y: 565,
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
    y: 500,
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

    // Same anchor transform for both members: the source offsets survive,
    // re-fit at the pair's own content scale (the aspect type basis, 4/3 on a
    // story) — a content-sized composite keeps its internal rhythm relative to
    // its type, and the two members round independently (65 → 86).
    expect((labelOut.x as number) - (barOut.x as number)).toBe(
      label.x - bar.x
    );
    expect((barOut.y as number) - (labelOut.y as number)).toBe(86);
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

  // The distinction the test above pins: ONE member carrying an anchor is
  // incidental (a previous per-element reflow left it there). Unanimity across
  // the whole unit is deliberate — the composer stamps a plan-authored badge
  // corner on every member — and that is a placement contract.
  it('honors an anchor only when every member of the group agrees', () => {
    const split = computeGroupBoxes([
      { ...bar, anchor: 'top-left' as const },
      label,
    ]);
    expect(split.get('cta')!.anchor).toBeUndefined();

    const disagreeing = computeGroupBoxes([
      { ...bar, anchor: 'top-left' as const },
      { ...label, anchor: 'bottom-right' as const },
    ]);
    expect(disagreeing.get('cta')!.anchor).toBeUndefined();

    const unanimous = computeGroupBoxes([
      { ...bar, anchor: 'top-right' as const },
      { ...label, anchor: 'top-right' as const },
    ]);
    expect(unanimous.get('cta')!.anchor).toBe('top-right');

    // …and the unanimous anchor wins over the bbox derivation, for every
    // member, so the pair still moves as one.
    const barOut = smartReflow(
      { ...bar, anchor: 'top-right' as const },
      squareSource,
      storyTarget,
      unanimous.get('cta')
    );
    const labelOut = smartReflow(
      { ...label, anchor: 'top-right' as const },
      squareSource,
      storyTarget,
      unanimous.get('cta')
    );
    expect(barOut.anchor).toBe('top-right');
    expect(labelOut.anchor).toBe('top-right');
    expect((labelOut.x as number) - (barOut.x as number)).toBe(label.x - bar.x);
  });

  it('leaves a self-placing (unanimously anchored) unit out of a copy stack', () => {
    const stackHeadline: DesignerElement = {
      ...label,
      id: 'h1',
      groupId: undefined,
      originId: 'headline',
      x: 400,
      y: 620,
      width: 280,
      height: 80,
    };
    // Same column, one stack-gap below the pair — it would join the stack…
    const joined = computeTextStackBoxes([bar, label, stackHeadline], squareSource);
    expect(joined.get(label)).toBe(joined.get(stackHeadline));

    // …but a unit with an authored anchor places itself; folding it into the
    // stack frame is exactly how a plan-positioned badge lost its corner.
    const anchoredPair = computeTextStackBoxes(
      [
        { ...bar, anchor: 'top-right' as const },
        { ...label, anchor: 'top-right' as const },
        stackHeadline,
      ],
      squareSource
    );
    expect(anchoredPair.size).toBe(0);
  });

  it('keeps a hairline underline rule thin instead of flooring it to 10px', () => {
    const boxes = computeGroupBoxes([bar, label]);
    const barOut = smartReflow(bar, squareSource, storyTarget, boxes.get('cta'));

    // The pair's content scale here is 4/3 (the story's type basis), so the
    // 6px rule becomes 8px and stays a hairline — the generic 10px
    // min-dimension floor would have fattened it into a slab across the copy.
    expect(barOut.height).toBe(8);

    // Scaled down, a hairline floors at 2px, never at 10.
    const shrunk = smartReflow(
      { ...bar, height: 2 },
      squareSource,
      { width: 270, height: 270, formatId: 'unknown-format' },
      boxes.get('cta')
    );
    expect(shrunk.height).toBe(2);
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

// A panel widens per-axis while its CONTENTS took the uniform branch and
// shrank — the live 1080²→1200×675 docs opened a 249px dead gutter on one side
// of a 552px panel against a 60px one on the other.
describe('smartReflow panel containers', () => {
  const source = { width: 1080, height: 1080 };
  const xPost = { width: 1200, height: 675, formatId: 'x-post' };
  const base = { rotation: 0, opacity: 1, locked: false, hidden: false };

  // split-panel-bg: 46% width, full height. Copy is inset by the 5% margin.
  const panel: DesignerElement = {
    id: 'p1',
    type: 'shape',
    shape: 'rect',
    x: 0,
    y: 0,
    width: 497,
    height: 1080,
    ...base,
    originId: 'split-panel-bg',
  };
  const headline: DesignerElement = {
    id: 'h1',
    type: 'text',
    x: 54,
    y: 415,
    width: 389,
    height: 225,
    ...base,
    text: 'Big launch',
    fontSize: 90,
    originId: 'headline',
  };

  it('maps a panel-filling copy box through the PANEL transform, not the canvas one', () => {
    const containers = computeContainerBoxes([panel, headline]);
    expect(containers.get(headline)).toMatchObject({ x: 0, width: 497 });
    expect(containers.get(panel)).toBeUndefined();

    const panelOut = smartReflow(panel, source, xPost);
    const out = smartReflow(
      headline,
      source,
      xPost,
      undefined,
      containers.get(headline)
    );

    // Panel: 497 × (1200/1080) = 552. Copy: 389 × (552/497) = 432, inset by the
    // scaled 54px margin on BOTH sides — 60 | 432 | 60, not 60 | 243 | 249.
    expect(panelOut.width).toBe(552);
    expect(out.x).toBe(60);
    expect(out.width).toBe(432);
    expect(panelOut.width! - out.x! - out.width!).toBe(60);
    // Height and type ride the aspect-aware TYPE BASIS (900/1080 = 0.833), not
    // the min-axis 0.625 that used to typeset a wider canvas for its short
    // edge; the width still comes from the panel, so text never stretches.
    expect(out.height).toBe(188);
    expect(out.fontSize).toBe(75);
  });

  // ROUND 8 (A3b): the live 1584×396 geometry from
  // `.tmp-r7run3-screens/doc-*.json`. The doc validator clamped the headline
  // to x=942.8 to keep it inside the format's title-safe area — 59.2px outside
  // the sidebar it belongs to. Under STRICT containment the box was disowned
  // by its panel and reflowed against the canvas: the seeded story came out
  // `x=0 w=1080`, spanning the full width across an empty sidebar.
  it('keeps a box that a validator clamp nudged past the panel edge in the panel', () => {
    const banner = { width: 1584, height: 396 };
    const sidebar: DesignerElement = {
      id: 's1',
      type: 'shape',
      shape: 'rect',
      x: 982,
      y: 0,
      width: 602,
      height: 396,
      ...base,
      originId: 'editorial-sidebar-bg',
    };
    const clamped: DesignerElement = {
      ...headline,
      x: 942.8,
      y: 109,
      width: 562,
      height: 85,
      fontSize: 34,
    };

    const containers = computeContainerBoxes([sidebar, clamped]);
    expect(containers.get(clamped)).toMatchObject({ x: 982, width: 602 });

    const story = { width: 1080, height: 1920, formatId: 'ig-story' };
    const out = smartReflow(
      clamped,
      banner,
      story,
      undefined,
      containers.get(clamped)
    );
    const panelOut = smartReflow(sidebar, banner, story);
    // Inside the reflowed sidebar, not spread across the whole canvas.
    expect(out.x).toBeGreaterThanOrEqual(panelOut.x!);
    expect(out.x! + out.width!).toBeLessThanOrEqual(
      panelOut.x! + panelOut.width!
    );
  });

  it('mirrors for a right-hand panel', () => {
    const right = { ...panel, x: 583 };
    const rightHeadline = { ...headline, x: 637 };
    const containers = computeContainerBoxes([right, rightHeadline]);
    const panelOut = smartReflow(right, source, xPost);
    const out = smartReflow(
      rightHeadline,
      source,
      xPost,
      undefined,
      containers.get(rightHeadline)
    );

    expect(panelOut.x).toBe(648);
    expect(out.x! - panelOut.x!).toBe(60);
    expect(panelOut.x! + panelOut.width! - (out.x! + out.width!)).toBe(60);
  });

  it('keeps a content-sized grouped chip on the uniform ratio, anchored to the panel edge it hugs', () => {
    // Badge pinned to the panel's right margin: 293..443 inside 0..497.
    const chip: DesignerElement = {
      id: 'b1',
      type: 'shape',
      shape: 'rect',
      x: 293,
      y: 54,
      width: 150,
      height: 52,
      ...base,
      groupId: 'badge',
      originId: 'badge-bg',
    };
    const label: DesignerElement = {
      id: 'b2',
      type: 'text',
      x: 309,
      y: 54,
      width: 118,
      height: 52,
      ...base,
      text: 'New',
      fontSize: 26,
      groupId: 'badge',
      originId: 'badge',
    };
    const containers = computeContainerBoxes([panel, chip, label]);
    const boxes = computeGroupBoxes([chip, label]);
    const chipOut = smartReflow(
      chip,
      source,
      xPost,
      boxes.get('badge'),
      containers.get(chip)
    );
    const labelOut = smartReflow(
      label,
      source,
      xPost,
      boxes.get('badge'),
      containers.get(label)
    );

    // Content-sized (40% of the panel): one uniform factor for the whole pair,
    // so the label can never outgrow its chip — the type basis (900/1080),
    // since a chip is sized by the label it wraps. Its 54px right margin still
    // scales to the panel's 60.
    expect(chipOut.width).toBe(125);
    expect(552 - (chipOut.x! + chipOut.width!)).toBe(60);
    // The pair stays glued at that same ratio.
    expect(labelOut.x! - chipOut.x!).toBe(
      Math.round((309 - 293) * (900 / 1080))
    );
  });

  it('leaves elements outside every panel on the canvas transform', () => {
    const outside: DesignerElement = { ...headline, id: 'o1', x: 600 };
    const containers = computeContainerBoxes([panel, outside]);
    expect(containers.get(outside)).toBeUndefined();
  });
});

// Everything smartReflow does NOT return comes through the seed-copy deep clone
// verbatim — which left a 26px pill radius on a chip half the height, and a 3px
// stroke on a button scaled by 0.625.
describe('smartReflow pixel-valued styles', () => {
  const source = { width: 1080, height: 1080 };
  const xPost = { width: 1200, height: 675, formatId: 'x-post' };
  const base = { rotation: 0, opacity: 1, locked: false, hidden: false };

  const chip = (overrides: Partial<DesignerElement> = {}): DesignerElement =>
    ({
      id: 'c1',
      type: 'shape',
      shape: 'rect',
      x: 400,
      y: 400,
      width: 150,
      height: 52,
      ...base,
      ...overrides,
    } as DesignerElement);

  it('recomputes a PILL radius from the new height instead of scaling it', () => {
    // 52 × 0.625 → 33, which needs 17. round(26 × 0.625) = 16 leaves a visible
    // flat on each end of the pill.
    const result = smartReflow(chip({ borderRadius: 26 }), source, xPost);
    expect(result.height).toBe(33);
    expect(result.borderRadius).toBe(17);
  });

  it('scales a non-pill radius and a stroke proportionally, flooring at 1', () => {
    const result = smartReflow(
      chip({ borderRadius: 9, strokeWidth: 3 }),
      source,
      xPost
    );
    expect(result.borderRadius).toBe(6);
    expect(result.strokeWidth).toBe(2);

    // A hairline never disappears.
    const tiny = smartReflow(
      chip({ borderRadius: 1, strokeWidth: 1 }),
      source,
      { width: 270, height: 270, formatId: 'unknown-format' }
    );
    expect(tiny.borderRadius).toBe(1);
    expect(tiny.strokeWidth).toBe(1);
  });

  it('leaves an authored zero at zero', () => {
    const result = smartReflow(
      chip({ borderRadius: 0, strokeWidth: 0 }),
      source,
      xPost
    );
    expect(result.borderRadius).toBeUndefined();
    expect(result.strokeWidth).toBe(0);
  });

  it('scales text shadow, text stroke and letter spacing — signs kept', () => {
    const label: DesignerElement = {
      id: 't1',
      type: 'text',
      x: 400,
      y: 400,
      width: 200,
      height: 80,
      ...base,
      text: 'Headline',
      fontSize: 64,
      letterSpacing: -4,
      textStroke: { color: '#000', width: 6 },
      textShadow: { color: '#000', blur: 12, offsetX: 4, offsetY: -8 },
    };
    const result = smartReflow(label, source, xPost);

    // The label is type-sized (80 → 67 at the 0.833 type basis), and pixel
    // styles ride the element's own size change.
    expect(result.letterSpacing).toBe(-3);
    expect(result.textStroke).toEqual({ color: '#000', width: 5 });
    expect(result.textShadow).toEqual({
      color: '#000',
      blur: 10,
      offsetX: 3,
      offsetY: -7,
    });
  });

  it('rides the per-axis factor for a full-bleed shape', () => {
    const band: DesignerElement = {
      id: 's1',
      type: 'shape',
      shape: 'rect',
      x: 0,
      y: 400,
      width: 1080,
      height: 200,
      ...base,
      borderRadius: 20,
      originId: 'band-bg',
    };
    // Per-axis: height 200 → 125, so the radius follows 0.625, not 1200/1080.
    const result = smartReflow(band, source, xPost);
    expect(result.height).toBe(125);
    expect(result.borderRadius).toBe(13);
  });
});

describe('reflowBackground', () => {
  it('re-derives an image background focal point for the new aspect', () => {
    const bg = reflowBackground(
      {
        type: 'image',
        src: 'https://example.com/i.png',
        focalPoint: { x: 0.5, y: 0.5 },
        subjectPoint: { x: 0.5, y: 0.3 },
        naturalWidth: 1024,
        naturalHeight: 1024,
      },
      { width: 1200, height: 675 }
    );

    // 1024² into 1200×675: cropH = 1024 / (1200/675) = 576, slack = 448,
    // fp.y = (0.3·1024 − 288) / 448 ≈ 0.0429 — nothing like the inherited 0.5.
    expect(bg!.focalPoint!.y).toBeCloseTo(0.042857, 5);
    expect(bg!.focalPoint!.x).toBe(0.5);
  });

  it('leaves a background without a centroid (or a non-image one) untouched', () => {
    const image = {
      type: 'image' as const,
      src: 'https://example.com/i.png',
      focalPoint: { x: 0.3, y: 0.7 },
    };
    expect(reflowBackground(image, { width: 1200, height: 675 })).toBe(image);

    const solid = { type: 'color' as const, color: '#fff' };
    expect(reflowBackground(solid, { width: 1200, height: 675 })).toBe(solid);
    expect(reflowBackground(undefined, { width: 1200, height: 675 })).toBeUndefined();
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
  // Type basis 1440/2160 = 0.667: a 12px label would land at 8px.
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
    fontSize: 12,
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

// The single basis every cross-output type/size adjustment routes through.
// `Math.min(w, h)` — what this replaced — typeset a 1200×675 seeded from a
// 1080² for its 675 short edge, on a canvas 11% WIDER than the original.
describe('typeBasisPx', () => {
  it('is the canvas geometric mean, and the side length itself when square', () => {
    expect(typeBasisPx(1080, 1080)).toBe(1080);
    expect(typeBasisPx(1200, 675)).toBe(900);
    expect(typeBasisPx(1080, 1920)).toBeCloseTo(1440, 6);
    // Orientation-agnostic.
    expect(typeBasisPx(675, 1200)).toBe(900);
  });

  it('stays the geometric mean on an extreme aspect — no layout-blind cap', () => {
    // A √2 aspect cap used to pull a 4:1 banner back to 396 × 1.4 = 554.4.
    // It was a layout-BLIND proxy for "the copy stack has to fit vertically",
    // and being the weaker rule it always won over the composer's real,
    // layout-aware budget — which is now the parameter below.
    expect(typeBasisPx(1584, 396)).toBeCloseTo(792, 6);
    expect(typeBasisPx(396, 1584)).toBeCloseTo(792, 6);
  });

  it('bounds the basis by the copy stack\'s vertical budget when given one', () => {
    // hero-fullbleed's budget on a 4:1 banner: 0.49 / (4.705 × 0.085 × 1).
    const heroBudget = 0.49 / (4.705 * 0.085);
    expect(typeBasisPx(1584, 396, heroBudget)).toBeCloseTo(396 * heroBudget, 6);
    // Inert wherever the geometric mean already fits the budget.
    expect(typeBasisPx(1080, 1080, heroBudget)).toBe(1080);
    // Never below the short edge, budget or no budget.
    expect(typeBasisPx(1584, 396, 0.1)).toBe(396);
  });

  it('never returns less than the short edge — no canvas types smaller than before', () => {
    for (const [w, h] of [
      [1080, 1080],
      [1200, 675],
      [1584, 396],
      [1080, 1920],
      [1200, 1200],
    ]) {
      expect(typeBasisPx(w, h)).toBeGreaterThanOrEqual(Math.min(w, h));
    }
  });
});

// A1: the canvas frame is derived from the same basis as the type, so a wide
// canvas is not framed for its short edge (a 1584×396 banner used to get a
// 20px — 1.26% of its width — margin while a square got 54px).
describe('canvasMarginPx', () => {
  it('derives the frame from the type basis, not the short edge', () => {
    expect(canvasMarginPx(1584, 396)).toBe(40);
    expect(canvasMarginPx(1080, 1080)).toBe(54);
    expect(canvasMarginPx(1200, 675)).toBe(45);
    expect(canvasMarginPx(1080, 1920)).toBe(72);
  });

  it('never eats more than a tenth of the short axis', () => {
    // 32:1: the geometric-mean margin (0.05 × 1131 = 57) would be 57% of the
    // 100px short side.
    expect(canvasMarginPx(3200, 100)).toBe(10);
  });
});

describe('typeScaleRatio', () => {
  it('grows type when the target canvas is wider than the source', () => {
    // The live x-post case: 0.833, where min(scaleX, scaleY) gave 0.625.
    expect(
      typeScaleRatio({ width: 1080, height: 1080 }, { width: 1200, height: 675 })
    ).toBeCloseTo(900 / 1080, 6);
  });

  it('is 1 for the same canvas and inverts between two canvases', () => {
    const a = { width: 1080, height: 1080 };
    const b = { width: 1200, height: 675 };
    expect(typeScaleRatio(a, a)).toBe(1);
    expect(typeScaleRatio(a, b) * typeScaleRatio(b, a)).toBeCloseTo(1, 6);
  });

  it('measures BOTH canvases with the design\'s own type budget', () => {
    // A2: a hero banner that COMPOSED at 396 × 1.2266 = 486 must not seed its
    // siblings from the unbounded geometric mean (792) — a 1.63× jump.
    const heroBudget = 0.49 / (4.705 * 0.085);
    const banner = { width: 1584, height: 396, typeBudget: heroBudget };
    const square = { width: 1080, height: 1080 };
    expect(typeScaleRatio(banner, square)).toBeCloseTo(
      1080 / (396 * heroBudget),
      6
    );
    // The budget rides on whichever side carries it — a freshly seeded output
    // has not been stamped yet.
    expect(typeScaleRatio({ width: 1584, height: 396 }, { ...square, typeBudget: heroBudget }))
      .toBeCloseTo(1080 / (396 * heroBudget), 6);
  });
});

describe('groupKeyOf', () => {
  it('keys companions onto their base slot and everything else onto itself', () => {
    expect(groupKeyOf({ groupId: 'cta', originId: 'cta-bg' })).toBe('cta');
    expect(groupKeyOf({ originId: 'badge-bg' })).toBe('badge');
    expect(groupKeyOf({ originId: 'cta-underline' })).toBe('cta');
    expect(groupKeyOf({ originId: 'headline' })).toBe('headline');
    expect(groupKeyOf({})).toBeUndefined();
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

  // Changed deliberately (round 5): grouped members used to be excluded from
  // the stack entirely, so a CTA structurally landed in a different anchor
  // bucket than the copy above it — a dead vertical band on aspect change.
  // Stack membership is now computed over GROUP boxes, so a same-column CTA
  // within the stack rhythm joins it (and every member of the pair maps to the
  // one stack frame, so the label keeps its pill/underline).
  it('includes a grouped (CTA) pair in the stack when it keeps the column rhythm', () => {
    const ctaLabel: DesignerElement = {
      ...subhead,
      id: 'c1',
      y: 530,
      height: 60,
      text: 'Shop now',
      groupId: 'cta',
      originId: 'cta',
    };
    const ctaBar: DesignerElement = {
      ...ctaLabel,
      id: 'c2',
      type: 'shape',
      y: 597,
      height: 4,
      text: undefined,
      originId: 'cta-underline',
    };
    const stacks = computeTextStackBoxes(
      [headline, subhead, ctaLabel, ctaBar],
      source
    );

    expect(stacks.get(headline)).toBe(stacks.get(subhead));
    // Both members of the pair ride the SAME frame as the copy above them.
    expect(stacks.get(ctaLabel)).toBe(stacks.get(headline));
    expect(stacks.get(ctaBar)).toBe(stacks.get(headline));
    // The frame spans the whole stack, underline rule included.
    expect(stacks.get(ctaLabel)).toMatchObject({ y: 270, height: 601 - 270 });
  });

  it('leaves a far-away grouped CTA out of the stack', () => {
    const ctaLabel: DesignerElement = {
      ...subhead,
      id: 'c1',
      y: 950,
      height: 60,
      text: 'Shop now',
      groupId: 'cta',
      originId: 'cta',
    };
    const stacks = computeTextStackBoxes([headline, subhead, ctaLabel], source);

    expect(stacks.get(headline)).toBe(stacks.get(subhead));
    expect(stacks.get(ctaLabel)).toBeUndefined();
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
