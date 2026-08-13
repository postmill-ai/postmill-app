import { describe, it, expect } from 'vitest';
import { buildFramePage, fontLinksForOutput, fontsUsedInOutput } from './frame-page';
import { FRAME_RENDERER_SCRIPT } from './frame-renderer-script';
import { cssFilterForToken, parseDesignerFilterToken } from './filter-tokens';

/**
 * The video path had no test at all, which is how it came to load NO fonts —
 * every caption in every rendered video used Chromium's default sans, however
 * carefully the font was chosen in the editor.
 */

const output = {
  width: 1080,
  height: 1080,
  clips: [
    { type: 'text', fontFamily: 'Bebas Neue', fontWeight: 400 },
    { type: 'text', fontFamily: 'Montserrat', fontWeight: 700 },
    { type: 'text', fontFamily: 'Montserrat', fontWeight: 400 },
  ],
};

describe('fontsUsedInOutput', () => {
  it('finds every family and weight, however deeply nested', () => {
    const used = fontsUsedInOutput({ tracks: [{ clips: output.clips }] });
    expect([...used.keys()].sort()).toEqual(['Bebas Neue', 'Montserrat']);
    expect([...used.get('Montserrat')!].sort()).toEqual([400, 700]);
  });

  it('ignores a family that is not in the catalog, since it goes into a URL', () => {
    const used = fontsUsedInOutput({ clips: [{ fontFamily: 'evil"><script>' }] });
    expect(used.size).toBe(0);
  });
});

describe('buildFramePage', () => {
  const page = buildFramePage({
    outputLiteral: '{}',
    baseUrlLiteral: '"http://x"',
    baseUrl: 'http://x',
    script: 'window.__FRAME_API = {preload:function(){},renderFrame:function(){}};',
    fontLinks: fontLinksForOutput(output),
  });

  it('injects a stylesheet for every family the composition uses', () => {
    expect(page).toContain('fonts.googleapis.com');
    expect(page).toContain('Bebas+Neue');
    expect(page).toContain('Montserrat');
    // Weights are narrowed to what Google serves for the family.
    expect(page).toMatch(/Montserrat:wght@[\d;]*400[\d;]*/);
  });

  it('waits for the faces before announcing the API the capture loop polls', () => {
    expect(page).toContain('document.fonts');
    expect(page).toContain('window.__FRAME_API = api');
    // The API must be cleared first, or the loop starts on an unfonted frame.
    expect(page.indexOf('window.__FRAME_API = undefined')).toBeLessThan(
      page.indexOf('window.__FRAME_API = api')
    );
  });

  it('renders an initial frame only when one is asked for', () => {
    expect(page).not.toContain('renderFrame(');
    const preview = buildFramePage({
      outputLiteral: '{}',
      baseUrlLiteral: '"http://x"',
      baseUrl: 'http://x',
      script: '',
      initialFrame: 12,
      fontLinks: '',
    });
    expect(preview).toContain('api.renderFrame(12)');
  });
});

/**
 * The page cannot import, so it carries hand-written copies of shared logic.
 * These pin the copies to the originals — the previous copy had already drifted
 * into emitting `brightness(NaN)`, which CSS discards, silently dropping every
 * adjustment on a clip.
 */
describe('frame renderer inlined copies', () => {
  const mapFilterToken = new Function(
    `${/function mapFilterToken\(token\)[\s\S]*?\n  }/.exec(FRAME_RENDERER_SCRIPT)![0]}
     return mapFilterToken;`
  )() as (token: string) => string;

  it('agrees with cssFilterForToken on every real token', () => {
    const tokens = [
      'grayscale',
      'sepia',
      'blur:4',
      'brightness:0.5',
      'contrast:1.4',
      'saturate:2',
    ];
    for (const token of tokens) {
      const parsed = parseDesignerFilterToken(token)!;
      expect(mapFilterToken(token)).toBe(cssFilterForToken(parsed.key, parsed.value));
    }
  });

  it('emits nothing — never NaN — for a malformed token', () => {
    for (const token of ['brightness', 'contrast:', 'saturate:abc', 'nonsense:1']) {
      expect(mapFilterToken(token)).toBe('');
    }
  });

  it('quotes the font family, so a multi-word family is a valid shorthand', () => {
    const fontLines = FRAME_RENDERER_SCRIPT.split('\n').filter((l) =>
      l.includes('ctx.font =')
    );
    expect(fontLines.length).toBeGreaterThan(0);
    for (const line of fontLines) {
      expect(line).toMatch(/"/);
    }
  });

  it('reads the gradient field the schema actually has', () => {
    expect(FRAME_RENDERER_SCRIPT).not.toContain('gradient.colors');
    expect(FRAME_RENDERER_SCRIPT).toContain('output.bg.gradient.stops');
  });
});
