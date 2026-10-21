import { describe, it, expect } from 'vitest';
import {
  applyTextReveal,
  textRevealProgress,
  textRevealSource,
} from './text-reveal';

describe('textRevealProgress', () => {
  it('runs 0→1 across the explicit reveal window', () => {
    const reveal = { mode: 'chars' as const, durationMs: 1000 };
    expect(textRevealProgress(reveal, 0, 5000)).toBe(0);
    expect(textRevealProgress(reveal, 500, 5000)).toBe(0.5);
    expect(textRevealProgress(reveal, 1000, 5000)).toBe(1);
    // Past the window it stays fully revealed for the rest of the clip.
    expect(textRevealProgress(reveal, 4999, 5000)).toBe(1);
  });

  it('spans the whole clip when durationMs is absent or non-positive', () => {
    expect(textRevealProgress({ mode: 'chars' }, 1000, 2000)).toBe(0.5);
    expect(textRevealProgress({ mode: 'chars', durationMs: 0 }, 1000, 2000)).toBe(0.5);
  });

  it('clamps below 0 and never hides text for a degenerate span', () => {
    expect(textRevealProgress({ mode: 'chars' }, -50, 2000)).toBe(0);
    expect(textRevealProgress({ mode: 'chars' }, 0, 0)).toBe(1);
    expect(textRevealProgress({ mode: 'chars', durationMs: -5 }, 100, 0)).toBe(1);
  });
});

describe('applyTextReveal', () => {
  it('returns the text unchanged without a reveal', () => {
    expect(applyTextReveal('hello world', undefined, 0, 1000)).toBe('hello world');
  });

  it('reveals ceil(progress × length) characters', () => {
    const reveal = { mode: 'chars' as const, durationMs: 1000 };
    // 10 chars, 1000ms window → exactly one char per 100ms.
    expect(applyTextReveal('0123456789', reveal, 0, 5000)).toBe('');
    expect(applyTextReveal('0123456789', reveal, 100, 5000)).toBe('0');
    expect(applyTextReveal('0123456789', reveal, 550, 5000)).toBe('012345');
    expect(applyTextReveal('0123456789', reveal, 1000, 5000)).toBe('0123456789');
    expect(applyTextReveal('0123456789', reveal, 9999, 5000)).toBe('0123456789');
  });

  it('reveals ceil(progress × wordCount) words on space boundaries', () => {
    const reveal = { mode: 'words' as const, durationMs: 1200 };
    const text = 'one two three four';
    expect(applyTextReveal(text, reveal, 0, 5000)).toBe('');
    expect(applyTextReveal(text, reveal, 300, 5000)).toBe('one');
    expect(applyTextReveal(text, reveal, 600, 5000)).toBe('one two');
    expect(applyTextReveal(text, reveal, 899, 5000)).toBe('one two three');
    expect(applyTextReveal(text, reveal, 1200, 5000)).toBe(text);
  });

  it('handles empty text and a zero-length window without throwing', () => {
    expect(applyTextReveal('', { mode: 'chars' }, 100, 1000)).toBe('');
    expect(applyTextReveal('hi', { mode: 'chars' }, 100, 0)).toBe('hi');
  });
});

describe('textRevealSource (frame-renderer parity)', () => {
  // The export renderer cannot import — it is handed these functions as source
  // (see frame-renderer-script.ts). The injected copy must BE this module, so
  // an exported mp4 reveals text exactly as the preview did.
  const injected = () => {
    const fn = new Function(`${textRevealSource()}; return { applyTextReveal, textRevealProgress };`) as () => {
      applyTextReveal: typeof applyTextReveal;
      textRevealProgress: typeof textRevealProgress;
    };
    return fn();
  };

  it('evaluates standalone and matches the module char-for-char', () => {
    const { applyTextReveal: injApply, textRevealProgress: injProgress } = injected();
    const reveal = { mode: 'chars' as const, durationMs: 800 };
    for (const ms of [-10, 0, 100, 333, 799, 800, 5000]) {
      expect(injProgress(reveal, ms, 2000)).toBe(textRevealProgress(reveal, ms, 2000));
      expect(injApply('some headline text', reveal, ms, 2000)).toBe(
        applyTextReveal('some headline text', reveal, ms, 2000)
      );
    }
    const wordReveal = { mode: 'words' as const };
    for (const ms of [0, 250, 1000, 4000]) {
      expect(injApply('one two three', wordReveal, ms, 3000)).toBe(
        applyTextReveal('one two three', wordReveal, ms, 3000)
      );
    }
  });
});
