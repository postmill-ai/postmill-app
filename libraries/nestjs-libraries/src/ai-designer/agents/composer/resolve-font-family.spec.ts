import { describe, it, expect } from 'vitest';
import { isCatalogFamily } from '../../../media/designer-doc/font-catalog';
import { isScriptFamily, resolveFontFamily } from './resolve-font-family';

/**
 * Observed live in every reference run: the planner answers "what KIND of
 * face?" instead of naming one — `"script"` on the accent line, `"condensed"`
 * on a badge, `"serif"` on a subhead. Those went into the document verbatim
 * and painted in the fallback sans, which is why a poster's script accent
 * came out in Helvetica.
 */

describe('resolveFontFamily', () => {
  it('passes a real catalog family through untouched', () => {
    expect(resolveFontFamily('Playfair Display', 'Inter')).toBe('Playfair Display');
    expect(resolveFontFamily('Anton', 'Inter')).toBe('Anton');
  });

  it('maps the kind words the planner actually emits to loadable faces', () => {
    for (const kind of ['script', 'cursive', 'condensed', 'handwriting', 'brush', 'mono']) {
      const resolved = resolveFontFamily(kind, 'Inter');
      expect(resolved, kind).toBeTruthy();
      expect(isCatalogFamily(resolved!), `${kind} -> ${resolved}`).toBe(true);
      expect(resolved, kind).not.toBe(kind);
    }
  });

  it('prefers the formal copperplate for a script accent', () => {
    // The register reference posters reach for; the brush faces are the
    // fallbacks behind it.
    expect(resolveFontFamily('script', 'Inter')).toBe('Great Vibes');
  });

  it('treats generic kinds as "whatever the preset uses"', () => {
    expect(resolveFontFamily('serif', 'Playfair Display')).toBe('Playfair Display');
    expect(resolveFontFamily('sans-serif', 'Inter')).toBe('Inter');
    expect(resolveFontFamily('body', 'Inter')).toBe('Inter');
  });

  it('is case- and separator-insensitive, as a model is', () => {
    expect(resolveFontFamily('Condensed Sans', 'Inter')).toBe(
      resolveFontFamily('condensed-sans', 'Inter')
    );
    expect(resolveFontFamily('SCRIPT', 'Inter')).toBe('Great Vibes');
  });

  it('falls back rather than shipping a hallucinated family', () => {
    expect(resolveFontFamily('Helvetica Neue Ultra Whatever', 'Inter')).toBe('Inter');
    expect(resolveFontFamily('', 'Inter')).toBe('Inter');
    expect(resolveFontFamily(undefined, 'Inter')).toBe('Inter');
  });

  it('every mapped candidate is a family the loader can actually fetch', () => {
    // The mapping is only useful if the faces exist — this is the drift guard
    // for the table itself.
    for (const kind of ['script', 'condensed', 'condensed-serif', 'slab', 'display', 'mono']) {
      expect(isCatalogFamily(resolveFontFamily(kind, 'Inter')!), kind).toBe(true);
    }
  });
});

describe('isScriptFamily', () => {
  it('knows the faces an all-caps transform destroys', () => {
    for (const family of ['Great Vibes', 'Dancing Script', 'Pacifico', 'Caveat', 'Lobster']) {
      expect(isScriptFamily(family), family).toBe(true);
    }
  });

  it('leaves everything else alone', () => {
    for (const family of ['Anton', 'Inter', 'Playfair Display', 'Barlow Condensed', undefined]) {
      expect(isScriptFamily(family), String(family)).toBe(false);
    }
  });
});
