import { describe, it, expect } from 'vitest';
import { escapeForScriptTag } from './frame-renderer-script';

describe('escapeForScriptTag (0.2 </script> breakout)', () => {
  it('neutralizes a </script> breakout in a user-controlled composition value', () => {
    const output = { name: '</script><script>window.__pwned=1</script>' };
    const escaped = escapeForScriptTag(output);

    // The literal closing tag must not survive — no way to end the inline <script>.
    expect(escaped).not.toContain('</script>');
    expect(escaped.toLowerCase()).not.toContain('</script');
    expect(escaped).toContain('\\u003c');

    // Still valid JSON that parses back to the original string (browser sees inert data).
    expect(JSON.parse(escaped)).toEqual(output);
  });

  it('escapes U+2028 / U+2029 line separators that break JS string literals', () => {
    const LS = String.fromCharCode(0x2028);
    const PS = String.fromCharCode(0x2029);
    const raw = `a${LS}b${PS}c`;
    const escaped = escapeForScriptTag(raw);
    expect(escaped).toContain('\\u2028');
    expect(escaped).toContain('\\u2029');
    expect(escaped).not.toContain(LS);
    expect(escaped).not.toContain(PS);
    expect(JSON.parse(escaped)).toBe(raw);
  });

  it('leaves ordinary values intact (round-trips through JSON)', () => {
    const value = { width: 1080, tracks: [{ clips: [{ src: 'https://x/y.png' }] }] };
    expect(JSON.parse(escapeForScriptTag(value))).toEqual(value);
  });
});
