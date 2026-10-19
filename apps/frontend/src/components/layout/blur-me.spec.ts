import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { acquireBlurMe, resetBlurMe } from './blur-me';

/**
 * The `.blurMe` dimming classes gate the main nav's clickability — the two
 * former writers (modal manager, billing loader) each removed them when its
 * own condition cleared, stranding the nav in `pointer-events-none`. These
 * specs pin the single-owner refcount: classes live while ANY contributor
 * holds a token, gone only when the last one releases.
 */

const blurEls = () => Array.from(document.querySelectorAll('.blurMe'));

const expectDimmed = () => {
  expect(document.body.classList.contains('overflow-hidden')).toBe(true);
  for (const el of blurEls()) {
    expect(el.classList.contains('blur-xs')).toBe(true);
    expect(el.classList.contains('pointer-events-none')).toBe(true);
  }
};

const expectClear = () => {
  expect(document.body.classList.contains('overflow-hidden')).toBe(false);
  for (const el of blurEls()) {
    expect(el.classList.contains('blur-xs')).toBe(false);
    expect(el.classList.contains('pointer-events-none')).toBe(false);
  }
};

describe('blur-me single owner', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="blurMe"></div><div class="blurMe"></div><div></div>';
  });

  afterEach(() => {
    resetBlurMe();
    document.body.innerHTML = '';
  });

  it('applies the classes on acquire and removes them on release', () => {
    const release = acquireBlurMe();
    expectDimmed();
    release();
    expectClear();
  });

  it('keeps the classes while any contributor is still active (modal closes under the loader)', () => {
    const releaseModal = acquireBlurMe();
    const releaseLoader = acquireBlurMe();
    // The modal's effect clearing must not strip the loader's dimming…
    releaseModal();
    expectDimmed();
    // …and only the last release clears.
    releaseLoader();
    expectClear();
  });

  it('keeps the classes when the loader finishes while a modal is open', () => {
    const releaseModal = acquireBlurMe();
    const releaseLoader = acquireBlurMe();
    releaseLoader();
    expectDimmed();
    releaseModal();
    expectClear();
  });

  it('release is idempotent, so an effect cleanup can fire it unconditionally', () => {
    const release = acquireBlurMe();
    release();
    release();
    expectClear();
  });

  it('does not touch elements without the blurMe marker', () => {
    const plain = document.querySelector('div:not(.blurMe)')!;
    const release = acquireBlurMe();
    expect(plain.classList.contains('blur-xs')).toBe(false);
    expect(plain.classList.contains('pointer-events-none')).toBe(false);
    release();
  });
});
