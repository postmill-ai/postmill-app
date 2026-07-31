import { describe, expect, it } from 'vitest';
import {
  DEGENERATE_VIOLATION_PREFIX,
  validateDesignDoc,
} from './doc-validator';
import type { DesignerDoc } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import type { DesignPlan } from '../ai-designer.types';

let seq = 0;
const el = (overrides: Record<string, unknown>) =>
  ({
    id: `e${++seq}`,
    originId: overrides.id as string,
    type: 'text',
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    ...overrides,
  } as any);

const makeDoc = (
  children: any[],
  outputOverrides: Record<string, unknown> = {}
): DesignerDoc =>
  ({
    version: 1,
    mode: 'image',
    outputs: [
      {
        id: 'o1',
        formatId: 'ig-post',
        name: 'IG',
        width: 1080,
        height: 1080,
        background: '#ffffff',
        children,
        ...outputOverrides,
      },
    ],
  } as DesignerDoc);

describe('validateDesignDoc', () => {
  it('returns the same doc reference and no violations for a clean doc', () => {
    const doc = makeDoc([
      el({
        originId: 'headline',
        text: 'Hello',
        x: 100,
        y: 100,
        width: 400,
        height: 80,
        fontSize: 40,
        fill: '#111111',
      }),
    ]);

    const { doc: out, violations } = validateDesignDoc(doc);

    expect(out).toBe(doc);
    expect(violations).toEqual([]);
  });

  it('clamps elements back into the canvas bounds', () => {
    const doc = makeDoc([
      el({ originId: 'a', text: 'A', x: -50, y: 1000, width: 400, height: 200 }),
      el({ originId: 'b', text: 'B', x: 0, y: 0, width: 2000, height: 50 }),
    ]);

    const { doc: out, violations } = validateDesignDoc(doc);
    const [a, b] = (out.outputs[0] as any).children;

    expect(out).not.toBe(doc);
    expect(a.x).toBe(0);
    // y clamped so the AABB stays inside: 1080 - 200.
    expect(a.y).toBe(880);
    // Oversized width shrinks to the canvas width.
    expect(b.width).toBe(1080);
    expect(violations.some((v) => v.includes('canvas bounds'))).toBe(true);

    // The repaired doc passes clean on a second pass.
    const second = validateDesignDoc(out);
    expect(second.doc).toBe(out);
    expect(
      second.violations.filter((v) => v.includes('canvas bounds'))
    ).toEqual([]);
  });

  it('flips low-contrast text to a passing fill against the output background', () => {
    const doc = makeDoc([
      el({
        originId: 'headline',
        text: 'Washed out',
        x: 100,
        y: 100,
        width: 400,
        height: 80,
        fontSize: 40,
        fill: '#EEEEEE',
      }),
    ]);

    const { doc: out, violations } = validateDesignDoc(doc);
    const headline = (out.outputs[0] as any).children[0];

    expect(headline.fill).toBe('#111111');
    expect(violations.some((v) => v.includes('Low contrast'))).toBe(true);

    const second = validateDesignDoc(out);
    expect(second.violations.filter((v) => v.includes('Low contrast'))).toEqual(
      []
    );
  });

  it('uses the stricter 4.5:1 threshold for small text', () => {
    // #777777 on white is 4.48:1 — passes for large text (3:1), fails small.
    const doc = makeDoc([
      el({
        originId: 'body',
        text: 'Fine print',
        x: 100,
        y: 100,
        width: 400,
        height: 40,
        fontSize: 16,
        fill: '#777777',
      }),
    ]);

    const { doc: out } = validateDesignDoc(doc);
    expect((out.outputs[0] as any).children[0].fill).toBe('#111111');
  });

  it('contrasts against the topmost shape fill beneath the text, not the output bg', () => {
    const doc = makeDoc(
      [
        el({
          originId: 'panel',
          type: 'shape',
          shape: 'rect',
          x: 0,
          y: 0,
          width: 1080,
          height: 1080,
          fill: '#111111',
        }),
        el({
          originId: 'headline',
          text: 'Dark on dark',
          x: 100,
          y: 100,
          width: 400,
          height: 80,
          fontSize: 40,
          fill: '#222222',
        }),
      ],
      { background: '#ffffff' }
    );

    const { doc: out } = validateDesignDoc(doc);
    expect((out.outputs[0] as any).children[1].fill).toBe('#FFFFFF');
  });

  it('skips the contrast check when imagery sits beneath the text', () => {
    const doc = makeDoc([
      el({
        originId: 'hero',
        type: 'image',
        x: 0,
        y: 0,
        width: 1080,
        height: 1080,
        src: 'https://example.com/hero.png',
      }),
      el({
        originId: 'headline',
        text: 'Over a photo',
        x: 100,
        y: 100,
        width: 400,
        height: 80,
        fontSize: 40,
        fill: '#123456',
      }),
    ]);

    const { doc: out, violations } = validateDesignDoc(doc);
    expect(out).toBe(doc);
    expect(violations).toEqual([]);
  });

  it('moves an opaque label-carrying shape behind the text it covers', () => {
    const doc = makeDoc([
      el({
        originId: 'cta',
        text: 'Shop now',
        x: 100,
        y: 100,
        width: 200,
        height: 60,
        fontSize: 24,
        fill: '#111111',
      }),
      el({
        originId: 'cta-bg',
        type: 'shape',
        shape: 'rect',
        x: 90,
        y: 90,
        width: 220,
        height: 80,
        fill: '#FF4D00',
      }),
    ]);

    const { doc: out, violations } = validateDesignDoc(doc);
    const children = (out.outputs[0] as any).children;

    expect(children.map((c: any) => c.originId)).toEqual(['cta-bg', 'cta']);
    expect(violations.some((v) => v.includes('behind the text'))).toBe(true);
  });

  it('drops an opaque covering shape that carries no label', () => {
    const doc = makeDoc([
      el({
        originId: 'headline',
        text: 'Headline',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        fontSize: 24,
        fill: '#111111',
      }),
      // Covers 60% of the headline but contains no text of its own.
      el({
        originId: 'stray',
        type: 'shape',
        shape: 'rect',
        x: 40,
        y: 0,
        width: 100,
        height: 100,
        fill: '#FF4D00',
      }),
    ]);

    const { doc: out, violations } = validateDesignDoc(doc);
    const children = (out.outputs[0] as any).children;

    expect(children.map((c: any) => c.originId)).toEqual(['headline']);
    expect(violations.some((v) => v.includes('Dropped opaque shape'))).toBe(
      true
    );
  });

  it('ignores translucent shapes for the occlusion check', () => {
    const doc = makeDoc([
      el({
        originId: 'headline',
        text: 'Headline',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        fontSize: 24,
        fill: '#111111',
      }),
      el({
        originId: 'scrim',
        type: 'shape',
        shape: 'rect',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        opacity: 0.4,
        fill: '#000000',
      }),
    ]);

    const { doc: out } = validateDesignDoc(doc);
    expect(out).toBe(doc);
  });

  it('treats a small opaque pill fully inside a wide subhead as occlusion', () => {
    const doc = makeDoc([
      el({
        originId: 'sub',
        text: 'A wide subhead spanning most of the canvas',
        x: 0,
        y: 0,
        width: 1000,
        height: 80,
        fontSize: 28,
        fill: '#111111',
      }),
      el({
        originId: 'promo',
        text: 'NEW',
        x: 110,
        y: 20,
        width: 100,
        height: 40,
        fontSize: 24,
        fill: '#FFFFFF',
      }),
      // Overlap is only 9% of the subhead's area but 100% of the pill's —
      // the min(text, shape) half-area predicate still counts it.
      el({
        originId: 'promo-pill',
        type: 'shape',
        shape: 'rect',
        x: 100,
        y: 10,
        width: 120,
        height: 60,
        fill: '#FF4D00',
      }),
    ]);

    const { doc: out, violations } = validateDesignDoc(doc);
    const children = (out.outputs[0] as any).children;

    // The pill carries the 'NEW' label — spliced behind the subhead.
    expect(children.map((c: any) => c.originId)).toEqual([
      'promo-pill',
      'sub',
      'promo',
    ]);
    expect(violations.some((v) => v.includes('behind the text'))).toBe(true);
  });

  it('drops a small opaque pill inside a wide subhead when it carries no label', () => {
    const doc = makeDoc([
      el({
        originId: 'sub',
        text: 'A wide subhead spanning most of the canvas',
        x: 0,
        y: 0,
        width: 1000,
        height: 80,
        fontSize: 28,
        fill: '#111111',
      }),
      el({
        originId: 'stray-pill',
        type: 'shape',
        shape: 'rect',
        x: 100,
        y: 10,
        width: 120,
        height: 60,
        fill: '#FF4D00',
      }),
    ]);

    const { doc: out, violations } = validateDesignDoc(doc);
    const children = (out.outputs[0] as any).children;

    expect(children.map((c: any) => c.originId)).toEqual(['sub']);
    expect(violations.some((v) => v.includes('carried no label'))).toBe(true);
  });

  it('collapses elements identical in type/originId/box/fill/opacity to one', () => {
    const accent = {
      originId: 'accent',
      type: 'shape',
      shape: 'rect',
      x: 600,
      y: 900,
      width: 120,
      height: 40,
      fill: '#FF4D00',
    };
    const doc = makeDoc([el(accent), el(accent)]);

    const { doc: out, violations } = validateDesignDoc(doc);
    const children = (out.outputs[0] as any).children;

    expect(children).toHaveLength(1);
    expect(
      violations.some((v) => v.includes('Dropped duplicate element'))
    ).toBe(true);
  });

  it('drops the later of two overlapping elements sharing an originId, keeping the earlier', () => {
    const doc = makeDoc([
      el({
        originId: 'badge-bg',
        type: 'shape',
        shape: 'star',
        x: 100,
        y: 100,
        width: 200,
        height: 200,
        fill: '#FF4D00',
      }),
      // A critic pass re-added the slot as a fresh plate — different box and
      // fill, so the identical-element dedupe does not catch it.
      el({
        originId: 'badge-bg',
        type: 'shape',
        shape: 'rect',
        x: 90,
        y: 110,
        width: 220,
        height: 180,
        fill: '#111111',
      }),
    ]);

    const { doc: out, violations } = validateDesignDoc(doc);
    const children = (out.outputs[0] as any).children;

    expect(children).toHaveLength(1);
    expect(children[0].shape).toBe('star');
    expect(violations.some((v) => v.includes('same slot id'))).toBe(true);
  });

  it('keeps non-overlapping elements that share an originId', () => {
    const doc = makeDoc([
      el({
        originId: 'accent',
        type: 'shape',
        shape: 'rect',
        x: 100,
        y: 100,
        width: 100,
        height: 40,
        fill: '#FF4D00',
      }),
      el({
        originId: 'accent',
        type: 'shape',
        shape: 'rect',
        x: 800,
        y: 900,
        width: 100,
        height: 40,
        fill: '#FF4D00',
      }),
    ]);

    const { doc: out, violations } = validateDesignDoc(doc);

    expect(out).toBe(doc);
    expect(violations).toEqual([]);
  });

  it('drops an opaque plate burying a smaller `-bg` badge chip beneath it', () => {
    const doc = makeDoc([
      el({
        originId: 'badge-bg',
        type: 'shape',
        shape: 'star',
        x: 100,
        y: 100,
        width: 200,
        height: 200,
        fill: '#FF4D00',
      }),
      el({
        originId: 'badge',
        text: 'NEW',
        x: 140,
        y: 140,
        width: 120,
        height: 120,
        fontSize: 24,
        fill: '#111111',
      }),
      // Painted last: an opaque plate fully covering the chip (a different
      // slot, so the slot-uniqueness dedupe does not catch it).
      el({
        originId: 'plate',
        type: 'shape',
        shape: 'rect',
        x: 80,
        y: 80,
        width: 260,
        height: 260,
        fill: '#111111',
      }),
    ]);

    const { doc: out, violations } = validateDesignDoc(doc);
    const children = (out.outputs[0] as any).children;

    expect(children.map((c: any) => c.originId)).toEqual(['badge-bg', 'badge']);
    expect(violations.some((v) => v.includes('buried the badge chip'))).toBe(
      true
    );
  });

  it('drops the less prominent of two text elements with identical copy', () => {
    const doc = makeDoc([
      // Same normalized text (case/whitespace-insensitive) in two slots —
      // the planner duplicated the CTA into the badge. The larger fontSize
      // wins even though it comes later in the children array.
      el({
        originId: 'badge',
        text: '  JOIN  NOW ',
        x: 700,
        y: 100,
        width: 200,
        height: 60,
        fontSize: 20,
        fill: '#111111',
      }),
      el({
        originId: 'headline',
        text: 'Join now',
        x: 100,
        y: 400,
        width: 600,
        height: 120,
        fontSize: 64,
        fill: '#111111',
      }),
    ]);

    const { doc: out, violations } = validateDesignDoc(doc);
    const children = (out.outputs[0] as any).children;

    expect(children.map((c: any) => c.originId)).toEqual(['headline']);
    expect(violations.some((v) => v.includes('duplicates'))).toBe(true);
  });

  it('keeps the earlier element when duplicate copy ties on fontSize', () => {
    const doc = makeDoc([
      el({
        originId: 'headline',
        text: 'Join now',
        x: 100,
        y: 100,
        width: 400,
        height: 80,
        fontSize: 40,
        fill: '#111111',
      }),
      el({
        originId: 'cta',
        text: 'JOIN NOW',
        x: 100,
        y: 800,
        width: 400,
        height: 80,
        fontSize: 40,
        fill: '#111111',
      }),
    ]);

    const { doc: out } = validateDesignDoc(doc);
    const children = (out.outputs[0] as any).children;

    expect(children.map((c: any) => c.originId)).toEqual(['headline']);
  });

  it('does not dedupe a badge code appearing inside a longer subhead', () => {
    const doc = makeDoc([
      el({
        originId: 'badge',
        text: 'BEAN30',
        x: 700,
        y: 100,
        width: 200,
        height: 60,
        fontSize: 24,
        fill: '#111111',
      }),
      el({
        originId: 'subhead',
        text: 'Use code BEAN30 at checkout',
        x: 100,
        y: 400,
        width: 600,
        height: 80,
        fontSize: 28,
        fill: '#111111',
      }),
    ]);

    const { doc: out, violations } = validateDesignDoc(doc);

    // Substring overlap is emphasis, not duplication — untouched doc.
    expect(out).toBe(doc);
    expect(violations).toEqual([]);
  });

  it('clamps a star badge label into the star inner safe area', () => {
    const doc = makeDoc([
      el({
        originId: 'badge-bg',
        type: 'shape',
        shape: 'star',
        x: 100,
        y: 100,
        width: 200,
        height: 200,
        fill: '#FF4D00',
      }),
      // Pinned to the raw AABB — spills onto the star's points.
      el({
        originId: 'badge',
        text: 'NEW',
        x: 100,
        y: 100,
        width: 200,
        height: 200,
        fontSize: 24,
        fill: '#FFFFFF',
      }),
    ]);

    const { doc: out, violations } = validateDesignDoc(doc);
    const label = (out.outputs[0] as any).children[1];

    expect(label.x).toBe(140);
    expect(label.y).toBe(140);
    expect(label.width).toBe(120);
    expect(label.height).toBe(120);
    expect(violations.some((v) => v.includes('inner safe area'))).toBe(true);

    const second = validateDesignDoc(out);
    expect(
      second.violations.filter((v) => v.includes('inner safe area'))
    ).toEqual([]);
  });

  it('leaves a star badge label already inside the safe area untouched', () => {
    const doc = makeDoc([
      el({
        originId: 'badge-bg',
        type: 'shape',
        shape: 'star',
        x: 100,
        y: 100,
        width: 200,
        height: 200,
        fill: '#FF4D00',
      }),
      el({
        originId: 'badge',
        text: 'NEW',
        x: 140,
        y: 140,
        width: 120,
        height: 120,
        fontSize: 24,
        fill: '#FFFFFF',
      }),
    ]);

    const { doc: out, violations } = validateDesignDoc(doc);
    expect(out).toBe(doc);
    expect(violations).toEqual([]);
  });

  it('shrinks a star badge label font in 0.9 steps until it fits the inner box', () => {
    const doc = makeDoc([
      el({
        originId: 'badge-bg',
        type: 'shape',
        shape: 'star',
        x: 100,
        y: 100,
        width: 200,
        height: 200,
        fill: '#FF4D00',
      }),
      // Already inside the inner safe area, but too long to fit at 36px.
      el({
        originId: 'badge',
        text: 'SPECIAL LAUNCH DISCOUNT INSIDE',
        x: 140,
        y: 140,
        width: 120,
        height: 120,
        fontSize: 36,
        fill: '#FFFFFF',
      }),
    ]);

    const { doc: out, violations } = validateDesignDoc(doc);
    const [star, label] = (out.outputs[0] as any).children;

    // 36 → 32 → 28 → 25: the first 0.9-step size whose wrapped block fits
    // the 120px inner box.
    expect(label.fontSize).toBe(25);
    // The star itself never had to grow.
    expect(star.width).toBe(200);
    expect(star.shape).toBe('star');
    expect(
      violations.some((v) => v.includes('Shrunk the star badge label'))
    ).toBe(true);
  });

  it('grows the star when even the font floor cannot fit the label', () => {
    const doc = makeDoc([
      el({
        originId: 'deal-bg',
        type: 'shape',
        shape: 'star',
        x: 100,
        y: 100,
        width: 100,
        height: 100,
        fill: '#111111',
      }),
      el({
        originId: 'deal',
        text: 'MEGA CLEARANCE BLOWOUT EVENT',
        x: 120,
        y: 120,
        width: 60,
        height: 60,
        fontSize: 24,
        fill: '#FFFFFF',
      }),
    ]);

    const { doc: out, violations } = validateDesignDoc(doc);
    const [star, label] = (out.outputs[0] as any).children;

    // The 15px floor (1080 × 0.014) overflows the 60px inner box, so the
    // star grows ×1.2 per step: 100 → 120 → 144, where the floor fits.
    expect(star.width).toBe(144);
    expect(star.shape).toBe('star');
    expect(label.fontSize).toBe(15);
    expect(violations.some((v) => v.includes('Grew the star badge'))).toBe(
      true
    );
  });

  it('clamps a grown star into the title-safe zone, not just the canvas', () => {
    const doc = makeDoc([
      el({
        originId: 'deal-bg',
        type: 'shape',
        shape: 'star',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        fill: '#111111',
      }),
      el({
        originId: 'deal',
        text: 'MEGA CLEARANCE BLOWOUT EVENT',
        x: 20,
        y: 20,
        width: 60,
        height: 60,
        fontSize: 24,
        fill: '#FFFFFF',
      }),
    ]);

    const { doc: out, violations } = validateDesignDoc(doc);
    const [star] = (out.outputs[0] as any).children;

    // Same 100 → 144 growth as the interior case, but the corner star is
    // pulled inside the 5% fallback safe inset (54..1026) instead of
    // hugging (0,0) under platform overlays.
    expect(star.width).toBe(144);
    expect(star.x).toBe(54);
    expect(star.y).toBe(54);
    expect(violations.some((v) => v.includes('Grew the star badge'))).toBe(
      true
    );
  });

  it('reverts the burst to a pill when growth is exhausted', () => {
    const doc = makeDoc(
      [
        el({
          originId: 'promo-bg',
          type: 'shape',
          shape: 'star',
          x: 100,
          y: 100,
          width: 100,
          height: 100,
          fill: '#111111',
        }),
        el({
          originId: 'promo',
          text: Array(100).fill('SUPER').join(' '),
          x: 120,
          y: 120,
          width: 60,
          height: 60,
          fontSize: 16,
          fill: '#FFFFFF',
        }),
      ],
      // Small canvas: the star maxes out at 300x300 and still cannot fit
      // the label at the font floor.
      { width: 300, height: 300 }
    );

    const { doc: out, violations } = validateDesignDoc(doc);
    const [shape] = (out.outputs[0] as any).children;

    expect(shape.shape).toBe('rect');
    // Growth is bounded by the title-safe zone (5% fallback inset on the
    // 300px canvas), not the raw canvas: 300 - 2×15 = 270.
    expect(shape.width).toBe(270);
    expect(shape.borderRadius).toBe(Math.round(shape.height / 2));
    expect(
      violations.some((v) => v.includes('Reverted the star badge'))
    ).toBe(true);
  });

  it('recolors a blending badge chip but never a large layout panel', () => {
    const doc = makeDoc(
      [
        // ~46% of the canvas — a layout panel, not a badge chip. Its fill
        // matching the backdrop must NOT trigger the badge recolor (which
        // would cascade into headline contrast flips).
        el({
          originId: 'split-panel-bg',
          type: 'shape',
          shape: 'rect',
          x: 0,
          y: 0,
          width: 497,
          height: 1080,
          fill: '#0A0A0A',
        }),
        el({
          originId: 'headline',
          text: 'On the panel',
          x: 40,
          y: 100,
          width: 400,
          height: 120,
          fontSize: 48,
          fill: '#FFFFFF',
        }),
        // A genuine small badge chip blending into the output background.
        el({
          originId: 'badge-bg',
          type: 'shape',
          shape: 'rect',
          x: 700,
          y: 100,
          width: 200,
          height: 80,
          fill: '#0B0B0B',
        }),
      ],
      { background: '#0A0A0A' }
    );

    const { doc: out, violations } = validateDesignDoc(doc);
    const children = (out.outputs[0] as any).children;
    const panel = children.find((c: any) => c.originId === 'split-panel-bg');
    const headline = children.find((c: any) => c.originId === 'headline');
    const chip = children.find((c: any) => c.originId === 'badge-bg');

    expect(panel.fill).toBe('#0A0A0A');
    expect(headline.fill).toBe('#FFFFFF');
    expect(chip.fill).toBe('#FFFFFF');
    expect(
      violations.filter((v) => v.includes('Recolored the badge shape'))
    ).toHaveLength(1);
  });

  it('drops a heavy shape washing out imagery when it backs no text', () => {
    const doc = makeDoc([
      el({
        originId: 'hero',
        type: 'image',
        x: 0,
        y: 0,
        width: 1080,
        height: 1080,
        src: 'https://example.com/hero.png',
      }),
      // Covers ~54% of the image at 0.6 opacity and backs no copy.
      el({
        originId: 'haze',
        type: 'shape',
        shape: 'rect',
        x: 0,
        y: 0,
        width: 900,
        height: 700,
        opacity: 0.6,
        fill: '#000000',
      }),
    ]);

    const { doc: out, violations } = validateDesignDoc(doc);
    const children = (out.outputs[0] as any).children;

    expect(children.map((c: any) => c.originId)).toEqual(['hero']);
    expect(violations.some((v) => v.includes('backed no text'))).toBe(true);
  });

  it('keeps a text-backing scrim over imagery but caps it at 0.55 opacity', () => {
    const doc = makeDoc([
      el({
        originId: 'hero',
        type: 'image',
        x: 0,
        y: 0,
        width: 1080,
        height: 1080,
        src: 'https://example.com/hero.png',
      }),
      el({
        originId: 'scrim',
        type: 'shape',
        shape: 'rect',
        x: 0,
        y: 0,
        width: 900,
        height: 700,
        opacity: 0.8,
        fill: '#000000',
      }),
      el({
        originId: 'headline',
        text: 'Over the photo',
        x: 100,
        y: 100,
        width: 400,
        height: 80,
        fontSize: 40,
        fill: '#FFFFFF',
      }),
    ]);

    const { doc: out, violations } = validateDesignDoc(doc);
    const scrim = (out.outputs[0] as any).children.find(
      (c: any) => c.originId === 'scrim'
    );

    expect(scrim).toBeDefined();
    expect(scrim.opacity).toBe(0.55);
    expect(violations.some((v) => v.includes('Capped the scrim'))).toBe(true);
  });

  it('flags a degenerate output with no visible text although the plan carries copy', () => {
    const doc = makeDoc([
      el({
        originId: 'panel',
        type: 'shape',
        shape: 'rect',
        x: 0,
        y: 0,
        width: 1080,
        height: 1080,
        fill: '#111111',
      }),
    ]);
    const plan = {
      slots: [{ id: 'headline', role: 'headline', kind: 'text' }],
      texts: { headline: 'Big launch' },
    } as unknown as DesignPlan;

    const { doc: out, violations } = validateDesignDoc(doc, { plan });

    // Reported, never auto-fixed — the doc ships unchanged.
    expect(out).toBe(doc);
    expect(
      violations.some(
        (v) =>
          v.startsWith(DEGENERATE_VIOLATION_PREFIX) &&
          v.includes('no visible text')
      )
    ).toBe(true);
  });

  it('flags an image-slot element with no resolvable src', () => {
    const doc = makeDoc([
      el({
        originId: 'hero',
        type: 'image',
        x: 0,
        y: 0,
        width: 1080,
        height: 1080,
      }),
      el({
        originId: 'headline',
        text: 'Still here',
        x: 100,
        y: 100,
        width: 400,
        height: 80,
        fontSize: 40,
        fill: '#111111',
      }),
    ]);

    const { doc: out, violations } = validateDesignDoc(doc);

    expect(out).toBe(doc);
    expect(
      violations.some(
        (v) =>
          v.startsWith(DEGENERATE_VIOLATION_PREFIX) &&
          v.includes('no resolvable src')
      )
    ).toBe(true);
  });

  it('skips video outputs', () => {
    const doc = {
      version: 1,
      mode: 'video',
      outputs: [
        {
          id: 'o1',
          formatId: 'reel',
          name: 'Reel',
          width: 1080,
          height: 1920,
          fps: 30,
          durationMs: 5000,
          tracks: [],
        },
      ],
    } as unknown as DesignerDoc;

    const { doc: out, violations } = validateDesignDoc(doc);
    expect(out).toBe(doc);
    expect(violations).toEqual([]);
  });
});
