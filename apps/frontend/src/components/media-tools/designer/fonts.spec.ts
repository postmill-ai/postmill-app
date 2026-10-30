import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureFontLoaded, ensureFontsUsed } from './fonts';

const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');

afterEach(() => {
  document.head.innerHTML = '';
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
  vi.restoreAllMocks();
});

describe('Designer font loading', () => {
  it('loads true italic faces in addition to normal faces', async () => {
    const load = vi.fn().mockResolvedValue([]);
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load, ready: Promise.resolve() },
    });

    await ensureFontLoaded('Montserrat', [700], true);

    const links = [...document.head.querySelectorAll('link')];
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

    await ensureFontsUsed(
      new Map([['Montserrat', new Set([400, 700])]]),
      new Set(['Montserrat'])
    );

    expect(load).toHaveBeenCalledWith('italic 400 16px "Montserrat"');
    expect(load).toHaveBeenCalledWith('italic 700 16px "Montserrat"');
  });
});
