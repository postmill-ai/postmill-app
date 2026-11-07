import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureFontLoaded, ensureFontsUsed } from './fonts';

const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');

afterEach(() => {
  document.head.innerHTML = '';
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Designer font loading', () => {
  it('loads true italic faces in addition to normal faces', async () => {
    const load = vi.fn().mockResolvedValue([]);
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load, ready: Promise.resolve() },
    });

    const pending = ensureFontLoaded('Montserrat', [700], true);
    const links = [...document.head.querySelectorAll('link')];
    links.forEach((link) => link.dispatchEvent(new Event('load')));
    await pending;

    expect(links).toHaveLength(2);
    expect(links[0].href).toContain('Montserrat:wght@400;700');
    expect(decodeURIComponent(links[1].href)).toContain('Montserrat:ital,wght@0,400;1,400;0,700;1,700');
    expect(load).toHaveBeenCalledWith('700 16px "Montserrat"');
    expect(load).toHaveBeenCalledWith('italic 700 16px "Montserrat"');
  });

  it('passes italic families from the document signature without reloading others', async () => {
    const load = vi.fn().mockResolvedValue([]);
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load, ready: Promise.resolve() },
    });

    const pending = ensureFontsUsed(
      new Map([['Montserrat', new Set([400, 700])]]),
      new Set(['Montserrat'])
    );
    document.head.querySelectorAll('link').forEach((link) =>
      link.dispatchEvent(new Event('load'))
    );
    await pending;

    expect(load).toHaveBeenCalledWith('italic 400 16px "Montserrat"');
    expect(load).toHaveBeenCalledWith('italic 700 16px "Montserrat"');
  });

  it('waits for the stylesheet before asking the browser to load the faces', async () => {
    const load = vi.fn().mockResolvedValue([]);
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load, ready: Promise.resolve() },
    });

    const pending = ensureFontLoaded('Sofia Sans Extra Condensed', [700]);
    await Promise.resolve();
    expect(load).not.toHaveBeenCalled();

    document.head.querySelector('link')!.dispatchEvent(new Event('load'));
    await pending;
    expect(load).toHaveBeenCalledWith('700 16px "Sofia Sans Extra Condensed"');
  });

  it('times out a stalled stylesheet and allows a later retry', async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockResolvedValue([]);
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load, ready: Promise.resolve() },
    });

    const pending = ensureFontLoaded('Be Vietnam Pro', [700]);
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
    expect(document.head.querySelector('link')).toBeNull();
    expect(load).toHaveBeenCalled();

    const retry = ensureFontLoaded('Be Vietnam Pro', [700]);
    document.head.querySelector('link')!.dispatchEvent(new Event('load'));
    await retry;
    expect(document.head.querySelector('link')).not.toBeNull();
  });
});
