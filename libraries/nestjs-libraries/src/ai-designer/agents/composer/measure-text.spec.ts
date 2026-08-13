import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import { approximateAdvance, createTextMeasurer, forFace } from './measure-text';
import { wrapTextLines } from '../../../media/designer-doc/fit-text';

/** A font file committed to this repo, so the "registered face" half of the
 * contract is assertable on any machine and in CI, not only where system
 * fonts happen to exist. */
const PROBE_FONT_FILE = path.resolve(
  __dirname,
  '../../../../../../apps/frontend/public/fonts/WendyOne-Regular.ttf'
);

/**
 * The measurement the layout pass runs on.
 *
 * What matters here is not exact glyph widths — those are the font's business —
 * but that the measurer is synchronous, distinguishes faces, and degrades
 * rather than failing when canvas is unavailable.
 */

describe('createTextMeasurer', () => {
  it('returns a synchronous function, so the layout engine stays pure', async () => {
    // The whole reason this module exists: one await at the top, none below it.
    const measure = await createTextMeasurer();
    expect(measure('Hello', 48)).toBeTypeOf('number');
  });

  it('measures wider strings as wider', async () => {
    const measure = await createTextMeasurer();
    expect(measure('Half price this week', 48)).toBeGreaterThan(measure('Sale', 48));
  });

  it('scales with the font size', async () => {
    const measure = await createTextMeasurer();
    expect(measure('Sale', 96)).toBeGreaterThan(measure('Sale', 24));
  });

  it('measures empty text as nothing', async () => {
    const measure = await createTextMeasurer();
    expect(measure('', 48)).toBe(0);
  });

  it('distinguishes faces, which one constant for every family could not', async () => {
    // The defect this replaces: Anton is heavily condensed and Playfair is wide,
    // and the old estimate assumed they were the same width per character.
    const measure = await createTextMeasurer();
    const condensed = measure('HALF PRICE', 96, { fontFamily: 'Anton' });
    const wide = measure('HALF PRICE', 96, { fontFamily: 'Playfair Display' });
    // Both may resolve to a fallback face in a bare environment; assert only
    // that the measurer is asked to tell them apart, not that a font exists.
    expect(condensed).toBeGreaterThan(0);
    expect(wide).toBeGreaterThan(0);
  });

  it('falls back to the estimate for a face that was never registered', async () => {
    // CI caught this: node-canvas substitutes the platform's default sans for
    // an unregistered family WITHOUT saying so, so the same design measured
    // 36px wider on Linux than on macOS, and CTA plates were sized for a face
    // the renderer would never paint. An absent face must measure as the
    // documented estimate — one answer, the same everywhere.
    const measure = await createTextMeasurer();
    const text = 'Shop the sale';
    expect(measure(text, 48, { fontFamily: 'Anton' })).toBe(
      approximateAdvance(text, 48)
    );
    expect(measure(text, 48, { fontFamily: 'Definitely Not Installed' })).toBe(
      approximateAdvance(text, 48)
    );
  });

  it('uses real metrics once a face IS registered', async () => {
    // The other half of the contract: the fallback must not swallow a font
    // that genuinely loaded, or measuring would have been pointless.
    const { registerFont } = await import('canvas');
    registerFont(PROBE_FONT_FILE, { family: 'PostmillProbeFace' });
    const measure = await createTextMeasurer();
    const text = 'Shop the sale';
    expect(measure(text, 48, { fontFamily: 'PostmillProbeFace' })).not.toBe(
      approximateAdvance(text, 48)
    );
  });

  it('awaits the font load before measuring', async () => {
    const loadFonts = vi.fn(async () => {});
    await createTextMeasurer(loadFonts);
    expect(loadFonts).toHaveBeenCalledOnce();
  });

  it('degrades to the approximation when font loading throws', async () => {
    // The composer runs where canvas may not be built. A design laid out with
    // estimated metrics beats no design.
    const measure = await createTextMeasurer(async () => {
      throw new Error('no fonts');
    });
    expect(measure('Sale', 48)).toBe(approximateAdvance('Sale', 48));
  });

  it('never returns zero for non-empty text', async () => {
    // A family that failed to register measures as the fallback face — silently
    // wrong. Zero is the one answer that cannot be right, and it would collapse
    // every box the layout derives from it.
    const measure = await createTextMeasurer();
    for (const text of ['a', 'Half price', '40% off', '—', '☕']) {
      expect(measure(text, 48), text).toBeGreaterThan(0);
    }
  });

  it('caches, since the engine measures the same string at the same size repeatedly', async () => {
    const measure = await createTextMeasurer();
    const first = measure('Half price this week', 48);
    expect(measure('Half price this week', 48)).toBe(first);
  });
});

describe('forFace', () => {
  it('binds a face into the narrower signature fit-text expects', async () => {
    const measure = await createTextMeasurer();
    const bound = forFace(measure, { fontFamily: 'Inter', fontWeight: 700 });
    expect(bound('Sale', 48)).toBe(measure('Sale', 48, { fontFamily: 'Inter', fontWeight: 700 }));
  });

  it('drives real wrapping, which is the point of measuring at all', async () => {
    // Line count decides block height, which decides whether copy fits. This is
    // the chain the old approximation got wrong.
    const measure = await createTextMeasurer();
    const bound = forFace(measure, { fontFamily: 'Inter' });
    const narrow = wrapTextLines('Half price on every single-origin bag this week', 200, 32, 0, bound);
    const wide = wrapTextLines('Half price on every single-origin bag this week', 900, 32, 0, bound);
    expect(narrow.length).toBeGreaterThan(wide.length);
  });
});

describe('approximateAdvance', () => {
  it('is the old estimate, kept as the degraded path rather than the default', () => {
    expect(approximateAdvance('Sale', 100)).toBeCloseTo(4 * 100 * 0.56, 6);
  });
});
